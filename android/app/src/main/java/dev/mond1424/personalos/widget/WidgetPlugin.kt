package dev.mond1424.personalos.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 웹 → 위젯 다리 (T-48 · ADR-043).
 *
 * 웹에서:  await Capacitor.Plugins.Widget.push({ date, boundary, summary, values, score })
 *
 * ★ **이 다리가 있는 이유는 문장 하나 때문이다.** 마감 요약은 `public/app.js`의
 *   `closeSummaryText` **한 곳**이 만든다(티켓 ③). 위젯이 같은 문장을 말하려면 둘 중 하나다 —
 *   Kotlin에 옮겨 적거나(두 벌이 되어 갈라진다), **만든 것을 건네받거나.** 후자를 골랐다.
 *
 * 값(`values`·`score`)과 경계(`boundary`)도 같은 응답에서 왔으므로 함께 온다 —
 * 위젯이 `GET /api/today`를 따로 부를 이유가 사라진다(왕복도 배터리도 안 는다).
 *
 * ⚠️ **얇게 유지한다.** 판단은 [ScaleStore]가 하고 여기는 넘겨주기만 한다 —
 *    `GuardPlugin`이 서 있는 자리와 같은 규칙이다.
 */
@CapacitorPlugin(name = "Widget")
class WidgetPlugin : Plugin() {

    /**
     * 웹이 Today를 그릴 때마다 부른다. **앱이 대장이다** — 위젯은 받은 것을 그린다.
     * 받은 즉시 다시 그린다: *"앱에서 찍었다 → 위젯이 따라온다"*가 이 한 줄이다(티켓 ⑤).
     */
    @PluginMethod
    fun push(call: PluginCall) {
        ScaleStore.pushFromApp(context, call.data)
        ScaleWidget.refresh(context)
        call.resolve(JSObject().put("ok", true))
    }
}
