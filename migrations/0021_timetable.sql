-- 0021: 시간표 — **규칙만 저장한다. 인스턴스는 조회할 때 전개한다** (ADR-045 ② · 원칙 1).
--
-- 15주치 행을 만들어 두면 학기가 바뀔 때·휴강이 생길 때·시각 하나가 틀릴 때 그 전부를
-- 손봐야 한다. `CalendarContract.Instances`가 하는 일과 같은 모양이고, T-53이 이미 그 판단을 따랐다.
--
-- ⚠️ `events`가 아니다 — 저기 넣는 순간 15주치 행이 되고 원칙 1을 어긴다.
-- ⚠️ `periods`도 아니다 — 그것은 기간(학기·프로젝트) 하나이고 **반복이 없다**.
--
-- ★ `end_time`이 이 표의 존재 이유다. 포털 그리드는 **시작 칸만** 그려서 길이를 말하지 않는데,
--   같은 과목이 요일마다 길이가 다르다(전자기및연습1 = 월 3시간 · 목 2시간). 시작만 담으면
--   시간표가 틀린 채 학기를 가고, Guard가 그 값으로 보호 일정을 건다.
--
-- 마감 동결 트리거를 두지 않는다: 규칙은 *'그날 있었던 일'* 이 아니라 학기 내내 유효한 설정이다.
-- (함정 6이 세는 `*_frozen_*` 삼총사와 성격이 다르다.)
CREATE TABLE timetable_rules (
  id         TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  weekday    INTEGER NOT NULL,          -- 1=월 … 7=일 (ISO-8601)
  start_time TEXT NOT NULL,             -- 'HH:MM'
  end_time   TEXT NOT NULL,             -- 'HH:MM'
  term_start TEXT NOT NULL,             -- 'YYYY-MM-DD' — 매 학기 바뀌므로 입력으로 받는다
  term_end   TEXT NOT NULL,             --              코드에 박으면 다음 학기에 조용히 틀린다
  created_at TEXT NOT NULL,
  CHECK (weekday BETWEEN 1 AND 7),
  CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time   GLOB '[0-2][0-9]:[0-5][0-9]'),
  CHECK (end_time > start_time),
  CHECK (term_end >= term_start)
);
CREATE INDEX idx_timetable_weekday ON timetable_rules(weekday);
