package dev.mond1424.personalos.guard

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * 웹 ↔ 네이티브 다리.
 *
 * 웹에서:  await Capacitor.Plugins.Guard.state()
 *
 * 얇게 유지한다 — 판단은 전부 네이티브(ADR-021: 발동은 기기가)이고,
 * 웹은 권한 상태를 보여 주고 설정 화면으로 보내는 역할만 한다.
 * 나중에 Compose로 전환해도 이 다리만 걷어내면 된다.
 */
@CapacitorPlugin(name = "Guard")
class GuardPlugin : Plugin() {

    companion object {
        private const val REQ_POST_NOTIFICATIONS = 7301
    }

    override fun load() {
        GuardNotifications.ensureChannels(context)
        // 값싼 보험 — 강제 종료로 AlarmManager 등록이 날아간 경우까지 덮는다.
        // BootReceiver는 재부팅·업데이트만 덮는다.
        runCatching { GuardAlarms.restoreAll(context) }
        // 상시 서비스도 앱을 열 때마다 되살린다. 죽어 있으면 그때부터 표본이 비고,
        // 무엇보다 스와이프 종료에 대한 방어가 사라진다.
        runCatching { GuardService.start(context) }
    }

    /** 권한 3종의 현재 상태. 1주차 게이트 화면이 이걸 그린다. */
    @PluginMethod
    fun state(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("notifications", GuardNotifications.canPost(context))
                .put("fullScreenIntent", canUseFsi(context))
                .put("overlay", GuardNotifications.canOverlay(context))
                .put("batteryUnrestricted", isBatteryUnrestricted(context))
                .put("sdk", Build.VERSION.SDK_INT)
                .put("manufacturer", Build.MANUFACTURER),
        )
    }

    /**
     * 지금 Level 4 구간인가 — 화면이 **오늘 날짜를 붙이기 전에** 묻는다 (ADR-035 ②·③).
     *
     * `{ level4: Boolean, until?: Long }` — `until`은 epoch ms이고 **표시용**이다.
     * 왜 내일이 됐는지 말해야 하기 때문에 함께 준다(ADR-035 ⑤).
     *
     * **묻는 방식(pull)인 이유**: 이벤트로 밀면 Level 4 중에 앱을 **새로 여는** 경우를
     * 놓친다 — 그때 필요한 것은 "방금 바뀐 순간"이 아니라 "지금 상태"다.
     * 판정은 기기가 끝낸다 — 웹에 시각을 주고 계산시키지 않는다.
     */
    @PluginMethod
    fun level4State(call: PluginCall) {
        val until = GuardLevel4.activeUntil(context)
        val res = JSObject().put("level4", until != null)
        if (until != null) res.put("until", until)
        call.resolve(res)
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !GuardNotifications.canPost(context)) {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                REQ_POST_NOTIFICATIONS,
            )
        }
        call.resolve()
    }

    /** Android 14+ — FSI 허용 설정 화면. 알람 앱이 아니면 기본 부여가 안 된다. */
    @PluginMethod
    fun openFsiSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            open(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, appUri()))
        } else {
            open(appDetails())
        }
        call.resolve()
    }

    /**
     * 배터리 최적화 예외.
     * ACTION_REQUEST_...는 예/아니오 다이얼로그 하나로 끝난다 — 목록에서 앱을 찾는 것보다 훨씬 낫다.
     * 삼성은 여기에 더해 '절전 시 사용 중지 앱'에서도 빼야 한다(수동, 자동화 불가).
     */
    @PluginMethod
    @Suppress("BatteryLife")
    fun openBatterySettings(call: PluginCall) {
        if (isBatteryUnrestricted(context)) { call.resolve(); return }
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, appUri())
        runCatching {
            direct.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(direct)
        }.onFailure {
            open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
        call.resolve()
    }

    /**
     * '다른 앱 위에 표시' 허용 화면.
     *
     * 이게 있어야 **깨어 있는 화면에서도** 개입 화면이 뜬다.
     * FSI 단독으로는 잠긴 화면에서만 Activity가 열리기 때문이다(FSI의 계약).
     * 이 권한이 백그라운드 액티비티 시작 제한(Android 10+)의 예외를 준다.
     */
    @PluginMethod
    fun openOverlaySettings(call: PluginCall) {
        if (GuardNotifications.canOverlay(context)) { call.resolve(); return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, appUri()))
        }
        call.resolve()
    }

    /** 알림 채널 설정 — 소리가 안 나면 여기서 확인한다. */
    @PluginMethod
    fun openChannelSettings(call: PluginCall) {
        val ch = call.getString("channel") ?: GuardNotifications.CH_HIGH
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            open(
                Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, ch),
            )
        } else open(appDetails())
        call.resolve()
    }

    /**
     * 발동 — 1주차 게이트용. S1.3에서 진짜 예약(setAlarmClock)이 붙는다.
     *
     * delayMs를 주면 그만큼 뒤에 발동한다. **FSI 확인에 필요하다** —
     * FSI는 발동 '시점'에 화면이 잠겨 있어야 Activity를 띄운다. 깨어 있으면
     * 헤드업 알림으로 끝난다. 그래서 지연을 걸고 그 사이 폰을 잠가야 한다.
     *
     * ⚠️ Handler 기반이라 앱 프로세스가 죽으면 사라진다. 30초 이내로 쓴다.
     *    프로세스가 죽어도 뜨는지는 S1.3의 알람이 확인한다.
     */
    @PluginMethod
    fun testNotify(call: PluginCall) {
        val level = call.getInt("level") ?: 3
        val delay = (call.getInt("delayMs") ?: 0).toLong().coerceIn(0, 120_000)
        val title = call.getString("title") ?: "Guard 테스트 · Level $level"
        val body = call.getString("body")
            ?: "이 알림이 잠긴 화면을 알람 소리와 함께 점유했다면 통과입니다."

        if (delay <= 0) {
            val r = GuardNotifications.fire(context, level, title, body)
            val plan = GuardAlertPolicy.plan(context, level)
            call.resolve(
                JSObject()
                    .put("reached", r.reached)
                    .put("posted", r.posted)      // 알림(알림함·폴백 소리)
                    .put("shown", r.shown)        // 개입 화면 — 소리·진동의 주인
                    .put("canPost", r.canPost)    // ← false면 requestNotifications()
                    .put("canOverlay", r.canOverlay)  // ← false면 openOverlaySettings()
                    // 이번 발동에서 실제로 낸 것. 폰의 소리 모드가 그대로 반영된다
                    .put("ringerMode", ringerModeName())
                    .put("playedSound", plan.sound)
                    .put("playedVibration", plan.vibrate),
            )
            return
        }
        Handler(Looper.getMainLooper()).postDelayed({
            GuardNotifications.fire(context, level, title, body)
        }, delay)
        call.resolve(JSObject().put("scheduledInMs", delay))
    }

    /** 소리·진동 설정 읽기. `effective`는 지금 이 순간 실제로 무엇이 날지 — 벨소리 모드 반영. */
    @PluginMethod
    fun getSettings(call: PluginCall) {
        val s = GuardSettings(context)
        val plan = GuardAlertPolicy.plan(context, 3)
        val planL4 = GuardAlertPolicy.plan(context, 4)
        call.resolve(
            JSObject()
                .put("sound", s.sound)
                .put("vibration", s.vibration)
                .put("ringerMode", ringerModeName())
                .put("effectiveL3", JSObject().put("sound", plan.sound).put("vibrate", plan.vibrate))
                .put("effectiveL4", JSObject().put("sound", planL4.sound).put("vibrate", planL4.vibrate)),
        )
    }

    @PluginMethod
    fun setSettings(call: PluginCall) {
        val s = GuardSettings(context)
        call.getBoolean("sound")?.let { s.sound = it }
        call.getBoolean("vibration")?.let { s.vibration = it }
        getSettings(call)
    }

    private fun ringerModeName(): String {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? android.media.AudioManager
        return when (am?.ringerMode) {
            android.media.AudioManager.RINGER_MODE_SILENT -> "silent"
            android.media.AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
            else -> "normal"
        }
    }

    // ── 감지 · 상시 서비스 (S1.4 · S2.5) ─────────────────────

    /** 사용 정보 접근은 특수 권한이라 런타임 요청이 없다. 설정 화면으로 보낸다. */
    @PluginMethod
    fun openUsageSettings(call: PluginCall) {
        runCatching { context.startActivity(UsageProbe.settingsIntent()) }
        call.resolve()
    }

    @PluginMethod
    fun startService(call: PluginCall) {
        GuardService.start(context)
        call.resolve(JSObject().put("started", true))
    }

    @PluginMethod
    fun stopService(call: PluginCall) {
        GuardService.stop(context)
        call.resolve(JSObject().put("stopped", true))
    }

    /** 감지가 실제로 값을 만들고 있는지 — 표본 수와 현재 전면 앱. */
    @PluginMethod
    fun detectStatus(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("usagePermission", UsageProbe.hasPermission(context))
                .put("currentApp", UsageProbe.currentApp(context))
                .put("samples", GuardActivityLog.size(context))
                .put("snapshot", JSObject.fromJSONObject(GuardActivityLog.snapshot(context))),
        )
    }

    /** 최근 표본 원본 — 무엇이 잡히는지 눈으로 확인할 때. */
    @PluginMethod
    fun recentActivity(call: PluginCall) {
        val min = call.getInt("minutes") ?: 60
        // JSObject는 JSONObject를 상속하므로 JSONArray를 그대로 넣으면 된다.
        // JSArray.from은 Java 배열·컬렉션용이라 JSONArray에는 안 맞는다.
        call.resolve(
            JSObject()
                .put("window_min", min)
                .put("items", GuardActivityLog.recent(context, min)),
        )
    }

    @PluginMethod
    fun clearActivity(call: PluginCall) {
        GuardActivityLog.clear(context)
        call.resolve(JSObject().put("cleared", true))
    }

    // ── 감지 기반 발동 (ADR-025) ──────────────────────────────

    /** 규칙이 지금 어떻게 보이는지 — 창 안인가, 연속 몇 분인가, 오늘 밤 몇 번 발동했나. */
    @PluginMethod
    fun watchStatus(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(GuardWatch.status(context)))
    }

    @PluginMethod
    fun setWatch(call: PluginCall) {
        val s = GuardSettings(context)
        call.getBoolean("enabled")?.let { s.watchEnabled = it }
        call.getString("bedFrom")?.let { s.bedFrom = it }
        call.getString("bedTo")?.let { s.bedTo = it }
        call.getInt("minutes")?.let { s.watchMinutes = it }
        // 재발동 간격 (T-51). `minutes`와 **한 판단의 두 손잡이**라 같은 자리에서 받는다 —
        // 전엔 이것만 코드 상수여서 조정할 때마다 APK가 들었다.
        call.getInt("refireMinutes")?.let { s.watchRefireMinutes = it }
        call.getInt("maxPerNight")?.let { s.watchMaxPerNight = it }
        watchStatus(call)
    }

    /**
     * 규칙을 지금 한 번 평가한다 — 폴링(60초)을 기다리지 않고 확인할 때.
     *
     * 조건을 만족해야 발동한다. 창 밖이거나 연속 시간이 모자라면 `fired: false`가
     * 정상이다 — 그 경우 `watchStatus`로 무엇이 막았는지 본다.
     */
    @PluginMethod
    fun evaluateWatch(call: PluginCall) {
        val fired = GuardWatch.evaluate(context)
        call.resolve(
            JSObject().put("fired", fired)
                .put("status", JSObject.fromJSONObject(GuardWatch.status(context))),
        )
    }

    /** 밤 상한·Level 2 이력 초기화. 같은 밤에 두 번 이상 시험할 때. */
    @PluginMethod
    fun resetWatchNight(call: PluginCall) {
        GuardWatch.resetNight(context)
        call.resolve(JSObject().put("reset", true))
    }

    /** 수락 재확인이 arm됐는지, 5분·화면·오늘 상한 중 무엇이 막는지 확인한다. */
    @PluginMethod
    fun recheckStatus(call: PluginCall) {
        call.resolve(JSObject.fromJSONObject(GuardRecheck.status(context)))
    }

    // ── 서버 동기화 (S2.3) ───────────────────────────────────

    /**
     * 웹이 부팅 때 한 번 알려 준다 — 서버 주소와 토큰.
     * 토큰은 웹뷰 localStorage에 있고 네이티브가 직접 못 읽는다. 9월 Phase 0에서 기기 토큰으로 바뀐다.
     */
    @PluginMethod
    fun configure(call: PluginCall) {
        val base = call.getString("baseUrl")
        if (base.isNullOrBlank()) { call.reject("baseUrl이 필요합니다"); return }
        GuardSync.configure(context, base, call.getString("token"))
        call.resolve(JSObject.fromJSONObject(GuardSync.status(context)))
    }

    /** 서버의 예약 재료를 받아 알람으로 전부 건다. 멱등 — 서버발 예약을 통째로 갈아엎는다. */
    @PluginMethod
    fun sync(call: PluginCall) {
        val app = context.applicationContext
        Thread {
            val r = GuardSync.syncNow(app)
            call.resolve(
                JSObject().put("ok", r.ok).put("scheduled", r.scheduled)
                    .put("error", r.error)
                    .put("status", JSObject.fromJSONObject(GuardSync.status(app))),
            )
        }.start()
    }

    @PluginMethod
    fun syncStatus(call: PluginCall) {
        call.resolve(
            JSObject.fromJSONObject(GuardSync.status(context))
                .put("queued", GuardEventQueue.size(context)),   // 아직 못 올린 발동 기록 수
        )
    }

    /** 밀린 발동 기록만 올린다 (예약 갱신 없이). */
    @PluginMethod
    fun flushEvents(call: PluginCall) {
        val app = context.applicationContext
        Thread {
            val (sent, left) = GuardEventQueue.flush(app)
            call.resolve(JSObject().put("sent", sent).put("remaining", left))
        }.start()
    }

    /**
     * Level 4 검증을 **한 번 불러 결과만 본다** (T-04 확인용 · ADR-024).
     *
     * 발동시키지 않는다 — 통제가 실제로 어떻게 답하는지만 확인하는 진단 통로다.
     * `client_id`는 매번 새로 만들어 캐시에 걸리지 않게 한다(같은 것을 쓰면 두 번째부터
     * `source: "cache"`만 보게 된다).
     *
     * 돌아오는 `source`로 통제를 읽는다:
     *   `off` 킬 스위치 · `cap` 일일 상한 · `cache` 재사용 · `ai` 실제 호출 ·
     *   `timeout`·`error` 판정 불가(전부 Level 3)
     */
    @PluginMethod
    fun verifyNow(call: PluginCall) {
        val app = context.applicationContext
        val cause = call.getString("cause") ?: "diagnostic"
        val eventId = call.getString("eventId")
        Thread {
            val v = GuardVerify.verify(
                app, java.util.UUID.randomUUID().toString(), cause, eventId, null, null,
            )
            if (v == null) {
                // 서버에 못 닿았다 — 실제 발동이었다면 Level 3으로 남았을 상황이다.
                call.resolve(JSObject().put("reached", false).put("level", 3))
                return@Thread
            }
            call.resolve(
                JSObject()
                    .put("reached", true)
                    .put("level", v.level)
                    .put("approved", v.approved)
                    .put("source", v.source)
                    .put("ai_used", v.aiUsed)
                    .put("ai_verdict", v.aiVerdict ?: JSONObject.NULL)
                    .put("reason", v.reason),
            )
        }.start()
    }

    // ── 예약 (S1.3) ──────────────────────────────────────────

    /**
     * n초 뒤 발동을 예약한다. **앱이 죽어 있어도 시스템이 깨워 발동시킨다** —
     * `testNotify`의 `delayMs`(Handler 기반, 프로세스와 함께 죽음)와 결정적으로 다르다.
     */
    @PluginMethod
    fun scheduleIn(call: PluginCall) {
        val sec = call.getInt("seconds") ?: 180
        val level = call.getInt("level") ?: 3
        val at = System.currentTimeMillis() + sec * 1000L
        val id = GuardAlarms.TEST_ID_BASE + (call.getInt("slot") ?: 0)
        val a = ScheduledAlarm(
            id = id, at = at, level = level,
            title = call.getString("title") ?: "Guard 예약 테스트 · Level $level",
            body = call.getString("body")
                ?: "예약한 시각에 앱이 죽어 있어도 스스로 깨어났다면 통과입니다.",
        )
        val ok = GuardAlarms.schedule(context, a)
        call.resolve(
            JSObject().put("scheduled", ok).put("id", id).put("at", at)
                .put("inSeconds", sec)
                .put("canScheduleExact", GuardAlarms.canScheduleExact(context)),
        )
    }

    /** 절대 시각 예약 — 'HH:MM'(오늘/내일 중 가까운 쪽) 또는 epoch millis. */
    @PluginMethod
    fun scheduleAt(call: PluginCall) {
        val level = call.getInt("level") ?: 3
        val id = GuardAlarms.TEST_ID_BASE + (call.getInt("slot") ?: 1)
        val at = call.getString("hhmm")?.let { hhmm ->
            val (h, m) = hhmm.split(":").map { it.trim().toInt() }
            val c = java.util.Calendar.getInstance().apply {
                set(java.util.Calendar.HOUR_OF_DAY, h)
                set(java.util.Calendar.MINUTE, m)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }
            if (c.timeInMillis <= System.currentTimeMillis()) {
                c.add(java.util.Calendar.DAY_OF_YEAR, 1)   // 지났으면 내일
            }
            c.timeInMillis
        } ?: call.getString("at")?.toLongOrNull()
            ?: run { call.reject("hhmm 또는 at이 필요합니다"); return }

        val a = ScheduledAlarm(
            id = id, at = at, level = level,
            title = call.getString("title") ?: "Guard 예약 · Level $level",
            body = call.getString("body") ?: "예약한 시각에 발동했습니다.",
        )
        call.resolve(
            JSObject().put("scheduled", GuardAlarms.schedule(context, a))
                .put("id", id).put("at", at)
                .put("atLocal", java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.KOREA).format(java.util.Date(at)))
                .put("canScheduleExact", GuardAlarms.canScheduleExact(context)),
        )
    }

    /** 지금 걸려 있는 예약 목록. 재부팅 전후로 비교하면 복구를 확인할 수 있다. */
    @PluginMethod
    fun listAlarms(call: PluginCall) {
        val fmt = java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.KOREA)
        val arr = com.getcapacitor.JSArray()
        GuardAlarmStore.all(context).sortedBy { it.at }.forEach {
            arr.put(
                JSObject().put("id", it.id).put("level", it.level)
                    .put("at", it.at).put("atLocal", fmt.format(java.util.Date(it.at)))
                    .put("inSeconds", (it.at - System.currentTimeMillis()) / 1000)
                    .put("title", it.title),
            )
        }
        call.resolve(
            JSObject().put("alarms", arr)
                .put("count", arr.length())
                .put("canScheduleExact", GuardAlarms.canScheduleExact(context)),
        )
    }

    @PluginMethod
    fun cancelAlarms(call: PluginCall) {
        GuardAlarms.cancelAll(context)
        call.resolve(JSObject().put("cleared", true))
    }

    /** 예약이 살아 있는지 강제로 다시 걸어 본다 — 복구 경로 자체의 확인용. */
    @PluginMethod
    fun restoreAlarms(call: PluginCall) {
        call.resolve(JSObject().put("restored", GuardAlarms.restoreAll(context)))
    }

    @PluginMethod
    fun stopAlarm(call: PluginCall) {
        GuardAlarmPlayer.stop()
        call.resolve()
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        val level = call.getInt("level") ?: 3
        GuardNotifications.clear(context, level)
        call.resolve()
    }

    @PluginMethod
    fun showOngoing(call: PluginCall) {
        val text = call.getString("text") ?: "보호 모드가 켜져 있어요"
        call.resolve(JSObject().put("posted", GuardNotifications.showOngoing(context, text)))
    }

    @PluginMethod
    fun clearOngoing(call: PluginCall) {
        GuardNotifications.clearOngoing(context)
        call.resolve()
    }

    // ── helpers ──────────────────────────────────────────────
    private fun appUri() = Uri.fromParts("package", context.packageName, null)

    private fun appDetails() =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, appUri())

    private fun open(i: Intent) {
        runCatching {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }.onFailure {
            runCatching {
                context.startActivity(appDetails().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }

    private fun canUseFsi(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return false
        return nm.canUseFullScreenIntent()
    }

    private fun isBatteryUnrestricted(ctx: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        return pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }
}
