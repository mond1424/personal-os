package dev.mond1424.personalos.guard

import android.content.Context
import android.os.PowerManager
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * 수락 재확인 (ADR-026).
 *
 * [알겠습니다]는 바로 끝난다. 다만 5분 뒤에도 화면을 계속 쓰고 있으면
 * 같은 Level로 다시 한 번 묻는다. 화면을 껐다면 수락을 지킨 것이므로 arm을 해제한다.
 */
object GuardRecheck {

    private const val RECHECK_MS = 5 * 60_000L
    private const val MAX_PER_DAY = 2

    private const val K_ARMED_AT = "recheck_armed_at"
    private const val K_ARMED_LEVEL = "recheck_armed_level"
    private const val K_ARMED_DAY = "recheck_armed_day"
    private const val K_COUNT_DAY = "recheck_count_day"
    private const val K_COUNT = "recheck_count"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    /** 수락 시각·Level·귀속일을 저장한다. 수락 자체에는 사유나 대기를 붙이지 않는다. */
    fun arm(ctx: Context, level: Int) {
        runCatching {
            val day = attributionDay(ctx)
            val pr = prefs(ctx)
            val edit = pr.edit()
                .putLong(K_ARMED_AT, System.currentTimeMillis())
                .putInt(K_ARMED_LEVEL, level)
                .putString(K_ARMED_DAY, day)
            if (pr.getString(K_COUNT_DAY, null) != day) {
                edit.putString(K_COUNT_DAY, day).putInt(K_COUNT, 0)
            }
            edit.apply()
        }
    }

    /**
     * GuardService 폴링이 부른다. 조건을 만족하면 한 번 발동하고 true.
     *
     * **던지지 않는다** — 재확인 평가가 실패해도 상시 서비스가 죽으면 안 된다.
     */
    fun evaluate(ctx: Context): Boolean = runCatching { evalInner(ctx) }.getOrDefault(false)

    private fun evalInner(ctx: Context): Boolean {
        val pr = prefs(ctx)
        val armedAt = pr.getLong(K_ARMED_AT, 0L)
        val armedDay = pr.getString(K_ARMED_DAY, null) ?: return false
        val level = pr.getInt(K_ARMED_LEVEL, 0)
        if (armedAt <= 0L || level <= 0) return false
        if (System.currentTimeMillis() - armedAt < RECHECK_MS) return false
        if (!screenOn(ctx)) return false

        val count = if (pr.getString(K_COUNT_DAY, null) == armedDay) {
            pr.getInt(K_COUNT, 0)
        } else {
            0
        }
        if (count >= MAX_PER_DAY) return false

        GuardNotifications.fire(
            ctx,
            level,
            "다시 확인할게요",
            "5분 전 [알겠습니다]를 선택했지만 아직 화면을 사용 중이에요.",
            eventId = null,
            cause = "recheck:accepted",
        )

        pr.edit()
            .putString(K_COUNT_DAY, armedDay)
            .putInt(K_COUNT, count + 1)
            .remove(K_ARMED_AT)
            .remove(K_ARMED_LEVEL)
            .remove(K_ARMED_DAY)
            .apply()
        return true
    }

    /** 화면을 껐다면 수락을 지킨 것이다. 횟수는 남기고 대기 중 재확인만 해제한다. */
    fun disarm(ctx: Context) {
        runCatching {
            prefs(ctx).edit()
                .remove(K_ARMED_AT)
                .remove(K_ARMED_LEVEL)
                .remove(K_ARMED_DAY)
                .apply()
        }
    }

    /** 폰 실측에서 무엇이 재확인을 막고 있는지 보는 상태. */
    fun status(ctx: Context): JSONObject {
        val pr = prefs(ctx)
        val armedAt = pr.getLong(K_ARMED_AT, 0L)
        val armedDay = pr.getString(K_ARMED_DAY, null)
        val day = armedDay ?: attributionDay(ctx)
        val count = if (pr.getString(K_COUNT_DAY, null) == day) pr.getInt(K_COUNT, 0) else 0
        val elapsed = if (armedAt > 0L) (System.currentTimeMillis() - armedAt).coerceAtLeast(0L) else 0L
        val remaining = if (armedAt > 0L) (RECHECK_MS - elapsed).coerceAtLeast(0L) else 0L
        return JSONObject()
            .put("armed", armedAt > 0L && armedDay != null)
            .put("armedAt", if (armedAt > 0L) armedAt else JSONObject.NULL)
            .put("level", if (armedAt > 0L) pr.getInt(K_ARMED_LEVEL, 0) else JSONObject.NULL)
            .put("attributionDay", armedDay ?: JSONObject.NULL)
            .put("screenOn", screenOn(ctx))
            .put("remainingMs", remaining)
            .put("firedToday", count)
            .put("maxPerDay", MAX_PER_DAY)
    }

    /** 서버에서 받은 하루 경계를 따른다. 경계 전이면 전날 귀속이다. */
    private fun attributionDay(ctx: Context): String {
        val (hour, minute) = GuardSync.boundaryHm(ctx)
        val boundaryMin = hour * 60 + minute
        val c = Calendar.getInstance()
        val nowMin = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
        if (nowMin < boundaryMin) c.add(Calendar.DAY_OF_YEAR, -1)
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            c.get(Calendar.YEAR),
            c.get(Calendar.MONTH) + 1,
            c.get(Calendar.DAY_OF_MONTH),
        )
    }

    private fun screenOn(ctx: Context): Boolean {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return pm?.isInteractive == true
    }
}
