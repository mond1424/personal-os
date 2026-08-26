package dev.mond1424.personalos.widget

import android.content.Context
import dev.mond1424.personalos.R
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * 홈 "오늘 찍기" 위젯의 상태와 눈금 규격 (T-48 · ADR-043).
 *
 * ★ **이 파일은 문장을 만들지 않는다.** 마감 요약은 웹의 `closeSummaryText` **하나**가 만들고
 *   여기는 그것을 문자열 그대로 받아 둔다(ADR-043 결정 ②·티켓 ③). Kotlin으로 옮겨 적으면
 *   두 벌이 되고, 갈라진 쪽이 조용히 다른 말을 한다.
 *
 * ★ **하루 경계 시각을 여기 적지 않는다.** 서버가 `GET /api/today`의 `boundary`로 주고
 *   웹이 [pushFromApp]으로 건네준다. 못 받았으면 **짐작하지 않는다** — 비우지도 않는다.
 *
 * 저장은 SharedPreferences JSON 하나다(`GuardEventQueue`와 같은 판단 — 하루 몇 건이라
 * SQLite는 과하다). ⚠️ **guard 쪽 prefs를 쓰지 않는다** — 읽는 것과 쓰는 것은 다르다.
 */
object ScaleStore {

    // ⚠️ 아래 주석에서 `api/widget` 뒤에 별표를 붙이지 않는다 — 슬래시+별표가 **주석을 새로 연다**
    //    (Kotlin 블록 주석은 중첩된다). T-46이 물린 그 함정이고, 여기서 다시 물렸다.

    /* ── 서버와의 계약 — 화면이 쓰는 API 그대로다(ADR-043: 위젯 전용 API는 없다) ────── */

    /** feelings 쓰기. 본문은 `{ "values": { field: value } }`. */
    const val PATH_FEELINGS = "/api/daily/feelings"

    /** score 쓰기. 본문은 `{ "score": value }`. */
    const val PATH_SCORE = "/api/daily/score"

    /** feelings 본문의 바깥 키. `test/smoke.ts`가 이 글자로 본문을 조립해 실제로 쏜다. */
    const val BODY_FEELINGS = "values"

    /** score 본문의 키. */
    const val BODY_SCORE = "score"

    /**
     * 눈금 5칸 (ADR-043 결정 ①). `feelings.value`가 `REAL(1..10)`이라 스키마는 그대로고,
     * **한 칸이 손가락에 맞는 것이 해상도보다 먼저다.** 10칸으로 늘리는 것은 레이아웃만 바꾸면 된다.
     */
    val STEPS = intArrayOf(2, 4, 6, 8, 10)

    /**
     * 최소 크기에서 찍는 셋.
     * ⚠️ 레이아웃이 세 줄로 고정이라 여기도 고정이다 — 설정의 `feelings_fields`가 넷이 되면
     *    위젯은 따라가지 못한다. 그때는 레이아웃과 함께 고친다.
     */
    val FEELING_FIELDS = arrayOf("energy", "stress", "focus")

    /** score는 feelings가 아니다 — 경로도 본문도 다르다. 같은 탭 경로를 태우려고 이름만 나눈다. */
    const val FIELD_SCORE = "score"

    /* ── 크기 3단계 (티켓 ②) ─────────────────────────────────────────────────────
     * ⚠️ `RemoteViews(Map<SizeF, …>)`는 API 31+다. `minSdk = 24`라 **못 쓴다** —
     *    레이아웃 하나에 블록 셋을 두고 `setViewVisibility`로 켠다.
     *
     * ★ **요약과 score는 한 플래그다**(`close`). 둘을 따로 켜는 자리를 아예 만들지 않는다 —
     *   score만 보이면 빈 칸에 점수를 매기는 그 모양이고 ADR-040을 되돌린다(ADR-043 결정 ②).
     *   레이아웃에서도 둘은 같은 컨테이너(`widget_scale_close`) 안에 있다.
     */
    data class Tier(val name: String, val close: Boolean, val log: Boolean)

    /** ★ 이 표가 대장이다 — `test/front.mjs`가 이 줄들을 뽑아 짝을 센다. */
    val TIERS = listOf(
        Tier(name = "min", close = false, log = false),
        Tier(name = "mid", close = true, log = false),
        Tier(name = "max", close = true, log = true),
    )

