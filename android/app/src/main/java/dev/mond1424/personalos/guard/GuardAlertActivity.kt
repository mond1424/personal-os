package dev.mond1424.personalos.guard

import android.app.Activity
import android.app.KeyguardManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationManagerCompat
import dev.mond1424.personalos.R

/**
 * FSI가 띄우는 화면 — 잠긴 화면 위에 그대로 뜬다.
 *
 * S1.2에서는 '보이는가'만 확인한다. 버튼은 닫기 하나뿐이다.
 * S3.2에서 여기에 Override 마찰(사유 20자 + 대기 타이머)이 들어간다 —
 * 그때 [닫기]는 [사유 적고 넘어가기]로 바뀌고 대기 시간이 붙는다.
 *
 * ⚠️ 잠금화면 위 표시는 매니페스트 속성과 코드 호출이 **둘 다** 필요하다.
 *    한쪽만 하면 기기·버전에 따라 조용히 안 뜬다.
 */
class GuardAlertActivity : Activity() {

    companion object {
        const val EX_LEVEL = "level"
        const val EX_TITLE = "title"
        const val EX_BODY = "body"
        const val EX_EVENT = "event_id"
        const val EX_NOTIF_ID = "notif_id"
        const val EX_CLIENT_ID = "client_id"
    }

    private var notifId = -1
    private var clientId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        blockBackGesture()
        setContentView(R.layout.activity_guard_alert)

        val level = intent.getIntExtra(EX_LEVEL, 3)
        val title = intent.getStringExtra(EX_TITLE) ?: "Guard"
        val body = intent.getStringExtra(EX_BODY) ?: ""
        notifId = intent.getIntExtra(EX_NOTIF_ID, -1)
        clientId = intent.getStringExtra(EX_CLIENT_ID)

        findViewById<TextView>(R.id.guard_level).text = "LEVEL $level"
        findViewById<TextView>(R.id.guard_title).text = title
        findViewById<TextView>(R.id.guard_body).text = body

        findViewById<Button>(R.id.guard_dismiss).setOnClickListener { dismiss() }

        // 소리·진동의 주인은 화면이다 — 설정과 벨소리 모드를 따르려면 채널이 아니라 여기여야 한다.
        if (level >= 3) GuardAlarmPlayer.start(this, level)
    }

    // onPause에서 멈추지 않는다.
    // 전원 버튼으로 화면을 끄거나 홈으로 나가는 것만으로 소리가 멎으면
    // 그게 0마찰 Override가 된다(설계 §6.3). 알람 시계가 그러지 않는 것과 같은 이유다.
    // 멈추는 경로는 둘뿐: [닫기]와 3분 상한(GuardAlarmPlayer.MAX_MS).

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            // 잠금은 풀지 않는다 — 화면 위에 뜨기만 하면 된다.
            // requestDismissKeyguard를 부르면 생체인증 프롬프트가 떠 오히려 방해가 된다.
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    /**
     * S1.2 시점의 [닫기]는 'accepted'로 기록한다.
     * S3.2에서 여기가 갈린다 — [지금 자기]=accepted / [사유 적고 계속]=override(사유 20자 + 대기).
     * 아무것도 안 하고 3분 상한이 지나면 서버가 'ignored'로 확정한다.
     */
    private fun dismiss() {
        GuardAlarmPlayer.stop()
        clientId?.let { cid ->
            runCatching { GuardEventQueue.recordReaction(this, cid, "accepted", null) }
            // 밀어 올리기는 백그라운드로. 실패해도 큐에 남아 다음 동기화에 간다.
            val app = applicationContext
            Thread { runCatching { GuardEventQueue.flush(app) } }.start()
        }
        if (notifId >= 0) runCatching { NotificationManagerCompat.from(this).cancel(notifId) }
        finish()
    }

    /**
     * 뒤로 가기로는 못 닫는다 — 마찰의 최소치(설계 §6.3).
     *
     * ⚠️ targetSdk 35+는 **예측형 뒤로가기가 기본 활성**이라 onBackPressed()가 아예 안 불린다.
     *    (targetSdk 36을 쓰고 있다.) API 33+는 OnBackInvokedDispatcher로 막아야 한다.
     *    둘 다 둬야 구버전·신버전 모두 막힌다.
     */
    // Any?로 들고 있는다 — OnBackInvokedCallback은 API 33 클래스라
    // 필드 타입으로 쓰면 구버전에서 클래스 검증 시 문제가 될 수 있다.
    // 등록·해제 시점에만 버전 가드 안에서 캐스팅한다.
    private var blockBack: Any? = null

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun registerBackBlock() {
        val cb = OnBackInvokedCallback { /* 아무것도 하지 않는다 */ }
        blockBack = cb
        onBackInvokedDispatcher.registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_OVERLAY, cb,
        )
    }

    private fun blockBackGesture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) registerBackBlock()
    }

    override fun onDestroy() {
        GuardAlarmPlayer.stop()   // 화면이 죽으면 소리도 죽는다 — 누수 방지
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            (blockBack as? OnBackInvokedCallback)?.let {
                runCatching { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
            }
        }
        super.onDestroy()
    }

    @Suppress("DEPRECATION", "MissingSuperCall")
    override fun onBackPressed() {
        // API 32 이하 경로. 의도적으로 비워 둔다.
    }
}
