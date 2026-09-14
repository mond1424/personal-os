package dev.mond1424.personalos.spike

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.min

// 달 그리드는 항상 6주. 실제 주 수는 4에서 6주로 들쭉날쭉해서, 옆으로 미는 전환은
// 높이가 일정해야 성립한다(웹과 같은 이유).
private const val WEEKS_IN_GRID = 6

fun weeksOf(ym: YearMonth): List<List<LocalDate>> {
    val first = ym.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value % 7).toLong())
    return (0 until WEEKS_IN_GRID).map { w ->
        (0 until 7).map { i -> start.plusDays((w * 7 + i).toLong()) }
    }
}

private val WKDAYS = listOf("일", "월", "화", "수", "목", "금", "토")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen() {
    val base = remember { YearMonth.from(Fixture.today) }
    val pagerState = rememberPagerState(initialPage = Tuning.CENTER) { Tuning.MONTHS }
    val scope = rememberCoroutineScope()
    var sheetDate by remember { mutableStateOf<LocalDate?>(null) }
    var innerEnabled by remember { mutableStateOf(true) }
    val sheetState = rememberModalBottomSheetState()

    val shownMonth by remember {
        derivedStateOf { base.plusMonths((pagerState.currentPage - Tuning.CENTER).toLong()) }
    }
    val cardH = Tuning.WK_H + Tuning.ROW_H * WEEKS_IN_GRID + 2.dp

    Column(
        Modifier
            .fillMaxSize()
            .background(Ink.paper)
            // 세로 스크롤. Android 12 이상은 여기에 stretch overscroll 이 기본으로 붙는다.
            // 웹의 STRETCH_MAX, STRETCH_K, STRETCH_BACK_MS 세 값이 흉내 내던 바로 그것.
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 20.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "‹",
                fontSize = dpSp(19f),
                color = Ink.sub,
                modifier = Modifier
                    .clickable { scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) } }
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
            Text(
                "${shownMonth.year} · ${shownMonth.monthValue}월",
                fontSize = dpSp(21f),
                color = Ink.ink,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 2.dp),
            )
            Text(
                "›",
                fontSize = dpSp(19f),
                color = Ink.sub,
                modifier = Modifier
                    .clickable { scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) } }
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }

        Spacer(Modifier.height(14.dp))

        // ★★ D1 — 가장자리 손넘김.
        // 웹은 `blocked(e)` 훅 하나로 "가장자리 20% 에서 시작한 끌기는 바깥 캐러셀 몫"이라고 갈랐다.
        // Compose 엔 그 훅이 없다. 안쪽 페이저가 가로 끌기를 전부 먹는데, 달은 121장이라
        // **끝에 닿는 일이 없어** 중첩 스크롤로는 바깥에 영영 안 넘어간다.
        //
        // 그래서 Initial 패스에서 누른 자리를 먼저 보고 userScrollEnabled 를 끈다.
        // ⚠️ 이건 해결이 아니라 우회다 — 훅이 아니라 **상태를 거쳐 재구성 한 번을 돈다.**
        //    누름과 끌기 사이(슬롭만큼)가 있어 시간은 충분하지만, 계약이 아니라 경합이다.
        Box(
            Modifier
                .fillMaxWidth()
                .height(cardH)
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        while (true) {
                            val e = awaitPointerEvent(PointerEventPass.Initial)
                            val down = e.changes.firstOrNull { it.pressed && !it.previousPressed }
                            if (down != null) {
                                val x = down.position.x
                                val w = size.width
                                innerEnabled = x > w * Tuning.EDGE_RATIO &&
                                    x < w * (1f - Tuning.EDGE_RATIO)
                            }
                        }
                    }
                }
        ) {
            HorizontalPager(
                state = pagerState,
                pageSpacing = Tuning.PANE_GAP,
                beyondViewportPageCount = 1,
                userScrollEnabled = innerEnabled,
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                MonthCard(base.plusMonths((page - Tuning.CENTER).toLong())) { sheetDate = it }
            }
        }

        Spacer(Modifier.height(10.dp))
        Legend(shownMonth)
        Spacer(Modifier.height(6.dp))
        Text(
            "겹침 규칙: 활성 기간이 n개인 구간은 밴드를 n등분(위에서 아래 = 만든 순). " +
                "경계는 기간의 시작과 끝 전환점에서만 반 칸 폭으로 가파르게 이동하고 나머지는 수평.",
            fontSize = dpSp(11.5f),
            color = Ink.faint,
            lineHeight = dpSp(18f),
        )
        Spacer(Modifier.height(22.dp))
        PeriodList(shownMonth)
        Spacer(Modifier.height(120.dp))
    }

    val open = sheetDate
    if (open != null) {
        ModalBottomSheet(
            onDismissRequest = { sheetDate = null },
            sheetState = sheetState,
            containerColor = Ink.card,
        ) {
            DaySheetBody(open)
            Spacer(Modifier.height(28.dp))
        }
    }
}

