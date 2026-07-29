package dev.mond1424.personalos.guard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 예약된 시각에 시스템이 깨우는 지점. **Guard의 실제 발동은 여기서 일어난다.**
 *
 * 앱이 죽어 있어도 시스템이 프로세스를 띄워 이걸 부른다 — 그게 알람의 계약이다.
 * 발동 경로에는 네트워크가 없다(ADR-021). 문구는 예약할 때 이미 확정해 저장해 뒀다.
 *
 * 두 가지 인텐트를 받는다:
 *   기본        → 개입 발동
 *   ACTION_SYNC → 하루 1회 재동기화 (여기만 네트워크를 탄다, 백그라운드 스레드로)
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == GuardAlarms.ACTION_SYNC) {
            handleSync(ctx)
            return
        }

        val id = intent.getIntExtra("id", -1)
        val level = intent.getIntExtra("level", 3)
        val title = intent.getStringExtra("title") ?: "Guard"
        val body = intent.getStringExtra("body") ?: ""
        val eventId = intent.getStringExtra("eventId")

        // 소비된 예약은 저장소에서 뺀다 — 재부팅 복구 때 과거 알람이 되살아나지 않게.
        if (id >= 0) GuardAlarmStore.remove(ctx, id)

        runCatching { GuardNotifications.fire(ctx, level, title, body, eventId) }
    }

    /**
     * onReceive는 ~10초 안에 끝나야 하고 메인 스레드에서 네트워크를 못 쓴다.
     * goAsync로 시간을 벌고 별도 스레드에서 돈다.
     */
    private fun handleSync(ctx: Context) {
        val pending = goAsync()
        val app = ctx.applicationContext
        Thread {
            try {
                runCatching { GuardSync.syncNow(app) }
            } finally {
                // 동기화가 실패해도 다음 예약은 GuardSync가 이미 걸어 뒀다.
                pending.finish()
            }
        }.start()
    }
}
