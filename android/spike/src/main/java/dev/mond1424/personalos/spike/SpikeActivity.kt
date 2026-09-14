package dev.mond1424.personalos.spike

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// T-73 스파이크 진입점. 지금 쓰는 앱과 applicationId 가 다르므로 폰에 따로 깔린다.
class SpikeActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(
                colorScheme = lightColorScheme(
                    surface = Ink.card,
                    background = Ink.paper,
                    onSurface = Ink.ink,
                )
            ) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Ink.body),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .widthIn(max = 402.dp)
                            .fillMaxSize()
                            .background(Ink.paper)
                            .safeDrawingPadding()
                    ) {
                        SpikeApp()
                    }
                }
            }
        }
    }
}
