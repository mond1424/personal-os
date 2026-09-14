package dev.mond1424.personalos.spike

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

// ★★ 왕복 1 ② — 슬롭 A/B.
//
// 라운드 0 은 "슬롭을 넣을 자리가 없다"고 적었고 그건 **틀렸다.**
// LayoutNode.setCompositionLocalMap 이 CompositionLocalMap 에서 LocalViewConfiguration 을
// 꺼내 노드의 viewConfiguration 에 넣는다(바이트코드 확인). 제스처 감지기는 그 노드 값을 읽는다.
// 그래서 아래 한 겹이면 **HorizontalPager 를 그대로 둔 채** 슬롭만 바뀐다.
//
// ⚠️ 이것은 튜닝 패널이 아니다. 팔이 둘뿐인 스위치다 —
//    라운드 0 에서 슬라이더를 일부러 안 넣은 이유(왕복 수가 측정값이라서)는 그대로다.
private class SlopOverride(
    base: ViewConfiguration,
    private val slop: Float,
) : ViewConfiguration by base {
    override val touchSlop: Float get() = slop
}

private val TABS = listOf("오늘", "캘린더", "나")

@Composable
fun SpikeApp() {
    var webSlop by remember { mutableStateOf(false) }
    val platform = LocalViewConfiguration.current
    val density = LocalDensity.current
    val slopPx = with(density) { Tuning.WEB_AXIS_LOCK_AB_ARM.toPx() }
    val vc = remember(webSlop, platform, slopPx) {
        if (webSlop) SlopOverride(platform, slopPx) else platform
    }

    // ★ 주입 아래에서 읽는다 — 스위치가 실제로 닿았는지를 화면이 증명해야 한다.
    // (훑기의 0건에 "스캐너가 살아 있는가"를 먼저 묻는 것과 같은 자리다.)
    CompositionLocalProvider(LocalViewConfiguration provides vc) {
        Column(
            Modifier
                .fillMaxSize()
                .background(Ink.paper)
        ) {
            DiagBar(webSlop) { webSlop = !webSlop }

            // ★★ D1 — 바깥 가로 캐러셀. 이번 왕복에서 열었다.
            // 안쪽(달 넘기기)과 바깥(탭 전환)이 둘 다 가로라서 압력이 실제로 생긴다.
            // beyondViewportPageCount = 0 — 옆 탭을 미리 조립하지 않는다.
            // 그래야 "렉이 줄었나"(③)와 "중첩이 되나"(④)가 화면에서 안 섞인다.
            val tabs = rememberPagerState(initialPage = 1) { TABS.size }
            HorizontalPager(
                state = tabs,
                beyondViewportPageCount = 0,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            ) { page ->
                if (page == 1) CalendarScreen() else Placeholder(TABS[page])
            }
        }
    }
}

@Composable
private fun DiagBar(webSlop: Boolean, onToggle: () -> Unit) {
    val density = LocalDensity.current
    val slopDp = with(density) { LocalViewConfiguration.current.touchSlop.toDp() }
    var boxDp by remember { mutableFloatStateOf(0f) }

    Column(
        Modifier
            .fillMaxWidth()
            .background(Ink.body)
            .padding(horizontal = 14.dp, vertical = 6.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "슬롭 ${"%.1f".format(slopDp.value)}dp",
                style = boxedStyle(12f, 15f, FontWeight.Bold),
                color = Ink.ink,
            )
            Spacer(Modifier.width(10.dp))
            Text(
                if (webSlop) "웹 값(20) 팔" else "플랫폼 팔",
                style = boxedStyle(11f, 14f),
                color = Ink.sub,
            )
            Spacer(Modifier.weight(1f))
            Text(
                if (webSlop) "→ 플랫폼으로" else "→ 웹 20 으로",
                style = boxedStyle(11.5f, 14f, FontWeight.Bold),
                color = Ink.paper,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Ink.ink)
                    .clickable { onToggle() }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        Spacer(Modifier.padding(top = 3.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 이 한 글자가 셀 글줄과 **같은 스타일**로 그려진다. 재는 대상이 곧 쓰이는 것이다.
            Text(
                "일정",
                style = boxedStyle(Tuning.EV_FONT, Tuning.EV_LINE),
                color = Ink.ink,
                onTextLayout = { r -> boxDp = with(density) { r.size.height.toDp().value } },
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "줄상자 ${"%.1f".format(boxDp)}dp · 목표 ${Tuning.EV_LINE}",
                style = boxedStyle(10.5f, 13f),
                color = Ink.faint,
            )
        }
    }
}

@Composable
private fun Placeholder(name: String) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Ink.paper),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$name — 스파이크엔 없는 화면.\n바깥 탭 캐러셀이 살아 있다는 것만 보인다.",
            style = boxedStyle(13f, 20f),
            color = Ink.faint,
        )
    }
}
