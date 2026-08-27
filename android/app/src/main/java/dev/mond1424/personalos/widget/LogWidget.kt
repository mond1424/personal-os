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
 * 홈 3×1 "로그 쓰기" 위젯 (T-49 · ADR-043 연장).
 *
 * **데이터를 그리지 않는다.** 아이콘과 힌트 문구뿐이라 다리도 토큰도 갱신 스케줄도 없다 —
 * [AddTaskWidget]과 같은 부류다(ADR-041 §맥락). 그리는 것이 정적이므로
 * `updatePeriodMillis`도 0이다.
 *
 * ★ **[AddTaskWidget]과 같은 물건에 다른 옷이다** — 탭 → 딥링크 → 앱 입력창.
 *   다른 것은 생김새뿐이고, **어느 쪽이 눌리는지가 "위젯이 안 눌리는 이유가 어포던스인가"**를
 *   답한다. 그래서 둘을 합치지 않는다.
 *
 * ⚠️ **검색창처럼 보이지만 여기서는 못 친다.** `RemoteViews`에 `EditText`가 없다 —
 *    탭하면 앱이 열리는 것이 전부이고, 그것은 Google 검색 위젯과 같은 계약이다.
 *
 * ⚠️ **`updatePeriodMillis`가 0이라 [onUpdate]는 등록·재부팅·앱 교체 때만 온다.**
 *    그린 것이 정적이라 그래도 되지만, **탭 처리를 [onUpdate] 밖으로 옮기면 안 된다** —
 *    RemoteViews를 한 번도 안 밀면 위젯은 `initialLayout` 그대로 뜨고 **눌러도 아무 일이
 *    없다**(= 죽은 위젯). T-46이 그 자리에 남긴 경고 그대로다.
 *
 * ⚠️ 주석에 슬래시+별표를 만드는 경로(예: api 아래 와일드카드)를 적지 않는다 —
 *    Kotlin 블록 주석은 **중첩**되어 파일 끝까지 안 닫힌다(함정 13. 두 번 물렸다).
 */
class LogWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) manager.updateAppWidget(id, buildViews(context))
    }

    companion object {
        /**
         * 딥링크 원본. **웹의 `DEEPLINK_ACTIONS`에 이미 서 있는 이름이다**(T-48이 세웠다) —
         * 이 티켓은 액션을 고치지 않고 **재사용만** 한다.
         *
         * ⚠️ **한 글자만 틀려도 조용히 실패한다**: `deepLinkAction`이 `null`을 주고
         *    T-46이 세운 폴백이 그냥 Today를 띄운다 — 위젯을 눌렀는데 아무 일도 안 난 것처럼
         *    보이지 않고 *"앱이 열리긴 했다"*로 보인다. 그래서 `test/front.mjs`가 이 문자열을
         *    뽑아 **살아 있는 `deepLinkAction`에 먹여** 대장에 실제로 있는지까지 센다.
         */
        const val DEEP_LINK = "personalos://add-log"

        private fun buildViews(context: Context): RemoteViews =
            RemoteViews(context.packageName, R.layout.widget_log).apply {
                setOnClickPendingIntent(R.id.widget_log_root, tapIntent(context))
            }

        /**
         * 탭 → 앱.
         *
         * **컴포넌트를 명시한다**(`setClass`). 암시적 VIEW로 던지면 같은 스킴을 받는 앱이
         * 있을 때 선택 대화상자가 뜨고, 그러면 "탭 한 번"이 아니게 된다.
         * `MainActivity`가 `singleTask`라 앱이 떠 있으면 `onNewIntent`로 들어가고(더운 시작),
         * 꺼져 있었으면 이 intent가 launch intent가 되어 `getLaunchUrl`이 준다(찬 시작).
         *
         * `requestCode`가 [AddTaskWidget]과 달라야 한다 — 같으면 두 위젯의 `PendingIntent`가
         * 하나로 합쳐져 나중에 만든 쪽이 먼저 것을 덮어쓴다.
         */
        private fun tapIntent(context: Context): PendingIntent {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).apply {
                setClass(context, MainActivity::class.java)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            return PendingIntent.getActivity(
                context, REQ_TAP, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private const val REQ_TAP = 4901
    }
}
