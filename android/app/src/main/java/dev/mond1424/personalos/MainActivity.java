package dev.mond1424.personalos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import dev.mond1424.personalos.guard.GuardPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GuardPlugin.class);   // super.onCreate 前에 등록해야 한다
        super.onCreate(savedInstanceState);
    }
}
