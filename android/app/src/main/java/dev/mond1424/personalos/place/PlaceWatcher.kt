package dev.mond1424.personalos.place

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import dev.mond1424.personalos.guard.GuardSync
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 붙은 네트워크가 바뀌면 서버에 알린다 — `POST /api/places/observe` (T-59 · ADR-046).
 *
 * ★ **왜 플러그인이 아니라 object 인가.** 관측이 일어나는 시점 중 하나는 **웹이 없는 시각**이다.
 *   `ConnectivityManager` 콜백은 앱이 닫힌 채로 불리고 그 자리에는 `PluginCall` 이 없다.
 *   보내는 코드가 플러그인 안에 있으면 그 시점이 통째로 빈다 — `CalSync` 가 선 자리와 같다.
 *
 * ⚠️ **`guard/` 를 한 줄도 안 건드린다**(티켓 §범위). 대신 같은 프로세스에 콜백을 걸어 둔다 —
 *    `GuardService` 가 포그라운드 서비스로 프로세스를 살려 두므로 앱을 닫아도 콜백이 산다.
 *    진단 ③이 답한 그대로다: `foregroundServiceType="location"` 은 필요 없었다.
 *
 * ⚠️ **전이 판정을 여기서 하지 않는다**(ADR-046 ③). 관측을 그대로 보내고 서버가 가른다 —
 *    기기에 두면 앱을 지웠다 깔거나 백업을 복원한 날 prefs 가 비어 **같은 곳이 다시
 *    전이로** 들어온다. 판정이 두 곳에 있으면 갈라진다.
 *
 * ⚠️ **SSID 원문이 여기 없다.** 나가는 것은 [WifiProbe.netId] 가 준 해시뿐이다.
 */
object PlaceWatcher {

    private const val PREFS = "place"
    private const val K_LAST_SEEN = "place_last_seen"   // 마지막으로 관측이 서버까지 닿은 시각
    private const val K_LAST_ERR = "place_last_err"     // 지금 실패한 상태인가
    private const val K_LAST_TRY = "place_last_try"     // 방금 무슨 일이 있었나 (JSON 한 줄)
    private const val K_REG = "place_registered"        // 콜백이 걸린 시각

    private const val TAG = "PlaceWatcher"
    private const val TIMEOUT_MS = 10_000

