package dev.mond1424.personalos.guard

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * 개입 화면이 직접 내는 소리·진동.
 *
 * 왜 알림 채널이 아니라 여기인가:
 *   ① 채널 설정은 생성 뒤 못 바꾼다 → 설정에서 끄고 켤 수 없다
 *   ② 채널은 벨소리 모드를 무시한다(알람 카테고리) → 무음/진동 대응 불가
 *   ③ 채널 소리는 POST_NOTIFICATIONS에 묶인다 → 알림 권한이 풀리면 조용해진다
 *
 * 화면(Activity)이 소리의 주인이 되면 셋 다 풀린다.
 * 대신 **화면이 안 뜨는 경우**(오버레이 없음 + 화면 깨어 있음)에는 소리도 없으므로,
 * 그때만 소리 나는 알림 채널로 폴백한다 — GuardNotifications.fire() 참조.
 */
object GuardAlarmPlayer {

    /** 무한히 울리게 두지 않는다. 배터리·이웃·제정신. 마찰은 재발동 주기가 진다. */
    private const val MAX_MS = 3 * 60 * 1000L

    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val stopper = Handler(Looper.getMainLooper())

    @Synchronized
    fun start(ctx: Context, level: Int) {
        stop()
        val plan = GuardAlertPolicy.plan(ctx, level)
        if (plan.sound) startSound(ctx)
        if (plan.vibrate) startVibration(ctx)
        if (!plan.silentScreenOnly) stopper.postDelayed({ stop() }, MAX_MS)
    }

    @Synchronized
    fun stop() {
        stopper.removeCallbacksAndMessages(null)
        runCatching { player?.stop() }
        runCatching { player?.release() }
        player = null
        runCatching { vibrator?.cancel() }
        vibrator = null
    }

    private fun startSound(ctx: Context) {
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            ?: return
        runCatching {
            player = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)   // 알람 볼륨 · 미디어와 분리
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                setDataSource(ctx, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { player = null }
    }

    private fun startVibration(ctx: Context) {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        } ?: return
        vibrator = v

        val pattern = longArrayOf(0, 500, 250, 500, 250, 500, 1000)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, 0))   // 0 = 처음부터 반복
            } else {
                @Suppress("DEPRECATION")
                v.vibrate(pattern, 0)
            }
        }
    }
}
