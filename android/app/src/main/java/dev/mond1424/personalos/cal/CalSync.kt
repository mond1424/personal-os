package dev.mond1424.personalos.cal

import android.content.Context
import dev.mond1424.personalos.guard.GuardSync
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * 읽은 것을 서버에 보낸다 — `POST /api/cal/sync` (T-53 · 도착지는 T-52가 세웠다).
 *
 * ★ **왜 플러그인이 아니라 object인가.** 동기화 시점이 셋인데(앱 열 때 · 하루 1회 보호 일정
 *   pull 직전 · 수동) **가운데 하나는 웹이 없는 시각에 돈다.** 알람이 깨우는 그 경로에는
 *   `PluginCall`이 없으므로, 보내는 코드가 플러그인 안에 있으면 그 시점이 통째로 빈다.
 *   [CalPlugin]은 이 object를 부르기만 한다 — `GuardSync`/`GuardPlugin`과 같은 모양이다.
 *
 * **자격증명은 [GuardSync]의 것을 그대로 쓴다**(읽기만 한다). 토큰은 웹뷰 localStorage에 있고
 * 네이티브가 직접 못 읽어 웹이 `configure`로 건네주는데, 그 통로를 두 벌 두면 한쪽만
 * 갱신되는 밤이 반드시 온다. `GuardEventQueue`가 같은 이유로 같은 값을 쓴다.
 */
object CalSync {

    private const val K_TARGETS = "cal_targets"          // 쉼표로 이은 캘린더 id
    private const val K_DAYS = "cal_window_days"
    private const val K_LAST_OK = "cal_last_ok"
    private const val K_LAST_ERR = "cal_last_err"
    private const val K_LAST_N = "cal_last_count"
    private const val K_LAST_SERVER = "cal_last_server"  // 서버가 세어 준 것(무엇을 안 했는지)

    /** 창 길이 기본값(일). 티켓 ④의 `기본 60`. */
    const val DEFAULT_WINDOW_DAYS = 60

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("cal", Context.MODE_PRIVATE)

    // ── 대상 캘린더 — 선택 전에는 아무것도 안 가져온다 (티켓 ③) ──────────

    fun targets(ctx: Context): Set<Long> =
        (prefs(ctx).getString(K_TARGETS, "") ?: "")
            .split(",").mapNotNull { it.trim().toLongOrNull() }.toSet()

    fun setTargets(ctx: Context, ids: List<Long>) {
        prefs(ctx).edit().putString(K_TARGETS, ids.distinct().joinToString(",")).apply()
    }

    fun windowDays(ctx: Context): Int =
        prefs(ctx).getInt(K_DAYS, DEFAULT_WINDOW_DAYS).coerceIn(1, 365)

    fun setWindowDays(ctx: Context, days: Int) {
        prefs(ctx).edit().putInt(K_DAYS, days.coerceIn(1, 365)).apply()
    }

    /**
     * 화면이 읽는 사실들. **상태 이름을 여기서 정하지 않는다** — 문구와 우선순위는
     * 웹의 `calStatusLine` 한 곳이 정한다(두 곳에 두면 갈라진다).
     */
    fun status(ctx: Context): JSONObject = JSONObject()
        .put("permission", CalendarReader.hasPermission(ctx))
        .put("targets", JSONArray().apply { targets(ctx).forEach { put(it) } })
        .put("windowDays", windowDays(ctx))
        .put("configured", GuardSync.isConfigured(ctx))
        .put("lastOkAt", prefs(ctx).getString(K_LAST_OK, null) ?: JSONObject.NULL)
        .put("lastError", prefs(ctx).getString(K_LAST_ERR, null) ?: JSONObject.NULL)
        .put("lastCount", prefs(ctx).getInt(K_LAST_N, -1))
        .put(
            "lastServer",
            prefs(ctx).getString(K_LAST_SERVER, null)
                ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL,
        )

    data class Result(val ok: Boolean, val sent: Int, val error: String? = null, val skipped: String? = null)

