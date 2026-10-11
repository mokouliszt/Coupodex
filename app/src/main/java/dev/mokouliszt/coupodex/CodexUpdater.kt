package dev.mokouliszt.coupodex

import android.content.Context
import android.content.res.AssetManager
import android.net.ConnectivityManager
import android.system.Os
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import kotlin.coroutines.coroutineContext

/**
 * 同梱の Codex を起動できる状態にし、APK の更新を待たずに新しい版へ入れ替える。
 *
 * Codex の実行には2つのファイルが要る。
 *  - codex-app-server: 本体
 *  - codex-code-mode-host: code mode（モデルが書いた JavaScript からツールを呼ぶ仕組み）の実行役。
 *    現行のモデルは web 検索もここを通して呼ぶ。app-server は自分と同じフォルダからこれを探す
 * どちらも filesDir/codex-bin/<版>/ に並べて置く。同梱版の本体は assets から展開し、
 * host はインストール時に展開されたネイティブライブラリへのシンボリックリンクにする。
 *
 * 起動時に openai/codex の最新リリースを GitHub に問い合わせ、新しい版があれば両方を取得し、
 * GitHub が公開している SHA-256 と照合し、試しに起動してから以後はそれを使う。
 * 新しいモデルはそれに対応した Codex にしか一覧されないため、モデルの追加に追従するには
 * ここが欠かせない。
 *
 * アプリの保存領域にある実行ファイルを起動できるのは targetSdk 28 以下のアプリだけ。
 * Coupodex の targetSdk が 28 なのはこのため（Termux と同じ判断）。
 * 取得した版が起動できなかった場合は、同梱の版に戻す。
 */
object CodexUpdater {

    private const val SERVER_ASSET = "codex-app-server-aarch64-unknown-linux-musl.tar.gz"
    private const val SERVER_ENTRY = "codex-app-server-aarch64-unknown-linux-musl"
    private const val HOST_ASSET = "codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz"
    private const val HOST_ENTRY = "codex-code-mode-host-aarch64-unknown-linux-musl"
    private const val SERVER_NAME = "codex-app-server"
    /** app-server が探す名前（変えられない）。 */
    private const val HOST_NAME = "codex-code-mode-host"
    private const val HOST_LIB = "libcodex_code_mode_host.so"
    private const val BUNDLED_SERVER = "codex/codex-app-server"
    private const val CHECK_INTERVAL_MS = 60 * 60 * 1000L

    class Part(val url: String, val size: Long, val sha256: String?)
    /** [host] が null のリリースでは、同梱の host を使う。 */
    class Release(val version: String, val server: Part, val host: Part?)

    /** codex-bin の中身を書き換える処理（展開・入れ替え・掃除）を順番に行わせる。 */
    private val mutex = Mutex()

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("codex_update", Context.MODE_PRIVATE)
    private fun dir(ctx: Context) = File(ctx.filesDir, "codex-bin")
    private fun staging(ctx: Context) = File(ctx.filesDir, "codex-staging")
    private fun bundledHost(ctx: Context) = File(ctx.applicationInfo.nativeLibraryDir, HOST_LIB)

    val bundledVersion: String get() = BuildConfig.CODEX_VERSION

    /** この端末で Codex を動かせるか。host は arm64 の端末にしか展開されない。 */
    fun isSupported(ctx: Context): Boolean = bundledHost(ctx).isFile

    /** 次に起動する Codex の版。 */
    fun activeVersion(ctx: Context): String {
        val v = prefs(ctx).getString("current", null) ?: return bundledVersion
        val f = File(dir(ctx), "$v/$SERVER_NAME")
        return if (f.canExecute() && compare(v, bundledVersion) > 0 && !isBad(ctx, v)) v else bundledVersion
    }

    /** 同梱版をまだ展開していない（次の起動に数秒かかる）。 */
    fun needsPrepare(ctx: Context): Boolean =
        !File(dir(ctx), "${activeVersion(ctx)}/$SERVER_NAME").canExecute()

