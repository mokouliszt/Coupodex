package dev.mokouliszt.coupodex

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var store: Store
    private lateinit var codex: CodexClient

    companion object {
        /** リクエストは Activity より長生きさせる（バックグラウンド化・再生成で切らない） */
        private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        private val jobs = ConcurrentHashMap<String, Job>()

        /** JS へイベントを届ける先。前面の Activity が自分を登録する。 */
        @Volatile
        private var sink: ((String, JSONObject) -> Unit)? = null

        /** 待っている ChatGPT ログイン（キャンセル用）。 */
        @Volatile private var loginReqId: String? = null
        @Volatile private var codexLoginId: String? = null

        /** Codex の更新確認はアプリの起動ごとに1回（さらに CodexUpdater 側で1時間に1回まで）。 */
        @Volatile private var startupChecked = false
        /** Codex 更新のダウンロード進捗。画面が作り直されても表示に復帰できるように持つ。 */
        @Volatile private var updateProgress: JSONObject? = null
    }

    /** 画面に紐づく購読用（Activity と一緒に死ぬ） */
    private val uiScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var pendingCaptureUri: Uri? = null
    private var lastLocation: JSONObject? = null

    // ---- Activity results ----

    private val takePicture =
        registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
            val uri = pendingCaptureUri
            pendingCaptureUri = null
            if (!ok || uri == null) { emit("photo", JSONObject().put("cancelled", true)); return@registerForActivityResult }
            importPhoto(uri)
        }

    private val pickImage =
        registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri == null) { emit("photo", JSONObject().put("cancelled", true)); return@registerForActivityResult }
            importPhoto(uri)
        }

    private val requestLocation =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            locateNow()
        }

    // ---- lifecycle ----

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        WindowCompat.setDecorFitsSystemWindows(window, false)

        store = Store(this)
        codex = CodexClient(this)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/photos/", WebViewAssetLoader.InternalStoragePathHandler(this, store.photosDir))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(0xFFFFF8F3.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100
            overScrollMode = View.OVER_SCROLL_NEVER
            addJavascriptInterface(Bridge(), "Native")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(req.url)

                override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                    val u = req.url
                    if (u.host == "appassets.androidplatform.net") return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) }
                    return true
                }

                override fun onPageFinished(v: WebView, url: String) = pushInsets()
            }
            loadUrl("https://appassets.androidplatform.net/assets/webui/index.html")
        }
        setContentView(web)

        ViewCompat.setOnApplyWindowInsetsListener(web) { _, insets -> pushInsets(insets); insets }

        sink = { type, payload -> deliver(type, payload) }

        CodexRuntime.isLoggedIn(this) // 保存済みのログイン状態を読み込んでから購読する
        uiScope.launch {
            CodexRuntime.loggedInFlow.collect { emit("auth", JSONObject().put("loggedIn", it)) }
        }
        startupCodexCheck()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // ログインを終えたブラウザから戻ってきたとき
        emit("auth", JSONObject().put("loggedIn", CodexRuntime.isLoggedIn(this)))
    }

    override fun onDestroy() {
        // 実行中のリクエストは止めない（バックグラウンドで完了させる）。
        // 届け先だけ外して、WebView が死んだあとに触らないようにする。
        if (!isChangingConfigurations) {
            sink = null
            if (jobs.isEmpty() && isFinishing) CodexRuntime.stopIfIdle()
        }
        uiScope.coroutineContext[Job]?.cancel()
        super.onDestroy()
    }

    // ---- insets → CSS 変数 ----

    private fun pushInsets(insets: WindowInsetsCompat? = null) {
        val i = insets ?: ViewCompat.getRootWindowInsets(web) ?: return
        val bars = i.getInsets(WindowInsetsCompat.Type.systemBars())
        val ime = i.getInsets(WindowInsetsCompat.Type.ime())
        val d = resources.displayMetrics.density
        val o = JSONObject()
            .put("top", bars.top / d)
            .put("bottom", bars.bottom / d)
            .put("ime", (if (ime.bottom > 0) ime.bottom - bars.bottom else 0) / d)
        emit("insets", o)
    }

    // ---- JS へイベント送出 ----

    private fun emit(type: String, payload: JSONObject) {
        (sink ?: return).invoke(type, payload)
    }

    private fun deliver(type: String, payload: JSONObject) {
        if (isDestroyed || isFinishing) return
        val json = payload.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        runOnUiThread {
            runCatching { web.evaluateJavascript("window.__native&&window.__native(\"$type\",$json)", null) }
        }
    }

    // ---- 写真 ----

    private fun importPhoto(uri: Uri) {
        uiScope.launch(Dispatchers.IO) {
            val id = Photos.import(this@MainActivity, uri, store.photosDir)
            if (id == null) emit("photo", JSONObject().put("error", "画像を読み込めませんでした"))
            else emit("photo", JSONObject().put("id", id).put("url", photoUrl(id)))
        }
    }

    private fun photoUrl(id: String) = "https://appassets.androidplatform.net/photos/$id.jpg"

    // ---- 位置 ----

    private fun locateNow() {
        if (!Geo.hasPermission(this)) {
            emit("location", JSONObject().put("denied", true)); return
        }
        Geo.locate(this) { loc ->
            if (loc == null) { emit("location", JSONObject().put("error", "現在地を取得できませんでした")); return@locate }
            val o = JSONObject()
                .put("lat", loc.latitude).put("lng", loc.longitude)
                .put("accuracy", loc.accuracy.toInt()).put("time", loc.time)
            lastLocation = o
            emit("location", o)
        }
    }

    // ---- Codex ----

    /**
     * AIを使う処理は必ずここを通す。未ログインなら実行せず、画面をログインへ戻す。
     */
    private fun requireLogin(reqId: String): Boolean {
        if (CodexRuntime.isLoggedIn(this)) return true
        emit("error", req(reqId).put("message", "ChatGPTにログインしてください").put("needLogin", true))
        return false
    }

    /** Codex の失敗を画面へ。ログインが切れていれば needLogin を付ける。 */
    private fun emitFailure(reqId: String, e: Throwable, fallback: String) {
        if (e is CancellationException) return
        emit("error", req(reqId)
            .put("message", e.message ?: fallback)
            .put("needLogin", (e as? CodexException)?.needLogin == true))
    }

    private fun runAnalyze(reqId: String, photoId: String) {
        if (!requireLogin(reqId)) return
        val bytes = Photos.bytes(store.photosDir, photoId)
        if (bytes == null) { emit("error", req(reqId).put("message", "写真が見つかりません")); return }
        val s = store.settings()
        val near = lastLocation?.let { "緯度 ${it.optDouble("lat")}, 経度 ${it.optDouble("lng")}" }
        val instructions = Prompts.extract(store.places(), s.optString("defaultPlace"), near)
        val msgs = listOf(
            Msg(
                "user",
                "この写真は紙のクーポンです。指定のJSONスキーマだけを返してください。",
                listOf(bytes)
            )
        )
        val buf = StringBuilder()
        var finalText: String? = null
        var failed = false
        launchRequest(reqId) {
            codex.run(instructions, msgs, s.optString("model"), s.optString("effort"))
                .catch { e ->
                    failed = true
                    emitFailure(reqId, e, "解析に失敗しました")
                }
                .collect { ev ->
                    when (ev) {
                        is CodexEvent.Delta -> buf.append(ev.text)
                        is CodexEvent.Tool -> emit("tool", req(reqId).put("label", ev.label))
                        is CodexEvent.Final -> finalText = ev.text
                    }
                }
            if (failed) return@launchRequest
            // 途中経過のひとことを含まない最後の回答を優先する
            val parsed = extractJson(finalText?.takeIf { it.isNotBlank() } ?: buf.toString())
            if (parsed == null) emit("error", req(reqId).put("message", "読み取り結果を解釈できませんでした"))
            else emit("analyzed", req(reqId).put("data", parsed).put("photo", photoId).put("url", photoUrl(photoId)))
        }
    }

    private fun runChat(reqId: String, payload: JSONObject) {
        if (!requireLogin(reqId)) return
        val s = store.settings()
        val instructions = Prompts.chat(store.load(), lastLocation, s.optInt("radius", 500))
        val arr = payload.optJSONArray("messages") ?: JSONArray()
        val msgs = ArrayList<Msg>()
        for (i in 0 until arr.length()) {
            val m = arr.optJSONObject(i) ?: continue
            msgs.add(Msg(m.optString("role", "user"), m.optString("content")))
        }
        if (msgs.isEmpty()) { emit("done", req(reqId)); return }
        var failed = false
        launchRequest(reqId) {
            codex.run(instructions, msgs, s.optString("model"), s.optString("effort"))
                .catch { e ->
                    failed = true
                    emitFailure(reqId, e, "通信に失敗しました")
                }
                .collect { ev ->
                    when (ev) {
                        is CodexEvent.Delta -> emit("delta", req(reqId).put("text", ev.text))
                        is CodexEvent.Tool -> emit("tool", req(reqId).put("label", ev.label))
                        is CodexEvent.Final -> {}
                    }
                }
            if (!failed) emit("done", req(reqId))
        }
    }

    private fun req(id: String) = JSONObject().put("reqId", id)

    /**
     * リクエストを起動する。実行中は前面サービスを立てて、
     * バックグラウンドでプロセスが凍結されソケットが切れるのを防ぐ。
     */
    private fun launchRequest(reqId: String, block: suspend () -> Unit) {
        val app = applicationContext
        RequestService.begin(app)
        jobs[reqId] = appScope.launch {
            try {
                block()
            } finally {
                jobs.remove(reqId)
                RequestService.end(app)
            }
        }
    }

    /** モデル出力から最初の JSON オブジェクトを取り出す。 */
    private fun extractJson(text: String): JSONObject? {
        val cleaned = text.replace("```json", "```").let {
            val f = it.indexOf("```")
            if (f >= 0) {
                val e = it.indexOf("```", f + 3)
                if (e > f) it.substring(f + 3, e) else it
            } else it
        }
        val start = cleaned.indexOf('{')
        val end = cleaned.lastIndexOf('}')
        if (start < 0 || end <= start) return null
        return runCatching { JSONObject(cleaned.substring(start, end + 1)) }.getOrNull()
    }

    // ---- Codex: ログイン・本体の更新 ----

    /**
     * ChatGPT へのログインは Codex に任せる。ブラウザ方式では Codex が端末内の
     * localhost:1455 で認可の戻りを受け取り、コード方式では表示したコードを入力してもらう。
     */
    private fun runLogin(reqId: String, device: Boolean) {
        val app = applicationContext
        loginReqId?.let { jobs.remove(it)?.cancel() }
        loginReqId = reqId
        RequestService.begin(app, "ChatGPTのログインを待っています")
        jobs[reqId] = appScope.launch {
            try {
                val r = CodexRuntime.startLogin(app, device)
                codexLoginId = r.optString("loginId").takeIf { it.isNotBlank() }
                emit("codexLoginStarted", req(reqId)
                    .put("device", device)
                    .put("verificationUrl", r.optString("verificationUrl"))
                    .put("userCode", r.optString("userCode")))
                if (!device) openBrowser(Uri.parse(r.optString("authUrl")))
                val done = try { CodexRuntime.awaitLogin() } finally { codexLoginId = null }
                if (!done.optBoolean("success")) {
                    throw CodexException(done.optString("error").takeUnless { it.isBlank() || it == "null" }
                        ?: "ChatGPTへのログインに失敗しました")
                }
                bringToFront()
                emit("auth", req(reqId).put("loggedIn", true))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                emit("loginFailed", req(reqId).put("message", e.message ?: "ChatGPTへのログインに失敗しました"))
            } finally {
                if (loginReqId == reqId) loginReqId = null
                jobs.remove(reqId)
                RequestService.end(app)
            }
        }
    }

    /** 起動時に openai/codex の新しいリリースを確認する（最大1時間に1回）。 */
    private fun startupCodexCheck() {
        if (startupChecked) return
        startupChecked = true
        val ctx = applicationContext
        appScope.launch {
            if (!CodexUpdater.isSupported(ctx)) return@launch
            // ログイン済みなら、初めての読み取りを待たせないよう同梱版の展開を先に済ませる
            if (CodexRuntime.isLoggedIn(ctx)) {
                runCatching { CodexRuntime.warmUp(ctx) }.onFailure { Log.w("Coupodex", "Codex warm-up failed", it) }
            }
            if (!CodexUpdater.shouldCheck(ctx)) return@launch
            val rel = runCatching { CodexUpdater.latest(ctx) }.getOrNull() ?: return@launch
            if (!CodexUpdater.isNewer(ctx, rel)) {
                emit("codexUpdate", JSONObject().put("status", CodexUpdater.status(ctx)))
                return@launch
            }
            val policy = store.settings().optString("codexAutoUpdate", "wifi")
            val auto = policy == "always" || (policy == "wifi" && !CodexUpdater.isMetered(ctx))
            if (auto) runCodexUpdate("codex-update", rel)
            else emit("codexUpdate", JSONObject().put("status", CodexUpdater.status(ctx)).put("available", rel.version))
        }
    }

    private fun runCodexUpdate(reqId: String, known: CodexUpdater.Release? = null) {
        if (jobs.keys.any { it.startsWith("codex-update") }) return
        val app = applicationContext
        RequestService.begin(app, "Codex を更新しています")
        jobs[reqId] = appScope.launch {
            try {
                val rel = known ?: CodexUpdater.latest(app)
                if (!CodexUpdater.isNewer(app, rel)) {
                    emit("codexUpdate", JSONObject().put("status", CodexUpdater.status(app)).put("upToDate", true))
                    return@launch
                }
                RequestService.progress("Codex ${rel.version} を取得中")
                val v = CodexUpdater.install(app, rel) { have, total ->
                    val p = JSONObject().put("version", rel.version).put("done", have).put("total", total)
                    updateProgress = p
                    emit("codexUpdateProgress", p)
                }
                // 処理中でなければ止めておき、次の要求から新しい版で起動させる
                CodexRuntime.stopIfIdle()
                emit("codexUpdate", JSONObject().put("status", CodexUpdater.status(app)).put("updated", v))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                emit("codexUpdate", JSONObject().put("status", CodexUpdater.status(app))
                    .put("error", "Codex を更新できませんでした: ${e.message ?: e.javaClass.simpleName}"))
            } finally {
                updateProgress = null
                jobs.remove(reqId)
                RequestService.end(app)
            }
        }
    }

    /** ログインのページはアプリ内のブラウザ（Custom Tabs）で開く。 */
    private fun openBrowser(u: Uri) {
        runOnUiThread {
            runCatching { CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, u) }
                .onFailure { runCatching { startActivity(Intent(Intent.ACTION_VIEW, u)) } }
        }
    }

    /** ログインを終えたブラウザから、アプリを前面に戻す。 */
    private fun bringToFront() {
        runCatching {
            applicationContext.startActivity(Intent(applicationContext, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
    }

    // ---- JS ブリッジ ----

    inner class Bridge {

        @JavascriptInterface
        fun state(): String = JSONObject()
            .put("loggedIn", CodexRuntime.isLoggedIn(this@MainActivity))
            .put("codex", JSONObject()
                .put("bundled", CodexUpdater.isSupported(this@MainActivity))
                .put("update", CodexUpdater.status(this@MainActivity))
                .put("updating", updateProgress ?: JSONObject.NULL))
            .put("settings", store.settings())
            .put("places", JSONArray(store.places()))
            .put("hasLocation", Geo.hasPermission(this@MainActivity))
            .toString()

        /** device = true でコード方式（別の端末やブラウザでコードを入力する）。 */
        @JavascriptInterface
        fun login(reqId: String, device: Boolean) { runOnUiThread { runLogin(reqId, device) } }

        @JavascriptInterface
        fun cancelLogin() {
            val ctx = applicationContext
            codexLoginId?.let { id -> appScope.launch { CodexRuntime.cancelLogin(ctx, id) } }
            loginReqId?.let { jobs.remove(it)?.cancel() }
            loginReqId = null
        }

        @JavascriptInterface
        fun logout() {
            val ctx = applicationContext
            appScope.launch {
                runCatching { CodexRuntime.logout(ctx) }
                    .onFailure { emit("notice", JSONObject().put("message", "ログアウトできませんでした: ${it.message}")) }
                emit("auth", JSONObject().put("loggedIn", CodexRuntime.isLoggedIn(ctx)))
            }
        }

        /** Codex が提示しているモデルと、ログイン中のアカウント。 */
        @JavascriptInterface
        fun codexModels(reqId: String) {
            val ctx = applicationContext
            appScope.launch {
                try {
                    val account = CodexRuntime.account(ctx)
                    val models = if (account != null) CodexRuntime.models(ctx, fresh = true) else JSONArray()
                    emit("codexModels", req(reqId)
                        .put("models", models)
                        .put("account", account ?: JSONObject.NULL))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    emit("codexModels", req(reqId)
                        .put("models", JSONArray())
                        .put("error", e.message ?: "モデルの一覧を取得できませんでした"))
                }
            }
        }

        @JavascriptInterface
        fun codexCheckUpdate(reqId: String) {
            val ctx = applicationContext
            appScope.launch {
                try {
                    val rel = CodexUpdater.latest(ctx)
                    emit("codexUpdate", req(reqId).put("status", CodexUpdater.status(ctx))
                        .put("available", if (CodexUpdater.isNewer(ctx, rel)) rel.version else "")
                        .put("upToDate", !CodexUpdater.isNewer(ctx, rel)))
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    emit("codexUpdate", req(reqId).put("status", CodexUpdater.status(ctx))
                        .put("error", "更新を確認できませんでした: ${e.message ?: e.javaClass.simpleName}"))
                }
            }
        }

        @JavascriptInterface
        fun codexUpdate(reqId: String) { runOnUiThread { runCodexUpdate("codex-update-$reqId") } }

        @JavascriptInterface
        fun copy(text: String) {
            runCatching {
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("code", text))
            }
        }

        /** 失敗を undefined で返すと JS 側が握りつぶすので、必ず JSON で返す。 */
        private inline fun guard(what: String, block: () -> String): String =
            try {
                block()
            } catch (e: Throwable) {
                Log.e("Coupodex", "bridge $what failed", e)
                JSONObject().put("error", e.message ?: e.toString()).toString()
            }

        @JavascriptInterface
        fun coupons(): String = guard("coupons") { store.load().toString() }

        @JavascriptInterface
        fun saveCoupon(json: String): String = guard("saveCoupon") { store.upsert(JSONObject(json)).toString() }

        @JavascriptInterface
        fun deleteCoupon(id: String): String = guard("deleteCoupon") { store.remove(id).toString() }

        @JavascriptInterface
        fun saveSettings(json: String) {
            runCatching { store.saveSettings(JSONObject(json)) }
                .onFailure { Log.e("Coupodex", "saveSettings failed", it) }
        }

        @JavascriptInterface
        fun pickPhoto(mode: String) {
            runOnUiThread {
                if (mode == "gallery") {
                    pickImage.launch(
                        androidx.activity.result.PickVisualMediaRequest.Builder()
                            .setMediaType(ActivityResultContracts.PickVisualMedia.ImageOnly).build()
                    )
                } else {
                    val dir = File(cacheDir, "capture").apply { mkdirs() }
                    val f = File(dir, UUID.randomUUID().toString() + ".jpg")
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", f)
                    pendingCaptureUri = uri
                    runCatching { takePicture.launch(uri) }
                        .onFailure { emit("photo", JSONObject().put("error", "カメラを起動できませんでした")) }
                }
            }
        }

        @JavascriptInterface
        fun analyze(reqId: String, photoId: String) { runOnUiThread { runAnalyze(reqId, photoId) } }

        @JavascriptInterface
        fun chat(reqId: String, payload: String) {
            runOnUiThread { runCatching { runChat(reqId, JSONObject(payload)) } }
        }

        @JavascriptInterface
        fun cancel(reqId: String) { jobs.remove(reqId)?.cancel() }

        @JavascriptInterface
        fun locate() {
            runOnUiThread {
                if (Geo.hasPermission(this@MainActivity)) locateNow()
                else requestLocation.launch(
                    arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
                )
            }
        }

        @JavascriptInterface
        fun openGeo(lat: Double, lng: Double, label: String) {
            val q = Uri.encode(label.ifBlank { "$lat,$lng" })
            openExternal("geo:$lat,$lng?q=$lat,$lng($q)")
        }

        @JavascriptInterface
        fun search(query: String) = openExternal("geo:0,0?q=" + Uri.encode(query))

        @JavascriptInterface
        fun openUrl(url: String) = openExternal(url)

        @JavascriptInterface
        fun share(text: String) {
            runOnUiThread {
                val i = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                runCatching { startActivity(Intent.createChooser(i, null)) }
            }
        }

        @JavascriptInterface
        fun haptic() {
            runOnUiThread {
                runCatching {
                    web.performHapticFeedback(
                        if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
                        else HapticFeedbackConstants.VIRTUAL_KEY
                    )
                }
            }
        }
    }

    private fun openExternal(url: String) {
        runOnUiThread { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
    }
}
