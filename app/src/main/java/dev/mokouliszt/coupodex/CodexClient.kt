package dev.mokouliszt.coupodex

import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

/** 会話1件。images は最後のユーザ発話にのみ添付される。 */
data class Msg(val role: String, val text: String, val imagesJpeg: List<ByteArray> = emptyList())

/** ストリーム中のイベント。UI へそのまま流す。 */
sealed class CodexEvent {
    data class Delta(val text: String) : CodexEvent()
    data class Tool(val label: String) : CodexEvent()
    data class Fail(val message: String) : CodexEvent()
}

/**
 * ChatGPT サブスク枠(Codex OAuth)を端末から直接利用するクライアント。
 * overlay-ai の DirectCodexClient と同じ実行条件:
 *   - Web検索 (web_search) 常時ON
 *   - shell を function ツールとして定義し workspace-write サンドボックス内で実行
 *   - --full-auto 相当: ツール呼び出しを自動承認・自動実行
 * tools が弾かれた場合は段階フォールバック（shell→web_searchのみ→なし）。
 */
class CodexClient(
    private val auth: CodexAuth,
    private val workspaceProvider: () -> File,
) {

    companion object {
        private const val URL = "https://chatgpt.com/backend-api/codex/responses"
        private const val MAX_ITERS = 6
        // 通信断（バックグラウンド化でソケットが切られる等）に対する張り直し回数
        private const val MAX_RETRIES = 3
        private const val RETRY_DELAY_MS = 900L

        val MODELS = listOf(
            "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
            "gpt-5.5", "gpt-5.4", "gpt-5.3-codex", "gpt-5-codex-mini",
        )
        val EFFORTS = listOf("minimal", "low", "medium", "high", "xhigh", "max")

        private const val SHELL_NOTE =
            "You also have a `shell` function tool that runs `/bin/sh -c <command>` in --full-auto mode " +
            "inside a workspace-write sandbox (the working directory). Commands are auto-approved. " +
            "The environment is a minimal Android shell (toybox: ls, cat, echo, mkdir, sed, grep …; no python/node). " +
            "Keep shell usage minimal — it is rarely needed for this app."
    }

    private val http = Net.client(
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS) // SSE
            .retryOnConnectionFailure(true)
    )

    private class ShellCall(val callId: String, val command: String)
    private class Turn(val items: List<JSONObject>, val shellCalls: List<ShellCall>, val toolLevel: Int)

    /** 1リクエスト分を投げてイベントを逐次受け取る。ツール呼び出しは自動実行してループする。 */
    fun run(
        instructions: String,
        messages: List<Msg>,
        model: String,
        effort: String,
    ): Flow<CodexEvent> = flow {
        val token = auth.accessToken() ?: error("未ログインです。ChatGPT にログインしてください")
        val account = auth.accountId() ?: error("account_id を取得できません。ログインし直してください")

        val input = JSONArray()
        buildInitialInput(messages, input)

        // 本文を1文字でも出したあとに再試行すると二重に出てしまうので、
        // 「まだ何も出していない間の切断」だけ黙って張り直す。
        var emitted = 0
        val out = object : FlowCollector<CodexEvent> {
            override suspend fun emit(value: CodexEvent) {
                if (value is CodexEvent.Delta) emitted += value.text.length
                this@flow.emit(value)
            }
        }

        var level = 2 // 2: shell+web_search / 1: web_search のみ / 0: ツールなし
        var iter = 0
        var retries = 0
        while (iter < MAX_ITERS) {
            val turn = try {
                streamTurn(instructions, input, model, effort, token, account, out, level)
            } catch (e: IOException) {
                // ユーザーが停止した場合の割り込みは張り直さない
                if (!currentCoroutineContext().isActive) throw e
                if (emitted == 0 && retries < MAX_RETRIES) {
                    retries++
                    emit(CodexEvent.Tool("接続が切れました。再接続中… ($retries/$MAX_RETRIES)"))
                    delay(RETRY_DELAY_MS * retries)
                    continue // 同じ入力のまま張り直す（iter は進めない）
                }
                throw e
            }
            iter++
            level = turn.toolLevel
            if (turn.shellCalls.isEmpty()) return@flow
            turn.items.forEach { input.put(it) }
            for (call in turn.shellCalls) {
                emit(CodexEvent.Tool("$ " + call.command))
                val result = withContext(Dispatchers.IO) { execShell(call.command) }
                input.put(JSONObject().apply {
                    put("type", "function_call_output")
                    put("call_id", call.callId)
                    put("output", result)
                })
            }
        }
        emit(CodexEvent.Fail("ツール実行が上限(${MAX_ITERS})に達しました"))
    }.flowOn(Dispatchers.IO)

    private suspend fun streamTurn(
        instructions: String, input: JSONArray, model: String, effort: String,
        token: String, account: String, out: FlowCollector<CodexEvent>, toolLevel: Int,
    ): Turn {
        val payload = buildBody(instructions, input, model, effort, toolLevel).toString()
        val req = Request.Builder().url(URL)
            .post(payload.toRequestBody("application/json".toMediaType()))
            .header("Authorization", "Bearer $token")
            .header("ChatGPT-Account-Id", account)
            .header("Accept", "text/event-stream")
            .header("User-Agent", "codex_cli_rs/0.0.0")
            .header("originator", "codex_cli_rs")
            .header("OpenAI-Beta", "responses=experimental")
            .header("session_id", UUID.randomUUID().toString())
            .build()

        val items = ArrayList<JSONObject>()
        val shellCalls = ArrayList<ShellCall>()

        http.newCall(req).execute().use { resp ->
            if (resp.code == 401) error("認証エラー(401)。ログインし直してください")
            if (resp.code == 400 && toolLevel > 0) {
                val body = resp.body?.string().orEmpty()
                if (body.contains("tool", ignoreCase = true)) {
                    return streamTurn(instructions, input, model, effort, token, account, out, toolLevel - 1)
                }
                error("upstream 400: ${body.take(300)}")
            }
            if (resp.code == 429) error("レート上限に達しました。しばらく待って再試行してください")
            if (!resp.isSuccessful) error("upstream ${resp.code}: ${resp.body?.string()?.take(200)}")
            val source = resp.body?.source() ?: error("empty body")
            while (!source.exhausted()) {
                val line = source.readUtf8Line() ?: break
                if (!line.startsWith("data:")) continue
                val data = line.removePrefix("data:").trim()
                if (data.isEmpty() || data == "[DONE]") continue
                val ev = runCatching { JSONObject(data) }.getOrNull() ?: continue
                when (ev.optString("type")) {
                    "response.output_text.delta" ->
                        ev.optString("delta").let { if (it.isNotEmpty()) out.emit(CodexEvent.Delta(it)) }
                    "response.output_item.added" -> {
                        val t = ev.optJSONObject("item")?.optString("type")
                        if (t == "web_search_call") out.emit(CodexEvent.Tool("web検索中…"))
                    }
                    "response.output_item.done" -> {
                        val item = ev.optJSONObject("item") ?: continue
                        items.add(item)
                        parseShellCall(item)?.let { shellCalls.add(it) }
                    }
                    "response.failed", "response.error", "error" ->
                        out.emit(CodexEvent.Fail(ev.optJSONObject("error")?.optString("message") ?: "upstream error"))
                }
            }
        }
        return Turn(items, shellCalls, toolLevel)
    }

    private fun parseShellCall(item: JSONObject): ShellCall? {
        if (item.optString("type") != "function_call") return null
        if (item.optString("name") != "shell") return null
        val callId = item.optString("call_id").ifEmpty { item.optString("id") }
        val args = runCatching { JSONObject(item.optString("arguments", "{}")) }.getOrNull()
        val cmd = args?.optString("command")?.takeIf { it.isNotBlank() } ?: return null
        return ShellCall(callId, cmd)
    }

    /** workspace-write サンドボックス内でコマンドを実行（full-auto）。 */
    private fun execShell(command: String): String {
        val ws = workspaceProvider().apply { mkdirs() }
        return try {
            val p = ProcessBuilder("/system/bin/sh", "-c", command)
                .directory(ws).redirectErrorStream(true).start()
            val sb = StringBuilder()
            val reader = Thread { runCatching { p.inputStream.bufferedReader().forEachLine { sb.appendLine(it) } } }
            reader.start()
            val ok = p.waitFor(20, TimeUnit.SECONDS)
            if (!ok) p.destroyForcibly()
            reader.join(500)
            val text = sb.toString()
            (if (text.length > 8000) text.take(8000) + "\n…(truncated)" else text) +
                (if (!ok) "\n(timeout)" else "")
        } catch (e: Exception) {
            "exec error: ${e.message}"
        }
    }

    // ---- リクエスト構築 ----

    private fun buildInitialInput(messages: List<Msg>, input: JSONArray) {
        messages.forEach { m ->
            val isUser = m.role == "user" || m.role == "system"
            val content = JSONArray().apply {
                put(JSONObject().apply {
                    put("type", if (isUser) "input_text" else "output_text")
                    put("text", m.text)
                })
                if (isUser) m.imagesJpeg.forEach { bytes ->
                    put(JSONObject().apply {
                        put("type", "input_image")
                        put("image_url", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
                    })
                }
            }
            input.put(JSONObject().apply {
                put("type", "message")
                put("role", m.role)
                put("content", content)
            })
        }
    }

    private fun shellTool(): JSONObject = JSONObject().apply {
        put("type", "function")
        put("name", "shell")
        put("description", "Run a shell command via /bin/sh -c in the workspace-write sandbox (cwd). Auto-approved.")
        put("parameters", JSONObject().apply {
            put("type", "object")
            put("properties", JSONObject().apply {
                put("command", JSONObject().apply {
                    put("type", "string")
                    put("description", "The shell command line to execute")
                })
            })
            put("required", JSONArray().put("command"))
            put("additionalProperties", false)
        })
    }

    private fun buildBody(
        instructions: String, input: JSONArray, model: String, effort: String, toolLevel: Int,
    ): JSONObject {
        val safeEffort =
            if ((effort == "xhigh" || effort == "max") && !model.startsWith("gpt-5.6")) "high" else effort
        val tools = JSONArray()
        if (toolLevel >= 2) tools.put(shellTool())
        if (toolLevel >= 1) tools.put(JSONObject().put("type", "web_search"))
        return JSONObject().apply {
            put("model", model)
            put("instructions", instructions + "\n\n" + SHELL_NOTE)
            put("input", input)
            if (tools.length() > 0) {
                put("tools", tools)
                put("tool_choice", "auto")
                put("parallel_tool_calls", false)
            }
            put("include", JSONArray().put("reasoning.encrypted_content"))
            put("store", false)
            put("stream", true)
            put("reasoning", JSONObject().put("effort", safeEffort))
        }
    }
}
