-- ============================================================
-- Personal OS · D1 스키마 — 구현 1 (migrations/0001_init.sql)
-- 진실의 원천: personal-agent-design_v0.8.md
--
-- 원칙 매핑
--   · 1.1  entity-first 폴더 ↔ 테이블 1:1
--          (daily · tasks · periods · guard · summary · analysis + Me · settings)
--   · 원칙4 원본만 저장. Todo/Done/Missed·이월 횟수·대기 일수·달성률은
--          전부 뷰/쿼리로 계산 — 물화는 summaries(cache 계층)에서만.
--   · 1.3  불변성("과거에 귀속된 기록은 수정 불가, 추가만")을
--          API가 아니라 트리거로 DB 계층에서 강제.
--   · 귀속일(logs.date, tasks.finished_on 등)은 경계(기본 05:00)를 반영해
--     기록 시점에 계산·저장한다 — 경계 설정을 나중에 바꿔도
--     과거가 재해석되지 않는다. (1.2·1.3의 구현상 귀결)
--
-- 표기 규약
--   · 날짜 = 'YYYY-MM-DD' (귀속일), 시각 = ISO8601 오프셋 포함
--     예: '2026-07-18T01:40:00+09:00'
--   · 엔티티 id = 'YYYYMMDD-NNN' (생성일+당일 순번, 불변·정렬 가능)
--     title은 자유 변경 — 참조는 항상 id (1.1 공통 규칙)
--   · D1은 FK 기본 강제. 로컬 sqlite 검증 시 PRAGMA foreign_keys=ON 필요.
-- ============================================================


-- ── settings ──────────────────────────────────────────────
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- 단순 문자열 또는 JSON
);
INSERT INTO settings (key, value) VALUES
  ('day_boundary',    '05:00'),                        -- 1.2 하루 경계 (설정 변경 가능)
  ('feelings_fields', '["energy","stress","focus"]');  -- 1.5 필드 구성


