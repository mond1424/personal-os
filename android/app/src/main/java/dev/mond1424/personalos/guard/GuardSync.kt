package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONArray
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
    private const val K_FRICTION = "sync_friction"     // Override 대기 배수 (ADR-019 모드)
    private const val K_MODE = "sync_mode"
    private const val K_WAKE = "sync_wake"             // 아침 재료 (JSON 배열 · ADR-047)
    private const val K_WAKE_AT = "sync_wake_at"       // ★ 그것을 **받은** 시각 — 낡음 판정의 근거

    /**
     * Override 대기 시간 배수. 활성 모드가 정한다(coach 1.0 · secretary 0).
     * 서버에서 못 받았으면 1.0 — **마찰이 있는 쪽이 기본**이다.
     * 통신이 안 될 때 마찰이 사라지면 그게 우회로가 된다.
     */
    fun frictionMult(ctx: Context): Float =
        prefs(ctx).getFloat(K_FRICTION, 1.0f)

    fun mode(ctx: Context): String? = prefs(ctx).getString(K_MODE, null)

    // ── 아침 재료 (ADR-047 · T-60) ────────────────────────────
    //
    // Level 2가 *"오늘 밤이 다른 밤과 어떻게 다른가"* 를 말하려면 아침에 무엇이 기다리는지
    // 알아야 하고, **발동 경로엔 네트워크가 없다**(ADR-021). 그래서 낮에 받아 여기 둔다.

    /**
     * ★ **넷을 가르는 것이 이 타입의 존재 이유다.** 셋은 다 *"시각을 못 붙인다"* 지만
     *   [NONE]만 *"말할 것이 없다"* 이고 나머지 둘은 **결함**이다 — 같은 이름으로 묶으면
     *   시간표가 깨진 밤이 조용한 밤과 구별되지 않는다(티켓 ③).
     */
    enum class WakeState { OK, NONE, NO_DATA, STALE }

    data class Wake(val state: WakeState, val at: Long = 0L, val title: String? = null)

    /**
     * `now` 이후 [lookaheadH]시간 안의 **첫 약속**. 없으면 상태로 왜 없는지 말한다.
     *
     * ⚠️ **한 번도 못 받았을 때와 받았는데 비었을 때가 다른 값이다.** 전자는 옛 배포거나
     *    동기화가 한 번도 성공하지 못한 것이고, 후자는 *"방학·공강이라 정말 없다"* 이다.
     */
    fun nextWake(ctx: Context, nowMs: Long, lookaheadH: Int, staleH: Int): Wake {
        val pr = prefs(ctx)
        val raw = pr.getString(K_WAKE, null) ?: return Wake(WakeState.NO_DATA)
        val gotAt = parseIso(pr.getString(K_WAKE_AT, null)) ?: return Wake(WakeState.NO_DATA)
        if (nowMs - gotAt > staleH * 3_600_000L) return Wake(WakeState.STALE)
        val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return Wake(WakeState.NO_DATA)

        val limit = nowMs + lookaheadH * 3_600_000L
        var bestAt = Long.MAX_VALUE
        var bestTitle: String? = null
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val at = parseIso(o.optString("at")) ?: continue
            if (at <= nowMs || at > limit || at >= bestAt) continue
            bestAt = at
            bestTitle = o.optString("title", "")
        }
        return if (bestTitle == null) Wake(WakeState.NONE) else Wake(WakeState.OK, bestAt, bestTitle)
    }
    private const val K_LAST_FIRE = "last_fire"        // 마지막 발동 흔적 (무인 테스트의 증거)

    /**
     * 발동 흔적을 남긴다.
     *
     * 무인 테스트(밤 03:00)에서 자느라 놓치면 뭘 근거로 판정할 것인가 —
     * `listAlarms()`의 count가 0인 건 '소비됐다'는 뜻일 뿐, 화면이 떴는지·소리가 났는지는 모른다.
     * 여기에 남겨 두면 아침에 확인할 수 있다.
     */
    fun noteFire(ctx: Context, level: Int, shown: Boolean, posted: Boolean) {
        val o = JSONObject()
            .put("at", nowIso()).put("level", level)
            .put("shown", shown).put("posted", posted)
        prefs(ctx).edit().putString(K_LAST_FIRE, o.toString()).apply()
    }

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
        // 아침 재료가 **언제 온 것이고 몇 개인가** — 없는 것과 낡은 것을 화면에서 가른다.
        .put("wakeAt", prefs(ctx).getString(K_WAKE_AT, null) ?: JSONObject.NULL)
        .put("wakeN", prefs(ctx).getString(K_WAKE, null)
            ?.let { runCatching { JSONArray(it).length() }.getOrNull() } ?: -1)
        .put("lastFire", prefs(ctx).getString(K_LAST_FIRE, null)
            ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL)
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

        // ★ **폰 캘린더 미러가 보호 일정 pull보다 먼저다** (T-53 ⑤ · 범위 밖 한 줄).
        //   순서가 뒤집히면 오늘 캘린더에서 옮겨 온 시험이 **이번 응답의 `fires[]`에 없고**,
        //   다음 동기화는 내일이라 **그날 알람 예약을 통째로 놓친다.**
        //   여기가 유일한 자리인 이유: 앱을 열 때도, 하루 1회 알람이 깨울 때도, 부팅 복구도
        //   전부 이 함수를 지난다 — 별도 알람으로 '2분 먼저'를 흉내 내면 그것은 순서 보장이
        //   아니라 우연이다. 실패해도 계속 간다: 캘린더가 안 와도 서버가 이미 아는
        //   보호 일정은 예약돼야 한다(동기화 실패로 예약을 인질로 잡지 않는다).
        runCatching { dev.mond1424.personalos.cal.CalSync.syncNow(ctx) }

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

        // 경계·모드를 먼저 저장한다 — scheduleDailySync와 개입 화면이 이 값을 읽는다.
        prefs(ctx).edit().apply {
            root.optString("boundary", "").takeIf { it.isNotBlank() }?.let { putString(K_BOUNDARY, it) }
            root.optString("mode", "").takeIf { it.isNotBlank() }?.let { putString(K_MODE, it) }
            if (root.has("friction_mult")) putFloat(K_FRICTION, root.optDouble("friction_mult", 1.0).toFloat())
            // ★ **필드가 있을 때만 손댄다.** 없으면 지우지도 않는다 — 옛 배포에 한 번 붙었다고
            //   어젯밤 재료를 지우면 그 밤이 통째로 '모른다'가 되고, 그건 사실이 아니다.
            //   대신 받은 시각이 안 갱신되므로 `wakeStaleHours`가 지나면 스스로 '낡음'이 된다.
            if (root.has("wake")) {
                putString(K_WAKE, root.optJSONArray("wake")?.toString() ?: "[]")
                putString(K_WAKE_AT, nowIso())
            }
        }.apply()

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
