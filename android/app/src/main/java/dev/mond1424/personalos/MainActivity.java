package dev.mond1424.personalos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.mond1424.personalos.cal.CalPlugin;
import dev.mond1424.personalos.guard.GuardPlugin;
import dev.mond1424.personalos.widget.WidgetPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GuardPlugin.class);   // super.onCreate 前에 등록해야 한다
        // T-48 — 웹이 만든 마감 요약 문장을 위젯에 건네는 다리. 등록을 빼면 `Capacitor.Plugins.Widget`이
        // 없어 웹이 조용히 건너뛰고(폴백), 위젯은 요약도 값도 못 받은 채 빈 눈금으로 남는다.
        registerPlugin(WidgetPlugin.class);
        // T-53 — 폰 캘린더 읽기. 등록을 빼면 `Capacitor.Plugins.Cal`이 없어 웹이 폴백하고,
        // 권한 유도도 대상 선택도 화면에 아예 안 뜬다(위 Widget과 같은 실패 모양).
        registerPlugin(CalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
