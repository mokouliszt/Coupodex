package dev.mokouliszt.coupodex

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * クーポン本体は filesDir/coupons.json に素の JSON 配列で保存する。
 * 写真は filesDir/photos/<id>.jpg。WebView からは
 * https://appassets.androidplatform.net/photos/<id>.jpg で参照する。
 */
class Store(context: Context) {

    private val appCtx = context.applicationContext
    private val file = File(appCtx.filesDir, "coupons.json")
    private val prefs = appCtx.getSharedPreferences("app", Context.MODE_PRIVATE)

    val photosDir: File = File(appCtx.filesDir, "photos").apply { mkdirs() }

    @Synchronized
    fun load(): JSONArray =
        if (file.exists()) runCatching { JSONArray(file.readText()) }.getOrDefault(JSONArray())
        else JSONArray()

    @Synchronized
    fun saveAll(arr: JSONArray) {
        val text = arr.toString()
        val tmp = File(appCtx.filesDir, "coupons.json.tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(file)) {
            // rename が通らない環境があるので直接書き戻す
            file.writeText(text)
            tmp.delete()
        }
        // 実際に永続化できたか確認する。黙って失敗させない。
        val written = runCatching { file.readText() }.getOrNull()
        if (written != text) error("coupons.json を保存できませんでした")
    }

    /** id が既にあれば置換、無ければ先頭に追加。 */
    @Synchronized
    fun upsert(item: JSONObject): JSONArray {
        val arr = load()
        val id = item.optString("id")
        val out = JSONArray()
        var replaced = false
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == id) { out.put(item); replaced = true } else out.put(o)
        }
        if (!replaced) {
            val merged = JSONArray().put(item)
            for (i in 0 until out.length()) merged.put(out.opt(i))
            saveAll(merged); return merged
        }
        saveAll(out); return out
    }

    @Synchronized
    fun remove(id: String): JSONArray {
        val arr = load()
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.optString("id") == id) {
                o.optString("photo").takeIf { it.isNotEmpty() }
                    ?.let { File(photosDir, "$it.jpg").delete() }
            } else out.put(o)
        }
        saveAll(out); return out
    }

    // ---- 設定 ----

    init { migrateSettings() }

    /**
     * v1.0 までは固定のモデル一覧から選ぶしかなく、「Codex のデフォルト」を選べなかった。
     * 設定画面はどの項目を変えても全項目を保存していたので、残っている値は意図して
     * 固定したものとは限らない。一度だけ消して Codex のデフォルトに追従させる。
     */
    private fun migrateSettings() {
        if (prefs.getInt("settingsVersion", 1) >= 2) return
        prefs.edit().remove("model").remove("effort").putInt("settingsVersion", 2).apply()
    }

    fun settings(): JSONObject = JSONObject().apply {
        // 空 = Codex のデフォルト（モデル）／そのモデルのデフォルト（推論の深さ）
        put("model", prefs.getString("model", "") ?: "")
        put("effort", prefs.getString("effort", "") ?: "")
        // Codex 本体の自動更新: wifi | always | off
        put("codexAutoUpdate", prefs.getString("codexAutoUpdate", "wifi") ?: "wifi")
        put("radius", prefs.getInt("radius", 500))
        put("defaultPlace", prefs.getString("defaultPlace", "") ?: "")
    }

    fun saveSettings(o: JSONObject) {
        prefs.edit().apply {
            // model / effort は空文字も有効な値（デフォルトに戻す）なので、キーの有無で判定する
            if (o.has("model")) putString("model", o.optString("model"))
            if (o.has("effort")) putString("effort", o.optString("effort"))
            o.optString("codexAutoUpdate").takeIf { it in setOf("wifi", "always", "off") }
                ?.let { putString("codexAutoUpdate", it) }
            if (o.has("radius")) putInt("radius", o.optInt("radius", 500))
            if (o.has("defaultPlace")) putString("defaultPlace", o.optString("defaultPlace"))
        }.apply()
    }

    /** 管理場所の候補（過去に使った場所を頻度順で）。 */
    fun places(): List<String> {
        val counts = HashMap<String, Int>()
        val arr = load()
        for (i in 0 until arr.length()) {
            val p = arr.optJSONObject(i)?.optString("place").orEmpty()
            if (p.isNotBlank()) counts[p] = (counts[p] ?: 0) + 1
        }
        return counts.entries.sortedByDescending { it.value }.map { it.key }
    }
}
