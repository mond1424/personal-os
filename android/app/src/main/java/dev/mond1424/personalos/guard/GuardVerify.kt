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
 * 새벽에 몇 초 늦는 화면은 그만큼 덜 막는다 — 그래서 검증은 **격상 여부만** 정한다.
 * (기다리는 상한은 아래 두 상수다. 여기 숫자를 적으면 두 벌이 된다.)
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
     * **중첩된 타임아웃은 바깥이 안보다 길다** (ADR-038). 안쪽이 자기 실패를 말할 시간을 남긴다.
     *
     * 전에는 하나의 상수 6초가 connect·read 양쪽에 쓰였고, 서버의 모델 예산은 8초였다
     * (`services/guard.ts`의 `AI_TIMEOUT_MS`). **바깥이 안보다 먼저 끊으니
     * `server_timeout`은 한 번도 관측될 수 없었다** — 서버가 그 신호를 주려면 8초 뒤에
     * 답해야 하는데 기기가 6초에 끊었다. T-31이 갈라 둔 두 이유 중 한쪽이
     * **구조적으로 나올 수 없는 값**이었다.
     *
     * **기기 쪽을 늘린다.** 서버를 줄이면 모델에게 주는 시간이 줄어 격상이 더 어려워진다
     * (ADR-038 §기각한 대안 2행). 개입 화면은 이미 떠 있고 이 호출은 백그라운드 스레드라
     * **사용자가 기다리는 시간이 아니다.**
     *
     * ⚠️ **둘을 한 상수로 되돌리지 않는다. 뜻이 다르다:**
     * - `connect` — 연결 자체가 안 되는 것은 **진짜 네트워크 부재**다. 빨리 알수록 낫다
     * - `read` — 서버가 생각 중인 시간이다. **여기가 서버 예산보다 커야** 판정이 도착한다
     *
     * 한 이름으로 두면 한쪽을 고칠 때 다른 쪽이 딸려 간다 —
     * 그게 이 결함이 생긴 방식이다. `test/smoke.ts`가 두 파일을 읽어 부등호를 지킨다.
     */
    private const val CONNECT_TIMEOUT_MS = 4_000

    /**
     * `AI_TIMEOUT_MS`(현재 8초) + 여유 4초. 서버는 그 예산 **위에** 컨텍스트 조립과 왕복이
     * 얹히므로 여유는 그쪽 몫이다. 늘어나는 최악은 connect + read = 16초이고, 전부 백그라운드다.
     *
     * ⚠️ **`AI_TIMEOUT_MS`를 올릴 때 이 값을 같이 본다** — 안쪽이 바깥을 넘으면
     * 원래 결함으로 돌아간다. 검사가 막지만, 막힌 이유는 여기 적혀 있다.
     */
    private const val READ_TIMEOUT_MS = 12_000

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
        const val TIMEOUT = "timeout"              // 기기가 기다리다 끊었다 (상한은 위 두 상수)
        const val DNS = "dns"                      // 호스트 이름을 못 풀었다
        const val NETWORK = "network"              // 연결 자체가 안 됐다
        const val BAD_RESPONSE = "bad_response"    // 2xx인데 본문이 판정이 아니다
        const val NO_BASE = "no_base"              // 서버 주소가 설정에 없다
        const val SERVER_TIMEOUT = "server_timeout" // 서버가 모델 예산을 넘겼다
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
         * **기기가 못 닿은 경우와 갈라 둔다** — `timeout`은 기기가 기다리다 끊은 것이고
         * `server_timeout`은 서버가 모델 예산을 넘긴 것이다. 12월에 *"서버가 늦었나"*와
         * *"Doze가 끊었나"*는 대응이 다르므로 같은 이름으로 세면 안 된다.
         *
         * ⚠️ **T-37 전에는 이 갈래의 아래쪽이 도달 불가능했다** — 기기가 서버보다 먼저
         * 끊었으므로 `server_timeout`이 실린 응답이 도착할 수 없었다(ADR-038).
         */
        val unavailableReason: String?
            get() = when (source) {
                "cap" -> Reason.CAP
                "timeout" -> Reason.SERVER_TIMEOUT
                "error" -> Reason.SERVER_ERROR
                else -> null
            }

        /**
         * **왜 그렇게 답했는가** (T-38 · 0017). 위와 정확히 반대편이다 —
         * 저쪽은 판정이 **없을 때**, 이쪽은 판정이 **있을 때**만 값이 있다.
         *
         * 서버는 늘 `reason`을 실어 보내고 이 클래스는 예전부터 그것을 파싱했다.
         * **버리던 것을 나르기만 한다** — 판정도 프롬프트도 달라지지 않는다.
         *
         * `cap`·`timeout`·`error`의 `reason`("상한을 다 썼어요" 같은 것)은 **싣지 않는다.**
         * 그건 판정의 사유가 아니라 못 부른 사정이고, 그쪽은 `unavailableReason`이 닫힌
         * 목록으로 이미 나른다. 둘이 동시에 차면 12월에 어느 쪽을 세는지가 흐려진다.
         */
        val aiReason: String?
            get() = when (source) {
                "ai", "cache" -> reason.trim().ifEmpty { null }
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
     * **판정 자체는 조금도 달라지지 않는다** — fail-closed 그대로다(ADR-024).
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
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
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
        // connect(4초)·read(12초) **어느 쪽이든** 여기로 온다 — 자바가 둘 다 이 예외를 던진다.
        // ⚠️ 갈라서 세지 않는다: 이유는 닫힌 목록이고 그 목록은 0016의 CHECK가 강제하는데,
        // SQLite는 CHECK를 고치려면 테이블을 다시 만들어야 한다 — `guard_events`는
        // 개입 이력 영구 보존이라 옮기지 않는다(0016 주석). **더하고, 빼지 않는다.**
        // 대신 `server_timeout`이 이제 도착할 수 있으므로 "서버가 늦었나"는 갈린다(T-37).
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
