package dev.mond1424.personalos.guard

import android.content.Context
import android.media.AudioManager

/**
 * Guard 개입의 소리·진동 설정.
 *
 * 왜 SharedPreferences인가 — 발동은 네트워크 없이 기기가 한다(ADR-021).
 * 설정도 마찬가지로 기기에 있어야 새벽에 서버가 안 붙어도 판단이 선다.
 * 서버(`settings` 테이블)와의 동기화는 2주차 pull에 얹는다.
 */
class GuardSettings(ctx: Context) {

    private val p = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    var sound: Boolean
        get() = p.getBoolean(K_SOUND, true)
        set(v) = p.edit().putBoolean(K_SOUND, v).apply()

    var vibration: Boolean
        get() = p.getBoolean(K_VIBRATION, true)
        set(v) = p.edit().putBoolean(K_VIBRATION, v).apply()

    // ── 감지 기반 발동 (ADR-025) ──────────────────────────────
    // 보호 일정이 없어도 도는 규칙. 이게 없으면 루프가 몇 주에 한 번 돌아
    // 9~11월에 전례가 쌓이지 않는다.

    /** 감지 발동 전체 스위치. 끄면 시각 경로만 남는다. */
    var watchEnabled: Boolean
        get() = p.getBoolean(K_WATCH, true)
        set(v) = p.edit().putBoolean(K_WATCH, v).apply()

    /** 취침 창 시작 'HH:MM'. 이 시각부터 다음 창 끝까지가 개입 대상. */
    var bedFrom: String
        get() = p.getString(K_BED_FROM, "00:30") ?: "00:30"
        set(v) = p.edit().putString(K_BED_FROM, v).apply()

    /** 취침 창 끝 'HH:MM'. from > to면 자정을 넘는 창으로 해석한다. */
    var bedTo: String
        get() = p.getString(K_BED_TO, "06:00") ?: "06:00"
        set(v) = p.edit().putString(K_BED_TO, v).apply()

    /** 연속 사용 임계(분). 잠깐 확인하는 것과 붙잡고 있는 것을 가른다. */
    var watchMinutes: Int
        get() = p.getInt(K_WATCH_MIN, 15)
        set(v) = p.edit().putInt(K_WATCH_MIN, v.coerceIn(1, 240)).apply()

    /**
     * Level 3 재발동 간격(분) — T-51에서 `GuardWatch`의 상수에서 여기로 내려왔다.
     *
     * ★ **같은 규칙의 두 임계가 한 곳에 있어야 한다.** 위 [watchMinutes]와 이 값은
     *   *"언제 처음 말하고, 그 뒤 얼마 만에 다시 말하는가"* 라는 한 판단의 두 손잡이인데,
     *   하나는 설정이고 하나는 코드 상수였다 — 그러면 조정할 때마다 APK가 든다.
     *   **9~11월 실사용에서 가장 먼저 만질 값이 이 둘이다**(§6.3의 반복 수정).
     *
     * 범위는 [watchMinutes]와 **같은 `1..240`** 이다. 두 값이 같은 규칙의 두 손잡이라
     * 한쪽만 다른 상한을 두면 어느 쪽이 먼저 걸렸는지 못 읽는다.
     */
    var watchRefireMinutes: Int
        get() = p.getInt(K_WATCH_REFIRE, 15)
        set(v) = p.edit().putInt(K_WATCH_REFIRE, v.coerceIn(1, 240)).apply()

    /**
     * 하룻밤 최대 발동 횟수. 오발동이 매일 반복되면 도구를 떠난다(§6.3).
     *
     * ★ **T-51이 5에서 9로 올렸다 — 요청받은 것이 아니라 요청의 부작용을 되돌린 것이다.**
     *   간격이 절반이 되면 상한도 두 배 빨리 닳는다: 5회 × 30분이면 첫 발동 뒤 2시간을
     *   덮었는데, 5회 × 15분이면 1시간에 끝나고 **취침 창(5.5시간)의 뒤쪽이 통째로 빈다.**
     *   가장 필요한 새벽이 비는 모양이고, 그것은 *"더 자주 개입해 달라"* 의 반대다.
     *
     *   9는 **옛 커버 시간을 그대로 유지하는 수**다:  (5 − 1) × 30 ÷ 15 + 1 = 9.
     *   즉 **요청한 것(밀도)은 바꾸고, 요청하지 않은 것(커버 시간)은 지킨다.**
     *
     * ⚠️ **올리는 쪽도 그냥 안전하지 않다**(§6.3 — 실패는 잔소리로 도구를 떠나는 것이다).
     *    되돌릴 신호는 Override·무시 비율이고, 그때는 시간당 상한(구조 변경)이 다음 후보다.
     */
    var watchMaxPerNight: Int
        get() = p.getInt(K_WATCH_MAX, 9)
        set(v) = p.edit().putInt(K_WATCH_MAX, v.coerceIn(1, 20)).apply()

    companion object {
        private const val K_SOUND = "sound"
        private const val K_VIBRATION = "vibration"
        private const val K_WATCH = "watch_enabled"
        private const val K_BED_FROM = "bed_from"
        private const val K_BED_TO = "bed_to"
        private const val K_WATCH_MIN = "watch_minutes"
        private const val K_WATCH_REFIRE = "watch_refire_minutes"
        private const val K_WATCH_MAX = "watch_max_per_night"
    }
}

/** 이번 발동에서 실제로 무엇을 낼지. 설정 ∩ 벨소리 모드. */
data class AlertPlan(val sound: Boolean, val vibrate: Boolean) {
    val silentScreenOnly: Boolean get() = !sound && !vibrate
}

object GuardAlertPolicy {

    /**
     * 벨소리 모드를 존중한다.
     *
     *   무음   → 화면만
     *   진동   → 진동만 (설정에서 진동을 켰을 때)
     *   일반   → 설정 그대로
     *
     * ⚠️ 알람 스트림은 원래 무음 모드에 영향받지 않는다. 여기서 **일부러** 존중하는 것이다.
     *    소리는 도달 수단이고 마찰은 사유·대기·재확인이 진다(ADR-026).
     */
    fun plan(ctx: Context, level: Int): AlertPlan {
        val s = GuardSettings(ctx)
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val mode = am?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL

        return when (mode) {
            AudioManager.RINGER_MODE_SILENT -> AlertPlan(sound = false, vibrate = false)
            AudioManager.RINGER_MODE_VIBRATE -> AlertPlan(sound = false, vibrate = s.vibration)
            else -> AlertPlan(sound = s.sound, vibrate = s.vibration)
        }
    }
}
