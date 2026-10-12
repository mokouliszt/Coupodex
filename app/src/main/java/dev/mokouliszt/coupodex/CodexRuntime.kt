package dev.mokouliszt.coupodex

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.OutputStreamWriter
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

class CodexException(message: String, val needLogin: Boolean = false) : Exception(message)

/** ストリーム中のイベント。UI へそのまま流す。 */
sealed class CodexEvent {
    /** 回答の本文（逐次）。 */
    data class Delta(val text: String) : CodexEvent()
    /** 進捗の表示用（web検索中・コマンド・途中経過のひとこと）。 */
    data class Tool(val label: String) : CodexEvent()
    /** 最後の回答メッセージ全体。JSON を取り出すときはこちらを使う。 */
    data class Final(val text: String) : CodexEvent()
}

/**
 * 同梱の公式 Codex app-server を stdio 上の JSON-RPC で動かす（実行ファイルの用意は CodexUpdater）。
 *
 * このアプリは ChatGPT のバックエンドを直接呼ばない。ログイン、トークンの更新、
 * モデルの呼び出しはすべて Codex 自身が行う。ここではプロセスを起こし、Android 上で
 * 通信できる環境を整え、公開されている app-server のプロトコル
 * （initialize、account/read、model/list、thread/start、turn/start など）を話すだけ。
 */
object CodexRuntime {

    private const val CLIENT_NAME = "coupodex"
    private const val MODEL_CACHE_MS = 10 * 60 * 1000L

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val writeLock = Any()
    private val ids = AtomicLong(1)
    private val pending = ConcurrentHashMap<Long, CompletableDeferred<JSONObject>>()
    private val _events = MutableSharedFlow<JSONObject>(extraBufferCapacity = 512)
    private val events: SharedFlow<JSONObject> = _events

    private val proxy by lazy { LocalProxy() }
    @Volatile private var process: Process? = null
    @Volatile private var writer: BufferedWriter? = null
    private val stderrTail = ArrayDeque<String>()
    private val busy = AtomicInteger(0)

    @Volatile private var modelCache: Pair<Long, JSONArray>? = null

    /**
     * ログイン状態。初回は保存済みの資格情報（auth.json）の有無から決め、
     * Codex に確認できた時点で上書きする。UI はこれを購読する。
     */
    val loggedInFlow = MutableStateFlow(false)
    @Volatile private var loginKnown = false

    /** 実行中（または次に起動する）Codex の版。 */
    @Volatile var runningVersion: String = ""
        private set

    private fun home(ctx: Context) = File(ctx.filesDir, "codex").apply { mkdirs() }

    /** Codex を起動せずに、保存済みのログインがあるかを返す。 */
    fun isLoggedIn(ctx: Context): Boolean {
        if (!loginKnown) {
            val home = home(ctx.applicationContext)
            LegacyAuth.migrate(ctx.applicationContext, home)
            loggedInFlow.value = File(home, "auth.json").isFile
            loginKnown = true
        }
        return loggedInFlow.value
    }

    private fun setLoggedIn(v: Boolean) {
        loginKnown = true
        if (loggedInFlow.value != v) modelCache = null
        loggedInFlow.value = v
    }

    /** 必要なら app-server を起こし、initialize まで済ませる。 */
    suspend fun ensure(ctx: Context) = lock.withLock {
        if (process?.isAlive == true) return@withLock
        val app = ctx.applicationContext
        isLoggedIn(app) // 旧版で保存したトークンの移し替えを先に済ませる
        val version = CodexUpdater.activeVersion(app)
        try {
            start(app, CodexUpdater.prepare(app, version), version)
        } catch (e: CancellationException) {
            stop()
            throw e
        } catch (e: Exception) {
            if (version == CodexUpdater.bundledVersion) throw e
            // 取得した版が起動できない場合は使うのをやめ、同梱の版に戻す
            stop()
            CodexUpdater.markBad(app, version)
            val bundled = CodexUpdater.bundledVersion
            start(app, CodexUpdater.prepare(app, bundled), bundled)
        }
    }

    /** 同梱版の展開を先に済ませておく。初めての読み取りを数秒待たせないため。 */
    suspend fun warmUp(ctx: Context) = lock.withLock {
        if (process?.isAlive == true) return@withLock
        val app = ctx.applicationContext
        if (CodexUpdater.needsPrepare(app)) CodexUpdater.prepare(app, CodexUpdater.activeVersion(app))
    }

