package dev.mond1424.personalos.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import dev.mond1424.personalos.MainActivity
import dev.mond1424.personalos.R
import dev.mond1424.personalos.guard.GuardSync
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 홈 "오늘 찍기" 위젯 (T-48 · ADR-043).
 *
 * 크기를 늘리면 찍을 것이 는다:
 * ```
 * 최소   energy . stress . focus        5칸 (2 4 6 8 10)
 * 중간   위 + 요약 한 줄 + daily score
 * 최대   위 + 로그 쓰기(딥링크)
 * ```
 *
 * ⚠️ **`guard/` 아래를 고치지 않는다.** [GuardSync]에서 `baseUrl`+`token`을 **읽기만** 한다 —
 *    웹이 `configure`로 넣어 둔 그 자격증명이 그대로 위젯의 것이다(ADR-043 §맥락:
 *    위젯 전용 API를 새로 만들 이유가 처음부터 없었다).
 *
 * ⚠️ **`RemoteViews`에 `EditText`가 없다.** 로그는 딥링크로 앱을 여는 것뿐이다.
 *
 * ⚠️ Kotlin 블록 주석은 **중첩된다** — 주석 안에 슬래시+별표를 적으면 그 뒤가 통째로 안 닫힌다.
 */
class ScaleWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) drawOne(context, manager, id)
        armBoundary(context)
    }

    /**
     * 크기가 바뀌었다 — `minSdk = 24`라 `RemoteViews(Map<SizeF, …>)`(API 31+)를 못 쓰고
     * **여기서 `setViewVisibility`로 가른다.**
     */
    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle?,
    ) {
        drawOne(context, manager, appWidgetId)
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_TAP -> handleTap(context, intent)
            ACTION_BOUNDARY -> { refresh(context); armBoundary(context) }
            else -> super.onReceive(context, intent)
        }
    }

    /** 위젯이 사라지면 걸어 둔 경계 알람도 걷는다 — 남기면 없는 위젯을 매일 깨운다. */
    override fun onDisabled(context: Context) {
        runCatching {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            am?.cancel(boundaryIntent(context))
        }
    }

    /**
     * ★ 탭 — 낙관적으로 칠하고, 서버에 보내고, **거부되면 되돌리고 남긴다** (티켓 ④).
     *
     * `goAsync()`로 브로드캐스트를 붙잡아 왕복을 기다린다. 붙잡지 않으면 `onReceive`가
     * 끝나는 순간 프로세스가 회수 대상이 되고, **되돌림이 화면에 닿기 전에 죽는다** —
     * 그것이 정확히 이 티켓이 없애려는 "조용히 사라지는 탭"이다.
     */
    private fun handleTap(context: Context, intent: Intent) {
        val field = intent.getStringExtra(EXTRA_FIELD) ?: return
        val value = intent.getIntExtra(EXTRA_VALUE, 0)
        if (value <= 0) return

        ScaleStore.optimistic(context, field, value)
        refresh(context)

        val pending = goAsync()
        val app = context.applicationContext
        Thread {
            try {
                val code = put(app, field, value)
                if (code != null && code in 200..299) ScaleStore.commit(app, field, value)
                else ScaleStore.reject(app, field, code)
                refresh(app)
            } finally {
                pending.finish()
            }
        }.start()
    }

    companion object {

        /** 탭 → 이 리시버. 명시 인텐트라 Manifest의 intent-filter와 무관하다. */
        const val ACTION_TAP = "dev.mond1424.personalos.widget.SCALE_TAP"

        /** 하루 경계가 왔다 — 위젯이 스스로 비워지는 자리(티켓 ⑤). */
        const val ACTION_BOUNDARY = "dev.mond1424.personalos.widget.SCALE_BOUNDARY"

        const val EXTRA_FIELD = "field"
        const val EXTRA_VALUE = "value"

        /**
         * 최대 크기의 "로그 쓰기". **웹의 `DEEPLINK_ACTIONS`와 짝이다** —
         * 무엇을 여는지의 대장은 웹 한 곳이고, 여기는 그 이름을 던지기만 한다(T-46이 세운 규칙).
         */
        const val LOG_DEEP_LINK = "personalos://add-log"

        private const val REQ_BOUNDARY = 4801
        private const val REQ_LOG = 4802

        /**
         * ⚠️ **`GuardEventQueue`(10초)보다 짧다.** 저기는 `Thread` 위의 flush라 여유가 있지만
         *    여기는 `goAsync()`가 붙잡은 브로드캐스트 안이다. T-37이 `GuardVerify`의 read를
         *    12초로 늘린 것은 **개입 판정**이 그만큼 기다려도 되기 때문이고, 손가락이 기다리는
         *    이 경로는 반대다 — 되돌림이 늦게 오는 것은 안 오는 것과 비슷하게 나쁘다.
         */
        private const val CONNECT_TIMEOUT_MS = 5_000
        private const val READ_TIMEOUT_MS = 5_000

        /** 칸 하나하나가 자기 id를 가진다 — `RemoteViews`는 자식을 순회하지 못한다. */
        private val CELL_IDS: Map<String, IntArray> = mapOf(
            "energy" to intArrayOf(
                R.id.widget_scale_energy_0, R.id.widget_scale_energy_1, R.id.widget_scale_energy_2,
                R.id.widget_scale_energy_3, R.id.widget_scale_energy_4,
            ),
            "stress" to intArrayOf(
                R.id.widget_scale_stress_0, R.id.widget_scale_stress_1, R.id.widget_scale_stress_2,
                R.id.widget_scale_stress_3, R.id.widget_scale_stress_4,
            ),
            "focus" to intArrayOf(
                R.id.widget_scale_focus_0, R.id.widget_scale_focus_1, R.id.widget_scale_focus_2,
                R.id.widget_scale_focus_3, R.id.widget_scale_focus_4,
            ),
            ScaleStore.FIELD_SCORE to intArrayOf(
                R.id.widget_scale_score_0, R.id.widget_scale_score_1, R.id.widget_scale_score_2,
                R.id.widget_scale_score_3, R.id.widget_scale_score_4,
            ),
        )

        /**
         * 웹(플러그인)과 탭 경로가 함께 부른다. 붙어 있는 위젯 전부를 다시 그린다.
         *
         * ★ **여기서도 경계 알람을 다시 건다.** `onUpdate`에서만 걸면 **웹이 경계를 처음
         *   알려 준 직후에 알람이 없다** — `updatePeriodMillis`가 0이라 다음 `onUpdate`는
         *   재부팅이나 앱 교체 때까지 안 온다. 그러면 첫 하루가 안 비워진다.
         *   재예약은 같은 `PendingIntent`를 덮어쓰는 것이라 여러 번 불려도 알람은 하나다.
         */
        fun refresh(context: Context) {
            val manager = runCatching { AppWidgetManager.getInstance(context) }.getOrNull() ?: return
            val ids = runCatching {
                manager.getAppWidgetIds(ComponentName(context, ScaleWidget::class.java))
            }.getOrDefault(IntArray(0))
            for (id in ids) drawOne(context, manager, id)
            armBoundary(context)
        }

        private fun drawOne(context: Context, manager: AppWidgetManager, id: Int) {
            val tier = tierOf(context, manager, id)
            runCatching { manager.updateAppWidget(id, buildViews(context, tier)) }
        }

        /**
         * ★ **크기 분기가 던져도 위젯이 빈 화면이 되지 않는다** (티켓 ⑨).
         *
         * `getAppWidgetOptions`는 런처가 아직 아무것도 안 넣었으면 빈 번들을 주고, 그 값이
         * 0이면 아래 계산이 최소 단계로 떨어진다. 여기서 던지면 `updateAppWidget`이 아예
         * 안 불려 **"성공처럼 보이는 실패"** 가 된다 — 위젯은 옛 그림이나 빈 틀로 남는다.
         * 그래서 최소 단계로 접는다: 셋 중 가장 적게 그리지만 **찍는 것은 그대로 된다.**
         */
        private fun tierOf(context: Context, manager: AppWidgetManager, id: Int): ScaleStore.Tier =
            runCatching {
                val options = manager.getAppWidgetOptions(id)
                val dp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
                ScaleStore.tierFor(context, dp)
            }.getOrDefault(ScaleStore.TIERS.first())

        private fun buildViews(context: Context, tier: ScaleStore.Tier): RemoteViews {
            val state = ScaleStore.readFresh(context)
            val views = RemoteViews(context.packageName, R.layout.widget_scale)

            // 요약과 score는 **한 플래그**로 함께 켜지고 함께 꺼진다(ADR-043 결정 ②).
            // 레이아웃에서도 둘은 `widget_scale_close` 안에 함께 있다 — 한쪽만 켜는 자리가 없다.
            views.setViewVisibility(R.id.widget_scale_close, vis(tier.close))
            views.setViewVisibility(R.id.widget_scale_log, vis(tier.log))

            // ★ 거부 표시는 **어느 단계에서도 보인다.** feelings만 있는 최소 크기에서 찍은 탭이
            //   되돌아오는 것을 못 보면 이 티켓이 없앤 실패가 그대로 남는다.
            val notice = ScaleStore.noticeOf(state)
            views.setViewVisibility(R.id.widget_scale_notice, vis(notice != null))
            if (notice != null) {
                views.setTextViewText(R.id.widget_scale_notice, context.getString(ScaleStore.noticeRes(notice)))
            }

            val summary = ScaleStore.summaryOf(state)
            views.setTextViewText(
                R.id.widget_scale_summary,
                if (summary.isNotBlank()) summary else context.getString(R.string.widget_scale_no_summary),
            )

            for ((field, ids) in CELL_IDS) {
                val shown = ScaleStore.shown(state, field)
                for (i in ids.indices) {
                    val step = ScaleStore.STEPS[i]
                    views.setTextViewText(
                        ids[i],
                        context.getString(
                            if (shown != null && shown >= step) R.string.widget_scale_cell_on
                            else R.string.widget_scale_cell_off,
                        ),
                    )
                    views.setOnClickPendingIntent(ids[i], tapIntent(context, field, step))
                }
            }

            views.setOnClickPendingIntent(R.id.widget_scale_log, logIntent(context))
            return views
        }

        private fun vis(on: Boolean) = if (on) View.VISIBLE else View.GONE

        /** 칸마다 다른 `requestCode`를 준다 — 같으면 `PendingIntent`가 하나로 합쳐져 늘 같은 값을 찍는다. */
        private fun tapIntent(context: Context, field: String, value: Int): PendingIntent {
            val slot = (CELL_IDS.keys.indexOf(field) + 1) * 100 + value
            val intent = Intent(ACTION_TAP)
                .setClass(context, ScaleWidget::class.java)
                .putExtra(EXTRA_FIELD, field)
                .putExtra(EXTRA_VALUE, value)
            return PendingIntent.getBroadcast(
                context, slot, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun logIntent(context: Context): PendingIntent {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(LOG_DEEP_LINK)).apply {
                setClass(context, MainActivity::class.java)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return PendingIntent.getActivity(
                context, REQ_LOG, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        /* ── 하루 경계에 스스로 비워진다 (티켓 ⑤) ────────────────────────────── */

        /**
         * ⚠️ **경계 시각을 코드에 적지 않는다.** 서버가 `GET /api/today`의 `boundary`로 주고
         *    웹이 건네준 그 값만 쓴다. 한 번도 못 받았으면 **알람을 걸지 않는다** —
         *    짐작한 시각에 위젯을 비우면 사용자가 찍은 것이 사라진다.
         */
        private fun armBoundary(context: Context) {
            runCatching {
                val boundary = ScaleStore.boundaryOf(ScaleStore.read(context))
                val at = ScaleStore.nextBoundaryMs(boundary, System.currentTimeMillis()) ?: return
                val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                am.setAndAllowWhileIdle(AlarmManager.RTC, at, boundaryIntent(context))
            }
        }

        private fun boundaryIntent(context: Context): PendingIntent {
            val intent = Intent(ACTION_BOUNDARY).setClass(context, ScaleWidget::class.java)
            return PendingIntent.getBroadcast(
                context, REQ_BOUNDARY, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        /* ── 서버 — 화면이 쓰는 API 그대로다 ─────────────────────────────────── */

        /**
         * ⚠️ 네트워크를 탄다 — **백그라운드 스레드에서만.**
         *
         * 헤더·본문의 모양은 `GuardEventQueue.post()`와 같다(자격증명도 같은 자리에서 온다).
         * @return HTTP 코드. `null`이면 아예 못 닿았다.
         */
        private fun put(context: Context, field: String, value: Int): Int? {
            val base = GuardSync.baseUrl(context) ?: return null
            val token = GuardSync.token(context)
            val path = if (field == ScaleStore.FIELD_SCORE) ScaleStore.PATH_SCORE else ScaleStore.PATH_FEELINGS
            val body = if (field == ScaleStore.FIELD_SCORE) {
                JSONObject().put(ScaleStore.BODY_SCORE, value)
            } else {
                JSONObject().put(ScaleStore.BODY_FEELINGS, JSONObject().put(field, value))
            }
            return try {
                val c = (URL("$base$path").openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    connectTimeout = CONNECT_TIMEOUT_MS
                    readTimeout = READ_TIMEOUT_MS
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
                }
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = c.responseCode
                runCatching { (if (code in 200..299) c.inputStream else c.errorStream)?.close() }
                c.disconnect()
                code
            } catch (e: Exception) {
                null
            }
        }
    }
}