@Composable
private fun MonthCard(ym: YearMonth, onDay: (LocalDate) -> Unit) {
    val shape = RoundedCornerShape(Tuning.CARD_RADIUS)
    val weeks = remember(ym) { weeksOf(ym) }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Ink.card)
            .border(1.dp, Ink.line, shape)
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(start = 2.dp, end = 2.dp, top = 9.dp, bottom = 5.dp)
        ) {
            WKDAYS.forEachIndexed { i, w ->
                Text(
                    w,
                    style = boxedStyle(10.5f, 13f),
                    color = if (i == 0) Ink.sun else Ink.faint,
                    modifier = Modifier
                        .weight(1f)
                        .padding(start = 5.dp),
                )
            }
        }
        weeks.forEachIndexed { i, row -> CalRow(row, ym.monthValue, i > 0, onDay) }
    }
}

@Composable
private fun CalRow(row: List<LocalDate>, month: Int, topLine: Boolean, onDay: (LocalDate) -> Unit) {
    val density = LocalDensity.current
    val capR = with(density) { 7.dp.toPx() }
    val lineW = with(density) { 1.dp.toPx() }
    Box(
        Modifier
            .fillMaxWidth()
            .height(Tuning.ROW_H)
            .drawBehind {
                if (topLine) {
                    drawLine(Ink.line, Offset(0f, 0f), Offset(size.width, 0f), lineW)
                }
                val cellW = size.width / 7f
                bandsFor(row, Fixture.periods, cellW, size.height, capR).forEach {
                    drawPath(it.path, it.color, alpha = 0.30f)
                }
            }
    ) {
        Row(Modifier.fillMaxSize()) {
            row.forEachIndexed { i, date ->
                Cell(
                    date, month, i > 0,
                    Modifier
                        .weight(1f)
                        .fillMaxHeight(),
                    onDay,
                )
            }
        }
    }
}

@Composable
private fun Cell(
    date: LocalDate,
    month: Int,
    leftLine: Boolean,
    modifier: Modifier,
    onDay: (LocalDate) -> Unit,
) {
    val mut = date.monthValue != month
    val today = date == Fixture.today
    val past = date.isBefore(Fixture.today)
    val data = Fixture.day(date)
    val lineW = with(LocalDensity.current) { 1.dp.toPx() }

    Box(
        modifier
            .clickable { onDay(date) }
            .drawBehind {
                if (leftLine) {
                    drawLine(Ink.cellLine, Offset(0f, 0f), Offset(0f, size.height), lineW)
                }
            }
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 4.dp, end = 3.dp, top = 2.dp)
        ) {
            if (today) {
                Box(
                    Modifier
                        .size(17.dp)
                        .clip(CircleShape)
                        .background(Ink.ink),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${date.dayOfMonth}", style = boxedStyle(10f, 12f), color = Ink.paper)
                }
            } else {
                Text(
                    "${date.dayOfMonth}",
                    style = boxedStyle(Tuning.D_FONT, Tuning.D_LINE),
                    color = if (mut) Ink.faint else Ink.sub,
                )
            }
            if (data?.diary == true) {
                Box(
                    Modifier
                        .padding(top = 3.dp, start = 1.dp)
                        .width(10.dp)
                        .height(2.5.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Ink.faint)
                )
            }
            if (data != null) CellLines(data, past)
        }
        if (mut) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Ink.calDim)
            )
        }
    }
}

