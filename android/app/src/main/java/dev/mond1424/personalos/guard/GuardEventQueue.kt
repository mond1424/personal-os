package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * 발동·반응의 **로컬 우선 기록** (ADR-023).
 *
 * Guard는 네트워크 없이 발동한다(ADR-021). 그러면 기록도 네트워크 없이 남아야 한다 —
 * 개입이 실패하는 밤은 대개 상황이 정상이 아닌 밤이고, 하필 그날 기록이 비면 안 된다.
 *
 * 그래서 순서가 이렇다:
 *   발동 → **로컬에 먼저 쓴다** → (온라인이면) 밀어 올린다 → 성공하면 로컬에서 뺀다
 *
 * `client_id`(UUID)를 기기가 만든다. 서버가 이걸 UNIQUE로 들고 있어서(0011)
 * POST가 닿았는데 응답만 유실돼 재시도해도 두 행이 되지 않는다.
 *
 * 저장은 SharedPreferences JSON이다 — 하룻밤에 몇 건이라 SQLite는 과하다.
 * 양이 늘면 그때 옮긴다(GuardAlarmStore와 같은 판단).
 */
object GuardEventQueue {

    private const val KEY = "event_queue"
    private const val MAX = 500          // 방어선. 넘으면 오래된 것부터 버린다
    private const val TIMEOUT_MS = 10_000

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    @Synchronized
    private fun read(ctx: Context): MutableList<JSONObject> = runCatching {
        val arr = JSONArray(prefs(ctx).getString(KEY, "[]") ?: "[]")
        (0 until arr.length()).map { arr.getJSONObject(it) }.toMutableList()
    }.getOrDefault(mutableListOf())

    @Synchronized
    private fun write(ctx: Context, list: List<JSONObject>) {
        val arr = JSONArray()
        list.takeLast(MAX).forEach { arr.put(it) }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply()
    }

    fun size(ctx: Context) = read(ctx).size

    /**
     * 발동을 기록한다. **여기서 네트워크를 기다리지 않는다** — 발동 경로를 막으면 안 된다.
     * @return client_id — 반응을 붙일 때 쓴다
     */
    fun recordFire(
        ctx: Context,
        level: Int,
        cause: String,
        eventId: String?,
        foregroundApp: String?,
        riskSnapshot: JSONObject? = null,
    ): String {
        // risk_snapshot은 판단 시점의 항 값이다. 점수가 아니라 **원재료** —
        // 가중치는 10월에 실제 스냅샷에서 유도한다(ADR-021).
        val clientId = UUID.randomUUID().toString()
        val o = JSONObject()
            .put("client_id", clientId)
            .put("fired_at", nowIso())
            .put("cause", cause)
            .put("level", level)
            .put("source", "android")
            .put("event_id", eventId ?: JSONObject.NULL)
            .put("foreground_app", foregroundApp ?: JSONObject.NULL)
            .put("mode", JSONObject.NULL)          // 서버가 활성 모드로 채운다
        if (riskSnapshot != null) o.put("risk_snapshot", riskSnapshot)
        write(ctx, read(ctx) + o)
        return clientId
    }

