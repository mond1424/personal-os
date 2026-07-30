package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Level 3 → 4 격상 검증 — 기기측 (ADR-024).
 *
 * **Level 1~3은 이 파일을 타지 않는다**(ADR-021). 격상에만 조건이 붙는다.
 *
 * 지연을 발동 앞에 두지 않는다: 화면은 이미 Level 3으로 떴고, 이 호출은 그 뒤에 돈다.
 * 새벽에 6초 늦는 화면은 6초만큼 덜 막는다 — 그래서 검증은 **격상 여부만** 정한다.
 *
 * **실패는 전부 Level 3이다**(fail-closed). 거부·타임아웃·오프라인·형식 오류 어느 것도
 * Level 4를 만들지 않는다 — ADR-024가 fail-open을 명시적으로 기각했다.
 * 그래서 이 객체는 **던지지 않고**, 판정이 없으면 `null`을 돌려준다.
 *
 * 캐시는 두지 않는다. 같은 밤의 재사용은 서버가 진다(ADR-024 ②) —
 * 두 곳에 두면 갈라지고, 갈라진 캐시는 어느 쪽이 맞는지 아무도 모른다.
 */
object GuardVerify {

    /**
     * 6초. 서버의 모델 타임아웃은 8초지만(ADR-024 ④) 기기는 그보다 먼저 포기한다 —
     * 서버가 8초를 다 쓰는 밤이면 이미 격상을 기다릴 이유가 없다.
     */
    private const val TIMEOUT_MS = 6_000

    /**
     * @param level     서버가 최종적으로 인정한 Level (3 또는 4)
     * @param source    판정의 출처: ai · cache · cap · timeout · error · off
     * @param aiUsed    서버가 세는 값 그대로 싣는다 — 상한(ADR-024 ③)의 근거가 한 곳이어야 한다
     */
    data class Verdict(
        val level: Int,
        val approved: Boolean,
        val source: String,
        val aiUsed: Int,
        val reason: String,
    ) {
        /**
         * `guard_events.ai_verdict`에 실을 값. DB CHECK는 approve·deny·unavailable만 받는다.
         *
         * `off`(킬 스위치)는 **AI 판정이 아니다** — 결정론으로 돌아간 것이므로 비운다.
         * 판정을 못 받은 경우(cap·timeout·error)는 `unavailable` — "부를 수 없었다"는 기록이고,
         * 서버가 이 값을 캐시하지 않는 이유이기도 하다(ADR-024).
         */
        val aiVerdict: String?
            get() = when (source) {
                "ai", "cache" -> if (approved) "approve" else "deny"
                "cap", "timeout", "error" -> "unavailable"
                else -> null
            }

        val upgrades: Boolean get() = approved && level >= 4
    }

    /**
     * ⚠️ **백그라운드 스레드에서만.** 발동 경로에서 부르면 개입이 네트워크에 걸린다.
     * @return 판정. 서버에 못 닿았거나 응답이 이상하면 `null` → 호출부는 Level 3을 유지한다.
     */
    fun verify(
        ctx: Context,
        clientId: String,
        cause: String,
        eventId: String?,
        foregroundApp: String?,
        riskSnapshot: JSONObject?,
    ): Verdict? {
        val base = GuardSync.baseUrl(ctx) ?: return null
        val token = GuardSync.token(ctx)

        val body = JSONObject()
            .put("client_id", clientId)
            .put("cause", cause)
            .put("level_candidate", 4)
            .put("event_id", eventId ?: JSONObject.NULL)
            .put("foreground_app", foregroundApp ?: JSONObject.NULL)
        if (riskSnapshot != null) body.put("risk_snapshot", riskSnapshot)

        val text = post(base, token, body) ?: return null
        return runCatching {
            val o = JSONObject(text)
            Verdict(
                level = o.optInt("level", 3),
                approved = o.optBoolean("approved", false),
                source = o.optString("source", "error"),
                aiUsed = o.optInt("ai_used", 0),
                reason = o.optString("reason", ""),
            )
        }.getOrNull()
    }

    /**
     * 서버는 **어떤 경우에도 200**으로 답한다(T-03). 그래서 2xx가 아니면 판정이 아니라
     * 통신 자체가 실패한 것이고, 그때는 Level 3이다.
     */
    private fun post(base: String, token: String?, body: JSONObject): String? = try {
        val c = (URL("$base/api/guard/verify").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
        }
        c.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = c.responseCode
        val text = if (code in 200..299) c.inputStream.bufferedReader().use { it.readText() } else null
        runCatching { c.errorStream?.close() }
        c.disconnect()
        text
    } catch (e: Exception) {
        null
    }
}
