package dev.mokouliszt.coupodex

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import java.util.concurrent.atomic.AtomicInteger

/**
 * 解析・チャットの実行中だけ前面サービスを立てる。
 *
 * これが無いと、アプリをバックグラウンドに送った直後に
 * プロセスが cached → frozen 扱いになり、通信中のソケットが
 * "Software caused connection abort" で切られる（Android 12+ の App Freezer）。
 * 前面サービスを持つプロセスは凍結対象から外れるので、
 * 別アプリを触っていても応答を最後まで受け取れる。
 */
class RequestService : Service() {

    companion object {
        private const val CHANNEL = "codex_request"
        private const val NOTIF_ID = 4711

        /** 同時に走るリクエスト数。0→1 で起動、1→0 で停止。 */
        private val active = AtomicInteger(0)

        fun begin(context: Context) {
            if (active.incrementAndGet() == 1) {
                val i = Intent(context, RequestService::class.java)
                runCatching { ContextCompat.startForegroundService(context.applicationContext, i) }
            }
        }

        fun end(context: Context) {
            if (active.decrementAndGet() <= 0) {
                active.set(0)
                runCatching { context.applicationContext.stopService(Intent(context, RequestService::class.java)) }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        runCatching { startForeground(NOTIF_ID, notification()) }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "実行中の処理", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "クーポンの読み取りや検索が終わるまで表示されます"
                    setShowBadge(false)
                }
            )
        }
        val tap = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle("処理中")
            .setContentText("読み取り・検索が終わるまで接続を保っています")
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentIntent(tap)
            .setOngoing(true)
            .build()
    }
}