    private var registered = false

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * 콜백을 건다. **두 번 걸지 않는다** — 두 벌이면 관측이 두 배로 쌓인다
     * (`boot()` 의 `booted` 가드와 같은 이유 · 함정 4).
     */
    @Synchronized
    fun start(ctx: Context) {
        if (registered) return
        val app = ctx.applicationContext
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                // 콜백은 바인더 스레드다 — 메인이 아니므로 여기서 바로 네트워크를 타도 된다.
                observeNow(app, "onAvailable")
            }
        }
        // 던지면 앱이 죽는다 — 장소 기능이 앱을 못 쓰게 만들면 그 자체가 더 큰 실패다.
        runCatching { cm.registerNetworkCallback(req, cb) }
            .onSuccess {
                registered = true
                prefs(app).edit().putString(K_REG, WifiProbe.nowIso()).apply()
            }
            .onFailure { note(app, "error", null, it.javaClass.simpleName, it.message ?: "등록 실패") }
    }

    data class Result(val outcome: String, val reason: String?, val name: String?)

    /**
     * 지금 붙은 것을 한 번 보낸다. ⚠️ **네트워크를 탄다 — 배경 스레드에서만 부른다.**
     *
     * ★ **모든 출구가 [note] 를 지난다**(T-54 ④가 배운 자리). *"실패가 아니다"* 와
     *   *"아무 자국도 안 남긴다"* 는 다른 말이고, 자국이 없으면 화면도 그 사실을 못 읽는다.
     */
    fun observeNow(ctx: Context, where: String): Result {
        val app = ctx.applicationContext
        if (!WifiProbe.hasLocationPermission(app)) return note(app, "skipped", null, "no_permission", null)
        if (!WifiProbe.locationEnabled(app)) return note(app, "skipped", null, "location_off", null)
        // 못 읽은 것은 실패가 아니다 — WiFi 가 꺼져 있거나 모바일 데이터일 수 있다.
        val id = WifiProbe.netId(app) ?: return note(app, "skipped", null, "no_wifi", null)

        val base = GuardSync.baseUrl(app)
            ?: return note(app, "error", null, "not_configured", "웹에서 configure 를 먼저 부릅니다")
        val token = GuardSync.token(app)
        val body = JSONObject().put("net_id", id).put("at", WifiProbe.nowIso())

        val text = try {
            val c = (URL("$base/api/places/observe").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                if (!token.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $token")
            }
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            val res = (if (code in 200..299) c.inputStream else c.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            if (code !in 200..299) return note(app, "error", null, "http_$code", res.take(120))
            res
        } catch (e: Exception) {
            return note(app, "error", null, e.javaClass.simpleName, e.message)
        }

        // ★ 서버가 셋을 가른다: `recorded`(전이) · `same_place`(그대로) · `unknown_network`(모르는 곳).
        //   **셋 다 정상이다** — 여기서 실패로 적으면 상태 줄이 거짓말한다.
        val o = runCatching { JSONObject(text) }.getOrNull()
        val reason = o?.optString("reason").orEmpty().ifBlank { "unknown_reason" }
        val name = o?.optJSONObject("place")?.optString("name")
        return note(app, "ok", name, reason, null)
    }

    /**
     * 흔적 하나. `outcome` 은 `ok`·`skipped`·`error` 셋뿐이다.
     *
     * ⚠️ **`lastError` 와 `lastTry` 를 합치지 않는다**(T-54 ④). 앞은 *"지금 실패한 상태인가"*,
     *    뒤는 *"방금 무슨 일이 있었나"* 다. 합치면 `no_wifi` 가 실패로 적히고 화면이 거짓말한다.
     */
    private fun note(ctx: Context, outcome: String, name: String?, reason: String?, detail: String?): Result {
        val e = prefs(ctx).edit()
        val o = JSONObject()
            .put("at", WifiProbe.nowIso()).put("outcome", outcome)
            .put("reason", reason ?: JSONObject.NULL)
            .put("detail", detail ?: JSONObject.NULL)
            .put("place", name ?: JSONObject.NULL)
        e.putString(K_LAST_TRY, o.toString())
        // ★ **서버까지 닿은 것만 '관측'으로 센다.** 권한이 없어 못 읽은 것을 여기 적으면
        //   화면의 `stale` 이 영원히 안 뜬다 — 돌지도 않는데 돌고 있다고 말하게 된다.
        if (outcome == "ok") e.putString(K_LAST_SEEN, WifiProbe.nowIso()).remove(K_LAST_ERR)
        if (outcome == "error") e.putString(K_LAST_ERR, listOfNotNull(reason, detail).joinToString(" "))
        e.apply()
        Log.i(TAG, "observe $outcome reason=$reason")
        return Result(outcome, reason, name)
    }

    /**
     * 화면이 읽는 사실들. **상태 이름과 우선순위는 여기서 안 정한다** —
     * 웹의 `placeStatusLine` 이 정한다(T-53이 세운 구조. 두 곳에 두면 갈라진다).
     */
    fun status(ctx: Context): JSONObject = JSONObject()
        .put("permission", WifiProbe.hasLocationPermission(ctx))
        .put("backgroundPermission", WifiProbe.hasBackgroundPermission(ctx))
        .put("locationEnabled", WifiProbe.locationEnabled(ctx))
        .put("wifiEnabled", WifiProbe.wifiEnabled(ctx))
        .put("configured", GuardSync.isConfigured(ctx))
        .put("registeredAt", prefs(ctx).getString(K_REG, null) ?: JSONObject.NULL)
        // 지금 붙은 네트워크의 해시 — **등록 화면이 이것에 이름을 붙인다.**
        .put("netId", WifiProbe.netId(ctx) ?: JSONObject.NULL)
        .put("lastSeenAt", prefs(ctx).getString(K_LAST_SEEN, null) ?: JSONObject.NULL)
        .put("lastError", prefs(ctx).getString(K_LAST_ERR, null) ?: JSONObject.NULL)
        .put(
            "lastTry",
            prefs(ctx).getString(K_LAST_TRY, null)
                ?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject.NULL,
        )
}