// 셀 공간 예산 동적 배분 — 일정, 할 일 1줄, memo 1줄, 남으면 할 일 2번째 줄.
// 웹과 같은 규칙이다(내용 모델이라 숫자가 그대로 넘어온다).
@Composable
private fun CellLines(data: DayData, past: Boolean) {
    var room = Tuning.CELL_MAX_LINES
    val evShow = min(data.events.size, Tuning.CELL_EV_MAX)
    val evOver = data.events.size - evShow
    room -= evShow + if (evOver > 0) 1 else 0
    val memoNeed = if (data.memo != null) 1 else 0
    var tkShow = if (data.tasks.isNotEmpty()) min(1, room) else 0
    room -= tkShow
    if (data.tasks.size > tkShow && room - memoNeed > 0 && tkShow < Tuning.CELL_TK_MAX) {
        tkShow += 1
        room -= 1
    }
    val memoShow = data.memo != null && room > 0

    data.events.take(evShow).forEach {
        EvLine(it.title, it.color, Ink.ink, FontWeight.Bold, past, dot = it.protect)
    }
    if (evOver > 0) {
        EvLine("일정 +$evOver", Color.Transparent, Ink.faint, FontWeight.Medium, past)
    }

    if (tkShow > 0) {
        val ordered = data.tasks.filter { !it.done && !it.moved } + data.tasks.filter { it.done || it.moved }
        val shown = ordered.take(tkShow)
        val restN = data.tasks.size - shown.size
        shown.forEachIndexed { i, t ->
            EvLine(
                t.title, t.color, Ink.sub, FontWeight.SemiBold, past,
                strike = t.done || t.moved,
                dim = if (t.done) 0.32f else if (t.moved) 0.40f else 1f,
                suffix = if (i == shown.size - 1 && restN > 0) "+$restN" else null,
            )
        }
    }
    if (memoShow && data.memo != null) {
        EvLine(
            data.memo.text, Color.Transparent, Ink.faint, FontWeight.Medium, past,
            suffix = if (data.memo.n > 1) "+${data.memo.n - 1}" else null,
        )
    }
}

@Composable
private fun EvLine(
    text: String,
    bar: Color,
    ink: Color,
    weight: FontWeight,
    past: Boolean,
    strike: Boolean = false,
    dim: Float = 1f,
    suffix: String? = null,
    dot: Boolean = false,
) {
    val alpha = (if (past) 0.55f else 1f) * dim
    // ★ 행 높이는 유도된 값이다 — 줄 상자(EV_LINE) + 위아래 패딩. 가정한 14dp 가 아니다.
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = Tuning.EV_GAP)
            .height(Tuning.EV_ROW),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .width(3.dp)
                .fillMaxHeight()
                .background(bar.copy(alpha = bar.alpha * alpha))
        )
        Text(
            text,
            modifier = Modifier
                .weight(1f)
                .padding(start = 4.dp, end = 2.dp),
            style = boxedStyle(Tuning.EV_FONT, Tuning.EV_LINE, weight),
            color = ink.copy(alpha = alpha),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textDecoration = if (strike) TextDecoration.LineThrough else TextDecoration.None,
        )
        if (dot) {
            Box(
                Modifier
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(Ink.brick.copy(alpha = alpha))
            )
            Spacer(Modifier.width(2.dp))
        }
        if (suffix != null) {
            Text(
                suffix,
                style = boxedStyle(8.5f, Tuning.EV_LINE, FontWeight.Bold),
                color = Ink.faint.copy(alpha = alpha),
            )
        }
    }
}

