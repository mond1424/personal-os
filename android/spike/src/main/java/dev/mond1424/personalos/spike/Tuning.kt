package dev.mond1424.personalos.spike

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// T-73 — 여덟 숫자를 "다시 유도한" 기록. 값을 옮겨 적은 것이 아니라, Compose 에서
// 그 값이 무엇에 해당하는지를 먼저 찾고, 해당하는 것이 없으면 없다고 적었다.
//
// 단위 분석이 먼저다. 웹은 CSS px 로 잰다. WebView 안에서 1 CSS px = 1 dp 다.
// 그래서 "레이아웃 상수"는 숫자가 그대로 넘어가고(dp 로 읽으면 된다),
// "제스처 상수"는 안 넘어간다 — 재는 주체가 브라우저 포인터 이벤트에서
// Compose 의 pointerInput 과 fling 스플라인으로 통째로 바뀌기 때문이다.
//
// 웹 여덟 개가 Compose 에서 어디로 갔나 (1차 유도):
//
//   AXIS_LOCK 20        없앴다. Compose 는 touchSlop 을 플랫폼이 준다
//                       (LocalViewConfiguration.touchSlop, 약 8dp).
//                       웹이 20 을 손으로 정한 이유는 브라우저가 슬롭을 안 주기 때문이다.
//                       Compose 에는 있으므로 "내가 정하지 않는 것"이 1차 답이다.
//                       ★ 8dp 는 20dp 보다 2.5배 예민하다 — 여기가 첫 관측점이다.
//
//   축비 1.9            해당하는 것이 없다. Compose 는 방향별 슬롭을 각각 재고
//                       먼저 넘은 축이 가져간다. 비율 판정이라는 개념 자체가 없다.
//
//   TRACK_RATIO 0.35    PagerDefaults.flingBehavior 의 snapPositionalThreshold 가
//                       같은 자리다. 기본값은 0.5.
//                       ★ 1차는 기본값을 그대로 쓴다 — 재려는 질문이
//                       "플랫폼 기본값이 웹 튜닝을 대신할 수 있는가"이기 때문이다.
//
//   FLICK 0.5 px/ms     해당하는 파라미터가 없다. Compose 는 속도를 임계로 안 쓰고
//                       decay 스플라인에 넣어 "어디까지 미끄러질지"를 계산한 뒤
//                       그 지점에서 가장 가까운 페이지로 스냅한다. 임계가 아니라 물리다.
//
//   CAL_GAP 20          넘어간다. 제스처가 아니라 레이아웃이고, 1 CSS px = 1 dp 다.
//                       pageSpacing = 20.dp.
//
//   STRETCH_MAX 90      셋 다 없앴다. Android 12 이상은 스크롤 컨테이너에
//   STRETCH_K 0.42      stretch overscroll 이 기본으로 붙는다. 웹의 세 값은
//   STRETCH_BACK_MS 460 그 네이티브 효과를 흉내 내려고 만든 것이다.
//                       ★ Compose 쪽 파라미터는 공개돼 있지 않다 — 맞추려면 끄고
//                       다시 만드는 수밖에 없다. 그게 필요한지가 관측 대상이다.

object Tuning {
    // 레이아웃 — CSS px 를 dp 로 읽는다
    val PANE_GAP = 20.dp        // CAL_GAP
    val ROW_H = 99.dp           // .cal-row height
    val CARD_RADIUS = 18.dp     // .calpane border-radius
    val WK_H = 27.dp            // .wkdays 높이 (padding 9 + 글자 + 5)

    // 셀 공간 예산 — 내용 모델이라 그대로 넘어간다
    const val CELL_MAX_LINES = 4
    const val CELL_EV_MAX = 2
    const val CELL_TK_MAX = 2

    const val MONTHS = 121      // 페이저 페이지 수
    const val CENTER = 60       // 가운데 = 이번 달
}

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