    /** 処理中でなければ止める。次の要求で、更新後の版が起動する。 */
    fun stopIfIdle(): Boolean {
        if (busy.get() > 0 || process == null) return false
        stop()
        return true
    }

    private suspend fun start(ctx: Context, bin: File, version: String) = withContext(Dispatchers.IO) {
        if (!bin.isFile) throw CodexException("Codex 本体が見つかりません（arm64 端末のみ対応）")
        runningVersion = version
        val home = home(ctx)
        val work = File(ctx.filesDir, "workspace").apply { mkdirs() }
        val userHome = File(ctx.filesDir, "home").apply { mkdirs() }
        val ca = writeCaBundle(home)
        val proxyUrl = proxy.url()

        val pb = ProcessBuilder(
            bin.absolutePath, "--listen", "stdio://",
            // プラグインやアプリ連携のカタログ同期はこのアプリでは使わず、通信量が増えるだけ
            "-c", "features.plugins=false",
            "-c", "features.apps=false",
        ).directory(work)
        pb.environment().apply {
            put("HOME", userHome.absolutePath)
            put("CODEX_HOME", home.absolutePath)
            put("TMPDIR", ctx.cacheDir.absolutePath)
            put("LANG", "C.UTF-8")
            put("RUST_LOG", "warn")
            put("HTTPS_PROXY", proxyUrl)
            put("HTTP_PROXY", proxyUrl)
            put("ALL_PROXY", proxyUrl)
            put("NO_PROXY", "localhost,127.0.0.1,::1")
            put("SSL_CERT_FILE", ca.absolutePath)
            put("CODEX_CA_CERTIFICATE", ca.absolutePath)
        }
        val p = try {
            pb.start()
        } catch (e: java.io.IOException) {
            throw CodexException("Codex を起動できませんでした（${e.message}）")
        }
        process = p
        writer = BufferedWriter(OutputStreamWriter(p.outputStream, Charsets.UTF_8))

        Thread({
            runCatching {
                p.inputStream.bufferedReader(Charsets.UTF_8).forEachLine { line -> handleLine(line) }
            }
            onExit(p)
        }, "codex-stdout").apply { isDaemon = true }.start()
        Thread({
            runCatching {
                p.errorStream.bufferedReader(Charsets.UTF_8).forEachLine { line ->
                    synchronized(stderrTail) {
                        stderrTail.addLast(line.replace(Regex("\u001B\\[[0-9;]*m"), ""))
                        while (stderrTail.size > 40) stderrTail.removeFirst()
                    }
                }
            }
        }, "codex-stderr").apply { isDaemon = true }.start()

        val init = JSONObject()
            .put("clientInfo", JSONObject()
                .put("name", CLIENT_NAME)
                .put("title", "Coupodex")
                .put("version", BuildConfig.VERSION_NAME))
        requestRaw("initialize", init, 30_000)
        notify("initialized", null)
    }

    private fun onExit(p: Process) {
        if (process === p) {
            process = null
            writer = null
        }
        val reason = CodexException("Codex が終了しました" + lastError().let { if (it.isBlank()) "" else ": $it" })
        pending.values.forEach { it.completeExceptionally(reason) }
        pending.clear()
        _events.tryEmit(JSONObject().put("method", "local/exited"))
    }

    private fun lastError(): String = synchronized(stderrTail) {
        stderrTail.lastOrNull { it.contains("ERROR") || it.contains("error") }?.take(300) ?: ""
    }

    fun stop() {
        process?.destroy()
        process = null
    }

    // ---- JSON-RPC ----

    private fun handleLine(line: String) {
        val msg = runCatching { JSONObject(line) }.getOrNull() ?: return
        val method = msg.optString("method", "")
        if (msg.has("id") && method.isEmpty()) {
            val id = msg.optLong("id", -1)
            pending.remove(id)?.complete(msg)
            return
        }
        if (method.isNotEmpty() && msg.has("id")) {
            answerServerRequest(msg)
            return
        }
        if (method.isNotEmpty()) _events.tryEmit(msg)
    }

