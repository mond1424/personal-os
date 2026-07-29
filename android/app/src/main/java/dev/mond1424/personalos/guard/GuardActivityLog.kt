package dev.mond1424.personalos.guard

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 활동 표본 링 버퍼 — `risk_snapshot`의 재료.
 *
 * 서버로 보내지 않는다. **발동 시점에만** 요약해서 `guard_events.risk_snapshot`에 실린다.
 * 전면 앱 이름을 계속 서버에 올리면 사생활 데이터가 과하게 쌓이고, 그건 계획에 없다
 * (ADR-022가 PC 에이전트를 '감시목록 대조'로 좁힌 것과 같은 취지).
 *
 * 최근 N개만 유지한다. 오래된 것은 버린다 — 판단에 쓰이는 창은 몇 시간이면 충분하다.
 */
object GuardActivityLog {

    private const val KEY = "activity_log"
    private const val MAX = 300           // 화면 켜짐 기준 5시간치(60초 폴링)

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    @Synchronized
    fun note(ctx: Context, kind: String, app: String?) {
        runCatching {
            val arr = read(ctx)
            // 같은 앱이 연속으로 잡히면 새 표본을 만들지 않고 마지막 것의 시각만 늘린다.
            // 60초마다 같은 값이 쌓이면 버퍼가 금방 차서 정작 필요한 창이 짧아진다.
            val last = if (arr.length() > 0) arr.getJSONObject(arr.length() - 1) else null
            if (last != null && last.optString("kind") == kind && last.optString("app") == (app ?: "")) {
                last.put("until", System.currentTimeMillis())
            } else {
                arr.put(
                    JSONObject()
                        .put("at", System.currentTimeMillis())
                        .put("until", System.currentTimeMillis())
                        .put("kind", kind)
                        .put("app", app ?: ""),
                )
            }
            write(ctx, arr)
        }
    }

    private fun read(ctx: Context): JSONArray = runCatching {
        JSONArray(prefs(ctx).getString(KEY, "[]") ?: "[]")
    }.getOrDefault(JSONArray())

    private fun write(ctx: Context, arr: JSONArray) {
        val trimmed = if (arr.length() <= MAX) arr else JSONArray().also { out ->
            for (i in arr.length() - MAX until arr.length()) out.put(arr.get(i))
        }
        prefs(ctx).edit().putString(KEY, trimmed.toString()).apply()
    }

    fun size(ctx: Context) = read(ctx).length()

    fun clear(ctx: Context) = prefs(ctx).edit().remove(KEY).apply()

    /**
     * **연속** 화면 사용 시간(분). 감지 발동의 유일한 임계(ADR-025).
     *
     * 누적이 아니라 연속이어야 한다 — 잠깐 시간을 확인하는 것과
     * 붙잡고 있는 것을 가르는 것이 이 규칙의 전부다.
     * 마지막 screen_off 이후로 흐른 시간을 센다. 켜진 적이 없으면 0.
     */
    fun continuousScreenOnMin(ctx: Context): Int {
        val arr = read(ctx)
        var onAt = 0L
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            when (o.optString("kind")) {
                "screen_on" -> if (onAt == 0L) onAt = o.optLong("at")
                "screen_off" -> onAt = 0L        // 껐으면 연속이 끊긴다
            }
        }
        if (onAt == 0L) return 0
        return ((System.currentTimeMillis() - onAt) / 60_000).toInt()
    }

    /** 최근 n분 표본 그대로 — 디버깅·확인용. */
    fun recent(ctx: Context, minutes: Int = 60): JSONArray {
        val since = System.currentTimeMillis() - minutes * 60_000L
        val arr = read(ctx)
        val out = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.optLong("until") >= since) out.put(o)
        }
        return out
    }

    /**
     * 발동 시점의 스냅샷 — §6.6의 입력 목록 중 기기가 아는 것들.
     *
     * **점수를 내지 않는다.** 항 값만 남긴다 —
     * 위험도는 기록하되 발동 게이트로 쓰지 않는다(ADR-021).
     * 가중치는 10월에 실제 스냅샷에서 유도한다.
     */
    fun snapshot(ctx: Context, minutes: Int = 60): JSONObject {
        val now = System.currentTimeMillis()
        val since = now - minutes * 60_000L
        val arr = read(ctx)

        var screenOnMs = 0L
        var unlocks = 0
        val appMs = mutableMapOf<String, Long>()
        var lastScreenOnAt = 0L

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val at = o.optLong("at"); val until = o.optLong("until")
            if (until < since) continue
            when (o.optString("kind")) {
                "screen_on" -> lastScreenOnAt = maxOf(at, since)
                "screen_off" -> if (lastScreenOnAt > 0) { screenOnMs += at - lastScreenOnAt; lastScreenOnAt = 0 }
                "unlock" -> unlocks++
                "app" -> {
                    val p = o.optString("app")
                    if (p.isNotBlank()) appMs[p] = (appMs[p] ?: 0) + maxOf(0, until - maxOf(at, since))
                }
            }
        }
        if (lastScreenOnAt > 0) screenOnMs += now - lastScreenOnAt

        // 초 단위로 남긴다. 분으로 자르면 1분 미만이 전부 0이 되어
        // 10월 가중치 유도(ADR-021) 때 이 항이 통째로 쓸모없어진다 — 소급 보정이 불가능하다.
        val top = JSONArray()
        appMs.entries.sortedByDescending { it.value }.take(3).forEach {
            top.put(JSONObject().put("app", it.key).put("sec", it.value / 1000))
        }

        val cal = java.util.Calendar.getInstance()
        return JSONObject()
            .put("window_min", minutes)
            .put("hour", cal.get(java.util.Calendar.HOUR_OF_DAY) + cal.get(java.util.Calendar.MINUTE) / 60.0)
            .put("screen_on_sec", screenOnMs / 1000)
            .put("unlocks", unlocks)
            .put("top_apps", top)
            .put("samples", arr.length())
            .put("usage_permission", UsageProbe.hasPermission(ctx))
    }
}
