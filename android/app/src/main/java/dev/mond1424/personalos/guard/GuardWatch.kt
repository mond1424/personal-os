package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONObject
import java.util.Calendar

/**
 * 감지 기반 발동 (ADR-025) — **시각 경로와 독립된 두 번째 발동 경로.**
 *
 * 왜 필요한가:
 *   시각 경로(보호 규칙 → 데드라인 역산 → 알람)는 `protect_from`이 붙은 일정이 있을 때만 돈다.
 *   그런 일정은 드물어서 Guard가 몇 주에 한 번 발동하고, 그러면 9~11월에 전례가 안 쌓인다.
 *   전례가 없으면 자기 보정(§6.5)은 12월에도 발화하지 못한다 — 실사용 기간의 목적 자체가 무너진다.
 *
 * 규칙은 **결정론**이다(ADR-021 유지). 위험도 점수나 AI가 아니라 관찰값의 임계 비교다:
 *   취침 창 안 · 화면 켜짐 · 연속 사용 ≥ N분  →  Level 2(1회) → 이후 M분마다 Level 3
 *
 * ⚠️ **N도 M도 여기 적지 않는다** — 둘 다 `GuardSettings`가 진다(T-51).
 *    숫자를 주석에 박으면 설정과 두 벌이 되고, 그 순간 이 주석이 틀린 문서가 된다.
 *
 * 실패 사례 #1이 정확히 이 상황이다 — 시험 전날 밤, 몰입, 새벽.
 *
 * 이 경로가 죽어도 시각 경로는 그대로 발동한다(예약이 시스템에 있다).
 * ADR-018이 지키려던 견고성은 그래서 유지된다.
 */
object GuardWatch {

    // ★ **재발동 간격은 여기 없다** — `GuardSettings.watchRefireMinutes`가 진다 (T-51).
    //   `watchMinutes`(첫 발동 임계)와 같은 규칙의 두 손잡이인데 하나만 상수였고,
    //   그러면 조정할 때마다 APK가 든다. 9~11월에 가장 먼저 만질 값이 이 둘이다.
    //   ⚠️ 여기에 분(分)을 다시 박으면 `test/front.mjs`의 스캐너가 빨간불이 된다.

    private const val K_LAST_FIRE = "watch_last_fire_at"
    private const val K_NIGHT_KEY = "watch_night_key"
    private const val K_NIGHT_N = "watch_night_count"
    private const val K_LEVEL2_DONE = "watch_l2_done"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    /**
     * GuardService 폴링이 부른다. 조건을 만족하면 발동하고 true.
     *
     * **던지지 않는다** — 규칙 평가가 실패해도 서비스가 죽으면 안 된다.
     */
    fun evaluate(ctx: Context): Boolean = runCatching { evalInner(ctx) }.getOrDefault(false)

    private fun evalInner(ctx: Context): Boolean {
        val s = GuardSettings(ctx)
        if (!s.watchEnabled) return false
        if (!inBedWindow(s.bedFrom, s.bedTo)) return false

        // 취침 창을 하나의 '밤'으로 묶는다. 창 시작 시점의 날짜를 키로 쓴다 —
        // 자정을 넘겨도 같은 밤이어야 상한이 제대로 걸린다.
        val night = nightKey(s.bedFrom, s.bedTo)
        val pr = prefs(ctx)
        if (pr.getString(K_NIGHT_KEY, null) != night) {
            pr.edit().putString(K_NIGHT_KEY, night)
                .putInt(K_NIGHT_N, 0).putBoolean(K_LEVEL2_DONE, false).apply()
        }
        if (pr.getInt(K_NIGHT_N, 0) >= s.watchMaxPerNight) return false

        // 연속 사용 — 화면이 켜진 채로 얼마나 붙잡고 있었나.
        // 잠깐 시간 확인하는 것과 구분하려면 '연속'이어야 한다.
        val usedMin = GuardActivityLog.continuousScreenOnMin(ctx)
        if (usedMin < s.watchMinutes) return false

        val now = System.currentTimeMillis()
        val last = pr.getLong(K_LAST_FIRE, 0)
        val l2done = pr.getBoolean(K_LEVEL2_DONE, false)

        // 처음은 Level 2(맥락 경고). 바로 Level 3으로 가면 오발동 비용이 크다.
        val level = if (!l2done) 2 else 3
        if (l2done && now - last < s.watchRefireMinutes * 60_000L) return false

        val app = UsageProbe.currentApp(ctx)
        val title = if (level == 2) "아직 깨어 있네요" else "지금 자야 합니다"
        val body = buildString {
            append("취침 창(${s.bedFrom}~${s.bedTo}) 안에서 ${usedMin}분째 화면을 보고 있어요.")
            if (app != null) append(" 지금 ${app}.")
            if (level >= 3) append(" 내일이 무너집니다.")
        }

        GuardNotifications.fire(ctx, level, title, body, eventId = null, cause = "watch:bedtime")

        pr.edit().putLong(K_LAST_FIRE, now)
            .putInt(K_NIGHT_N, pr.getInt(K_NIGHT_N, 0) + 1)
            .putBoolean(K_LEVEL2_DONE, true)
            .apply()
        return true
    }

    // ── 상태 조회 (확인용) ───────────────────────────────────

    fun status(ctx: Context): JSONObject {
        val s = GuardSettings(ctx)
        val pr = prefs(ctx)
        return JSONObject()
            .put("enabled", s.watchEnabled)
            .put("bedFrom", s.bedFrom).put("bedTo", s.bedTo)
            .put("inWindow", inBedWindow(s.bedFrom, s.bedTo))
            .put("thresholdMin", s.watchMinutes)
            .put("refireMin", s.watchRefireMinutes)   // T-51 — 둘이 같은 화면에 보여야 짝으로 읽힌다
            .put("continuousMin", GuardActivityLog.continuousScreenOnMin(ctx))
            .put("firedTonight", pr.getInt(K_NIGHT_N, 0))
            .put("maxPerNight", s.watchMaxPerNight)
            .put("level2Done", pr.getBoolean(K_LEVEL2_DONE, false))
            .put("nightKey", pr.getString(K_NIGHT_KEY, null))
    }

    /** 테스트용 — 밤 상한·Level 2 이력을 지운다. */
    fun resetNight(ctx: Context) {
        prefs(ctx).edit().remove(K_NIGHT_KEY).remove(K_NIGHT_N)
            .remove(K_LEVEL2_DONE).remove(K_LAST_FIRE).apply()
    }

    // ── helpers ─────────────────────────────────────────────

    private fun hm(s: String): Int {
        val m = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$").find(s.trim()) ?: return -1
        return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
    }

    /** from > to면 자정을 넘는 창으로 읽는다 (00:30~06:00은 안 넘고, 23:00~05:00은 넘는다). */
    private fun inBedWindow(from: String, to: String): Boolean {
        val f = hm(from); val t = hm(to)
        if (f < 0 || t < 0) return false
        val c = Calendar.getInstance()
        val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        return if (f <= t) now in f until t else now >= f || now < t
    }

    /** 창이 자정을 넘으면 시작한 날짜를 밤의 이름으로 쓴다. */
    private fun nightKey(from: String, to: String): String {
        val f = hm(from); val t = hm(to)
        val c = Calendar.getInstance()
        val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        if (f > t && now < t) c.add(Calendar.DAY_OF_YEAR, -1)   // 창 후반 — 어제 밤이다
        return "%04d-%02d-%02d".format(
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
        )
    }
}