    /**
     * [version] の Codex を起動できる状態にし、app-server の実行ファイルを返す。
     * 同梱版なら本体を assets から展開し、どの版でも隣に host を用意する。
     * 使っていない版のフォルダはここで消すので、Codex を起動していないときだけ呼ぶこと。
     */
    suspend fun prepare(ctx: Context, version: String): File = withContext(Dispatchers.IO) {
        mutex.withLock {
            if (!isSupported(ctx)) throw CodexException("この端末では Codex を実行できません（arm64 端末のみ対応）")
            val vdir = File(dir(ctx), version).apply { mkdirs() }
            val server = File(vdir, SERVER_NAME)
            if (version == bundledVersion) {
                if (!server.canExecute()) extractBundled(ctx, server)
                // アプリを更新するとネイティブライブラリの場所が変わるので、毎回張り直す
                linkHost(ctx, File(vdir, HOST_NAME), replace = true)
            } else {
                if (!server.canExecute()) throw CodexException("Codex $version が見つかりません")
                // host を取得できなかった版は、同梱の host で代用する
                linkHost(ctx, File(vdir, HOST_NAME), replace = false)
            }
            // 同梱版も、取得した版を使っている間は不要（戻すときに展開し直せる）
            dir(ctx).listFiles()?.forEach { if (it.name != version) it.deleteRecursively() }
            server
        }
    }

