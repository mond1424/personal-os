package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 서버의 예약 재료를 받아 기기에 알람으로 건다.
 *
 * 서버(`GET /api/guard/schedule`)가 보호 일정을 데드라인 역산까지 끝내
 * **발동 시각별로 펼친 `fires[]`** 를 준다. 여기서는 그걸 그대로 걸기만 한다 —
 * 판단은 서버가 이미 했고, 발동은 기기가 한다(ADR-021).
 *
 * 네트워크는 **여기서만** 쓴다. 발동 경로(AlarmReceiver)에는 네트워크가 없다.
 * 동기화가 실패해도 이미 걸린 알람은 그대로 발동한다.
 */
object GuardSync {

    private const val K_BASE = "sync_base_url"
    private const val K_TOKEN = "sync_token"
    private const val K_LAST_OK = "sync_last_ok"
    private const val K_LAST_ERR = "sync_last_err"
    private const val K_LAST_N = "sync_last_count"
    private const val K_BOUNDARY = "sync_boundary"     // 'HH:MM' — 서버가 준 하루 경계

    private const val TIMEOUT_MS = 10_000

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    /**
     * 웹이 부팅 때 한 번 알려 준다.
     * 토큰은 웹뷰의 localStorage에 있고 네이티브가 직접 못 읽는다 —
     * 그래서 웹이 건네준다. Phase 0(인증 골격, 9월)에서 기기 토큰으로 바뀐다.
     */
    fun configure(ctx: Context, baseUrl: String, token: String?) {
        prefs(ctx).edit()
            .putString(K_BASE, baseUrl.trimEnd('/'))
            .putString(K_TOKEN, token)
            .apply()
    }

    fun isConfigured(ctx: Context) = !prefs(ctx).getString(K_BASE, null).isNullOrBlank()

    // 큐(GuardEventQueue)도 같은 자격증명을 쓴다.
    fun baseUrl(ctx: Context): String? = prefs(ctx).getString(K_BASE, null)
    fun token(ctx: Context): String? = prefs(ctx).getString(K_TOKEN, null)

    /**
     * 하루 경계 — 재동기화 시각의 기준.
     * **사용자 설정이라 서버에서 받아 쓴다.** 아직 한 번도 못 받았으면 설계 기본값(05:00).
     */
    fun boundaryHm(ctx: Context): Pair<Int, Int> {
        val s = prefs(ctx).getString(K_BOUNDARY, null) ?: "05:00"
        val m = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$").find(s.trim())
            ?: return 5 to 0
        return m.groupValues[1].toInt() to m.groupValues[2].toInt()
    }

    fun status(ctx: Context): JSONObject = JSONObject()
        .put("configured", isConfigured(ctx))
        .put("baseUrl", prefs(ctx).getString(K_BASE, null))
        .put("hasToken", !prefs(ctx).getString(K_TOKEN, null).isNullOrBlank())
        .put("lastOkAt", prefs(ctx).getString(K_LAST_OK, null))
        .put("lastError", prefs(ctx).getString(K_LAST_ERR, null))
        .put("lastCount", prefs(ctx).getInt(K_LAST_N, -1))
        .put("boundary", prefs(ctx).getString(K_BOUNDARY, null))
        .put("nextSyncAt", boundaryHm(ctx).let { (h, m) ->
            val t = h * 60 + m + 10
            String.format(Locale.US, "%02d:%02d", (t / 60) % 24, t % 60)
        })

    data class Result(val ok: Boolean, val scheduled: Int, val error: String? = null)

    /**
     * ⚠️ 네트워크를 탄다 — **백그라운드 스레드에서만** 부른다.
     *
     * 멱등하다: 서버에서 받은 예약으로 통째로 갈아엎는다.
     * 부분 갱신을 하지 않는 이유는, 서버에서 보호 규칙이 지워졌을 때
     * 기기에 남은 알람을 확실히 없애야 하기 때문이다.
     */
    fun syncNow(ctx: Context): Result {
        val base = prefs(ctx).getString(K_BASE, null)
            ?: return fail(ctx, "baseUrl이 설정되지 않았습니다 — 웹에서 configure를 먼저 부릅니다")
        val token = prefs(ctx).getString(K_TOKEN, null)

        // 밀린 발동 기록부터 올린다 — 예약 갱신보다 먼저다.
        // 예약은 실패해도 다음날 다시 오지만, 기록은 여기서 안 올리면 계속 기기에만 남는다.
        runCatching { GuardEventQueue.flush(ctx) }

        val body = try {
            val c = (URL("$base/api/guard/schedule").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (code !in 200..299) return fail(ctx, "HTTP $code ${text.take(120)}")
            text
        } catch (e: Exception) {
            return fail(ctx, e.message ?: e.javaClass.simpleName)
        }

        val root = try {
            JSONObject(body)
        } catch (e: Exception) {
            return fail(ctx, "응답 파싱 실패: ${e.message}")
        }
        val plans = root.optJSONArray("events") ?: return fail(ctx, "events가 없습니다")

        // 경계를 먼저 저장한다 — 아래 scheduleDailySync가 이 값을 읽는다.
        root.optString("boundary", "").takeIf { it.isNotBlank() }?.let {
            prefs(ctx).edit().putString(K_BOUNDARY, it).apply()
        }

        // 서버발 예약만 갈아엎는다 — 테스트 알람(TEST_ID_BASE 구간)은 건드리지 않는다.
        GuardAlarms.cancelSynced(ctx)

        var id = GuardAlarms.SYNC_ID_BASE
        var n = 0
        for (i in 0 until plans.length()) {
            val p = plans.getJSONObject(i)
            val eventId = p.optString("event_id", null)
            val fires = p.optJSONArray("fires") ?: continue
            for (j in 0 until fires.length()) {
                val f = fires.getJSONObject(j)
                val at = parseIso(f.optString("at")) ?: continue
                if (at <= System.currentTimeMillis()) continue
                val okOne = GuardAlarms.schedule(
                    ctx,
                    ScheduledAlarm(
                        id = id++,
                        at = at,
                        level = f.optInt("level", 3),
                        title = f.optString("title", "Guard"),
                        body = f.optString("body", ""),
                        eventId = eventId,
                    ),
                )
                if (okOne) n++
            }
        }

        // 다음 동기화를 예약한다 — 앱을 안 열어도 하루 한 번은 갱신된다.
        GuardAlarms.scheduleDailySync(ctx)

        prefs(ctx).edit()
            .putString(K_LAST_OK, nowIso())
            .remove(K_LAST_ERR)
            .putInt(K_LAST_N, n)
            .apply()
        return Result(true, n)
    }

    private fun fail(ctx: Context, msg: String): Result {
        prefs(ctx).edit().putString(K_LAST_ERR, "${nowIso()} $msg").apply()
        // 실패해도 다음 시도는 예약해 둔다 — 한 번 실패로 영영 끊기면 안 된다.
        runCatching { GuardAlarms.scheduleDailySync(ctx) }
        return Result(false, 0, msg)
    }

    private fun iso(): SimpleDateFormat =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

    private fun nowIso() = iso().format(java.util.Date())

    /** 서버는 ISO8601 UTC(`...Z`)로 준다. 밀리초 유무 둘 다 받는다. */
    private fun parseIso(s: String?): Long? {
        if (s.isNullOrBlank()) return null
        for (pat in listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            runCatching {
                val f = SimpleDateFormat(pat, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
                return f.parse(s)!!.time
            }
        }
        return null
    }
}
