package dev.mond1424.personalos.place

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * 웹 ↔ 붙은 네트워크 다리 (T-59 · ADR-046).
 *
 * 웹에서:  await Capacitor.Plugins.Place.status()
 *
 * `CalPlugin` 이 선 자리와 같은 규칙 — **얇게 유지한다.** 읽기는 [WifiProbe],
 * 관측·전송은 [PlaceWatcher] 가 지고 여기는 잇기만 한다.
 *
 * ⚠️ **`MainActivity` 에 등록하지 않으면 `Capacitor.Plugins.Place` 가 아예 없다** —
 *    그러면 웹이 조용히 폴백하고 권한도 등록 화면도 영영 안 뜬다(T-48·T-53에서 배웠다).
 * ⚠️ **여기서 나가는 것에 SSID 원문이 없다** — 막는 자리는 [WifiProbe] 의 `describe` 하나다.
 */
@CapacitorPlugin(
    name = "Place",
    permissions = [
        Permission(
            strings = [android.Manifest.permission.ACCESS_FINE_LOCATION],
            alias = PlacePlugin.ALIAS,
        ),
    ],
)
class PlacePlugin : Plugin() {

    /**
     * ⚠️ **콜백을 여기서 건다.** `load()` 는 콜드 스타트에서만 돌지만 프로세스가 살아 있는
     *    동안은 콜백도 산다 — `GuardService` 가 그 프로세스를 포그라운드로 붙잡는 것이 전제다.
     *
     * 켜자마자 한 번 관측한다 — **앱을 다시 연 것 자체가 "그 사이 바뀌었을 수 있다"** 이고,
     * 배경 권한이 없는 반쪽 모양(ADR-046 ⑥)에서는 이것이 유일한 기회다.
     */
    override fun load() {
        val app = context.applicationContext
        PlaceWatcher.start(app)
        Thread { PlaceWatcher.observeNow(app, "load") }.start()
    }

    /** 권한·스위치·마지막 관측. **문구와 우선순위는 웹이 정한다** — 여기는 사실만 준다. */
    @PluginMethod
    fun status(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(PlaceWatcher.status(context)))
    }

    /**
     * 지금 한 번 읽어 보낸다.
     *
     * ⚠️ **네트워크를 타므로 스레드로 뺀다.** `CalPlugin.sync` 가 선 자리와 같다 —
     *    메인에서 부르면 `NetworkOnMainThreadException` 으로 죽는다.
     */
    @PluginMethod
    fun syncNow(call: PluginCall) {
        val app = context.applicationContext
        Thread {
            val r = PlaceWatcher.observeNow(app, "manual")
            call.resolve(
                JSObject().put("outcome", r.outcome).put("reason", r.reason).put("place", r.name)
                    .put("status", JSObject.fromJSONObject(PlaceWatcher.status(app))),
            )
        }.start()
    }

    /** 진단이 쓰던 자[尺]. **상태 줄이 못 가르는 밤에 이것이 답을 준다** — 지우지 않는다. */
    @PluginMethod
    fun probe(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(WifiProbe.read(context, "plugin")))
    }

    /**
     * 앞 위치 권한을 묻는다 — **SSID 를 읽는 데 이것이 필요하다**(진단 ①).
     *
     * 이미 있으면 시스템 창을 안 띄운다 — 물어볼 것이 없을 때 뜨는 창은 잔소리다(§6.3).
     *
     * ⚠️ **배경 권한은 여기서 같이 못 묻는다.** Android 11+ 는 앞 권한을 받은 뒤 **따로**
     *    물어야 하고, 묶으면 시스템이 통째로 거절한다. 게다가 *"항상 허용"* 은 팝업으로
     *    못 받고 설정 화면으로 보내야 한다 — 그 길이 [openSettings] 다.
     */
    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (getPermissionState(ALIAS) == com.getcapacitor.PermissionState.GRANTED) { status(call); return }
        requestPermissionForAlias(ALIAS, call, "permissionCallback")
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        // 거부도 정상 흐름이다 — 화면이 그 사실을 한 줄로 말한다(ADR-046 ⑤).
        status(call)
    }

    /**
     * 설정 화면으로 보낸다. **둘은 서로 다른 곳이다**(ADR-046 ⑤).
     *
     * `location`   시스템 위치 토글. 권한이 다 있어도 이것이 꺼지면 아무것도 못 읽는다(진단 ④).
     * `background` 앱 상세 설정 — 여기서만 *"항상 허용"* 으로 바꿀 수 있다(Android 11+).
     *
     * ⚠️ 한 버튼으로 합치면 사용자가 **엉뚱한 화면**에서 없는 스위치를 찾는다.
     */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        val which = call.getString("which") ?: "background"
        val intent = if (which == "location") {
            Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
        }
        runCatching {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
        status(call)
    }

    companion object {
        const val ALIAS = "location"
    }
}
