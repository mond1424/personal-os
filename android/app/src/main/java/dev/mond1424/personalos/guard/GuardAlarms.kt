package dev.mond1424.personalos.guard

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * 예약된 개입 하나.
 * 재부팅·앱 업데이트로 AlarmManager의 등록이 날아가므로, 원본은 기기에 따로 남긴다.
 */
data class ScheduledAlarm(
    val id: Int,
    val at: Long,           // epoch millis
    val level: Int,
    val title: String,
    val body: String,
    val eventId: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("at", at).put("level", level)
        .put("title", title).put("body", body).put("eventId", eventId ?: JSONObject.NULL)

    companion object {
        fun from(o: JSONObject) = ScheduledAlarm(
            id = o.getInt("id"),
            at = o.getLong("at"),
            level = o.getInt("level"),
            title = o.optString("title"),
            body = o.optString("body"),
            eventId = o.optString("eventId").takeIf { it.isNotEmpty() && it != "null" },
        )
    }
}

/**
 * 예약 원본 저장소.
 *
 * AlarmManager는 **재부팅과 앱 업데이트에서 등록을 지운다.** 원본이 여기 없으면
 * 시험 전날 폰을 껐다 켜는 것만으로 개입이 통째로 사라진다 — 조용한 전면 실패다.
 *
 * 2주차에 로컬 SQLite(ADR-023)로 옮긴다. 지금은 예약 몇 건이라 prefs로 충분하다.
 */
object GuardAlarmStore {
    private const val KEY = "alarms"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("guard", Context.MODE_PRIVATE)

    fun all(ctx: Context): List<ScheduledAlarm> = runCatching {
        val raw = prefs(ctx).getString(KEY, "[]") ?: "[]"
        val arr = JSONArray(raw)
        (0 until arr.length()).map { ScheduledAlarm.from(arr.getJSONObject(it)) }
    }.getOrDefault(emptyList())

    fun put(ctx: Context, a: ScheduledAlarm) {
        val next = all(ctx).filterNot { it.id == a.id } + a
        save(ctx, next)
    }

    fun remove(ctx: Context, id: Int) = save(ctx, all(ctx).filterNot { it.id == id })

    fun clear(ctx: Context) = save(ctx, emptyList())

    /** 지나간 예약은 버린다 — 재부팅 후 과거 알람이 한꺼번에 터지는 일을 막는다. */
    fun pruneAndGetFuture(ctx: Context): List<ScheduledAlarm> {
        val now = System.currentTimeMillis()
        val future = all(ctx).filter { it.at > now }
        save(ctx, future)
        return future
    }

    private fun save(ctx: Context, list: List<ScheduledAlarm>) {
        val arr = JSONArray()
        list.sortedBy { it.at }.forEach { arr.put(it.toJson()) }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply()
    }
}

/**
 * 예약·취소·복구.
 *
 * `setAlarmClock`을 쓴다. `setExactAndAllowWhileIdle`보다 나은 이유 셋:
 *   ① Doze에서 **정확히** 발동한다 (후자는 창이 있다)
 *   ② 시스템 '다음 알람' UI에 뜬다 — 설계 §6.2의 사전 서약이 눈에 보이는 형태
 *   ③ 앱이 알람 앱으로 취급돼 Android 14의 FSI 기본 부여 조건에 부합한다
 */
object GuardAlarms {

    /** 테스트 예약은 이 구간을 쓴다. 실제 보호 규칙 예약과 섞이지 않게. */
    const val TEST_ID_BASE = 9000

    private fun am(ctx: Context) =
        ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    fun canScheduleExact(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am(ctx).canScheduleExactAlarms() else true

    private fun operation(ctx: Context, a: ScheduledAlarm): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).apply {
            action = "dev.mond1424.personalos.GUARD_FIRE"
            putExtra("id", a.id)
            putExtra("level", a.level)
            putExtra("title", a.title)
            putExtra("body", a.body)
            putExtra("eventId", a.eventId)
        }
        return PendingIntent.getBroadcast(
            ctx, a.id, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** 상태바의 알람 아이콘을 탭했을 때 열리는 곳. */
    private fun showIntent(ctx: Context): PendingIntent {
        val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?: Intent(Intent.ACTION_MAIN)
        return PendingIntent.getActivity(
            ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /** @return 예약됐으면 true. 정확 알람 권한이 없으면 false — 던지지 않는다. */
    fun schedule(ctx: Context, a: ScheduledAlarm): Boolean {
        if (!canScheduleExact(ctx)) return false
        GuardAlarmStore.put(ctx, a)
        return runCatching {
            am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(a.at, showIntent(ctx)), operation(ctx, a))
            true
        }.getOrDefault(false)
    }

    fun cancel(ctx: Context, id: Int) {
        val a = GuardAlarmStore.all(ctx).find { it.id == id }
        if (a != null) runCatching { am(ctx).cancel(operation(ctx, a)) }
        GuardAlarmStore.remove(ctx, id)
    }

    fun cancelAll(ctx: Context) {
        GuardAlarmStore.all(ctx).forEach { runCatching { am(ctx).cancel(operation(ctx, it)) } }
        GuardAlarmStore.clear(ctx)
    }

    /**
     * 저장소를 근거로 전부 다시 건다.
     * 호출 시점: 재부팅 · 앱 업데이트 · **앱 시작**(마지막은 값싼 보험이다 —
     * 강제 종료로 등록이 날아간 경우까지 덮는다).
     */
    fun restoreAll(ctx: Context): Int {
        if (!canScheduleExact(ctx)) return 0
        val future = GuardAlarmStore.pruneAndGetFuture(ctx)
        var n = 0
        future.forEach {
            runCatching {
                am(ctx).setAlarmClock(AlarmManager.AlarmClockInfo(it.at, showIntent(ctx)), operation(ctx, it))
                n++
            }
        }
        return n
    }
}
