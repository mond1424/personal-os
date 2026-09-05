package dev.mond1424.personalos.place

import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 붙은 네트워크를 읽는 **유일한 자리** (T-59 · ADR-046).
 *
 * 2026-09-05 진단에서 이 파일은 자[尺]였다. 폰이 답을 준 뒤 그대로 기능이 됐고,
 * `read`는 그 자로 남아 있다 — 상태 다섯을 화면이 가르려면 같은 사실이 필요하기 때문이다.
 *
 * ⚠️ **SSID 원문이 이 object 밖으로 안 나간다**(ADR-046 ② · 티켓 §금지).
 *    네트워크 이름 자체가 장소를 말하므로, 나가는 것은 **해시**와 *"읽혔는가"* 뿐이다.
 *    막는 자리는 [describe] 하나다 — 두 곳에서 정하면 갈라진 쪽이 원문을 흘린다.
 *
 * ★ **읽히는 경로는 deprecated된 [WifiManager.getConnectionInfo] 하나뿐이다**(진단 결과).
 *   `ConnectivityManager`가 주는 `WifiInfo`는 `ACCESS_NETWORK_STATE`가 있어도 호출자에게
 *   가려진 사본이라 늘 `redacted`다. **문서만 보고 최신 API로 갔으면 조용히 못 읽었을 자리다.**
 */
object WifiProbe {

    /** 진단이 나열했던 후보들 — 상태 줄이 이 중 둘(앞·배경)을 읽는다. */
    private val CANDIDATES = buildList {
        add("android.permission.ACCESS_WIFI_STATE")
        add("android.permission.ACCESS_COARSE_LOCATION")
        add("android.permission.ACCESS_FINE_LOCATION")
        add("android.permission.ACCESS_BACKGROUND_LOCATION")
        if (Build.VERSION.SDK_INT >= 33) add("android.permission.NEARBY_WIFI_DEVICES")
    }

    const val FINE = "android.permission.ACCESS_FINE_LOCATION"
    const val COARSE = "android.permission.ACCESS_COARSE_LOCATION"
    const val BACKGROUND = "android.permission.ACCESS_BACKGROUND_LOCATION"

    /** `unknown ssid` — 권한이 없거나 위치가 꺼졌을 때 시스템이 돌려주는 자리표시자. */
    private val UNKNOWN = WifiManager.UNKNOWN_SSID

    private fun granted(ctx: Context, p: String) =
        ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    /** 앞에서 읽을 수 있는가. **거친 위치로도 SSID는 읽힌다** — 정밀 위치를 요구하지 않는다. */
    fun hasLocationPermission(ctx: Context) = granted(ctx, FINE) || granted(ctx, COARSE)

    /**
     * 배경에서도 읽을 수 있는가.
     *
     * ⚠️ **없는 것은 실패가 아니라 반쪽이다**(ADR-046 ⑥). 앱을 열 때 *"그 사이 바뀐 것"* 은
     *    여전히 잡히고, 놓치는 것은 **시각**이다. 강요하지 않는다 —
     *    2026-08-28에 알림 권한을 껐다가 Guard 가 통째로 죽은 것이 강요의 대가였다.
     */
    fun hasBackgroundPermission(ctx: Context) =
        Build.VERSION.SDK_INT < 29 || granted(ctx, BACKGROUND)

    /**
     * 위치 서비스 스위치. ⚠️ **권한과 다른 축이다**(진단 ④) — 권한이 다 있어도 이것이 꺼지면
     * 두 경로 다 `redacted`가 되고, 사용자가 할 일은 앱 설정이 아니라 시스템 토글이다.
     */
    fun locationEnabled(ctx: Context): Boolean = runCatching {
        (ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager)?.isLocationEnabled == true
    }.getOrDefault(false)

