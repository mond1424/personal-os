package dev.mond1424.personalos.guard

import android.app.Activity
import android.app.KeyguardManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationManagerCompat
import dev.mond1424.personalos.R

/**
 * FSI가 띄우는 화면 — 잠긴 화면 위에 그대로 뜬다. **개입의 본체**다.
 *
 * 설계 §6.3 — Override는 금지가 아니라 마찰:
 *   [알겠습니다]        직접 마찰 없음. accepted + 계속 사용 시 5분 뒤 재확인
 *   [그래도 계속하기]   눌러야 마찰이 드러난다 → 사유 + 대기 → override
 *
 * 마찰을 처음부터 보이지 않는 이유: 나란히 두면 대등한 선택지로 읽힌다.
 * 한 번 더 누르게 하는 것 자체가 마찰의 일부다.
 *
 * 대기 시간은 Level과 모드가 정한다 — L3 60초 · L4 180초 × friction_mult(ADR-019).
 * secretary 모드는 배수가 0이라 마찰이 사라진다.
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

        // 사유 **길이 제한은 두지 않는다.** 20자 하한은 마찰이 아니라 강제로 읽혔다.
        // §6.3이 원하는 것은 "비용을 치르게 한다"이지 "분량을 채우게 한다"가 아니다.
        // 비어 있지만 않으면 된다 — 사유가 남아야 §6.5의 데이터가 되므로 그 선만 지킨다.

        /** 기본 대기 초. 모드의 friction_mult가 곱해진다. */
        private const val WAIT_L3 = 60
        private const val WAIT_L4 = 180

        /**
         * 지금 떠 있는 화면 — Level 4 격상을 받을 대상 (T-04 · ADR-024).
         *
         * 왜 Intent가 아니라 참조인가: 배경 스레드에서 `startActivity`를 부르면
         * ① 화면이 안 떠 있던 경우 **없던 화면이 갑자기 뜨고**(오버레이 권한이 없어 못 띄운
         * 상황인데도) ② Android 10+의 백그라운드 액티비티 시작 제한에 걸린다.
         * 살아 있는 화면이 없으면 **아무 일도 일어나지 않는 것**이 맞다.
         *
         * WeakReference + onDestroy 해제 — 화면이 죽은 뒤 참조가 남지 않게.
         */
        private var live: java.lang.ref.WeakReference<GuardAlertActivity>? = null

        /** 승인이 왔을 때 호출. 떠 있는 화면이 없으면 조용히 지나간다. */
        fun upgradeToLevel4() {
            val a = live?.get() ?: return
            a.runOnUiThread { runCatching { a.applyUpgrade(4) } }
        }
    }

    private var notifId = -1
    private var clientId: String? = null
    private var level = 3
    private var waitLeft = 0
    private val ticker = Handler(Looper.getMainLooper())

    /** 마찰 화면에 들어갔는가 — 들어간 뒤에는 격상하지 않는다(아래 applyUpgrade). */
    private var frictionEntered = false

    /** 이번 Level의 대기 초. 격상되면 다시 계산된다. */
    private var waitSec = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        live = java.lang.ref.WeakReference(this)
        showOverLockScreen()
        blockBackGesture()
        setContentView(R.layout.activity_guard_alert)

        level = intent.getIntExtra(EX_LEVEL, 3)
        notifId = intent.getIntExtra(EX_NOTIF_ID, -1)
        clientId = intent.getStringExtra(EX_CLIENT_ID)

        findViewById<TextView>(R.id.guard_level).text = "LEVEL $level"
        findViewById<TextView>(R.id.guard_title).text = intent.getStringExtra(EX_TITLE) ?: "Guard"
        findViewById<TextView>(R.id.guard_body).text = intent.getStringExtra(EX_BODY) ?: ""

        bindFriction()

        // 소리·진동의 주인은 화면이다 — 설정과 벨소리 모드를 따르려면 채널이 아니라 여기여야 한다.
        if (level >= 3) GuardAlarmPlayer.start(this, level)
    }

    // ── Override 마찰 (§6.3) ─────────────────────────────────

    private fun bindFriction() {
        val accept = findViewById<Button>(R.id.guard_accept)
        val openBtn = findViewById<Button>(R.id.guard_override_open)
        val friction = findViewById<View>(R.id.guard_friction)
        val reason = findViewById<EditText>(R.id.guard_reason)
        val count = findViewById<TextView>(R.id.guard_reason_count)
        val go = findViewById<Button>(R.id.guard_override_go)
        val note = findViewById<TextView>(R.id.guard_wait_note)

        accept.setOnClickListener {
            finishWith("accepted", null)
            GuardRecheck.arm(this, level)
        }

        // Level 1~2는 마찰이 없다 — 알림·맥락 경고일 뿐 개입이 아니다(§6.1).
        waitSec = waitSecFor(level)
        if (level < 3) {
            openBtn.visibility = View.GONE
            accept.text = "확인"
            return
        }

        openBtn.setOnClickListener {
            // 여기부터는 격상하지 않는다 — 사용자가 이미 대가를 치르기 시작했다.
            // 사유를 쓰는 중에 대기가 60초에서 180초로 늘면 그건 마찰이 아니라 배신이다.
            frictionEntered = true
            // 마찰 화면에 들어오면 소리·진동을 끈다.
            // 울리는 채로는 사유를 쓸 수 없고, 그건 마찰이 아니라 소음이다.
            // 우회로가 되지도 않는다 — 화면은 그대로 남고 반응이 기록되기 전까진 끝난 게 아니다.
            GuardAlarmPlayer.stop()
            openBtn.visibility = View.GONE
            friction.visibility = View.VISIBLE
            reason.requestFocus()
            startWait(waitSec, go, note, reason)
        }

        reason.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val n = s?.toString()?.trim()?.length ?: 0
                count.text = if (n > 0) "${n}자" else ""
                refreshGo(go, reason)
            }
        })

        go.setOnClickListener {
            val text = reason.text.toString().trim()
            if (text.isEmpty() || waitLeft > 0) return@setOnClickListener
            finishWith("override", text)
        }
    }

    private fun waitSecFor(lv: Int): Int {
        val mult = GuardSync.frictionMult(this)
        return when {
            lv >= 4 -> (WAIT_L4 * mult).toInt()
            lv == 3 -> (WAIT_L3 * mult).toInt()
            else -> 0
        }
    }

    /**
     * Level 4 격상 — 검증이 승인했을 때 서버 응답을 받고 호출된다 (T-04 · ADR-024).
     *
     * **마찰에 들어간 뒤에는 올리지 않는다.** 사유를 쓰고 있는데 대기가 늘면 배신이다.
     * 그 경우 개입은 Level 3으로 끝나고, 기록에도 3으로 남는다 — 실제로 그렇게 개입했으므로 맞다.
     *
     * 격상된 Level의 재생 정책을 적용하기 위해 플레이어를 다시 시작한다.
     * `start()`가 내부에서 `stop()`을 먼저 부르므로 두 번 겹치지 않는다.
     */
    private fun applyUpgrade(newLevel: Int) {
        if (newLevel <= level || frictionEntered || isFinishing || isDestroyed) return
        level = newLevel
        waitSec = waitSecFor(level)
        findViewById<TextView>(R.id.guard_level).text = "LEVEL $level"
        GuardAlarmPlayer.start(this, level)
    }

    /**
     * 대기는 **사유 입력과 동시에** 흐른다.
     * 순차로 두면 "사유 다 쓰고 나서 또 기다려"가 되어 마찰이 아니라 짜증이 된다.
     * §6.3의 목적은 이탈을 부르지 않는 선에서 잠깐 멈춰 세우는 것이다.
     */
    private fun startWait(sec: Int, go: Button, note: TextView, reason: EditText) {
        waitLeft = sec
        if (sec <= 0) { note.text = ""; refreshGo(go, reason); return }
        ticker.post(object : Runnable {
            override fun run() {
                if (isFinishing || isDestroyed) return
                note.text = if (waitLeft > 0) "${waitLeft}초 뒤에 넘어갈 수 있어요" else "이제 넘어갈 수 있어요"
                refreshGo(go, reason)
                if (waitLeft > 0) { waitLeft--; ticker.postDelayed(this, 1000) }
            }
        })
    }

    private fun refreshGo(go: Button, reason: EditText) {
        go.isEnabled = reason.text.toString().trim().isNotEmpty() && waitLeft <= 0
        go.alpha = if (go.isEnabled) 1f else 0.45f
    }

    /** 반응을 로컬에 먼저 남기고(ADR-023) 밀어 올리기는 백그라운드로. */
    private fun finishWith(reaction: String, reason: String?) {
        GuardAlarmPlayer.stop()
        ticker.removeCallbacksAndMessages(null)
        clientId?.let { cid ->
            runCatching { GuardEventQueue.recordReaction(this, cid, reaction, reason) }
            val app = applicationContext
            Thread { runCatching { GuardEventQueue.flush(app) } }.start()
        }
        if (notifId >= 0) runCatching { NotificationManagerCompat.from(this).cancel(notifId) }
        finish()
    }

    // onPause에서 소리를 멈추지 않는다.
    // 전원 버튼으로 화면을 끄거나 홈으로 나가는 것만으로 소리가 멎으면
    // 그게 0마찰 Override가 된다(§6.3). 알람 시계가 그러지 않는 것과 같은 이유다.
    // 멈추는 경로는 둘뿐: 명시적 선택(finishWith)과 3분 상한(GuardAlarmPlayer.MAX_MS).

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
        // 격상 대상에서 뺀다 — 죽은 화면에 올려 봐야 아무 일도 안 일어나지만,
        // 다음 발동이 이 참조를 덮기 전까지 남아 있을 이유가 없다.
        if (live?.get() === this) live = null
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
