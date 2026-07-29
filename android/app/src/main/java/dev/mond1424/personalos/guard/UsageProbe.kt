package dev.mond1424.personalos.guard

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings

/**
 * 지금 무엇을 쓰고 있는가 — 설계 §6.6의 판단 입력.
 *
 * **보조 입력이다**(ADR-018·021). 발동 조건이 아니다.
 * 제조사 절전 정책이 이걸 죽여도 Guard는 그대로 돈다 — 보호 규칙은 시각으로 예측되므로.
 * 감지가 하는 일은 `risk_snapshot`을 풍부하게 만드는 것뿐이고, 그게 10월 가중치 유도의 재료다.
 *
 * `AccessibilityService`를 쓰지 않는다 — 더 정확하지만 권한이 과도하고 오용 위험이 크다(ADR-018 기각안).
 * 폴링으로 충분하다.
 */
object UsageProbe {

    /** 사용 정보 접근은 특수 권한이라 런타임 요청이 안 된다. 설정 화면으로 보내는 수밖에 없다. */
    fun hasPermission(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false
        val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ops.unsafeCheckOpNoThrow("android:get_usage_stats", Process.myUid(), ctx.packageName)
        } else {
            @Suppress("DEPRECATION")
            ops.checkOpNoThrow("android:get_usage_stats", Process.myUid(), ctx.packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun settingsIntent(): Intent =
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /**
     * 최근 전면 앱. 권한이 없거나 조회가 실패하면 null — **던지지 않는다.**
     * 감지 실패가 발동을 막으면 안 된다.
     *
     * `queryEvents`를 쓴다. `queryUsageStats`는 집계라 '지금 무엇'을 못 준다.
     */
    fun currentApp(ctx: Context, lookbackMs: Long = 60_000): String? {
        if (!hasPermission(ctx)) return null
        return runCatching {
            val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val ev = usm.queryEvents(now - lookbackMs, now)
            val e = UsageEvents.Event()
            var last: String? = null
            while (ev.hasNextEvent()) {
                ev.getNextEvent(e)
                if (e.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                    e.eventType == UsageEvents.Event.ACTIVITY_RESUMED
                ) last = e.packageName
            }
            last?.takeIf { it != ctx.packageName }   // 우리 앱은 신호가 아니다
        }.getOrNull()
    }

    /**
     * 최근 n분 동안 전면에 있던 앱들 — 사용 시간이 긴 순.
     * "새벽 1시에 무엇을 하고 있었는가"의 재료.
     */
    fun recentApps(ctx: Context, minutes: Int = 60, limit: Int = 5): List<Pair<String, Long>> {
        if (!hasPermission(ctx)) return emptyList()
        return runCatching {
            val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val ev = usm.queryEvents(now - minutes * 60_000L, now)
            val e = UsageEvents.Event()
            val dur = mutableMapOf<String, Long>()
            var curPkg: String? = null
            var curAt = 0L
            while (ev.hasNextEvent()) {
                ev.getNextEvent(e)
                when (e.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND, UsageEvents.Event.ACTIVITY_RESUMED -> {
                        curPkg = e.packageName; curAt = e.timeStamp
                    }
                    UsageEvents.Event.MOVE_TO_BACKGROUND, UsageEvents.Event.ACTIVITY_PAUSED -> {
                        if (curPkg == e.packageName && curAt > 0) {
                            dur[curPkg!!] = (dur[curPkg] ?: 0) + (e.timeStamp - curAt)
                            curPkg = null
                        }
                    }
                }
            }
            // 아직 전면에 있는 앱은 지금까지로 친다
            if (curPkg != null && curAt > 0) dur[curPkg!!] = (dur[curPkg] ?: 0) + (now - curAt)
            dur.remove(ctx.packageName)
            dur.entries.sortedByDescending { it.value }.take(limit).map { it.key to it.value }
        }.getOrDefault(emptyList())
    }
}