    /**
     * 承認なしで動かしているので、本来ここには来ない。
     * 来た場合は断って、ターンを止めたままにしない。
     */
    private fun answerServerRequest(msg: JSONObject) {
        val method = msg.optString("method")
        val reply = JSONObject().put("id", msg.get("id"))
        if (method.contains("Approval", ignoreCase = true) || method.endsWith("requestApproval")) {
            reply.put("result", JSONObject().put("decision", "decline"))
        } else {
            reply.put("error", JSONObject().put("code", -32601).put("message", "not supported by this client"))
        }
        runCatching { write(reply) }
    }

    private fun write(obj: JSONObject) {
        val w = writer ?: throw CodexException("Codex が起動していません")
        synchronized(writeLock) {
            w.write(obj.toString())
            w.write("\n")
            w.flush()
        }
    }

    private fun notify(method: String, params: JSONObject?) {
        val o = JSONObject().put("method", method)
        if (params != null) o.put("params", params)
        write(o)
    }

    private suspend fun requestRaw(method: String, params: JSONObject, timeoutMs: Long): JSONObject {
        val id = ids.getAndIncrement()
        val d = CompletableDeferred<JSONObject>()
        pending[id] = d
        try {
            write(JSONObject().put("id", id).put("method", method).put("params", params))
            val res = timed(timeoutMs, "Codex から応答がありません（$method）") { d.await() }
            res.optJSONObject("error")?.let { err ->
                val m = err.optString("message", "Codex のエラー")
                throw CodexException(m, needLogin = isAuthError(m))
            }
            return res.optJSONObject("result") ?: JSONObject()
        } finally {
            pending.remove(id)
        }
    }

    private suspend fun request(ctx: Context, method: String, params: JSONObject = JSONObject(), timeoutMs: Long = 60_000): JSONObject {
        ensure(ctx)
        return requestRaw(method, params, timeoutMs)
    }

    // ---- アカウント ----

    /** ChatGPT でログイン済みなら {email, planType} を返す。 */
    suspend fun account(ctx: Context): JSONObject? {
        val r = request(ctx, "account/read", JSONObject())
        val a = r.optJSONObject("account")?.takeIf { it.optString("type") == "chatgpt" }
        setLoggedIn(a != null)
        return a
    }

    /** ChatGPT へのログインを始める。authUrl か、verificationUrl と userCode が返る。 */
    suspend fun startLogin(ctx: Context, deviceCode: Boolean): JSONObject =
        request(ctx, "account/login/start", JSONObject().put("type", if (deviceCode) "chatgptDeviceCode" else "chatgpt"))

    /** ログインの完了通知を待つ。 */
    suspend fun awaitLogin(timeoutMs: Long = 15 * 60_000L): JSONObject {
        busy.incrementAndGet()
        try {
            val ev = timed(timeoutMs, "ログインの待ち時間を過ぎました。もう一度お試しください") {
                // ログインは同時に1つしか走らないので、届いた完了通知はそれのもの
                events.first {
                    val m = it.optString("method")
                    m == "account/login/completed" || m == "local/exited"
                }
            }
            if (ev.optString("method") == "local/exited") throw CodexException("Codex が終了しました")
            val p = ev.optJSONObject("params") ?: JSONObject()
            if (p.optBoolean("success")) setLoggedIn(true)
            return p
        } finally {
            busy.decrementAndGet()
        }
    }

    suspend fun cancelLogin(ctx: Context, loginId: String) {
        runCatching { request(ctx, "account/login/cancel", JSONObject().put("loginId", loginId), 10_000) }
    }

    suspend fun logout(ctx: Context) {
        request(ctx, "account/logout", JSONObject())
        setLoggedIn(false)
    }

    // ---- モデル ----

