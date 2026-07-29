package dev.mond1424.personalos.guard

import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.mond1424.personalos.R

/**
 * 상시 서비스.
 *
 * 목적이 둘인데 **무게는 두 번째에 있다**:
 *   ① 감지 — 화면 on/off와 전면 앱을 표본으로 남긴다(§6.6 판단 입력)
 *   ② **생존** — 상시 알림을 띄운 포그라운드 서비스는 최근 앱에서 밀어 종료해도
 *      대부분의 OEM에서 프로세스가 살아남는다. 1주차에 스와이프 종료로 알람이
 *      통째로 죽는 것을 겪었고, 그게 이 서비스를 앞당긴 실제 이유다.
 *
 * 감지 자체는 ADR-018·021상 **보조 입력**이다 — 이 서비스가 죽어도 Guard는 돈다.
 * 보호 규칙은 시각으로 예측되고 알람은 시스템이 들고 있다.
 */
class GuardService : Service() {

    companion object {
        const val ACTION_START = "dev.mond1424.personalos.GUARD_SERVICE_START"

        /** onTaskRemoved 되살리기용 PendingIntent id. Guard 알람 구간과 겹치지 않게. */
        private const val RESTART_ID = 8100

        /** 화면이 켜져 있을 때만 표본을 뜬다. 꺼져 있으면 전면 앱이라는 개념이 없다. */
        private const val POLL_MS = 60_000L

        fun start(ctx: Context) {
            runCatching {
                val i = Intent(ctx, GuardService::class.java).setAction(ACTION_START)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
                else ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            runCatching { ctx.stopService(Intent(ctx, GuardService::class.java)) }
        }
    }

    private val handler = Handler(Looper.getMainLooper())
    private var screenOn = true

    /**
     * 화면 on/off는 **매니페스트에 선언할 수 없다** — 런타임 등록만 받는다.
     * 그래서 서비스가 살아 있어야 이 신호를 얻는다.
     */
    private val screenRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            when (i.action) {
                Intent.ACTION_SCREEN_ON -> { screenOn = true; GuardActivityLog.note(c, "screen_on", null); schedulePoll() }
                Intent.ACTION_SCREEN_OFF -> { screenOn = false; GuardActivityLog.note(c, "screen_off", null) }
                Intent.ACTION_USER_PRESENT -> GuardActivityLog.note(c, "unlock", null)
            }
        }
    }

    private val poll = object : Runnable {
        override fun run() {
            if (screenOn) {
                runCatching {
                    UsageProbe.currentApp(applicationContext)?.let {
                        GuardActivityLog.note(applicationContext, "app", it)
                    }
                }
                handler.postDelayed(this, POLL_MS)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        GuardNotifications.ensureChannels(this)
        // targetSdk 34+는 registerReceiver에 exported 플래그를 요구한다.
        // 화면 on/off는 시스템 보호 브로드캐스트라 면제 대상이지만 명시가 안전하다.
        // ContextCompat이 버전 분기를 흡수한다.
        ContextCompat.registerReceiver(
            this,
            screenRx,
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_USER_PRESENT)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        schedulePoll()
        // 죽어도 시스템이 되살린다. 생존이 이 서비스의 절반이다.
        return START_STICKY
    }

    private fun schedulePoll() {
        handler.removeCallbacks(poll)
        handler.post(poll)
    }

    private fun goForeground() {
        val n: Notification = NotificationCompat.Builder(this, GuardNotifications.CH_ONGOING)
            .setSmallIcon(R.drawable.ic_guard)
            .setContentTitle("Guard")
            .setContentText("지켜보는 중")
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(
                    GuardNotifications.ID_ONGOING, n,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
                )
            } else {
                startForeground(GuardNotifications.ID_ONGOING, n)
            }
        }
    }

    /**
     * 최근 앱에서 밀어 종료했을 때. **여기가 실측으로 드러난 구멍이었다.**
     *
     * `START_STICKY`만으로는 부족하다 — 제조사가 스와이프 종료를 강제 종료에 가깝게
     * 다루면 시스템이 되살려 주지 않는다. 몇 초 뒤로 알람을 걸어 직접 되살린다.
     *
     * 감지 표본이 끊기는 것보다, 상시 알림이 사라져 '지켜보고 있다'는 표시가
     * 없어지는 쪽이 더 크다 — 설계 §6.2의 사전 서약은 보여야 작동한다.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        runCatching {
            val am = getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
            val pi = android.app.PendingIntent.getService(
                this, RESTART_ID,
                Intent(this, GuardService::class.java).setAction(ACTION_START),
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            am.setExactAndAllowWhileIdle(
                android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 3_000, pi,
            )
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(poll)
        runCatching { unregisterReceiver(screenRx) }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