@Composable
private fun Legend(ym: YearMonth) {
    val weeks = remember(ym) { weeksOf(ym) }
    val from = weeks.first().first()
    val to = weeks.last().last()
    val shown = Fixture.periods.filter { !it.start.isAfter(to) && !it.end.isBefore(from) }
    Column {
        shown.forEach { p ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(bottom = 4.dp),
            ) {
                Box(
                    Modifier
                        .size(9.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(p.color.copy(alpha = 0.6f))
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    "${p.title}  ${md(p.start)}–${md(p.end)}",
                    fontSize = dpSp(11.5f),
                    color = Ink.sub,
                )
            }
        }
    }
}

@Composable
private fun PeriodList(ym: YearMonth) {
    val weeks = remember(ym) { weeksOf(ym) }
    val from = weeks.first().first()
    val to = weeks.last().last()
    val shown = Fixture.periods.filter { !it.start.isAfter(to) && !it.end.isBefore(from) }
    Column {
        Row(verticalAlignment = Alignment.Bottom) {
            Text("기간", fontSize = dpSp(11f), color = Ink.sub, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(8.dp))
            Text("${shown.size}", fontSize = dpSp(11f), color = Ink.faint)
        }
        Spacer(Modifier.height(10.dp))
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Ink.card)
                .border(1.dp, Ink.line, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 4.dp)
        ) {
            if (shown.isEmpty()) {
                Text(
                    "이번 달엔 기간이 없어요",
                    fontSize = dpSp(11.5f),
                    color = Ink.faint,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
            }
            shown.forEach { p ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier
                            .size(9.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(p.color)
                    )
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(p.title, fontSize = dpSp(14f), color = Ink.ink, fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(2.dp))
                        Text("${md(p.start)} – ${md(p.end)}", fontSize = dpSp(11.5f), color = Ink.faint)
                    }
                }
            }
        }
    }
}

@Composable
private fun DaySheetBody(date: LocalDate) {
    val data = Fixture.day(date)
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp)
    ) {
        Text(
            "${date.monthValue}월 ${date.dayOfMonth}일 ${WKDAYS[date.dayOfWeek.value % 7]}요일",
            fontSize = dpSp(19f),
            color = Ink.ink,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(14.dp))
        if (data == null) {
            Text("이 날은 비어 있어요.", fontSize = dpSp(12.5f), color = Ink.faint)
            return@Column
        }
        if (data.events.isNotEmpty()) {
            SheetSection("일정")
            data.events.forEach { SheetRow(it.title, it.color, if (it.timed) "시각 있음" else "종일") }
        }
        if (data.tasks.isNotEmpty()) {
            SheetSection("할 일")
            data.tasks.forEach {
                SheetRow(it.title, it.color, if (it.done) "완료" else if (it.moved) "옮겨감" else "")
            }
        }
        if (data.memo != null) {
            SheetSection("적어둔 것")
            SheetRow(data.memo.text, Color.Transparent, if (data.memo.n > 1) "외 ${data.memo.n - 1}건" else "")
        }
    }
}

@Composable
private fun SheetSection(title: String) {
    Spacer(Modifier.height(12.dp))
    Text(title, fontSize = dpSp(11f), color = Ink.sub, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
}

@Composable
private fun SheetRow(title: String, color: Color, note: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .width(3.dp)
                    .height(15.dp)
                    .background(color)
            )
            Spacer(Modifier.width(8.dp))
            Text(title, fontSize = dpSp(14f), color = Ink.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (note.isNotEmpty()) Text(note, fontSize = dpSp(11.5f), color = Ink.faint)
    }
}

private fun md(d: LocalDate) = "${d.monthValue}.${d.dayOfMonth}"