    /**
     * Codex がこのアカウントに提示しているモデル:
     * [{id, displayName, description, isDefault, defaultEffort, efforts[]}]
     *
     * アプリ側には一覧を持たない。一覧も各モデルの推論の深さも、実行中の Codex から取る。
     * Codex は自分の版以上を要求するモデルを一覧に出さないため、新しいモデルは
     * Codex の更新（CodexUpdater）とともに現れる。
     */
    suspend fun models(ctx: Context, fresh: Boolean = false): JSONArray {
        val cached = modelCache
        if (!fresh && cached != null && System.currentTimeMillis() - cached.first < MODEL_CACHE_MS) return cached.second
        val out = JSONArray()
        var cursor: String? = null
        var pages = 0
        do {
            val params = JSONObject().put("limit", 100)
            if (cursor != null) params.put("cursor", cursor)
            val r = request(ctx, "model/list", params)
            val data = r.optJSONArray("data") ?: JSONArray()
            for (i in 0 until data.length()) {
                val m = data.optJSONObject(i) ?: continue
                if (m.optBoolean("hidden")) continue
                val efforts = JSONArray()
                val se = m.optJSONArray("supportedReasoningEfforts") ?: JSONArray()
                for (j in 0 until se.length()) {
                    val e = se.opt(j)
                    val v = if (e is JSONObject) e.optString("reasoningEffort") else e?.toString()
                    if (!v.isNullOrBlank()) efforts.put(v)
                }
                out.put(JSONObject()
                    .put("id", m.optString("model", m.optString("id")))
                    .put("displayName", m.optString("displayName", m.optString("id")))
                    .put("description", m.optString("description").takeUnless { it == "null" } ?: "")
                    .put("isDefault", m.optBoolean("isDefault"))
                    .put("defaultEffort", m.optString("defaultReasoningEffort").takeUnless { it == "null" } ?: "")
                    .put("efforts", efforts))
            }
            cursor = r.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }
        } while (cursor != null && ++pages < 10)
        if (out.length() > 0) modelCache = System.currentTimeMillis() to out
        return out
    }

    class Choice(val model: String?, val effort: String?, val notice: String?)

    /**
     * 設定値を実行に使える形にする。空は Codex の既定に任せる。
     * 固定したモデルが一覧から消えていれば Codex の既定へ、
     * そのモデルが受け付けない推論の深さならモデルの既定へ戻す。
     */
    suspend fun resolve(ctx: Context, model: String?, effort: String?): Choice {
        var m = model?.takeIf { it.isNotBlank() }
        var e = effort?.takeIf { it.isNotBlank() }
        if (m == null && e == null) return Choice(null, null, null)
        val offered = runCatching { models(ctx) }.getOrNull()
        if (offered == null || offered.length() == 0) return Choice(m, e, null)
        val list = (0 until offered.length()).mapNotNull { offered.optJSONObject(it) }
        var notice: String? = null
        val pinned = m?.let { id -> list.firstOrNull { it.optString("id") == id } }
        if (m != null && pinned == null) {
            notice = "設定したモデル（$m）は現在使えないため、Codex のデフォルトで実行します"
            m = null
            e = null
        }
        val target = pinned ?: list.firstOrNull { it.optBoolean("isDefault") } ?: list.first()
        val efforts = target.optJSONArray("efforts")
        if (e != null && efforts != null && efforts.length() > 0 &&
            (0 until efforts.length()).none { efforts.optString(it) == e }
        ) {
            e = null
        }
        return Choice(m, e, notice)
    }

    // ---- ターン ----

    /**
     * 使い捨てのスレッドで1ターンだけ実行し、経過を流す。
     * web 検索は常に有効、承認は求めない（full-auto）。
     * 収集を止めると、走っているターンも中断させる。
     */
    fun stream(
        ctx: Context,
        instructions: String,
        input: JSONArray,
        model: String?,
        effort: String?,
        timeoutMs: Long = 10 * 60_000L,
    ): Flow<CodexEvent> = channelFlow {
        busy.incrementAndGet()
        try {
            if (process?.isAlive != true && CodexUpdater.needsPrepare(ctx)) send(CodexEvent.Tool("Codex を準備しています…"))
            ensure(ctx)
            val work = File(ctx.filesDir, "workspace").apply { mkdirs() }
            val threadParams = JSONObject()
                .put("ephemeral", true)
                .put("sandbox", "workspace-write")
                .put("approvalPolicy", "never")
                .put("cwd", work.absolutePath)
                .put("developerInstructions", instructions)
                .put("config", JSONObject().put("web_search", "live"))
            if (!model.isNullOrBlank()) threadParams.put("model", model)
            val thread = requestRaw("thread/start", threadParams, 60_000)
            val threadId = thread.optJSONObject("thread")?.optString("id")?.takeIf { it.isNotBlank() }
                ?: throw CodexException("スレッドを開始できませんでした")

            // 取りこぼさないよう、ターンを始める前に購読しておく。
            // 後片付けで inbox を閉じた直後に届いた通知で落ちないよう、trySend で渡す
            val inbox = Channel<JSONObject>(Channel.UNLIMITED)
            val collector = scope.launch {
                events.collect { ev ->
                    val p = ev.optJSONObject("params")
                    if (ev.optString("method") == "local/exited" || p?.optString("threadId") == threadId) inbox.trySend(ev)
                }
            }
            var turnId: String? = null
            var finished = false
            try {
                val turnParams = JSONObject().put("threadId", threadId).put("input", input)
                if (!effort.isNullOrBlank()) turnParams.put("effort", effort)
                turnId = requestRaw("turn/start", turnParams, 60_000).optJSONObject("turn")?.optString("id")

                // 途中経過のひとこと（commentary）は本文に混ぜず、進捗の表示に回す
                val phases = HashMap<String, String>()
                var lastItem: String? = null
                var answered = false
                var finalText: String? = null
                timed(timeoutMs, "処理が時間内に終わりませんでした") {
                    while (true) {
                        val ev = inbox.receive()
                        val p = ev.optJSONObject("params") ?: JSONObject()
                        when (ev.optString("method")) {
                            "item/started" -> {
                                val item = p.optJSONObject("item") ?: continue
                                when (item.optString("type")) {
                                    "agentMessage" -> item.optString("phase").takeIf { it.isNotBlank() && it != "null" }
                                        ?.let { phases[item.optString("id")] = it }
                                    "webSearch" -> send(CodexEvent.Tool("web検索中…"))
                                    "commandExecution" -> send(CodexEvent.Tool("$ " + item.optString("command")))
                                }
                            }
                            "item/agentMessage/delta" -> {
                                val itemId = p.optString("itemId")
                                if (phases[itemId] == "commentary") continue
                                val d = p.optString("delta")
                                if (d.isEmpty()) continue
                                if (answered && lastItem != null && itemId != lastItem) send(CodexEvent.Delta("\n\n"))
                                lastItem = itemId
                                answered = true
                                send(CodexEvent.Delta(d))
                            }
                            "item/completed" -> {
                                val item = p.optJSONObject("item") ?: continue
                                if (item.optString("type") == "webSearch") {
                                    // 開始時点では検索語が空のことがあるので、終わったときに出す
                                    item.optString("query").trim().takeIf { it.isNotEmpty() && it != "null" }?.let {
                                        send(CodexEvent.Tool("web検索: " + if (it.length > 50) it.take(50) + "…" else it))
                                    }
                                    continue
                                }
                                if (item.optString("type") != "agentMessage") continue
                                val text = item.optString("text")
                                val phase = item.optString("phase").takeIf { it.isNotBlank() && it != "null" }
                                    ?: phases[item.optString("id")]
                                if (phase == "commentary") {
                                    text.lineSequence().firstOrNull { it.isNotBlank() }?.trim()?.let {
                                        send(CodexEvent.Tool(if (it.length > 60) it.take(60) + "…" else it))
                                    }
                                } else {
                                    finalText = text
                                }
                            }
                            // 例: code mode を起動できない。回答はモデルが続けるので、記録だけ残す
                            "warning" -> Log.w("Coupodex", "Codex: " + p.optString("message").take(500))
                            "error" -> {
                                if (!p.optBoolean("willRetry")) {
                                    val m = p.optJSONObject("error")?.optString("message") ?: "Codex のエラー"
                                    throw CodexException(m, needLogin = isAuthError(m))
                                }
                            }
                            "turn/completed" -> {
                                val turn = p.optJSONObject("turn") ?: JSONObject()
                                if (turn.optString("status") != "completed") {
                                    val m = turn.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                                        ?: "処理が中断されました"
                                    throw CodexException(m, needLogin = isAuthError(m))
                                }
                                finished = true
                                val text = finalText.orEmpty()
                                // 本文が1文字も流れなかった場合（途中経過扱いだけで終わった等）は、最後に出す
                                if (!answered && text.isNotEmpty()) send(CodexEvent.Delta(text))
                                send(CodexEvent.Final(text))
                                break
                            }
                            "local/exited" -> throw CodexException("Codex が終了しました" + lastError().let { if (it.isBlank()) "" else ": $it" })
                        }
                    }
                }
            } finally {
                collector.cancel()
                inbox.close()
                val tid = turnId
                if (!finished && tid != null) {
                    scope.launch { runCatching { requestRaw("turn/interrupt", JSONObject().put("threadId", threadId).put("turnId", tid), 10_000) } }
                }
                // 使い終わったスレッドは購読をやめ、Codex 側で破棄させる
                scope.launch { runCatching { requestRaw("thread/unsubscribe", JSONObject().put("threadId", threadId), 10_000) } }
            }
        } catch (e: CodexException) {
            if (e.needLogin) setLoggedIn(false)
            throw e
        } finally {
            busy.decrementAndGet()
        }
    }

    private fun isAuthError(m: String) =
        m.contains("401") || m.contains("unauthorized", true) || m.contains("log in", true) || m.contains("login", true)

    /**
     * withTimeout の例外は CancellationException の一種で、呼び出し側では「利用者が止めた」と
     * 区別できず黙って捨てられてしまう。時間切れは通常の失敗として返す。
     */
    private suspend fun <T> timed(ms: Long, message: String, block: suspend () -> T): T =
        try {
            withTimeout(ms) { block() }
        } catch (e: TimeoutCancellationException) {
            throw CodexException(message)
        }

    // ---- TLS のルート証明書 ----

    /**
     * Android は信頼するルート証明書を /etc/ssl ではなく AndroidCAStore に持つ。
     * PEM にまとめて Codex に渡す（SSL_CERT_FILE / CODEX_CA_CERTIFICATE）。
     */
    private fun writeCaBundle(dir: File): File {
        val out = File(dir, "cacert.pem")
        val ks = KeyStore.getInstance("AndroidCAStore").apply { load(null) }
        val sb = StringBuilder()
        val now = System.currentTimeMillis()
        for (alias in ks.aliases()) {
            val cert = ks.getCertificate(alias) as? X509Certificate ?: continue
            if (cert.notAfter.time < now) continue
            val b64 = Base64.encodeToString(cert.encoded, Base64.NO_WRAP)
            sb.append("-----BEGIN CERTIFICATE-----\n")
            b64.chunked(64).forEach { sb.append(it).append('\n') }
            sb.append("-----END CERTIFICATE-----\n")
        }
        val tmp = File(dir, "cacert.pem.tmp")
        tmp.writeText(sb.toString())
        tmp.renameTo(out)
        return out
    }
}

