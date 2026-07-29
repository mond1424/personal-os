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

    /** 무음 모드에서도 Level 4는 울린다. 기본 꺼짐 — 켜면 우회로가 하나 막힌다. */
    var overrideSilentAtL4: Boolean
        get() = p.getBoolean(K_L4_SILENT, false)
        set(v) = p.edit().putBoolean(K_L4_SILENT, v).apply()

    companion object {
        private const val K_SOUND = "sound"
        private const val K_VIBRATION = "vibration"
        private const val K_L4_SILENT = "l4_override_silent"
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
     *    대가: 폰을 무음으로 두면 Guard의 소리가 0마찰로 사라진다 — 설계 §6.3이 경계하는
     *    '비용 없는 Override'다. 그래서 `overrideSilentAtL4`를 남겨 뒀다.
     */
    fun plan(ctx: Context, level: Int): AlertPlan {
        val s = GuardSettings(ctx)
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val mode = am?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL

        if (level >= 4 && s.overrideSilentAtL4) return AlertPlan(s.sound, s.vibration)

        return when (mode) {
            AudioManager.RINGER_MODE_SILENT -> AlertPlan(sound = false, vibrate = false)
            AudioManager.RINGER_MODE_VIBRATE -> AlertPlan(sound = false, vibrate = s.vibration)
            else -> AlertPlan(sound = s.sound, vibrate = s.vibration)
        }
    }
}
