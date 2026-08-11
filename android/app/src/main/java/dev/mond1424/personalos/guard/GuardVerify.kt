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
     * **왜 판정을 못 받았는가** — 닫힌 목록 (T-31 · 0016).
     *
     * 8/11 밤 넷이 `unavailable`이었는데 기록은 "부를 수 없었다"까지였다.
     * Doze가 끊은 것 · Wi-Fi 절전 · 앱 대기 버킷 · 서버가 늦은 것 —
     * **넷의 대응이 완전히 다르다.** 구분이 없으면 ADR-024를 재검토할 재료가 없다.
     *
     * **대장은 `src/services/guard.ts`의 `UNAVAILABLE_REASONS`이다.** 여기와 0016의 CHECK는
     * 그 메아리이고, 셋이 갈라지면 smoke가 빨간불이 된다. 자유롭게 늘리지 않는다 —
     * 12월에 **세어야** 하고, 같은 원인이 여러 철자로 흩어지면 집계가 안 된다.
     */
    object Reason {
        const val TIMEOUT = "timeout"              // 6초 안에 응답이 없다
        const val DNS = "dns"                      // 호스트 이름을 못 풀었다
        const val NETWORK = "network"              // 연결 자체가 안 됐다
        const val BAD_RESPONSE = "bad_response"    // 2xx인데 본문이 판정이 아니다
        const val NO_BASE = "no_base"              // 서버 주소가 설정에 없다
        const val SERVER_TIMEOUT = "server_timeout" // 서버가 모델 8초를 넘겼다
        const val SERVER_ERROR = "server_error"    // 서버가 오류를 만났다
        const val CAP = "cap"                      // 일일 상한 — 못 부른 게 아니라 안 부른 것이다
        fun http(code: Int) = "http_$code"         // 2xx 아닌 응답. 401과 503의 대응이 다르다
    }

    /**
     * 한 번의 시도 결과. **`verdict`가 null이면 `reason`이 왜인지 말한다** — 그 둘이 짝이다.
     *
     * 전에는 서버에 못 닿으면 그냥 `null`이었고, 그래서 기록에 "부를 수 없었다"만 남았다.
     */
    data class Attempt(val verdict: Verdict?, val reason: String?)

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

        /**
         * 서버가 답했는데 판정이 아니었을 때의 이유 (T-31).
         *
         * **기기가 못 닿은 경우와 갈라 둔다** — `timeout`은 기기의 6초이고
         * `server_timeout`은 서버의 모델 8초다. 12월에 *"서버가 늦었나"*와
         * *"Doze가 끊었나"*는 대응이 다르므로 같은 이름으로 세면 안 된다.
         */
        val unavailableReason: String?
            get() = when (source) {
                "cap" -> Reason.CAP
                "timeout" -> Reason.SERVER_TIMEOUT
                "error" -> Reason.SERVER_ERROR
                else -> null
            }

        val upgrades: Boolean get() = approved && level >= 4
    }

    /**
     * ⚠️ **백그라운드 스레드에서만.** 발동 경로에서 부르면 개입이 네트워크에 걸린다.
     * @return 판정. 서버에 못 닿았거나 응답이 이상하면 `null` → 호출부는 Level 3을 유지한다.
     *
     * 이유까지 필요하면 [attempt]를 쓴다 — 이 함수는 그 얇은 겉면이다.
     */
    fun verify(
        ctx: Context,
        clientId: String,
        cause: String,
        eventId: String?,
        foregroundApp: String?,
        riskSnapshot: JSONObject?,
    ): Verdict? = attempt(ctx, clientId, cause, eventId, foregroundApp, riskSnapshot).verdict

    /**
     * [verify]와 같되 **못 받았으면 왜인지 들고 나온다** (T-31).
     *
     * **판정 자체는 조금도 달라지지 않는다** — fail-closed도 6초도 그대로다(ADR-024).
     * 늘어나는 것은 **기록**뿐이다.
     */
    fun attempt(
        ctx: Context,
        clientId: String,
        cause: String,
        eventId: String?,
        foregroundApp: String?,
        riskSnapshot: JSONObject?,
    ): Attempt {
        // 서버 주소가 없으면 네트워크를 타 보지도 않는다 — 'network'로 세면 원인을 오해한다.
        val base = GuardSync.baseUrl(ctx) ?: return Attempt(null, Reason.NO_BASE)
        val token = GuardSync.token(ctx)

        val body = JSONObject()
            .put("client_id", clientId)
            .put("cause", cause)
            .put("level_candidate", 4)
            .put("event_id", eventId ?: JSONObject.NULL)
            .put("foreground_app", foregroundApp ?: JSONObject.NULL)
        if (riskSnapshot != null) body.put("risk_snapshot", riskSnapshot)

        val r = post(base, token, body)
        val text = r.verdict ?: return Attempt(null, r.reason)
        val v = runCatching {
            val o = JSONObject(text)
            Verdict(
                level = o.optInt("level", 3),
                approved = o.optBoolean("approved", false),
                source = o.optString("source", "error"),
                aiUsed = o.optInt("ai_used", 0),
                reason = o.optString("reason", ""),
            )
            // 2xx인데 본문이 판정이 아니다 — 통신은 됐으므로 network가 아니다.
        }.getOrNull() ?: return Attempt(null, Reason.BAD_RESPONSE)
        return Attempt(v, v.unavailableReason)
    }

    /** 본문(2xx일 때)과 실패 이유를 함께 나른다. 둘 중 하나만 채워진다. */
    private data class Raw(val verdict: String?, val reason: String?)

    /**
     * 서버는 **어떤 경우에도 200**으로 답한다(T-03). 그래서 2xx가 아니면 판정이 아니라
     * 통신 자체가 실패한 것이고, 그때는 Level 3이다.
     *
     * **예외를 삼키지 않고 종류를 남긴다** (T-31). 새벽에 무엇이 끊었는지는
     * 여기서만 알 수 있고, 이 자리를 지나면 영영 못 되찾는다.
     */
    private fun post(base: String, token: String?, body: JSONObject): Raw = try {
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
        // 2xx면 본문, 아니면 코드를 남긴다 — 401(토큰 만료)과 503(과부하)의 대응이 다르다.
        if (text != null) Raw(text, null) else Raw(null, Reason.http(code))
    } catch (e: java.net.SocketTimeoutException) {
        // connect·read 어느 쪽이든 6초를 넘긴 것이다. **Doze가 가장 유력한 자리다.**
        Raw(null, Reason.TIMEOUT)
    } catch (e: java.net.UnknownHostException) {
        // 이름을 못 풀었다 — DNS가 안 서거나 네트워크가 통째로 내려간 것이다.
        Raw(null, Reason.DNS)
    } catch (e: Exception) {
        // 그 밖(ConnectException·NoRouteToHost·SSL·소켓 끊김). 더 잘게 가르지 않는다 —
        // 닫힌 목록이어야 하고, 실제로 무엇이 오는지는 9~11월 기록이 말해 준다.
        Raw(null, Reason.NETWORK)
    }
}