    fun wifiEnabled(ctx: Context): Boolean = runCatching {
        (ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled == true
    }.getOrDefault(false)

    /**
     * 지금 붙은 네트워크의 식별자 — SHA-256 앞 16자리. 못 읽으면 `null`.
     *
     * ★ **이 값 하나가 서버로 간다.** 서버의 `places.net_id`, 0022의 CHECK 와 같은 약속이고,
     *   거꾸로 이름을 알아낼 수는 없다.
     */
    fun netId(ctx: Context): String? {
        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        val d = legacy(wm)
        return if (d.optBoolean("ok")) d.optString("id", "").ifBlank { null } else null
    }

    /**
     * 지금 이 프로세스가 무엇을 읽을 수 있는지 — **사실만 준다. 문구는 웹이 정한다**(T-53의 구조).
     *
     * [where]는 어느 자리에서 불렀나다(`plugin` · `onAvailable`). 같은 권한이라도 앞과 배경에서
     * 답이 다를 수 있고, **그 차이가 진단 ②의 답이었다.**
     */
    fun read(ctx: Context, where: String): JSONObject {
        val perms = JSONObject()
        for (p in CANDIDATES) perms.put(p.substringAfterLast('.'), granted(ctx, p))

        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        return JSONObject()
            .put("at", nowIso())
            .put("where", where)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("perms", perms)
            .put("locationEnabled", locationEnabled(ctx))
            .put("wifiEnabled", wifiEnabled(ctx))
            .put("legacy", legacy(wm))
            .put("modern", modern(ctx))
    }

    /** `WifiManager.getConnectionInfo()` — deprecated지만 **읽히는 것은 이것뿐이다**(진단). */
    private fun legacy(wm: WifiManager?): JSONObject = runCatching {
        @Suppress("DEPRECATION")
        describe(wm?.connectionInfo)
    }.getOrElse { fail(it) }

    /** `ConnectivityManager`의 `transportInfo` — 정식 경로인데 **가려진 사본을 준다**(진단). */
    private fun modern(ctx: Context): JSONObject = runCatching {
        if (Build.VERSION.SDK_INT < 31) return@runCatching JSONObject().put("ok", false).put("reason", "sdk<31")
        val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
        if (caps == null || !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            return@runCatching JSONObject().put("ok", false).put("reason", "not_wifi")
        }
        describe(caps.transportInfo as? WifiInfo)
    }.getOrElse { fail(it) }

    /**
     * ★ **여기가 원문을 막는 한 자리다.** 위 둘이 어떤 경로로 읽었든 바깥으로 나가는 모양은
     *   이 함수가 정한다.
     *
     * ⚠️ **BSSID를 식별자에 안 섞는다.** 진단 프로브는 `ssid|bssid`로 해시했는데, 그러면
     *   AP 가 여럿인 학교에서 **같은 네트워크가 AP 마다 다른 장소**가 된다. 자[尺]로는
     *   충분했지만 기능으로는 틀린 값이다 — 갈라진 자리를 여기 적어 둔다.
     */
    private fun describe(info: WifiInfo?): JSONObject {
        if (info == null) return JSONObject().put("ok", false).put("reason", "no_info")
        val raw = info.ssid?.trim('"').orEmpty()
        val bssid = info.bssid.orEmpty()
        val redacted = raw.isBlank() || raw == UNKNOWN || raw == UNKNOWN.trim('"')
        return JSONObject()
            .put("ok", !redacted)
            .put("reason", if (redacted) "redacted" else "read")
            .put("len", if (redacted) 0 else raw.length)
            .put("id", if (redacted) JSONObject.NULL else hash16(raw))
            .put("id8", if (redacted) JSONObject.NULL else hash16(raw).take(8))
            .put("bssidRedacted", bssid.isBlank() || bssid == "02:00:00:00:00:00")
    }

    private fun fail(e: Throwable): JSONObject =
        JSONObject().put("ok", false).put("reason", e.javaClass.simpleName + ": " + (e.message ?: ""))

    /** SHA-256 앞 16자리. **원문은 여기서 끝나고 밖으로 안 나간다.** */
    private fun hash16(name: String): String {
        val d = MessageDigest.getInstance("SHA-256").digest(name.toByteArray())
        return d.take(8).joinToString("") { "%02x".format(it) }
    }

    fun nowIso(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())
}
