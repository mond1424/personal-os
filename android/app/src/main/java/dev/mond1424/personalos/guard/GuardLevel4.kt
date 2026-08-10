package dev.mond1424.personalos.guard

import android.content.Context

/**
 * "지금 Level 4 구간인가" — 화면이 오늘 날짜를 붙이기 전에 묻는다 (ADR-035 ②·③).
 *
 * **화면의 수명으로 판정하지 않는다.** `GuardAlertActivity`의 `live` 참조는 수락이든
 * Override든 `finishWith()`가 지우므로 **정상 경로로 화면을 나오면 이미 null**이고,
 * 앱에 와서 작업을 추가하는 것은 그 뒤의 일이다 — 그 기준으로는 차단이 영원히 안 걸린다.
 * ADR-035 ③이 기각한 구조가 정확히 그것이다.
 *
 * 그래서 **격상이 승인된 시각**을 남기고 창으로 판정한다.
 * 기준은 화면이 떴는지가 아니라 **격상이 승인됐다**는 사실이다.
 *
 * 판정을 여기서 끝내고 웹에는 결과만 준다(ADR-035 ②) — 시각만 넘겨 웹이 계산하게 두면
 * 창의 길이가 두 곳에 생기고, 두 곳에 있는 같은 사실은 갈라진다.
 */
object GuardLevel4 {

    /**
     * 격상 구간의 길이.
     *
     * 30분인 이유: Level 4는 데드라인 +30분부터 **30분 간격으로** 뜬다
     * (`services/guard.ts`의 `push` 루프). 창을 그 주기에 맞추면 **다음 발동이 이어받아**
     * 구간이 끊기지 않고, 발동이 멎으면 자연히 닫힌다 — 별도의 해제 경로가 필요 없다.
     *
     * ⚠️ **`GuardWatch.REFIRE_MS`를 재사용하지 않는다.** 값이 같지만 뜻이 다르다 —
     * 그쪽은 **감지(경로 B)의 재발동 간격**이고 이것은 **Level 4(경로 A)의 발동 주기**다.
     * 우연히 같은 값을 한 상수로 묶으면 한쪽을 조정할 때 다른 쪽이 말없이 끌려간다.
     */
    const val WINDOW_MS = 30 * 60_000L

    /** 쓰는 곳과 읽는 곳이 **이 상수 하나**를 본다. 키 문자열 사본을 두지 않는다. */
    private const val K_AT = "level4_at"

    /** 기존 "guard" prefs를 그대로 쓴다 — 새 파일을 만들지 않는다. */
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    /**
     * 격상이 승인됐다.
     *
     * **화면 격상의 성공 여부와 무관하게** 부른다 — 살아 있는 화면이 없거나 마찰에
     * 들어간 뒤면 화면은 안 올라가지만, **개입은 Level 4로 승인된 것**이고
     * 이 기록이 말하는 것은 그것이다.
     *
     * 던지지 않는다. 이 기록이 실패해도 개입 자체가 죽으면 안 된다.
     */
    fun note(ctx: Context) {
        runCatching {
            prefs(ctx).edit().putLong(K_AT, System.currentTimeMillis()).apply()
        }
    }

    /**
     * 구간이 살아 있으면 그 **끝**(epoch ms), 아니면 null.
     *
     * 끝을 함께 돌려주는 이유는 화면이 **왜 내일이 됐는지 말해야** 하기 때문이다(ADR-035 ⑤).
     * 판정 자체는 여기서 끝난다 — 부르는 쪽은 null인지만 보면 된다.
     */
    fun activeUntil(ctx: Context): Long? = runCatching {
        val at = prefs(ctx).getLong(K_AT, 0L)
        if (at <= 0L) return@runCatching null
        val until = at + WINDOW_MS
        if (System.currentTimeMillis() < until) until else null
    }.getOrNull()
}
