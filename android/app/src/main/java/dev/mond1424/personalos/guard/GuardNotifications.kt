package dev.mond1424.personalos.guard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.mond1424.personalos.R

/**
 * Guard 알림 — 채널 3종과 발동.
 *
 * 설계 §6.1의 Level을 채널로 나눈다.
 *   Level 1~2 → guard_low     일반 알림
 *   Level 3~4 → guard_high    FSI(잠금화면 점유) + 알람 소리
 *   보호 모드  → guard_ongoing 상시 표시(소리 없음)
 *
 * ⚠️ 채널 설정은 **생성된 뒤 코드로 바꿀 수 없다.** 소리·중요도·진동을 바꾸려면
 *    ID 끝의 버전을 올리고 옛 채널을 지워야 한다. 그래서 처음부터 _v1을 붙인다.
 *    (앱 데이터를 지우는 것도 방법이지만 로컬 guard_events가 함께 날아간다.)
 *
 * 방해금지: setBypassDnd를 쓰지 않는다. 알림 정책 접근 권한이 따로 필요하고,
 *    USAGE_ALARM으로 잡으면 방해금지의 '알람 허용'(기본 켬)을 이미 탄다.
 *    취침 모드를 엄격하게 쓰면 막힐 수 있다 — 1주차 새벽 게이트에서 드러난다.
 */
object GuardNotifications {

    const val CH_LOW = "guard_low_v1"

    /** 소리 나는 고위험 채널 — **개입 화면을 못 띄울 때만** 쓰는 폴백. */
    const val CH_HIGH = "guard_high_v2"

    /** 조용한 고위험 채널 — 개입 화면이 뜨는 정상 경로. 소리·진동은 화면이 낸다. */
    const val CH_HIGH_SILENT = "guard_high_silent_v1"

    const val CH_ONGOING = "guard_ongoing_v1"

    private const val ID_BASE = 7100
    const val ID_ONGOING = 7099

    /**
     * 버전을 올릴 때 지울 옛 채널 ID.
     * guard_high_v1 — 소리·진동이 채널에 박혀 있어 설정으로 못 껐다. v2는 폴백 전용.
     */
    private val RETIRED = listOf("guard_high_v1")

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return

        RETIRED.forEach { runCatching { nm.deleteNotificationChannel(it) } }

