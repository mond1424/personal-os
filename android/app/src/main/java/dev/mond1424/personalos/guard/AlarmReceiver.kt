package dev.mond1424.personalos.guard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 예약된 시각에 시스템이 깨우는 지점. **Guard의 실제 발동은 여기서 일어난다.**
 *
 * 앱이 죽어 있어도 시스템이 프로세스를 띄워 이걸 부른다 — 그게 알람의 계약이다.
 * 네트워크도, 서버도, 웹뷰도 필요 없다 (ADR-021).
 *
 * ⚠️ 리시버는 ~10초 안에 끝나야 한다. 여기서 네트워크를 부르지 않는다.
 *    알림 문구는 예약할 때 이미 확정해 저장해 뒀다.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        val id = intent.getIntExtra("id", -1)
        val level = intent.getIntExtra("level", 3)
        val title = intent.getStringExtra("title") ?: "Guard"
        val body = intent.getStringExtra("body") ?: ""
        val eventId = intent.getStringExtra("eventId")

        // 소비된 예약은 저장소에서 뺀다 — 재부팅 복구 때 과거 알람이 되살아나지 않게.
        if (id >= 0) GuardAlarmStore.remove(ctx, id)

        runCatching { GuardNotifications.fire(ctx, level, title, body, eventId) }
    }
}
