package dev.mond1424.personalos.cal

import android.Manifest
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * 웹 ↔ 폰 캘린더 다리 (T-53).
 *
 * 웹에서:  await Capacitor.Plugins.Cal.status()
 *
 * 얇게 유지한다 — 읽기는 [CalendarReader], 보내기·설정은 [CalSync]가 지고 여기는 잇기만 한다.
 * `GuardPlugin`·`WidgetPlugin`이 서 있는 자리와 같은 규칙이다.
 *
 * ⚠️ **`MainActivity`에 등록하지 않으면 `Capacitor.Plugins.Cal`이 아예 없다.** 그러면 웹이
 *    조용히 폴백해 *"이 기기에선 못 써요"* 로 뜨고, 권한도 목록도 영영 안 뜬다(T-48에서 배웠다).
 */
@CapacitorPlugin(
    name = "Cal",
    permissions = [Permission(strings = [Manifest.permission.READ_CALENDAR], alias = "calendar")],
)
class CalPlugin : Plugin() {

    /** 권한·대상·마지막 동기화 결과. **문구와 우선순위는 웹이 정한다** — 여기는 사실만 준다. */
    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(CalSync.status(context)))
    }

    /**
     * `READ_CALENDAR` 런타임 권한을 묻는다.
     *
     * 이미 있으면 시스템 창을 띄우지 않고 그대로 상태를 돌려준다 — 물어봐야 할 것이
     * 없을 때 뜨는 창은 그 자체가 잔소리다(§6.3).
     */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (CalendarReader.hasPermission(context)) { status(call); return }
        requestPermissionForAlias(ALIAS, call, "permissionCallback")
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        // 거부도 정상 흐름이다 — 화면이 그 사실을 한 줄로 말한다(티켓 ②).
        status(call)
    }

    /** 고를 수 있는 캘린더 목록. 권한이 없으면 빈 목록이고, 그것도 사실이다. */
    @PluginMethod
    fun calendars(call: PluginCall) {
        val arr = com.getcapacitor.JSArray()
        CalendarReader.calendars(context).forEach {
            arr.put(
                JSObject().put("id", it.id).put("name", it.name)
                    .put("account", it.account).put("visible", it.visible),
            )
        }
        val targets = com.getcapacitor.JSArray()
        CalSync.targets(context).forEach { targets.put(it) }
        call.resolve(
            JSObject().put("permission", CalendarReader.hasPermission(context))
                .put("calendars", arr)
                .put("targets", targets),
        )
    }

    /** 대상 캘린더를 저장한다. 창 길이도 여기서 함께 받는다 — 한 화면에서 정하는 값이다. */
    @PluginMethod
    fun setTargets(call: PluginCall) {
        val ids = ArrayList<Long>()
        call.getArray("ids")?.let { a ->
            for (i in 0 until a.length()) {
                runCatching { a.get(i) }.getOrNull()?.let { v ->
                    v.toString().trim().toDoubleOrNull()?.let { ids.add(it.toLong()) }
                }
            }
        }
        CalSync.setTargets(context, ids)
        call.getInt("windowDays")?.let { CalSync.setWindowDays(context, it) }
        status(call)
    }

    /** 지금 한 번 읽어 보낸다 (수동 새로고침 · 티켓 ⑤). */
    @PluginMethod
    fun sync(call: PluginCall) {
        val app = context.applicationContext
        Thread {
            val r = CalSync.syncNow(app)
            call.resolve(
                JSObject().put("ok", r.ok).put("sent", r.sent)
                    .put("error", r.error)
                    .put("skipped", r.skipped)
                    .put("status", JSObject.fromJSONObject(CalSync.status(app))),
            )
        }.start()
    }

    companion object {
        private const val ALIAS = "calendar"
    }
}
