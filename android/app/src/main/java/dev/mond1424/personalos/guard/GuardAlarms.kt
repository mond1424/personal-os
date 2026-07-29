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

    /** 서버에서 받아 건 예약. 동기화 때 이 구간만 통째로 갈아엎는다. */
    const val SYNC_ID_BASE = 100_000

    /** 하루 1회 재동기화 자신의 예약 — 앱을 안 열어도 예약이 갱신된다. */
    const val SYNC_SELF_ID = 8000
    const val ACTION_SYNC = "dev.mond1424.personalos.GUARD_SYNC"

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

    /** 서버발 예약만 지운다 — 테스트 알람은 남긴다. 동기화가 멱등하려면 이 분리가 필요하다. */
    fun cancelSynced(ctx: Context) {
        GuardAlarmStore.all(ctx).filter { it.id >= SYNC_ID_BASE }.forEach {
            runCatching { am(ctx).cancel(operation(ctx, it)) }
            GuardAlarmStore.remove(ctx, it.id)
        }
    }

    /**
     * 다음 재동기화를 건다. **귀속일 경계 + 10분**에 맞춘다 —
     * 그날의 보호 일정이 확정된 뒤 받아야 한다.
     *
     * ⚠️ 경계는 **사용자 설정**이다(기본 05:00, 지금은 06:00). 하드코딩하면
     *    경계를 바꾼 순간 동기화가 경계 이전에 돌아 전날 데이터를 받는다.
     *    서버가 `/api/guard/schedule` 응답에 `boundary`를 실어 주고,
     *    GuardSync가 그걸 저장해 여기로 넘긴다.
     *
     * 이미 지난 시각이면 내일로. 매 동기화마다 다시 걸므로 체인이 끊기지 않는다.
     */
    fun scheduleDailySync(ctx: Context) {
        if (!canScheduleExact(ctx)) return
        val (bh, bm) = GuardSync.boundaryHm(ctx)
        val total = bh * 60 + bm + 10
        val c = java.util.Calendar.getInstance().apply {
            set(java.util.Calendar.HOUR_OF_DAY, (total / 60) % 24)
            set(java.util.Calendar.MINUTE, total % 60)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        if (c.timeInMillis <= System.currentTimeMillis()) c.add(java.util.Calendar.DAY_OF_YEAR, 1)

        val i = Intent(ctx, AlarmReceiver::class.java).apply { action = ACTION_SYNC }
        val pi = PendingIntent.getBroadcast(
            ctx, SYNC_SELF_ID, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // 동기화는 개입이 아니다 — 알람 UI에 뜰 이유가 없다. Doze에서 조금 늦어도 무방.
        runCatching {
            am(ctx).setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.timeInMillis, pi)
        }
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