-- ── Me — 장기 맥락 (3장) ──────────────────────────────────
-- v0.8에서 1.1 저장 구조에 정식 편입 (필드 단위 + 변경 이력).
-- '지금'은 periods 목표의 조인 파생이므로 여기 저장하지 않는다.
CREATE TABLE me (
  field      TEXT PRIMARY KEY,       -- direction | interests | career | personality | life_pattern …
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 변경 이력 보존 + 이력 자체가 분석 입력 (3장)
CREATE TABLE me_history (
  id         INTEGER PRIMARY KEY,
  field      TEXT NOT NULL,
  old_value  TEXT,                   -- 최초 작성 시 NULL
  new_value  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai')),
                                     -- 'ai' = 승인된 AI 제안(diff) — 구현 2
  changed_at TEXT NOT NULL
);


-- ── periods (2.1) ─────────────────────────────────────────
CREATE TABLE periods (
  id         TEXT PRIMARY KEY,       -- YYYYMMDD-NNN
  title      TEXT NOT NULL,          -- 문서의 name — 전 엔티티 공통 title 규칙으로 통일
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  color      TEXT NOT NULL,          -- 형광펜 색 '#7ED4A9'
  goals      TEXT NOT NULL DEFAULT '[]',  -- JSON 문자열 배열 — Me '지금' 조인의 원천
  created_at TEXT NOT NULL,          -- 겹침 밴드 위→아래 배정 순서 (2.2)
  CHECK (start_date <= end_date)
);


-- ── tasks — identity 원본 (1.4) ───────────────────────────
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,   -- 불변 id
  title          TEXT NOT NULL,      -- 자유 변경
  period_id      TEXT REFERENCES periods(id),
                 -- 명시 소속 (v0.8 확정) — 날짜 조인으로는 겹침 구간에서
                 -- 소속이 모호하다. 기간별 세그먼트·기간색 노치의 전제.
                 -- 대기(미배정) task도 기간에 속할 수 있다.
  status         TEXT NOT NULL DEFAULT 'not_finished'
                 CHECK (status IN ('not_finished','finished')),
  finished_at    TEXT,               -- 실제 완료 시각
  finished_on    TEXT,               -- 완료가 귀속된 날 (경계 반영, 기록 시점 확정)
  wait_anchor_at TEXT NOT NULL,      -- 대기 21일 시계의 기준점 (1.4, v0.8 확정)
                 -- 생성 시 = created_at · 연장 시 = 연장한 현재 시각
                 -- 기한 = anchor + 21일. 갱신하면 아래 트리거가 이력을 자동 기록.
  created_at     TEXT NOT NULL,
  CHECK (status = 'not_finished' OR finished_on IS NOT NULL)
);
CREATE INDEX idx_tasks_period ON tasks(period_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- 대기 연장 이력 (v0.8 확정) — append-only.
-- 앱은 tasks.wait_anchor_at만 UPDATE하면 되고, 이력은 트리거가 보장한다.
-- extended_at = 새 앵커(연장 시각) 그 자체 — 다음 기한 = 이 값 + 21일.
-- 활용은 9장 #3(대기 재노출 강도)과 함께: 연장 횟수·간격이 패턴 신호가 된다.
CREATE TABLE wait_extensions (
  id             INTEGER PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  prev_anchor_at TEXT NOT NULL,
  extended_at    TEXT NOT NULL
);
CREATE INDEX idx_wait_ext_task ON wait_extensions(task_id, extended_at);

CREATE TRIGGER trg_wait_ext_log AFTER UPDATE OF wait_anchor_at ON tasks
WHEN OLD.wait_anchor_at IS NOT NEW.wait_anchor_at
BEGIN
  INSERT INTO wait_extensions (task_id, prev_anchor_at, extended_at)
  VALUES (NEW.id, OLD.wait_anchor_at, NEW.wait_anchor_at);
END;

CREATE TRIGGER trg_wait_ext_no_upd BEFORE UPDATE ON wait_extensions
BEGIN SELECT RAISE(ABORT, '연장 이력은 수정할 수 없음'); END;

CREATE TRIGGER trg_wait_ext_no_del BEFORE DELETE ON wait_extensions
BEGIN SELECT RAISE(ABORT, '연장 이력은 삭제할 수 없음'); END;

-- schedule 배열의 정규화 (1.4)
-- 미루기 = 새 항목 INSERT + 원 항목에 deferred_to 기록
--          (문서 예시 "{ date: 0701, 완료율: 80%, defer → 0704 }"의 저장형)
-- 이월 횟수 = 항목 수 − 1 (파생, 저장 안 함) — 마감 전 미루기와
--          Missed 후 재배정이 같은 공식으로 통일된다.
-- Missed  = 파생: "마감된 날의 항목 중, 그날 완료되지도(finished_on)
--          미뤄지지도(deferred_to) 않은 것". 마감 후 과거 항목이
--          트리거로 얼어붙으므로 이 판정은 영구히 안정적이다. (1.2·1.3)
CREATE TABLE schedule_entries (
  id          INTEGER PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  date        TEXT NOT NULL,         -- 예정일
  rate        INTEGER NOT NULL DEFAULT 0 CHECK (rate BETWEEN 0 AND 100),
              -- 완료율 원칙 (v0.8 확정):
              -- 미루기는 기존 entry의 수정이 아니라 "새 예정"의 생성이다.
              -- 따라서 새 entry의 rate는 항상 0에서 시작한다.
              -- 이전 entry의 rate(예: 80%)는 "그 예정일까지 얼마나 진행했는가"라는
              -- 과거 기록이지, 새 예정일의 현재 진행률이 아니다.
              -- 이어받으면 7/1 80% → defer → 7/4 80%처럼 새 일정이 이미
              -- 진행된 것처럼 보이고, 예정일별 진행 기록이 서로 섞인다.
              -- 과거 진행률은 이전 entry에 영구 보존, 새 entry는 새로운 시작점.
  deferred_to TEXT,                  -- 미루기 대상 날짜
  deferred_at TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (task_id, date),
  CHECK ((deferred_to IS NULL) = (deferred_at IS NULL)),
  CHECK (deferred_to IS NULL OR deferred_to > date)
);
CREATE INDEX idx_entries_date ON schedule_entries(date);
CREATE INDEX idx_entries_task ON schedule_entries(task_id, date);


-- ── daily — Diary, 하루 단위 기록 (1.2) ───────────────────
-- 행 = 그날 첫 입력 시 생성. 건너뛴 날 = 행 없음.
-- 과거 예정일에 행이 없으면 자동 마감이 closed 행을 만들어 Missed를 확정한다.
-- Todo/Done/Missed는 저장하지 않는다 — queries.sql B 참조.
CREATE TABLE daily (
  date          TEXT PRIMARY KEY,    -- YYYY-MM-DD = id (귀속일)
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  score         INTEGER CHECK (score BETWEEN 1 AND 10),   -- 1.6 self-Daily Score (주관·독립 입력)
  feelings_text TEXT,                -- 1.5 manual 서술 원본 (AI 분류는 구현 2, 마감 시 feelings 행으로 확정)
  close_kind    TEXT CHECK (close_kind IN ('manual','brief','auto')),  -- brief = 간략히 마감
  closed_at     TEXT,
  created_at    TEXT NOT NULL,
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

-- 1.5 feelings — 확정된 세부 필드 값 (원본)
CREATE TABLE feelings (
  date   TEXT NOT NULL REFERENCES daily(date),
  field  TEXT NOT NULL,
  value  REAL NOT NULL CHECK (value >= 1 AND value <= 10),  -- 눈금 1단위, 타이핑 시 소수점 허용
  source TEXT NOT NULL DEFAULT 'scale' CHECK (source IN ('scale','ai')),
  PRIMARY KEY (date, field)
);

-- 1.2 Log — 타임스탬프 스트림
CREATE TABLE logs (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL REFERENCES daily(date),  -- 귀속일 (05:00 경계 반영, 기록 시점 확정)
  ts         TEXT NOT NULL,          -- 표시 시각 (자동 채움, 마감 전 수정 가능)
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_logs_date ON logs(date, ts);

-- 1.3 memo — 마감 후 유일하게 열린 추가 통로
CREATE TABLE memos (
  id         TEXT PRIMARY KEY,      -- YYYYMMDD-NNN
  date       TEXT NOT NULL REFERENCES daily(date),
  ts         TEXT NOT NULL,          -- 사용자가 고른 표시 시각 (24h)
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL           -- 실제 작성 시각 ("작성 시각과 함께")
);
CREATE INDEX idx_memos_date ON memos(date);


-- ── summaries — cache 계층 (4장) ──────────────────────────
-- 파생의 물화가 허용되는 유일한 곳. 언제든 재생성 가능.
CREATE TABLE summaries (
  kind         TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly')),
  key          TEXT NOT NULL,        -- daily = 'YYYY-MM-DD' · weekly/monthly 키 규약은 구현 2에서
  mech         TEXT,                 -- (a) 기계적 층위: 마감 시점 파생 섹션·필드값 물화 (JSON)
  ai_text      TEXT,                 -- (b) AI 압축 — 구현 2
  stale        INTEGER NOT NULL DEFAULT 0,   -- memo 추가 시 1 → lazy 재생성
  generated_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);


-- ── analyses — 사고 계층 (5장) ────────────────────────────
-- 요청 시에만 생성, 영구 보존. 저장은 [1차, 2차] 분리(앵커링 방지는 데이터 층 속성).
CREATE TABLE analyses (
  id           TEXT PRIMARY KEY,     -- YYYYMMDD-NNN
  prompt       TEXT NOT NULL,
  pass1        TEXT NOT NULL,        -- 과거 analysis 없이 독립 생성
  pass2        TEXT NOT NULL,        -- 과거를 읽으며 추가 (1차 수정 금지)
  context_meta TEXT,                 -- 조립된 윈도우 기록 (JSON) — 재현·감사용 (v0.8 확정, 5.4)
  created_at   TEXT NOT NULL
);


-- ── guard_events — 개입 이벤트 로그 (6.5) ─────────────────
-- Event 필드는 6.5에서 이미 확정 → 선정의. 구현 1은 쓰지 않는다.
-- guard_rules 테이블은 만들지 않는다 — 규칙 문법은 9장 미확정,
-- 구현 3 직전 설계. 그때까지 cause는 자유 텍스트 참조로 시작.
CREATE TABLE guard_events (
  id              TEXT PRIMARY KEY,  -- YYYYMMDD-NNN
  fired_at        TEXT NOT NULL,     -- 발동 시각
  cause           TEXT NOT NULL,     -- 발동 원인(규칙 참조)
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),
  reaction        TEXT NOT NULL CHECK (reaction IN ('accepted','override')),
  override_reason TEXT,              -- 6.3 마찰에서 타이핑한 한 문장
  task_id         TEXT REFERENCES tasks(id),    -- 연결된 task 또는 period
  period_id       TEXT REFERENCES periods(id),
  outcome         TEXT CHECK (outcome IN ('success','failure')),  -- 사후 확정 (Guard가 직접 판단하지 않음)
  outcome_at      TEXT,
  created_at      TEXT NOT NULL,
  CHECK (reaction != 'override' OR override_reason IS NOT NULL)   -- Override에는 사유 필수 (6.3)
);


-- ============================================================
-- 파생 뷰 — "화면은 전부 원본의 조인 뷰" (7장)
-- 오늘 날짜가 필요한 파생(Todo/Missed/대기 일수 등)은 뷰가 아니라
-- queries.sql의 파라미터 쿼리로 — date('now')는 UTC라 경계 로직과 어긋난다.
-- ============================================================

CREATE VIEW v_task_stats AS
SELECT
  t.id, t.title, t.period_id, t.status, t.finished_on,
  t.wait_anchor_at, t.created_at,
  (SELECT COUNT(*) FROM schedule_entries e WHERE e.task_id = t.id)             AS entry_count,
  MAX((SELECT COUNT(*) FROM schedule_entries e WHERE e.task_id = t.id) - 1, 0) AS defer_count,   -- 이월 횟수
  (SELECT MAX(e.date) FROM schedule_entries e WHERE e.task_id = t.id)          AS latest_date,
  CASE WHEN t.status = 'finished' THEN 100
       ELSE COALESCE((SELECT e.rate FROM schedule_entries e
                      WHERE e.task_id = t.id ORDER BY e.date DESC LIMIT 1), 0)
  END AS current_rate,                                                          -- 완료율 다이얼 값
  CASE WHEN t.status = 'not_finished'
        AND NOT EXISTS (SELECT 1 FROM schedule_entries e WHERE e.task_id = t.id)
       THEN 1 ELSE 0 END AS is_waiting                                          -- schedule:[] = 대기
FROM tasks t;

-- 2.1 달성률 = 기간 내 task들의 다이얼 값 평균 (완료 100 · 미착수 0 · 부분 %)
CREATE VIEW v_period_achievement AS
SELECT p.id, p.title, ROUND(AVG(s.current_rate), 1) AS achievement
FROM periods p LEFT JOIN v_task_stats s ON s.period_id = p.id
GROUP BY p.id;


-- ============================================================
-- 불변성 트리거 (1.3)
-- "과거에 귀속된 기록은 수정할 수 없다. 추가만 가능하다."
-- 마감(closed)이 봉인 시점이다: 마감 전에는 편집 가능(타임스탬프 수정 등),
-- 마감 후에는 그날에 귀속된 모든 원본이 얼어붙고 memo만 열린다.
-- ============================================================

-- logs: 마감된 날 = 수정·삭제·추가 전부 불가 (추가는 memo로)
CREATE TRIGGER trg_logs_frozen_upd BEFORE UPDATE ON logs
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Log는 수정할 수 없음 — memo로 추가'); END;

CREATE TRIGGER trg_logs_frozen_del BEFORE DELETE ON logs
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Log는 삭제할 수 없음'); END;

CREATE TRIGGER trg_logs_frozen_ins BEFORE INSERT ON logs
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날에는 Log를 추가할 수 없음 — memo로'); END;

-- feelings: 동일 (manual 분류 확정은 마감 트랜잭션 안에서, 마감 전에 INSERT)
CREATE TRIGGER trg_feelings_frozen_upd BEFORE UPDATE ON feelings
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Feelings는 수정할 수 없음'); END;

CREATE TRIGGER trg_feelings_frozen_del BEFORE DELETE ON feelings
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Feelings는 삭제할 수 없음'); END;

CREATE TRIGGER trg_feelings_frozen_ins BEFORE INSERT ON feelings
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날에는 Feelings를 추가할 수 없음'); END;

-- schedule_entries: 과거(마감된 날) 항목 불변 — 1.2 파생 조립의 안전 근거
CREATE TRIGGER trg_entries_frozen_upd BEFORE UPDATE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 수정할 수 없음'); END;

CREATE TRIGGER trg_entries_frozen_del BEFORE DELETE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 삭제할 수 없음'); END;

CREATE TRIGGER trg_entries_frozen_ins BEFORE INSERT ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날짜에는 일정을 추가할 수 없음'); END;

-- daily: 마감되면 행 전체 동결 (score·feelings_text 포함)
CREATE TRIGGER trg_daily_frozen BEFORE UPDATE ON daily
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 daily는 수정할 수 없음 — memo만 추가 가능'); END;

-- memo: 시점 불문 수정·삭제 없음 — 순수 추가 (잘못 썼으면 새 memo로)
CREATE TRIGGER trg_memos_no_upd BEFORE UPDATE ON memos
BEGIN SELECT RAISE(ABORT, 'memo는 수정할 수 없음 — 새 memo로 추가'); END;

CREATE TRIGGER trg_memos_no_del BEFORE DELETE ON memos
BEGIN SELECT RAISE(ABORT, 'memo는 삭제할 수 없음'); END;

-- analyses: 영구 보존 (5.4)
CREATE TRIGGER trg_analyses_no_upd BEFORE UPDATE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 수정 불가'); END;

CREATE TRIGGER trg_analyses_no_del BEFORE DELETE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 삭제 불가'); END;

-- guard_events: outcome(사후 확정)만 갱신 가능, 나머지 동결 · 삭제 불가 (6.5)
CREATE TRIGGER trg_guard_frozen BEFORE UPDATE ON guard_events
WHEN NEW.id              IS NOT OLD.id
  OR NEW.fired_at        IS NOT OLD.fired_at
  OR NEW.cause           IS NOT OLD.cause
  OR NEW.level           IS NOT OLD.level
  OR NEW.reaction        IS NOT OLD.reaction
  OR NEW.override_reason IS NOT OLD.override_reason
  OR NEW.task_id         IS NOT OLD.task_id
  OR NEW.period_id       IS NOT OLD.period_id
  OR NEW.created_at      IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'guard_event는 outcome만 사후 갱신 가능'); END;

CREATE TRIGGER trg_guard_no_del BEFORE DELETE ON guard_events
BEGIN SELECT RAISE(ABORT, 'guard_event는 삭제할 수 없음'); END;