/**
 * v1.0 までの Coupodex は自前の OAuth でログインし、トークンを
 * EncryptedSharedPreferences（codex_auth）に置いていた。
 * 同じクライアントIDで発行されたものなので、Codex の auth.json に移せば
 * 更新後もログインし直さずに使える。移したら古い保存先は消す。
 */
private object LegacyAuth {

    private const val PREFS = "codex_auth"

    fun migrate(ctx: Context, home: File) {
        val flags = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
        if (flags.getBoolean("legacyAuthMigrated", false)) return
        runCatching {
            val target = File(home, "auth.json")
            if (!target.isFile && File(ctx.applicationInfo.dataDir, "shared_prefs/$PREFS.xml").isFile) {
                val key = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
                val old = EncryptedSharedPreferences.create(
                    ctx, PREFS, key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
                val access = old.getString("access", null)
                val refresh = old.getString("refresh", null)
                val id = old.getString("id", null)
                if (!access.isNullOrBlank() && !refresh.isNullOrBlank() && !id.isNullOrBlank()) {
                    val tokens = JSONObject()
                        .put("id_token", id)
                        .put("access_token", access)
                        .put("refresh_token", refresh)
                        .put("account_id", old.getString("account", null) ?: JSONObject.NULL)
                    val auth = JSONObject()
                        .put("auth_mode", "chatgpt")
                        .put("OPENAI_API_KEY", JSONObject.NULL)
                        .put("tokens", tokens)
                        // 最後に更新した日時は分からないので古い日付にし、初回の利用時に Codex に更新させる
                        .put("last_refresh", "2000-01-01T00:00:00Z")
                    val tmp = File(home, "auth.json.tmp")
                    tmp.writeText(auth.toString())
                    tmp.setReadable(false, false); tmp.setReadable(true, true)
                    tmp.setWritable(false, false); tmp.setWritable(true, true)
                    if (!tmp.renameTo(target)) tmp.delete()
                }
                old.edit().clear().commit()
            }
        }
        flags.edit().putBoolean("legacyAuthMigrated", true).apply()
    }
}
