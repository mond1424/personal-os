package dev.mond1424.personalos.cal

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

/**
 * 폰 캘린더를 **읽기만** 한다 (T-53 · ADR-029).
 *
 * 쓰기 방향(앱 → 캘린더)은 9월이다. 그때까지 갈라짐을 물리적으로 막는 방법은
 * **쓰는 코드를 아예 두지 않는 것**이고, 그래서 이 파일에는 insert·update·delete가 없다.
 *
 * ★ **반복은 [CalendarContract.Instances]로 전개한다.** 마스터 이벤트(Events) 1건으로 읽으면
 *   RRULE이 문자열로만 오고 **개강 후 주간 수업이 통째로 안 들어온다** — 이 티켓에서 값이
 *   가장 큰 부분이다. Instances는 provider가 창 범위만큼 이미 펼쳐 준다.
 *
 * ⚠️ **종일 일정의 시각은 UTC 자정이다.** 로컬 시간대로 읽으면 KST에서 하루가 밀린다.
 *    그래서 날짜 포맷의 시간대를 종일 여부로 가른다 — 이 한 줄이 9월 시간표 전체를 좌우한다.
 */
object CalendarReader {

    /** 한 번에 보내는 상한. 서버가 2000건에서 400을 준다(`calsync.ts`). */
    const val MAX_ITEMS = 2000

    fun hasPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_CALENDAR) ==
            PackageManager.PERMISSION_GRANTED

    /** 고를 수 있는 캘린더 하나. 계정이 여럿이라 이름만으로는 못 가른다(§함정 — 구글 다중·삼성). */
    data class CalendarInfo(
        val id: Long,
        val name: String,
        val account: String,
        val visible: Boolean,
    )

    /** 창 범위의 일정 하나. 서버 `POST /api/cal/sync`의 `items[]` 한 항목과 1:1이다. */
    data class Item(
        val extUid: String,
        val title: String,
        val date: String,
        val time: String?,
        val allDay: Boolean,
    )

    fun calendars(ctx: Context): List<CalendarInfo> {
        if (!hasPermission(ctx)) return emptyList()
        val cols = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.VISIBLE,
        )
        val out = ArrayList<CalendarInfo>()
        runCatching {
            ctx.contentResolver.query(
                CalendarContract.Calendars.CONTENT_URI, cols, null, null,
                CalendarContract.Calendars.ACCOUNT_NAME + " ASC",
            )?.use { c ->
                while (c.moveToNext()) {
                    out.add(
                        CalendarInfo(
                            id = c.getLong(0),
                            name = c.getString(1) ?: "(이름 없음)",
                            account = c.getString(2) ?: "",
                            visible = c.getInt(3) == 1,
                        ),
                    )
                }
            }
        }
        return out
    }

    /**
     * 창 범위(`from`~`to`, 양끝 포함)의 인스턴스를 전부 읽는다.
     *
     * ⚠️ **`calIds`가 비면 빈 목록이다.** *"선택 전에는 아무것도 안 가져온다"*(티켓 ③)를
     *    여기서 지킨다 — 호출부가 깜빡해도 전체 동기화가 되지 않는다.
     *
     * 멀티데이는 **시작일 1건으로 축약**한다(v1). Instances는 걸친 인스턴스를 한 행으로 주고
     * 우리는 `BEGIN`의 날짜만 쓴다 — 창 앞에서 시작해 창 안으로 걸친 일정은 그래서 빠진다.
     */
    fun readWindow(ctx: Context, calIds: Set<Long>, from: String, to: String): List<Item> {
        if (!hasPermission(ctx) || calIds.isEmpty()) return emptyList()

        val beginMs = localMidnight(from)
        val endMs = localMidnight(to) + DAY_MS      // to 당일까지 포함
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()
            .appendPath(beginMs.toString())
            .appendPath(endMs.toString())
            .build()
        val cols = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.CALENDAR_ID,
            CalendarContract.Instances.STATUS,
        )
        val ids = calIds.joinToString(",")
        val sel = CalendarContract.Instances.CALENDAR_ID + " IN (" + ids + ")"

        // uid가 같은 두 행(같은 날 두 번 도는 반복)은 앞의 것 하나로 접는다 — 서버의 키가 uid다.
        val seen = LinkedHashMap<String, Item>()
        runCatching {
            ctx.contentResolver.query(
                uri, cols, sel, null, CalendarContract.Instances.BEGIN + " ASC",
            )?.use { c ->
                while (c.moveToNext() && seen.size < MAX_ITEMS) {
                    // 취소된 인스턴스는 캘린더 화면에도 없다. 미러에 넣으면 유령이 된다.
                    if (!c.isNull(5) && c.getInt(5) == CalendarContract.Events.STATUS_CANCELED) continue
                    val eventId = c.getLong(0)
                    val begin = c.getLong(1)
                    val allDay = c.getInt(3) == 1
                    val tz = if (allDay) TimeZone.getTimeZone("UTC") else TimeZone.getDefault()
                    val date = fmt("yyyy-MM-dd", tz).format(java.util.Date(begin))
                    if (date < from || date > to) continue
                    val uid = "$eventId:$date"
                    if (seen.containsKey(uid)) continue
                    seen[uid] = Item(
                        extUid = uid,
                        // 서버가 빈 제목을 400으로 막는다. 제목 없는 일정은 캘린더에 실제로 있다.
                        title = c.getString(2)?.trim().takeUnless { it.isNullOrBlank() } ?: "(제목 없음)",
                        date = date,
                        time = if (allDay) null else fmt("HH:mm", tz).format(java.util.Date(begin)),
                        allDay = allDay,
                    )
                }
            }
        }
        return seen.values.toList()
    }

    /** 창의 끝 — `from`에서 `days`일 뒤. */
    fun addDays(date: String, days: Int): String {
        val c = Calendar.getInstance()
        c.timeInMillis = localMidnight(date)
        c.add(Calendar.DAY_OF_YEAR, days)
        return fmt("yyyy-MM-dd", TimeZone.getDefault()).format(c.time)
    }

    private const val DAY_MS = 24L * 60 * 60 * 1000

    private fun fmt(pattern: String, tz: TimeZone) =
        SimpleDateFormat(pattern, Locale.US).apply { timeZone = tz }

    private fun localMidnight(date: String): Long {
        val c = Calendar.getInstance()
        c.set(
            date.substring(0, 4).toInt(),
            date.substring(5, 7).toInt() - 1,
            date.substring(8, 10).toInt(),
            0, 0, 0,
        )
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }
}
