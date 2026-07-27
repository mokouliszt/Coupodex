package dev.mokouliszt.coupodex

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import kotlin.math.max

/** 撮影・選択された画像を回転補正＋縮小して photos/<id>.jpg に保存する。 */
object Photos {

    private const val MAX_EDGE = 1600

    fun import(context: Context, uri: Uri, photosDir: File): String? {
        val raw = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        val rotated = normalize(raw) ?: return null
        val id = UUID.randomUUID().toString().replace("-", "").take(16)
        File(photosDir, "$id.jpg").writeBytes(rotated)
        return id
    }

    fun bytes(photosDir: File, id: String): ByteArray? =
        File(photosDir, "$id.jpg").takeIf { it.exists() }?.readBytes()

    private fun normalize(raw: ByteArray): ByteArray? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        val longEdge = max(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (longEdge / sample > MAX_EDGE * 2) sample *= 2
        val bmp = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply {
            inSampleSize = sample
        }) ?: return null

        val orientation = runCatching {
            ExifInterface(raw.inputStream()).getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
            )
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

        val m = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
        }
        val scale = MAX_EDGE.toFloat() / max(bmp.width, bmp.height)
        if (scale < 1f) m.postScale(scale, scale)

        val out = if (m.isIdentity) bmp
        else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)

        val bos = ByteArrayOutputStream()
        out.compress(Bitmap.CompressFormat.JPEG, 88, bos)
        if (out !== bmp) out.recycle()
        bmp.recycle()
        return bos.toByteArray()
    }
}

/** 現在地取得。Play Services に依存せず LocationManager だけで完結させる。 */
object Geo {

    fun hasPermission(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    /** 直近の位置を即返し、無ければ単発測位を待つ（timeoutMs）。 */
    fun locate(context: Context, timeoutMs: Long = 9000, cb: (Location?) -> Unit) {
        if (!hasPermission(context)) { cb(null); return }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
        if (lm == null) { cb(null); return }

        val providers = listOfNotNull(
            LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER,
            if (android.os.Build.VERSION.SDK_INT >= 31) LocationManager.FUSED_PROVIDER else null,
        ).filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }

        val fresh = System.currentTimeMillis() - 3 * 60_000
        val last = providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
        if (last != null && last.time > fresh) { cb(last); return }

        if (providers.isEmpty()) { cb(last); return }

        var done = false
        val handler = android.os.Handler(Looper.getMainLooper())
        lateinit var listener: LocationListener
        val finish = { loc: Location? ->
            if (!done) {
                done = true
                runCatching { lm.removeUpdates(listener) }
                cb(loc ?: last)
            }
        }
        listener = LocationListener { loc -> handler.post { finish(loc) } }
        providers.forEach {
            runCatching { lm.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
        }
        handler.postDelayed({ finish(null) }, timeoutMs)
    }
}