    /**
     * 발동 항목에 **검증 결과를 덧쓴다** (ADR-024 ⑥ — 기록은 발동 시점에 남는다).
     *
     * 서버는 검증 결과를 저장하지 않는다. 검증만 하고 발동하지 않은 밤의 유령 행이
     * 개입 이력을 오염시키기 때문이다 — 그래서 **기기가 실어 보내는 것이 상한의 전제**다.
     * 안 실으면 그 호출이 `guardAiCallsOn`에 안 세어지고 통제 ③이 뚫린다.
     *
     * `level`은 격상이 승인됐을 때만 넘긴다. 발동 자체는 Level 3으로 났고(지연 0),
     * 승인이 오면 그 화면이 Level 4가 되므로 **기록도 실제 개입 수위를 따라가야 한다.**
     *
     * 이미 밀어 올려 큐에서 빠졌으면 조용히 지나간다 — 서버의 upsert는 반응만 채우므로
     * level·ai_*를 뒤늦게 고칠 수 없다. 검증이 끝나는 것은 발동 직후이므로 실제로는 거의 로컬에 있다.
     *
     * ⚠️ **T-37이 그 창을 넓혔다** — 기기가 기다리는 상한이 6초에서 최악 16초가 됐다
     * (`GuardVerify`의 두 상수). 그 사이에 `flush()`가 돌면 이 함수는 조용히 지나가고
     * 판정이 서버에 안 실린다. 상한이 더 늘면 이 가정을 다시 본다.
     */
    fun amendFire(
        ctx: Context,
        clientId: String,
        level: Int?,
        aiUsed: Int,
        aiVerdict: String?,
        // 왜 못 불렀는가 (T-31 · 0016). `ai_verdict`는 'unavailable' 그대로이고 **이유만 옆에 붙는다** —
        // 값을 넓히면 0010의 CHECK에 걸려 400이 되고, 아래 `flush()`가 그 행을 버린다.
        // 옛 서버는 이 키를 그냥 무시한다(모르는 필드다) — APK를 먼저 깔아도 안전하다.
        unavailableReason: String? = null,
        // 왜 **그렇게 답했는가** (T-38 · 0017). 서버가 늘 보내던 `reason`을 여기서 버리고 있었다 —
        // deny 열한 번의 사유가 그래서 어디에도 안 남았다. 판정이 있을 때만 찬다(`Verdict.aiReason`).
        // 옛 서버는 이 키를 그냥 무시한다 — APK를 먼저 깔아도 안전하다(위와 같은 이유).
        aiReason: String? = null,
    ) {
        val list = read(ctx)
        val hit = list.firstOrNull { it.optString("client_id") == clientId } ?: return
        if (level != null) hit.put("level", level)
        hit.put("ai_used", aiUsed)
        hit.put("ai_verdict", aiVerdict ?: JSONObject.NULL)
        hit.put("ai_unavailable_reason", unavailableReason ?: JSONObject.NULL)
        hit.put("ai_reason", aiReason ?: JSONObject.NULL)
        write(ctx, list)
    }

    /**
     * 반응을 같은 항목에 붙인다.
     * 이미 밀어 올려 큐에서 빠졌으면 **반응만 담은 항목을 새로 넣는다** —
     * 서버가 client_id로 찾아 반응만 채운다(record()의 upsert 경로).
     */
    fun recordReaction(ctx: Context, clientId: String, reaction: String, reason: String?) {
        val list = read(ctx)
        val hit = list.firstOrNull { it.optString("client_id") == clientId }
        if (hit != null) {
            hit.put("reaction", reaction)
            hit.put("reacted_at", nowIso())
            if (reason != null) hit.put("reason", reason)
            write(ctx, list)
            return
        }
        val o = JSONObject()
            .put("client_id", clientId)
            .put("reaction", reaction)
            .put("reacted_at", nowIso())
        if (reason != null) o.put("reason", reason)
        write(ctx, list + o)
    }

    /**
     * 밀어 올리기. ⚠️ **백그라운드 스레드에서만.**
     *
     * 하나씩 보내고 성공한 것만 뺀다 — 중간에 끊겨도 남은 건 다음에 간다.
     * 400(형식 오류)은 재시도해도 소용없으므로 버린다. 그러지 않으면 큐가 영원히 막힌다.
     */
    fun flush(ctx: Context): Pair<Int, Int> {
        val base = GuardSync.baseUrl(ctx) ?: return 0 to size(ctx)
        val token = GuardSync.token(ctx)
        var sent = 0

        while (true) {
            val list = read(ctx)
            if (list.isEmpty()) break
            val item = list.first()

            val code = post(base, token, item) ?: break     // 네트워크 실패 → 다음 기회에
            if (code in 200..299 || code == 400 || code == 409) {
                // 2xx 성공 · 400 형식 오류(재시도 무의미) · 409 이미 반응 있음(멱등)
                write(ctx, list.drop(1))
                if (code in 200..299) sent++
            } else {
                break                                       // 5xx 등 — 다음 기회에
            }
        }
        return sent to size(ctx)
    }

    private fun post(base: String, token: String?, body: JSONObject): Int? = try {
        val c = (URL("$base/api/guard/events").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        runCatching { (if (code in 200..299) c.inputStream else c.errorStream)?.close() }
        c.disconnect()
        code
    } catch (e: Exception) {
        null
    }

    private fun nowIso(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())
}
