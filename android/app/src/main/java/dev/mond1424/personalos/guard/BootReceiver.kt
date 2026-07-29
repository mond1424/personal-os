package dev.mond1424.personalos.guard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 예약 복구.
 *
 * AlarmManager의 등록은 **재부팅과 앱 업데이트에서 지워진다.**
 * 이게 없으면 시험 전날 폰을 껐다 켜는 것만으로 그날 개입이 통째로 사라진다.
 * 실패가 조용해서 다음 날 아침에야 안다 — 1주차에 반드시 넣어야 하는 이유.
 *
 * ⚠️ 알려진 한계: BOOT_COMPLETED는 **첫 잠금 해제 후**에 온다.
 *    밤에 재부팅하고 아침까지 안 켜면 그 사이 예약은 복구되지 않는다.
 *    직접 부팅(LOCKED_BOOT_COMPLETED)까지 덮으려면 암호화 인식 저장소가 필요하다 — 9월 이후.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> runCatching { GuardAlarms.restoreAll(ctx) }
        }
    }
}
