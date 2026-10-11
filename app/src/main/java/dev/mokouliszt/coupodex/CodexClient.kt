package dev.mokouliszt.coupodex

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject

/** 会話1件。images は最後のユーザ発話にのみ添付される。 */
data class Msg(val role: String, val text: String, val imagesJpeg: List<ByteArray> = emptyList())

/**
 * 同梱の Codex（CodexRuntime）で、指示文と会話を1回分実行する。
 *
 * model / effort が空なら Codex の既定に任せる。Codex の更新で既定のモデルや
 * 推論の深さが変わっても、アプリを触らずに追従する。
 * 固定したモデルや深さが使えなくなっていれば既定に戻し、その旨を Tool で知らせる。
 */
class CodexClient(context: Context) {

    private val ctx = context.applicationContext

    fun run(
        instructions: String,
        messages: List<Msg>,
        model: String?,
        effort: String?,
    ): Flow<CodexEvent> = flow {
        if (messages.isEmpty()) return@flow
        val input = buildInput(messages)
        val choice = CodexRuntime.resolve(ctx, model, effort)
        choice.notice?.let { emit(CodexEvent.Tool(it)) }
        var m = choice.model
        var e = choice.effort
        var emitted = false
        try {
            CodexRuntime.stream(ctx, instructions, input, m, e).collect { ev ->
                if (ev is CodexEvent.Delta) emitted = true
                emit(ev)
            }
        } catch (ex: CodexException) {
            // 固定したモデルや深さを途中で断られた場合だけ、既定に戻して1回やり直す。
            // 本文を出し始めた後にやり直すと二重になるので、その場合はそのまま失敗にする。
            val msg = ex.message.orEmpty()
            val modelRejected = m != null && msg.contains("model", ignoreCase = true)
            val effortRejected = e != null && msg.contains("effort", ignoreCase = true)
            if (emitted || ex.needLogin || !(modelRejected || effortRejected)) throw ex
            if (modelRejected) m = null
            e = null
            emit(CodexEvent.Tool("設定したモデルが使えないため、Codex のデフォルトでやり直します"))
            CodexRuntime.stream(ctx, instructions, input, m, e).collect { emit(it) }
        }
    }

    /**
     * Codex のスレッドは1回ごとに使い捨てるので、それまでの会話は
     * 今回の入力の前に書き起こして渡す。券面の写真は最後の発話に添える。
     */
    private fun buildInput(messages: List<Msg>): JSONArray {
        val last = messages.last()
        val text = if (messages.size == 1) last.text else buildString {
            append("[これまでの会話]\n")
            messages.dropLast(1).forEach { m ->
                append(if (m.role == "assistant") "アシスタント: " else "ユーザー: ")
                append(m.text.trim())
                append("\n\n")
            }
            append("[今回の質問]\n")
            append(last.text)
        }
        val input = JSONArray().put(JSONObject()
            .put("type", "text")
            .put("text", text)
            .put("text_elements", JSONArray()))
        last.imagesJpeg.forEach { bytes ->
            input.put(JSONObject()
                .put("type", "image")
                .put("url", "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)))
        }
        return input
    }
}
