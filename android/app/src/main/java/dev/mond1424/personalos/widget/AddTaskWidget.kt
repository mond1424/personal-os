package dev.mond1424.personalos.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import dev.mond1424.personalos.MainActivity
import dev.mond1424.personalos.R

/**
 * 홈 화면 1×1 "할 일 추가" 위젯 (T-46 · ADR-041).
 *
 * **데이터를 그리지 않는다.** 아이콘과 라벨뿐이고, 그래서 기기 토큰도 `/api/widget/…`도
 * 갱신 스케줄도 없다 — 그 셋은 전부 "그릴 때만" 드는 비용이다(ADR-041 §맥락).
 * (⚠️ Kotlin 블록 주석은 **중첩된다** — 주석 안에 `/`+`*`를 적으면 그 뒤가 통째로 안 닫힌다.)
 * 이 위젯이 답하는 질문은 하나다: **눌리는가.**
 *
 * 누르면 `personalos://add-task` VIEW intent가 [MainActivity]로 가고,
 * 웹(`public/app.js`의 `runDeepLink`)이 그것을 듣고 입력창을 연다.
 *
 * ⚠️ **`updatePeriodMillis`가 0이라 [onUpdate]는 등록·재부팅·앱 교체 때만 온다.**
 *    그린 것이 정적이라 그래도 되지만, **탭 처리를 [onUpdate] 밖으로 옮기면 안 된다** —
 *    RemoteViews를 한 번도 안 밀면 위젯은 `initialLayout` 그대로 뜨고 **눌러도 아무 일이
 *    없다**(= 죽은 위젯). 그리는 것과 배선하는 것이 같은 자리에 있어야 하는 이유다.
 */
class AddTaskWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) manager.updateAppWidget(id, buildViews(context))
    }

    companion object {
        /** 딥링크 원본. **웹의 `DEEPLINK_SCHEME`과 짝이다** — 한쪽만 고치면 조용히 안 된다. */
        const val DEEP_LINK = "personalos://add-task"

        private fun buildViews(context: Context): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_add_task).apply {
                setOnClickPendingIntent(R.id.widget_add_task_root, tapIntent(context))
            }

        /**
         * 탭 → 앱.
         *
         * **컴포넌트를 명시한다**(`setClass`). 암시적 VIEW로 던지면 같은 스킴을 받는 앱이
         * 있을 때 선택 대화상자가 뜨고, 그러면 "탭 한 번"이 아니게 된다.
         * Manifest의 intent-filter는 그래서 이 경로를 위한 것이 아니라
         * `adb shell am start -a android.intent.action.VIEW -d personalos://add-task`로
         * **딥링크만 따로 확인**하기 위한 것이다.
         *
         * `MainActivity`가 `singleTask`라 앱이 떠 있으면 새 인스턴스 없이 `onNewIntent`로
         * 들어가고, Capacitor가 그것을 `appUrlOpen` 이벤트로 웹에 넘긴다(더운 시작).
         * 꺼져 있었으면 이 intent가 그대로 launch intent가 되어 `getLaunchUrl`이 준다(찬 시작).
         */
        private fun tapIntent(context: Context): PendingIntent {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).apply {
                setClass(context, MainActivity::class.java)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            // FLAG_IMMUTABLE은 API 31+에서 필수다(minSdk 24라 무조건 붙여도 된다).
            return PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
