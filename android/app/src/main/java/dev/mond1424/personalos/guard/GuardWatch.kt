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

    /**
     * 마지막 Level 2 판정의 흔적 — **띄운 밤도 안 띄운 밤도 여기를 지난다** (티켓 ③).
     *
     * ⚠️ **T-53이 물린 그 자리다.** 그때 `no_target`은 *"실패가 아니다"* 라서 아무 자국도
     *    안 남겼고, 몇 번을 돌아도 화면도 로그도 그 사실을 못 읽었다. 여기서 *"일정이 없어
     *    안 띄웠다"* 를 조용히 두면 **시간표가 깨진 밤이 공강 밤과 똑같이 보인다.**
     */
    private const val K_L2_GATE = "watch_l2_gate"

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

        // ★ **Level 2만 아침을 본다** (ADR-047 ② · 티켓 ④의 회귀 검사가 겨누는 자리).
        //   Level 3·4는 데드라인·보호 일정이 근거이므로 여기를 타지 않는다 — 태우면
        //   **시험 전날 밤에 Guard가 통째로 조용해진다.**
        var wakeLine: String? = null
        if (level == 2) {
            val w = GuardSync.nextWake(ctx, now, s.wakeLookaheadHours, s.wakeStaleHours)
            // ★ **재료가 없거나 낡았으면 막지 않고 띄운다.** 막으면 *"시간표가 깨졌다"* 가
            //   *"조용한 밤"* 과 같은 모양이 되고, 그게 이 리포가 세 번 물린 실패다.
            //   말할 것이 진짜로 없는 밤(NONE)만 침묵한다.
            val fire = w.state != GuardSync.WakeState.NONE
            noteL2Gate(ctx, w, now, fire)
            if (!fire) return false
            if (w.state == GuardSync.WakeState.OK) wakeLine = wakeSentence(now, w)
        }

        val app = UsageProbe.currentApp(ctx)
        val title = if (level == 2) "아직 깨어 있네요" else "지금 자야 합니다"
        val body = buildString {
            // ★ **사실이 맨 앞이다** — 밤마다 달라지는 것이 이 문장 하나뿐이라
            //   뒤에 붙이면 매일 같은 앞부분이 먼저 읽히고 그대로 넘어간다(ADR-047 ①).
            if (wakeLine != null) append("$wakeLine. ")
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
            // ADR-047 — *"안 떴다"* 의 이유가 여기서 읽힌다. 밤 실측이 보는 칸이다.
            .put("wakeAheadH", s.wakeLookaheadHours)
            .put("wakeStaleH", s.wakeStaleHours)
            .put("l2Gate", pr.getString(K_L2_GATE, null)
                ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL)
    }

    /** 테스트용 — 밤 상한·Level 2 이력을 지운다. */
    fun resetNight(ctx: Context) {
        prefs(ctx).edit().remove(K_NIGHT_KEY).remove(K_NIGHT_N)
            .remove(K_LEVEL2_DONE).remove(K_LAST_FIRE).apply()
    }

    // ── Level 2의 아침 판정 (ADR-047 · T-60) ─────────────────

    /**
     * *"지금 자면 5시간 30분 — 10시 전자기및연습1"*.
     *
     * ⚠️ **명령이 아니라 사실이다.** 설계 §6.2가 개입의 정당성을 사전 서약에 두는데,
     *    매일 같은 명령은 서약을 소모하고 사실은 그렇지 않다.
     *
     * ⚠️ **준비 시간을 빼지 않는다** — 재는 것은 *약속까지 남은 시간*이지 수면 예상치가
     *    아니다. 빼려면 `prep`을 기기에도 둬야 하고, 그러면 역산이 두 벌이 된다
     *    (`protectAxis`가 유일한 자리인 이유와 같다).
     */
    private fun wakeSentence(nowMs: Long, w: GuardSync.Wake): String {
        val min = ((w.at - nowMs) / 60_000L).coerceAtLeast(0)
        val h = min / 60
        val m = min % 60
        val span = when {
            h > 0 && m > 0 -> "${h}시간 ${m}분"
            h > 0 -> "${h}시간"
            else -> "${m}분"
        }
        val c = Calendar.getInstance().apply { timeInMillis = w.at }
        val hh = c.get(Calendar.HOUR_OF_DAY)
        val mm = c.get(Calendar.MINUTE)
        val at = if (mm == 0) "${hh}시" else String.format(java.util.Locale.US, "%d시 %02d분", hh, mm)
        return "지금 자면 $span — $at ${w.title}"
    }

    /** 판정의 흔적. **띄운 쪽도 지난다** — 안 띄운 것만 남기면 '왜 떴나'를 못 읽는다. */
    private fun noteL2Gate(ctx: Context, w: GuardSync.Wake, nowMs: Long, fired: Boolean) {
        val o = JSONObject()
            .put("at", nowMs)
            .put("state", w.state.name.lowercase())
            .put("fired", fired)
            .put("wakeAt", if (w.state == GuardSync.WakeState.OK) w.at else JSONObject.NULL)
            .put("title", w.title ?: JSONObject.NULL)
        prefs(ctx).edit().putString(K_L2_GATE, o.toString()).apply()
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