        val low = NotificationChannel(
            CH_LOW, "Guard 알림", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Level 1~2 — 일정 안내·맥락 경고" }

        // 알람 카테고리 — 알람 볼륨으로 재생되고 무음/방해금지에서도 '알람 허용'을 탄다
        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val alarmAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        // 폴백 — 개입 화면을 못 띄우는 경우에만 쓴다. 소리가 채널에 박혀 있다.
        val high = NotificationChannel(
            CH_HIGH, "Guard 개입 (소리)", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "개입 화면을 띄울 수 없을 때의 폴백 — 채널이 직접 소리를 낸다"
            setSound(alarmSound, alarmAttrs)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 500)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        // 정상 경로 — 화면이 소리·진동의 주인이다(설정·벨소리 모드를 따르려면 그래야 한다).
        // 채널이 같이 울리면 두 겹으로 들린다.
        val highSilent = NotificationChannel(
            CH_HIGH_SILENT, "Guard 개입", NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Level 3~4 — 잠금화면 점유. 소리·진동은 개입 화면이 낸다"
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        val ongoing = NotificationChannel(
            CH_ONGOING, "Guard 보호 모드", NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "보호 모드가 켜져 있는 동안 상시 표시"
            setShowBadge(false)
            setSound(null, null)
            enableVibration(false)
        }

        nm.createNotificationChannels(listOf(low, high, highSilent, ongoing))
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                ctx, android.Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    /** 발동 결과 — 무엇이 되고 무엇이 막혔는지. 침묵의 원인을 눈으로 봐야 한다. */
    data class FireResult(
        val posted: Boolean,      // 알림이 떴는가 (소리·진동의 출처)
        val shown: Boolean,       // 개입 화면이 떴는가
        val canPost: Boolean,
        val canOverlay: Boolean,
    ) {
        val reached: Boolean get() = posted || shown
    }

    /**
     * Level에 맞는 개입을 발동한다.
     *
     * **두 경로는 서로 독립이다.**
     *   알림  — 소리·진동·알림함 기록. POST_NOTIFICATIONS 필요
     *   화면  — 개입 자체. SYSTEM_ALERT_WINDOW 필요(또는 잠긴 화면이면 FSI)
     *
     * 한쪽이 막혀도 다른 쪽은 간다. 알림 권한 하나가 풀렸다고 Guard가
     * 통째로 침묵하면 안 된다 — 그 일이 하필 새벽에 드러난다.
     *
     * 어느 경우에도 **던지지 않는다.** 예외로 죽으면 개입이 사라진다.
     */
    fun fire(
        ctx: Context,
        level: Int,
        title: String,
        body: String,
        eventId: String? = null,
        cause: String = "protect",
    ): FireResult {
        ensureChannels(ctx)

        // Level 4 후보는 **먼저 Level 3으로 낸다**(ADR-024 + ADR-021).
        // 검증을 발동 앞에 두면 응답을 기다리는 동안 개입이 늦어지는데, 새벽에 몇 초 늦는
        // 화면은 그만큼 덜 막는다. 그래서 지연 0으로 띄우고 **승인이 오면 그 화면을 올린다.**
        // (기다리는 상한은 `GuardVerify`의 두 상수다 — T-37이 그것을 늘렸고, 늘릴 수 있는
        //  이유가 바로 이 순서다: 사용자는 이미 화면을 보고 있다.)
        // 거부·실패·오프라인은 Level 3 그대로 — fail-closed(ADR-024가 fail-open을 기각했다).
        val candidate4 = level >= 4
        val fireLevel = if (candidate4) 3 else level

        val high = fireLevel >= 3

        // ① 로컬 기록이 **가장 먼저** — 네트워크를 기다리지 않는다(ADR-023).
        // 화면·알림보다 앞이어야 client_id를 화면에 넘겨 반응을 같은 항목에 붙일 수 있다.
        // 발동 경로에 왕복을 넣으면 새벽에 기록이 통째로 사라진다.
        // 감지가 있으면 함께 남긴다. 없으면 null — **감지 실패가 발동을 막지 않는다**(ADR-018 보조 입력).
        val fgApp = runCatching { UsageProbe.currentApp(ctx) }.getOrNull()
        val snap = runCatching { GuardActivityLog.snapshot(ctx) }.getOrNull()
        val clientId = runCatching {
            GuardEventQueue.recordFire(ctx, fireLevel, cause, eventId, fgApp, snap)
        }.getOrNull()

        val alert = Intent(ctx, GuardAlertActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(GuardAlertActivity.EX_LEVEL, fireLevel)
            putExtra(GuardAlertActivity.EX_TITLE, title)
            putExtra(GuardAlertActivity.EX_BODY, body)
            putExtra(GuardAlertActivity.EX_EVENT, eventId)
            putExtra(GuardAlertActivity.EX_NOTIF_ID, ID_BASE + fireLevel)
            putExtra(GuardAlertActivity.EX_CLIENT_ID, clientId)
        }
        val pi = PendingIntent.getActivity(
            ctx, ID_BASE + fireLevel, alert,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        // ② 개입 화면 — 채널 선택이 이 결과에 달렸다.
        // FSI는 화면이 잠겼을 때만 Activity를 띄우는 게 계약이라, 깨어 있으면 헤드업으로 끝난다.
        // 깨어 있는 화면까지 덮으려면 백그라운드 액티비티 시작이 필요한데 Android 10+가 막고,
        // '다른 앱 위에 표시'(SYSTEM_ALERT_WINDOW)가 그 예외를 준다.
        // 잠긴 화면에서는 FSI와 겹치지만 singleInstance + CLEAR_TOP이라 하나만 뜬다.
        val co = canOverlay(ctx)
        val shown = high && co && runCatching {
            ctx.startActivity(alert); true
        }.getOrDefault(false)

        // ③ 알림 — 화면이 떴으면 **조용한 채널**을 쓴다.
        // 소리는 화면이 내므로(설정·벨소리 모드를 따르려면 그래야 한다) 채널까지 울면 두 겹이 된다.
        // 화면을 못 띄웠을 때만 소리 나는 채널로 폴백한다.
        val channel = when {
            !high -> CH_LOW
            shown -> CH_HIGH_SILENT
            else -> CH_HIGH
        }

        val n = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_guard)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(if (high) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(pi)
            .setAutoCancel(!high)
            .also { b ->
                if (high) {
                    b.setFullScreenIntent(pi, true)
                    // setOngoing은 Android 14+에서 무력화됐다 — 앱이 만드는 '못 지우는 알림'은
                    // 더 이상 존재하지 않는다(시스템·기기정책 알림만 해당).
                    // 그래서 마찰은 알림이 아니라 **화면(GuardAlertActivity)과 재발동 주기**가 진다.
                    // 밀어서 지워도 Override가 기록되지 않았으면 Level 4는 30분 뒤 다시 온다.
                    b.setOngoing(true)      // 12 이하에서는 여전히 유효하므로 남겨 둔다
                }
            }
            .build()

        // ④ 알림 발송 — 권한이 없으면 건너뛴다. **화면은 이미 떴다**(막지 않는다).
        val cp = canPost(ctx)
        val posted = cp && runCatching {
            NotificationManagerCompat.from(ctx).notify(ID_BASE + fireLevel, n)
            true
        }.getOrDefault(false)

        // 발동 흔적 — 무인 테스트에서 아침에 확인할 유일한 근거.
        runCatching { GuardSync.noteFire(ctx, fireLevel, shown, posted) }

        // ⑤ Level 4 검증 — **화면이 뜬 뒤에** 백그라운드로. 여기까지 오는 데 네트워크가 없다.
        // 승인이면 이미 뜬 화면을 올리고, 어떤 결과든 ai_used·ai_verdict를 기록에 싣는다
        // (ADR-024 ⑥ — 안 실으면 그 호출이 일일 상한에 안 세어져 통제 ③이 뚫린다).
        if (candidate4 && clientId != null) {
            val app = ctx.applicationContext
            Thread {
                // `attempt`는 못 받았을 때 **왜인지도** 들고 나온다 (T-31). 판정은 그대로다 —
                // 늘어나는 것은 기록뿐이다. 밖이 던지면 이유를 모르는 것이 사실이므로 비운다.
                val a = runCatching {
                    GuardVerify.attempt(app, clientId, cause, eventId, fgApp, snap)
                }.getOrNull() ?: GuardVerify.Attempt(null, null)
                val v = a.verdict
                // 판정을 아예 못 받았으면(오프라인·서버 무응답) 'unavailable' — 판정이 아니라
                // "부를 수 없었다"는 기록이다. 그래도 남겨야 그 밤을 나중에 읽을 수 있다.
                // **값의 모양은 그대로 두고 이유를 옆에 싣는다**(0016) — `ai_verdict`를 넓히면
                // 0010의 CHECK에 걸려 400이 되고, `flush()`가 그 발동 행을 통째로 버린다.
                runCatching {
                    GuardEventQueue.amendFire(
                        app, clientId,
                        level = if (v?.upgrades == true) 4 else null,
                        aiUsed = v?.aiUsed ?: 0,
                        aiVerdict = v?.aiVerdict ?: "unavailable",
                        unavailableReason = a.reason,
                        // 판정이 있을 때 **왜 그렇게 답했는지** (T-38). 서버가 늘 보내던 값인데
                        // 여기서 버려지고 있었다 — deny 열한 번의 사유가 그래서 없다.
                        aiReason = v?.aiReason,
                    )
                }
                if (v?.upgrades == true) {
                    // 격상 승인을 **화면과 무관하게** 먼저 남긴다 (ADR-035 ③).
                    // 아래 `upgradeToLevel4()`는 살아 있는 화면이 없으면 조용히 지나가고
                    // 마찰에 들어간 뒤면 `applyUpgrade`가 되돌아간다 — 그 성패로 구간을 정하면
                    // 차단이 영원히 안 걸린다. 기준은 **격상이 승인됐다**는 사실이다.
                    // 킬 스위치(`guard_ai_verify=off`)도 여기를 지난다: 서버가 결정론 복귀로
                    // `approved=true · level=4`를 답하므로 `upgrades`가 참이다(ADR-024 ⑤).
                    GuardLevel4.note(app)
                    // 화면이 안 떴으면 no-op다 — 배경에서 액티비티를 새로 띄우지 않는다.
                    runCatching { GuardAlertActivity.upgradeToLevel4() }
                }
            }.start()
        }

        return FireResult(posted = posted, shown = shown, canPost = cp, canOverlay = co)
    }

    /** '다른 앱 위에 표시' — 켜져 있으면 사용 중에도 개입 화면을 띄울 수 있다. */
    fun canOverlay(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    /** 보호 모드 상시 알림 — 켜져 있다는 사실 자체가 사전 서약의 표시(설계 §6.2). */
    fun showOngoing(ctx: Context, text: String): Boolean {
        ensureChannels(ctx)
        if (!canPost(ctx)) return false
        val n = NotificationCompat.Builder(ctx, CH_ONGOING)
            .setSmallIcon(R.drawable.ic_guard)
            .setContentTitle("보호 모드")
            .setContentText(text)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return runCatching {
            NotificationManagerCompat.from(ctx).notify(ID_ONGOING, n)
            true
        }.getOrDefault(false)
    }

    fun clearOngoing(ctx: Context) {
        runCatching { NotificationManagerCompat.from(ctx).cancel(ID_ONGOING) }
    }

    fun clear(ctx: Context, level: Int) {
        runCatching { NotificationManagerCompat.from(ctx).cancel(ID_BASE + level) }
    }
}