    private fun extractBundled(ctx: Context, target: File) {
        val tmp = File(target.parentFile, "$SERVER_NAME.part")
        val md = MessageDigest.getInstance("SHA-256")
        try {
            ctx.assets.open(BUNDLED_SERVER, AssetManager.ACCESS_STREAMING).use { input ->
                FileOutputStream(tmp).use { out ->
                    val buf = ByteArray(1 shl 16)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        md.update(buf, 0, n)
                    }
                    out.fd.sync()
                }
            }
        } catch (e: IOException) {
            tmp.delete()
            throw CodexException("Codex を展開できませんでした。端末の空き容量（200MB ほど必要）を確認してください")
        }
        if (!hex(md.digest()).equals(BuildConfig.CODEX_SHA256, ignoreCase = true)) {
            tmp.delete()
            throw CodexException("同梱の Codex が壊れています。アプリを入れ直してください")
        }
        if (!tmp.setExecutable(true, true) || !tmp.renameTo(target)) {
            tmp.delete()
            throw CodexException("Codex を展開できませんでした")
        }
    }

    /**
     * [link] に同梱の host へのシンボリックリンクを置く。
     * [replace] が false なら、取得した本物の host がある場合はそのままにする。
     */
    private fun linkHost(ctx: Context, link: File, replace: Boolean) {
        val target = bundledHost(ctx).path
        val current = runCatching { Os.readlink(link.path) }.getOrNull()
        if (current == target) return
        if (!replace && current == null && link.isFile) return
        link.delete()
        try {
            Os.symlink(target, link.path)
        } catch (e: Exception) {
            throw CodexException("Codex の準備に失敗しました（${e.message}）")
        }
    }

    /** 取得した版が起動できなかった。以後は使わない。 */
    fun markBad(ctx: Context, version: String) {
        if (version == bundledVersion) return
        val bad = prefs(ctx).getStringSet("bad", emptySet())!!.toMutableSet().apply { add(version) }
        prefs(ctx).edit().putStringSet("bad", bad).remove("current").apply()
    }

    private fun isBad(ctx: Context, v: String) = prefs(ctx).getStringSet("bad", emptySet())!!.contains(v)

    fun status(ctx: Context): JSONObject = JSONObject()
        .put("active", activeVersion(ctx))
        .put("bundled", bundledVersion)
        .put("latest", prefs(ctx).getString("latest", "") ?: "")
        .put("checkedAt", prefs(ctx).getLong("checkedAt", 0))

    fun isMetered(ctx: Context): Boolean =
        runCatching { ctx.getSystemService(ConnectivityManager::class.java).isActiveNetworkMetered }.getOrDefault(true)

    fun shouldCheck(ctx: Context): Boolean =
        System.currentTimeMillis() - prefs(ctx).getLong("checkedAt", 0) > CHECK_INTERVAL_MS

    /** openai/codex の最新リリース。API の回数制限に掛かったときはリダイレクト先から読む。 */
    suspend fun latest(ctx: Context): Release = withContext(Dispatchers.IO) {
        val rel = runCatching { viaApi() }.getOrElse { viaRedirect() }
        prefs(ctx).edit().putString("latest", rel.version).putLong("checkedAt", System.currentTimeMillis()).apply()
        rel
    }

    private fun viaApi(): Release {
        val req = Request.Builder().url("https://api.github.com/repos/openai/codex/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", Net.USER_AGENT)
            .build()
        Net.http.newCall(req).execute().use { res ->
            check(res.isSuccessful) { "GitHub API ${res.code}" }
            val o = JSONObject(res.body!!.string())
            val version = versionOf(o.getString("tag_name"))
            val assets = o.getJSONArray("assets")
            var server: Part? = null
            var host: Part? = null
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val digest = a.optString("digest").takeIf { it.startsWith("sha256:") }?.removePrefix("sha256:")
                val part = Part(a.optString("browser_download_url"), a.optLong("size"), digest)
                when (a.optString("name")) {
                    SERVER_ASSET -> server = part
                    HOST_ASSET -> host = part
                }
            }
            return Release(version, server ?: error("release $version has no $SERVER_ASSET"), host)
        }
    }

    private fun viaRedirect(): Release {
        val client = Net.http.newBuilder().followRedirects(false).followSslRedirects(false).build()
        val req = Request.Builder().url("https://github.com/openai/codex/releases/latest")
            .header("User-Agent", Net.USER_AGENT).build()
        client.newCall(req).execute().use { res ->
            val loc = res.header("Location") ?: error("no redirect")
            val tag = loc.substringAfterLast("/tag/")
            val base = "https://github.com/openai/codex/releases/download/$tag"
            // 照合用の値は API からしか取れない。host の有無も、取得してみるまで分からない
            return Release(versionOf(tag), Part("$base/$SERVER_ASSET", 0, null), Part("$base/$HOST_ASSET", 0, null))
        }
    }

    private fun versionOf(tag: String) = tag.removePrefix("rust-v").removePrefix("v")

    fun isNewer(ctx: Context, rel: Release): Boolean =
        compare(rel.version, activeVersion(ctx)) > 0 && !isBad(ctx, rel.version)

    /** [rel] を取得・照合・展開し、試しに起動してから切り替える。入れた版を返す。 */
    suspend fun install(ctx: Context, rel: Release, onProgress: (Long, Long) -> Unit): String = withContext(Dispatchers.IO) {
        // 取得中のものは codex-bin の外に置く（prepare の掃除で消されないように）
        val stage = File(staging(ctx), rel.version)
        staging(ctx).deleteRecursively()
        stage.mkdirs()
        try {
            val known = rel.server.size > 0 && (rel.host == null || rel.host.size > 0)
            val total = if (known) rel.server.size + (rel.host?.size ?: 0) else 0L
            var base = 0L
            val report = { have: Long, partTotal: Long ->
                onProgress(base + have, if (known) total else base + partTotal)
            }
            val server = File(stage, SERVER_NAME)
            base = fetch(rel.server, File(stage, "server.tar.gz"), SERVER_ENTRY, server, required = true, report)
            smokeTest(server)
            val host = File(stage, HOST_NAME)
            if (rel.host != null && fetch(rel.host, File(stage, "host.tar.gz"), HOST_ENTRY, host, required = false, report) >= 0) {
                smokeTest(host)
            }
            mutex.withLock {
                val target = File(dir(ctx), rel.version)
                target.deleteRecursively()
                target.parentFile!!.mkdirs()
                check(stage.renameTo(target)) { "Codex を配置できませんでした" }
                prefs(ctx).edit().putString("current", rel.version).commit()
            }
            rel.version
        } finally {
            staging(ctx).deleteRecursively()
        }
    }

    /**
     * [part] を取得して照合し、アーカイブから [entry] を [out] に取り出す。取得したバイト数を返す。
     * [required] が false のときは、リリースに無ければ（404）-1 を返す。
     */
    private suspend fun fetch(
        part: Part,
        tgz: File,
        entry: String,
        out: File,
        required: Boolean,
        onProgress: (Long, Long) -> Unit,
    ): Long {
        val client = Net.http.newBuilder().readTimeout(120, TimeUnit.SECONDS).build()
        val md = MessageDigest.getInstance("SHA-256")
        var have = 0L
        client.newCall(Request.Builder().url(part.url).header("User-Agent", Net.USER_AGENT).build()).execute().use { res ->
            if (!required && res.code == 404) return -1
            check(res.isSuccessful) { "ダウンロードに失敗しました（${res.code}）" }
            val body = res.body!!
            val total = if (part.size > 0) part.size else body.contentLength()
            var last = 0L
            tgz.outputStream().use { o ->
                val input = body.byteStream()
                val buf = ByteArray(1 shl 16)
                while (true) {
                    coroutineContext.ensureActive()
                    val n = input.read(buf)
                    if (n < 0) break
                    o.write(buf, 0, n)
                    md.update(buf, 0, n)
                    have += n
                    val now = System.currentTimeMillis()
                    if (now - last > 300) { last = now; onProgress(have, total) }
                }
            }
            onProgress(have, total)
        }
        if (part.sha256 != null && !part.sha256.equals(hex(md.digest()), ignoreCase = true)) {
            tgz.delete()
            error("ダウンロードした Codex の検証に失敗しました")
        }
        val tmp = File(out.parentFile, out.name + ".part")
        extract(tgz, entry, tmp)
        tgz.delete()
        check(tmp.setExecutable(true, true)) { "実行権限を設定できませんでした" }
        check(tmp.renameTo(out)) { "Codex を配置できませんでした" }
        return have
    }

    private fun smokeTest(bin: File) {
        val p = ProcessBuilder(bin.absolutePath, "--help").redirectErrorStream(true).start()
        val out = p.inputStream.bufferedReader().readText()
        val ok = p.waitFor(20, TimeUnit.SECONDS) && p.exitValue() == 0 && out.contains("--listen")
        if (!ok) {
            p.destroy()
            error("新しい Codex を起動できませんでした（${bin.name}）")
        }
    }

    /** 最小限の ustar 読み取り。リリースアーカイブから [entry] だけを取り出す。 */
    private fun extract(tgz: File, entry: String, out: File) {
        GZIPInputStream(BufferedInputStream(FileInputStream(tgz), 1 shl 16)).use { gz ->
            val header = ByteArray(512)
            while (true) {
                if (!readFully(gz, header) || header.all { it == 0.toByte() }) error("$entry not found in archive")
                val name = String(header, 0, 100, Charsets.UTF_8).trimEnd('\u0000')
                val prefix = String(header, 345, 155, Charsets.UTF_8).trimEnd('\u0000')
                val full = if (prefix.isNotEmpty()) "$prefix/$name" else name
                val size = String(header, 124, 12, Charsets.US_ASCII).trim('\u0000', ' ').ifEmpty { "0" }.toLong(8)
                val type = header[156].toInt().toChar()
                val padded = (size + 511) / 512 * 512
                if ((type == '0' || type == '\u0000') && (full == entry || full.endsWith("/$entry"))) {
                    out.outputStream().use { o -> copyExactly(gz, o, size) }
                    return
                }
                skipExactly(gz, padded)
            }
        }
    }

    private fun readFully(input: InputStream, buf: ByteArray): Boolean {
        var off = 0
        while (off < buf.size) {
            val n = input.read(buf, off, buf.size - off)
            if (n < 0) return false
            off += n
        }
        return true
    }

    private fun copyExactly(input: InputStream, out: java.io.OutputStream, size: Long) {
        val buf = ByteArray(1 shl 16)
        var left = size
        while (left > 0) {
            val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) error("archive truncated")
            out.write(buf, 0, n)
            left -= n
        }
    }

    private fun skipExactly(input: InputStream, size: Long) {
        val buf = ByteArray(1 shl 16)
        var left = size
        while (left > 0) {
            val n = input.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (n < 0) error("archive truncated")
            left -= n
        }
    }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    fun compare(a: String, b: String): Int {
        fun parts(v: String) = v.split('-', limit = 2)[0].split('.').map { it.toIntOrNull() ?: 0 }
        val x = parts(a); val y = parts(b)
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = x.getOrElse(i) { 0 } - y.getOrElse(i) { 0 }
            if (d != 0) return d
        }
        return 0
    }
}