    /**
     * 세로 여유(dp)로 단계를 고른다.
     *
     * ★ **임계 dp를 여기 적지 않는다.** 레이아웃이 실제로 요구하는 높이(`res/values/widget_scale_dims.xml`)를
     *   더해서 쓴다 — 블록이 커지면 임계도 같이 움직인다. 숫자를 두 벌 두지 않는 것과 같은 이유다.
     *   실기기에서 재는 것은 §확인 절차가 진다.
     */
    fun tierFor(ctx: Context, availDp: Int): Tier {
        val d = ctx.resources.displayMetrics.density
        val base = ctx.resources.getDimension(R.dimen.widget_scale_h_base) / d
        val close = ctx.resources.getDimension(R.dimen.widget_scale_h_close) / d
        val log = ctx.resources.getDimension(R.dimen.widget_scale_h_log) / d
        return when {
            availDp >= base + close + log -> TIERS[2]
            availDp >= base + close -> TIERS[1]
            else -> TIERS[0]
        }
    }

    /* ── 상태 ────────────────────────────────────────────────────────────────── */

    private const val PREFS = "widget_scale"
    private const val KEY = "state"

    private const val K_DATE = "date"
    private const val K_BOUNDARY = "boundary"
    private const val K_SUMMARY = "summary"
    private const val K_VALUES = "values"
    private const val K_PENDING = "pending"
    private const val K_NOTICE = "notice"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun read(ctx: Context): JSONObject = runCatching {
        JSONObject(prefs(ctx).getString(KEY, "{}") ?: "{}")
    }.getOrDefault(JSONObject())

    @Synchronized
    fun write(ctx: Context, o: JSONObject) {
        prefs(ctx).edit().putString(KEY, o.toString()).apply()
    }

    /**
     * 웹이 Today를 그릴 때마다 건네준다 — **앱이 대장이다.**
     *
     * 요약 문장도 여기로 온다(`closeSummaryText`의 결과 그대로). 낙관적 칠과 거부 표시는
     * 이 순간 의미를 잃으므로 함께 지운다 — 서버가 준 값이 방금 도착했기 때문이다.
     */
    fun pushFromApp(ctx: Context, payload: JSONObject) {
        val o = JSONObject()
            .put(K_DATE, payload.optString(K_DATE, ""))
            .put(K_BOUNDARY, payload.optString(K_BOUNDARY, ""))
            .put(K_SUMMARY, payload.optString(K_SUMMARY, ""))
            .put(K_VALUES, payload.optJSONObject(K_VALUES) ?: JSONObject())
        payload.opt(BODY_SCORE)?.let { s -> if (s is Number) o.put(FIELD_SCORE, s.toInt()) }
        write(ctx, o)
    }

    /** 탭한 칸을 **먼저 칠한다.** 손가락은 왕복을 기다리지 않는다. */
    fun optimistic(ctx: Context, field: String, value: Int) {
        val o = read(ctx)
        val p = o.optJSONObject(K_PENDING) ?: JSONObject()
        p.put(field, value)
        o.put(K_PENDING, p).remove(K_NOTICE)
        write(ctx, o)
    }

    /** 서버가 받았다 — 칠한 것을 확정으로 옮긴다. */
    fun commit(ctx: Context, field: String, value: Int) {
        val o = read(ctx)
        o.optJSONObject(K_PENDING)?.remove(field)
        if (field == FIELD_SCORE) {
            o.put(FIELD_SCORE, value)
        } else {
            val v = o.optJSONObject(K_VALUES) ?: JSONObject()
            v.put(field, value)
            o.put(K_VALUES, v)
        }
        o.remove(K_NOTICE)
        write(ctx, o)
    }