    /**
     * ⚠️ 네트워크를 탄다 — **백그라운드 스레드에서만** 부른다.
     *
     * 멱등하다: 창 범위의 상태를 통째로 보내고 서버가 `events`를 그 상태에 맞춘다.
     * 부분 전송을 하지 않는 이유는 **삭제**다 — 캘린더에서 지운 일정을 서버가 알 방법이
     * "이번에 안 온 것"뿐이다(`calsync.ts`).
     *
     * ★ **권한 없음·미선택은 실패가 아니다.** `lastError`를 건드리지 않고 `skipped`로 돌아간다 —
     *   그 둘은 화면에서 각자의 문구를 가져야 하고(티켓 ②), 실패로 적으면 셋이 한 문장으로 뭉친다.
     */
    fun syncNow(ctx: Context): Result {
        if (!CalendarReader.hasPermission(ctx)) return Result(false, 0, skipped = "no_permission")
        val ids = targets(ctx)
        if (ids.isEmpty()) return Result(false, 0, skipped = "no_target")

        val base = GuardSync.baseUrl(ctx)
            ?: return fail(ctx, "baseUrl이 설정되지 않았습니다 — 웹에서 configure를 먼저 부릅니다")
        val token = GuardSync.token(ctx)

        val from = windowFrom(ctx)
        val to = CalendarReader.addDays(from, windowDays(ctx))
        val items = CalendarReader.readWindow(ctx, ids, from, to)

        // ★ 관측 시각을 LWW 기준으로 보낸다. CalendarContract에는 이식 가능한 '수정 시각'이
        //   없다 — 그래서 *"기기가 이 상태를 본 시각"* 을 싣는다. 늦게 도착한 옛 배치가
        //   새 상태를 덮는 것을 서버가 이 값으로 막는다(`calsync.ts`의 LWW).
        val observedAt = nowIso()
        val body = JSONObject()
            .put("window", JSONObject().put("from", from).put("to", to))
            .put(
                "items",
                JSONArray().apply {
                    items.forEach { item ->
                        put(
                            JSONObject()
                                .put("ext_uid", item.extUid)
                                .put("title", item.title)
                                .put("date", item.date)
                                .put("time", item.time ?: JSONObject.NULL)
                                .put("all_day", item.allDay)
                                .put("ext_updated", observedAt),
                        )
                    }
                },
            )

        val text = try {
            val c = (URL("$base/api/cal/sync").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
            }
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val res = (if (code in 200..299) c.inputStream else c.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (code !in 200..299) return fail(ctx, "HTTP $code ${res.take(120)}")
            res
        } catch (e: Exception) {
            return fail(ctx, e.message ?: e.javaClass.simpleName)
        }

        val counted = runCatching { JSONObject(text) }.getOrNull()
        prefs(ctx).edit()
            .putString(K_LAST_OK, nowIso())
            .remove(K_LAST_ERR)
            .putInt(K_LAST_N, items.size)
            .putString(K_LAST_SERVER, counted?.toString() ?: JSONObject().toString())
            .apply()
        return Result(true, items.size)
    }

    private const val TIMEOUT_MS = 10_000

    private fun fail(ctx: Context, msg: String): Result {
        prefs(ctx).edit().putString(K_LAST_ERR, msg).apply()
        return Result(false, 0, error = msg)
    }

    /**
     * 창의 시작 = **열린 날**(티켓 ④).
     *
     * ⚠️ 경계 이전(새벽)에는 아직 어제가 열려 있다. 벽시계 오늘로 잡으면 그 시간대에
     *    **열린 날이 창 밖**이 되어 오늘 화면만 캘린더가 안 채워진다.
     *    ADR-029가 금지한 것은 *항목의 귀속일 재계산*이고, 여기서 정하는 것은 **창의 시작**이다 —
     *    각 일정의 날짜는 캘린더의 벽시계 그대로 간다([CalendarReader]).
     */
    private fun windowFrom(ctx: Context): String {
        val (bh, bm) = GuardSync.boundaryHm(ctx)
        val c = Calendar.getInstance()
        if (c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE) < bh * 60 + bm) {
            c.add(Calendar.DAY_OF_YEAR, -1)
        }
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.time)
    }

    private fun nowIso() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(java.util.Date())
}
