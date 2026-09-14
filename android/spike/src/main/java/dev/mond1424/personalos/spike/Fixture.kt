package dev.mond1424.personalos.spike

import androidx.compose.ui.graphics.Color
import java.time.LocalDate

// 고정 픽스처. 실 D1 에 안 붙는다 — 재려는 것이 제스처이지 데이터 파이프라인이 아니다.
// 날짜는 전부 오늘 기준 상대다(함정 12 — 고정 날짜는 언젠가 반드시 현재가 된다).

data class Period(
    val id: String,
    val title: String,
    val start: LocalDate,
    val end: LocalDate,
    val color: Color,
    val createdAt: String,
)

data class Ev(val title: String, val timed: Boolean, val color: Color, val protect: Boolean = false)
data class Tk(val title: String, val done: Boolean = false, val moved: Boolean = false, val color: Color = Ink.faint)
data class Memo(val text: String, val n: Int)

data class DayData(
    val events: List<Ev> = emptyList(),
    val tasks: List<Tk> = emptyList(),
    val memo: Memo? = null,
    val diary: Boolean = false,
)

object Fixture {
    val today: LocalDate = LocalDate.now()

    private fun d(offset: Long): LocalDate = today.plusDays(offset)

    // 기간 — 겹치는 구간이 있어야 밴드 n등분과 경계 곡선이 화면에 나온다.
    // 셋이 서로 다르게 겹치도록 놓았다: 둘만 겹치는 구간, 셋 다 겹치는 구간, 하나만 있는 구간.
    val periods: List<Period> = listOf(
        Period("p1", "중간고사 기간", d(-18), d(4), Ink.brick, "2026-01-01T00:00:00Z"),
        Period("p2", "프로젝트 주간", d(-4), d(16), Ink.mint, "2026-01-02T00:00:00Z"),
        Period("p3", "동아리 준비", d(2), d(9), Ink.lav, "2026-01-03T00:00:00Z"),
        Period("p4", "다음 달 합숙", d(34), d(41), Ink.amber, "2026-01-04T00:00:00Z"),
    )

    // 날짜별 내용 — 오늘 기준 오프셋으로만 적는다.
    // 셀 공간 예산이 실제로 갈리도록 "일정만", "일정 셋(초과)", "할 일 넷", "memo 여럿"을 섞었다.
    private val byOffset: Map<Long, DayData> = mapOf(
        -9L to DayData(events = listOf(Ev("자료구조 과제 마감", true, Ink.brick))),
        -6L to DayData(
            tasks = listOf(Tk("교재 3장 읽기", done = true), Tk("노트 정리")),
            memo = Memo("도서관 3층이 조용하다", 1),
        ),
        -3L to DayData(
            events = listOf(Ev("알고리즘 강의", true, Ink.mint), Ev("스터디", true, Ink.amber), Ev("동아리 회의", false, Ink.lav)),
            tasks = listOf(Tk("발표 자료", moved = true)),
            diary = true,
        ),
        -1L to DayData(
            events = listOf(Ev("병원", true, Ink.brick, protect = true)),
            tasks = listOf(Tk("약 받기", done = true), Tk("장보기"), Tk("빨래")),
            memo = Memo("비 옴", 1),
            diary = true,
        ),
        0L to DayData(
            events = listOf(Ev("운영체제 강의", true, Ink.mint), Ev("팀 미팅", true, Ink.amber)),
            tasks = listOf(Tk("과제 제출"), Tk("자료 정리"), Tk("메일 회신")),
            memo = Memo("오늘은 세 개만 한다", 3),
            diary = true,
        ),
        1L to DayData(
            events = listOf(Ev("실습 조교 면담", true, Ink.lav)),
            tasks = listOf(Tk("실습 예습")),
        ),
        2L to DayData(
            events = listOf(Ev("동아리 준비 시작", false, Ink.lav)),
            memo = Memo("준비물 목록 확인", 2),
        ),
        4L to DayData(
            events = listOf(Ev("중간고사 마지막날", true, Ink.brick), Ev("뒤풀이", true, Ink.amber), Ev("귀가", false, Ink.faint), Ev("정리", false, Ink.faint)),
        ),
        6L to DayData(tasks = listOf(Tk("프로젝트 스켈레톤"), Tk("이슈 정리"), Tk("회고"))),
        9L to DayData(
            events = listOf(Ev("동아리 공연", true, Ink.lav, protect = true)),
            memo = Memo("리허설 17시", 1),
        ),
        13L to DayData(tasks = listOf(Tk("중간 점검"))),
        16L to DayData(events = listOf(Ev("프로젝트 마감", true, Ink.mint))),
        -14L to DayData(tasks = listOf(Tk("수강 정정", done = true))),
        -21L to DayData(events = listOf(Ev("개강", false, Ink.mint)), diary = true),
        24L to DayData(events = listOf(Ev("가족 모임", false, Ink.amber))),
        36L to DayData(events = listOf(Ev("합숙 출발", true, Ink.amber, protect = true)), tasks = listOf(Tk("짐 싸기"))),
    )

    private val byDate: Map<LocalDate, DayData> = byOffset.mapKeys { d(it.key) }

    fun day(date: LocalDate): DayData? = byDate[date]
}
