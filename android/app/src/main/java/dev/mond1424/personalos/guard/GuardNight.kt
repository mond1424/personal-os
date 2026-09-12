package dev.mond1424.personalos.guard

import android.content.Context
import java.util.Calendar

/**
 * **'밤'이 무엇인가** — 취침 창의 경계 하나, 그리고 **그 밤에 사용자가 몇 번 방해받았는가**.
 *
 * ★ **여기 계수는 `GuardWatch.K_NIGHT_N`과 다른 것을 센다** (T-69). 이름이 그 차이를 말한다:
 *
 * ```
 * watch_night_count      감시(watch:bedtime)가 몇 번 발동했나   — 밤 상한이 읽는다   · 동작
 * night_interrupt_count  오늘 밤 몇 번 방해받았나                — 문구가 읽는다      · 말
 * ```
 *
 * ⚠️ **둘을 합치지 마라.** `watchMaxPerNight`가 앞의 것을 읽으므로 거기에 재확인·경로 A까지
 *    더하면 **감시 발동이 줄어든다 — 말을 고치려다 동작을 바꾸는 것이다**(T-69 §금지 1행).
 *    반대로 문구가 앞의 것을 읽으면 재확인·경로 A가 안 세어져 *"3번째"* 라고 말하는 밤이
 *    사용자에게는 다섯 번째다 — 그것이 이 티켓이 고치는 결함이다.
 *
 * ★ **창 경계의 정의도 여기 하나뿐이다.** [inWindow]·[key]·[windowStartMs] 셋이 같은
 *   *"이 창은 언제 시작했나"* 를 쓴다. 셋이 각자 판단하면 자정을 넘는 창에서 갈라지고,
 *   그때 두 수가 **서로 다른 밤**을 말하게 된다.
 */
object GuardNight {

    /** 이 계수가 속한 밤. 키가 다르면 [count]는 0이다 — 밤이 바뀌면 1부터 다시 센다. */
    private const val K_NIGHT = "night_interrupt_key"

    /**
     * **오늘 밤 사용자가 방해받은 횟수.** 문구의 *"N번째"* 가 읽는 유일한 값이고,
     * 감시·재확인·경로 A 알람을 **다 센다**.
     *
     * ⚠️ **`GuardWatch.K_NIGHT_N`(`watch_night_count`)과 다른 것을 센다.** 그쪽은
     *    *"감시가 몇 번 발동했나"* 이고 **밤 상한이 읽는다** — 둘을 합치면 재확인까지
     *    상한에 세어져 **감시 발동이 줄어든다.** 말을 고치려다 동작을 바꾸는 것이다.
     * ⚠️ **상한은 이 값을 안 본다.** 여기에 무엇을 더해도 발동 횟수는 안 변한다 —
     *    그것이 T-69가 *"문구만 고친다"* 를 지킬 수 있는 이유다.
     */
    private const val K_N = "night_interrupt_count"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    // ── 방해 계수 ────────────────────────────────────────────

    /**
     * 개입 하나를 센다. **`GuardNotifications.fire()`가 부른다** — 감시·재확인·경로 A 알람이
     * 전부 그 함수를 지나므로 **자리가 늘어나는 곳과 세는 곳이 같다**(T-70 `markAsked`와 같은 이유).
     * 경로마다 세면 다음 사람이 넷째 경로를 더하고 여기를 잊는다.
     *
     * ⚠️ **취침 창 안의 발동만 센다.** 문구가 *"오늘 밤"* 과 *"취침 창"* 을 함께 말하므로
     *    두 수가 **같은 창**을 기준으로 재야 한 문장에 설 수 있다. 낮의 보호 알람은
     *    그 문장이 말하는 밤의 일이 아니다.
     *
     * **던지지 않는다** — 세다가 실패해도 개입이 사라지면 안 된다.
     */
    fun note(ctx: Context) {
        runCatching {
            val s = GuardSettings(ctx)
            if (!inWindow(s.bedFrom, s.bedTo)) return@runCatching
            val night = key(s.bedFrom, s.bedTo)
            val pr = prefs(ctx)
            val n = if (pr.getString(K_NIGHT, null) == night) pr.getInt(K_N, 0) else 0
            pr.edit().putString(K_NIGHT, night).putInt(K_N, n + 1).apply()
        }
    }

    /**
     * 지금 밤에 세어진 방해 횟수. 밤 키가 다르면 0 — **밤이 바뀌면 저절로 1부터다.**
     *
     * ⚠️ [note]와 달리 **창 안인지는 안 본다.** 창을 벗어난 아침에도 그 밤의 수를 읽을 수 있어야
     *    폰 콘솔에서 *"어젯밤 몇 번이었나"* 를 되짚는다(`GuardWatch.status`가 싣는다).
     */
    fun count(ctx: Context): Int = runCatching {
        val s = GuardSettings(ctx)
        val pr = prefs(ctx)
        if (pr.getString(K_NIGHT, null) == key(s.bedFrom, s.bedTo)) pr.getInt(K_N, 0) else 0
    }.getOrDefault(0)

    /** 테스트용 — 이 밤의 방해 계수를 지운다. `GuardWatch.resetNight`가 함께 부른다. */
    fun reset(ctx: Context) {
        prefs(ctx).edit().remove(K_NIGHT).remove(K_N).apply()
    }

    // ── 창의 경계 ────────────────────────────────────────────

    /** from > to면 자정을 넘는 창으로 읽는다 (00:30~06:00은 안 넘고, 23:00~05:00은 넘는다). */
    fun inWindow(from: String, to: String): Boolean {
        val f = hm(from); val t = hm(to)
        if (f < 0 || t < 0) return false
        val c = Calendar.getInstance()
        val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        return if (f <= t) now in f until t else now >= f || now < t
    }

    /** 창이 자정을 넘으면 **시작한 날짜**를 밤의 이름으로 쓴다. */
    fun key(from: String, to: String): String {
        val c = startCal(hm(from), hm(to))
        return "%04d-%02d-%02d".format(
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
        )
    }

    /**
     * 지금 들어와 있는 창이 **시작한 시각**(ms). 창 표기가 깨졌으면 0.
     *
     * 문구의 *"N분"* 이 여기서부터를 잰다(T-69 ②) — [key]와 **같은 날짜 판정**을 쓰므로
     * *"몇 번째"* 와 *"몇 분"* 이 같은 밤을 말한다.
     */
    fun windowStartMs(from: String, to: String): Long {
        val f = hm(from); val t = hm(to)
        if (f < 0 || t < 0) return 0L
        val c = startCal(f, t)
        c.set(Calendar.HOUR_OF_DAY, f / 60)
        c.set(Calendar.MINUTE, f % 60)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /**
     * 창이 시작한 **날**의 달력. 자정을 넘는 창의 후반이면 어제다.
     *
     * ★ [key]와 [windowStartMs]가 **이 하나를 공유한다** — 각자 판단하면 자정 근처에서
     *   하루가 갈라지고, 그 순간 두 수가 다른 밤을 말한다.
     */
    private fun startCal(f: Int, t: Int): Calendar {
        val c = Calendar.getInstance()
        val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        if (f > t && now < t) c.add(Calendar.DAY_OF_YEAR, -1)   // 창 후반 — 어제 밤이다
        return c
    }

    private fun hm(s: String): Int {
        val m = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$").find(s.trim()) ?: return -1
        return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
    }
}