    /**
     * ★ **이 티켓의 핵심** (ADR-043 결정 ③ · 티켓 ④).
     *
     * 위젯은 토스트를 못 띄운다. 낙관적으로 칠했는데 서버가 거부하면 **사용자는 찍은 줄 알고
     * 넘어간다.** 마감된 날에는 `feelings_frozen_ins`가 추가를 막아 409가 오고,
     * **그 하루의 마지막 탭이 조용히 사라지는 것이 이 위젯의 가장 흔한 실패다.**
     *
     * 그래서 **되돌리는 것과 남기는 것이 한 함수 안**이다. 나누면 한쪽만 지우는 변경이
     * 쉬워지고, 그때 생기는 것이 *"되돌리긴 하는데 아무 표시가 없는 구현"*이다.
     *
     * @param code HTTP 응답 코드. `null`이면 아예 못 닿았다(그것도 안 찍힌 것이다).
     */
    fun reject(ctx: Context, field: String, code: Int?) {
        val o = read(ctx)
        o.optJSONObject(K_PENDING)?.remove(field)   // 칠한 것이 되돌아온다
        o.put(K_NOTICE, noticeKeyOf(code))          // 그 사실이 위젯에 남는다
        write(ctx, o)
    }

    /** 거부 문구의 이름. 실제 문장은 `strings.xml`이 진다. */
    fun noticeKeyOf(code: Int?): String = when {
        code == null -> "net"
        code == 409 -> "closed"
        else -> "http"
    }

    fun noticeRes(key: String): Int = when (key) {
        "closed" -> R.string.widget_scale_notice_closed
        "net" -> R.string.widget_scale_notice_net
        else -> R.string.widget_scale_notice_http
    }

    /** 화면에 그릴 값 — 낙관적으로 칠한 것이 있으면 그것이 이긴다. */
    fun shown(state: JSONObject, field: String): Int? {
        state.optJSONObject(K_PENDING)?.let { p ->
            if (p.has(field)) return p.optInt(field)
        }
        if (field == FIELD_SCORE) return if (state.has(FIELD_SCORE)) state.optInt(FIELD_SCORE) else null
        val v = state.optJSONObject(K_VALUES) ?: return null
        return if (v.has(field)) v.optInt(field) else null
    }

    fun summaryOf(state: JSONObject): String = state.optString(K_SUMMARY, "")

    fun noticeOf(state: JSONObject): String? =
        state.optString(K_NOTICE, "").takeIf { it.isNotBlank() }

    fun boundaryOf(state: JSONObject): String = state.optString(K_BOUNDARY, "")

    /* ── 하루 경계 (티켓 ⑤) ──────────────────────────────────────────────────── */

    /**
     * 지금이 **어느 귀속일인가.** 경계 이전은 전날이다 — 서버의 `attributionOf`와 같은 셈이다.
     * @param boundary `HH:MM`. 서버가 준 그대로이고, 못 받았으면 `null`(짐작하지 않는다).
     */
    fun dayOf(boundary: String, nowMs: Long): String? {
        val hm = parseHm(boundary) ?: return null
        val c = Calendar.getInstance()
        c.timeInMillis = nowMs - (hm.first * 60 + hm.second) * 60_000L
        return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.time)
    }

    /** 다음 경계가 오는 순간(epoch ms). 위젯이 스스로 비워질 시각이다. */
    fun nextBoundaryMs(boundary: String, nowMs: Long): Long? {
        val hm = parseHm(boundary) ?: return null
        val c = Calendar.getInstance()
        c.timeInMillis = nowMs
        c.set(Calendar.HOUR_OF_DAY, hm.first)
        c.set(Calendar.MINUTE, hm.second)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        if (c.timeInMillis <= nowMs) c.add(Calendar.DAY_OF_YEAR, 1)
        return c.timeInMillis
    }

    private fun parseHm(s: String): Pair<Int, Int>? {
        val m = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$").find(s.trim()) ?: return null
        return m.groupValues[1].toInt() to m.groupValues[2].toInt()
    }

    /**
     * **경계를 넘었으면 스스로 비운다.**
     *
     * 경계를 모르면(웹이 아직 한 번도 안 건넸다) 비우지 않는다 — 짐작으로 지우는 것이
     * 짐작으로 남기는 것보다 나쁘다. 그때는 어차피 그릴 값도 없다.
     */
    fun readFresh(ctx: Context, nowMs: Long = System.currentTimeMillis()): JSONObject {
        val o = read(ctx)
        val today = dayOf(boundaryOf(o), nowMs) ?: return o
        val stamped = o.optString(K_DATE, "")
        if (stamped.isNotBlank() && stamped != today) {
            val fresh = JSONObject()
                .put(K_DATE, today)
                .put(K_BOUNDARY, boundaryOf(o))   // 경계는 남긴다 — 다음 판정의 근거다
            write(ctx, fresh)
            return fresh
        }
        return o
    }
}
