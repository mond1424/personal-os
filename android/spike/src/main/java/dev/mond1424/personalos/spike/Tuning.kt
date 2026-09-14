package dev.mond1424.personalos.spike

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

// T-73 — 여덟 숫자를 "다시 유도한" 기록. 값을 옮겨 적은 것이 아니라, Compose 에서
// 그 값이 무엇에 해당하는지를 먼저 찾고, 해당하는 것이 없으면 없다고 적었다.
//
// 단위 분석 — ★ 왕복 1 에서 칸이 둘에서 셋으로 늘었다:
//
//   레이아웃  넘어간다        1 CSS px = 1 dp. 순수한 기하는 숫자가 그대로다
//   제스처    안 넘어간다     재는 주체가 브라우저 포인터에서 pointerInput 과 fling 스플라인으로 바뀐다
// ★ 텍스트    레이아웃인데 안 넘어간다   줄 상자 높이를 폰트가 정하고, 폰트는 플랫폼 소유다
//                                        (TextBox.kt 참조 — 글자 있는 모든 화면에 걸린다)
//
// 웹 여덟 개가 Compose 에서 어디로 갔나:
//
//   AXIS_LOCK 20        LocalViewConfiguration.touchSlop.
//                       ★★ 왕복 1 정정 — 라운드 0 은 "값을 넣을 자리가 없다"고 적었는데 **틀렸다.**
//                       LayoutNode.setCompositionLocalMap 이 CompositionLocalMap 에서
//                       LocalViewConfiguration 을 꺼내 노드에 넣는다. 그래서
//                       CompositionLocalProvider 로 주입되고, HorizontalPager 를 안 버려도 된다.
//                       (읽는 곳만 보고 멈추면 반대로 읽힌다 — 함정 18.)
//
//   축비 1.9            해당하는 것이 없다. Compose 는 방향별 슬롭을 각각 재고
//                       먼저 넘은 축이 가져간다. 비율 판정이라는 개념 자체가 없다.
//
//   TRACK_RATIO 0.35    PagerDefaults.flingBehavior 의 snapPositionalThreshold 가
//                       같은 자리다. 기본값은 0.5(바이트코드 확인).
//                       1차는 기본값을 그대로 쓴다 — 재려는 질문이
//                       "플랫폼 기본값이 웹 튜닝을 대신할 수 있는가"이기 때문이다.
//
//   FLICK 0.5 px/ms     해당하는 파라미터가 없다. Compose 는 속도를 임계로 안 쓰고
//                       decay 스플라인에 넣어 "어디까지 미끄러질지"를 계산한 뒤
//                       그 지점에서 가장 가까운 페이지로 스냅한다. 임계가 아니라 물리다.
//
//   CAL_GAP 20          넘어간다. 제스처가 아니라 레이아웃이고, 1 CSS px = 1 dp 다.
//
//   STRETCH_MAX 90      셋 다 없앴다. Android 12 이상은 스크롤 컨테이너에
//   STRETCH_K 0.42      stretch overscroll 이 기본으로 붙는다. 웹의 세 값은
//   STRETCH_BACK_MS 460 그 네이티브 효과를 흉내 내려고 만든 것이다.
//                       Compose 쪽 파라미터는 공개돼 있지 않다(OverscrollConfiguration 에
//                       glowColor 와 drawPadding 뿐 — 바이트코드 확인).
//                       LocalOverscrollFactory 로 통째 교체는 공개돼 있다.

object Tuning {
    // 레이아웃 — CSS px 를 dp 로 읽는다
    val PANE_GAP = 20.dp        // CAL_GAP
    val ROW_H = 99.dp           // .cal-row height
    val CARD_RADIUS = 18.dp     // .calpane border-radius
    val WK_H = 27.dp            // .wkdays 높이 (padding 9 + 글자 + 5)

    // 셀 글줄 상자 — ★ 가정이 아니라 계산이다(TextBox.kt).
    // 웹: font 9px · line-height 1.3 · padding 1px/1.5px · margin-top 2.5px
    const val EV_FONT = 9f
    const val EV_LINE = 11.7f              // 9 * 1.3 — 줄 상자 높이를 우리가 못 박는다
    val EV_PAD_T = 1.dp
    val EV_PAD_B = 1.5.dp
    val EV_GAP = 2.5.dp
    val EV_ROW = EV_LINE.dp + EV_PAD_T + EV_PAD_B   // 14.2dp — 유도된 값

    // 날짜 숫자
    const val D_FONT = 10.5f
    const val D_LINE = 12f

    // 셀 공간 예산 — 내용 모델이라 그대로 넘어간다
    const val CELL_MAX_LINES = 4
    const val CELL_EV_MAX = 2
    const val CELL_TK_MAX = 2

    const val MONTHS = 121      // 페이저 페이지 수
    const val CENTER = 60       // 가운데 = 이번 달

    // ★ D1 — 가장자리 손넘김. 웹의 SWIPE_EDGE_RATIO 와 같은 뜻이다.
    // 폭의 비율이라 단위 분석상 '레이아웃'이고 숫자가 넘어간다.
    const val EDGE_RATIO = 0.2f

    // ★★ A/B 실험 전용 — 유도된 값이 아니다.
    // 사용자가 왕복 1 에서 "웹 값을 강제로 넣은 것과 번갈아 만지게 하라"고 지시한 그 값.
    // 제품 상수로 읽으면 안 된다. 토글의 한쪽 팔이다.
    val WEB_AXIS_LOCK_AB_ARM = 20.dp
}

// 글자 크기를 sp 가 아니라 dp 에서 뽑는다.
// 웹은 WebView 안 CSS px 이라 시스템 글꼴 배율을 안 탄다. Compose 의 sp 는 탄다.
// 배율이 1이 아닌 폰에서 둘을 비교하면 "제스처가 다른 것"과 "글자가 큰 것"이 화면에서 섞인다.
@Composable
fun dpSp(v: Float) = with(LocalDensity.current) { v.dp.toSp() }

// 색 — public/style.css 의 라이트 팔레트. 스파이크는 라이트만 본다(다크는 측정 대상 밖).
object Ink {
    val paper = Color(0xFFFBFAF7)
    val card = Color(0xFFFFFFFF)
    val ink = Color(0xFF26221C)
    val sub = Color(0xFF787164)
    val faint = Color(0xFFA9A296)
    val line = Color(0xFFE7E2D8)
    val body = Color(0xFFE9E5DC)
    val mint = Color(0xFF7ED4A9)
    val amber = Color(0xFFF3C05F)
    val brick = Color(0xFFC4401F)
    val lav = Color(0xFFB9A5EC)
    val sun = Color(0xFFCC7777)
    val cellLine = Color(0x0A26221C)
    val calDim = Color(0xB8FBFAF7)   // 다른 달 날짜를 덮는 흐림 (cal-dim, 0.72)
}
