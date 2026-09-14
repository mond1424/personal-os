package dev.mond1424.personalos.spike

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle

// ★★ 왕복 1 — 단위 분석의 셋째 칸.
//
// 라운드 0 에서 "1 CSS px = 1 dp 니까 레이아웃 상수는 넘어간다"고 적었다. 반만 맞았다.
// 실측이 셋째 칸을 만들었다:
//
//     레이아웃  넘어간다        (gap · 반지름 · 행 높이 — 순수한 기하)
//     제스처    안 넘어간다     (슬롭 · 임계 · 감쇠 — 재는 주체가 다르다)
//   ★ 텍스트    레이아웃인데 안 넘어간다
//
// 왜냐하면 **줄 상자의 높이를 폰트가 정하기 때문**이다. 그리고 폰트는 플랫폼 소유다.
//
//   CSS        line-height:1.3 이 줄 상자를 1.3em 으로 **강제한다.**
//              폰트가 무엇이든 상자 높이는 같고, 넘치는 글리프는 그냥 넘쳐 그려진다.
//   Compose    lineHeight 를 안 주면 줄 상자 = 그 폰트의 ascent+descent+leading 이다.
//              한글 폴백 폰트는 이 값이 크다. 9dp 글자가 13dp 넘는 상자를 요구한다.
//
// 그래서 CSS 산술로 계산한 14.2dp 짜리 칸에 넣으면 **아래가 잘린다.**
// 오프셋으로 밀어 올리는 것은 고치는 게 아니다 — 폰트가 바뀌거나 배율이 바뀌면 다시 깨진다.
//
// ⚠️ 사용자 가설(includeFontPadding)은 **아니었다.** 아티팩트가 답했다:
//    androidx.compose.ui.text.AndroidTextStyle_androidKt.DefaultIncludeFontPadding
//    → ConstantValue: int 0. Compose 1.8 에서 이미 꺼져 있다.
//    그래도 아래에서 명시적으로 false 를 박는다 — 이 값은 Compose 버전에 따라 바뀐 이력이 있고,
//    "플랫폼이 알아서 하는 값"에 기대는 것이 이 칸이 생긴 이유이기 때문이다.
//
// ★ 고치는 법(오프셋이 아니다): 줄 상자를 **우리가 선언한다.**
//    lineHeight 로 높이를 못 박고, LineHeightStyle 로 그 안에서 글리프를 가운데 둔다.
//    이것이 CSS 의 half-leading 과 같은 모델이고, 폰트가 무엇이든 상자 높이가 같다.

@OptIn(ExperimentalTextApi::class)
private val NoFontPadding = PlatformTextStyle(includeFontPadding = false)

// 줄 상자 높이가 lineDp 로 확정되는 스타일. 폰트 메트릭이 상자를 못 키운다.
@Composable
fun boxedStyle(
    fontDp: Float,
    lineDp: Float,
    weight: FontWeight = FontWeight.Normal,
): TextStyle = TextStyle(
    fontSize = dpSp(fontDp),
    lineHeight = dpSp(lineDp),
    fontWeight = weight,
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.None,
    ),
    platformStyle = NoFontPadding,
)
