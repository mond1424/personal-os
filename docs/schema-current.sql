-- Personal OS · D1 스키마 스냅샷 (자동 생성 — 손으로 고치지 말 것)
-- 적용 마이그레이션: 0001_init · 0002_models · 0003_ai_provider · 0004_events · 0005_delete_scope · 0006_fix_model_high · 0007_defer_reason
-- 생성일: 2026-07-23
-- 재생성: migrations/ 전체를 인메모리 sqlite에 적용한 뒤 sqlite_master를 덤프한다.
--         (새 마이그레이션 추가 시 이 파일도 다시 만든다 — 세션 종료 규칙, CLAUDE.md 참조)

PRAGMA foreign_keys = ON;

-- ─────────────────────────── TABLES ───────────────────────────
CREATE TABLE analyses (
  id           TEXT PRIMARY KEY,     -- YYYYMMDD-NNN
  prompt       TEXT NOT NULL,
  pass1        TEXT NOT NULL,        -- 과거 analysis 없이 독립 생성
  pass2        TEXT NOT NULL,        -- 과거를 읽으며 추가 (1차 수정 금지)
  context_meta TEXT,                 -- 조립된 윈도우 기록 (JSON) — 재현·감사용 (v0.8 확정, 5.4)
  created_at   TEXT NOT NULL
);
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
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  time       TEXT,                       -- 'HH:MM' · NULL이면 하루 종일
  period_id  TEXT REFERENCES periods(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE feelings (
  date   TEXT NOT NULL REFERENCES daily(date),
  field  TEXT NOT NULL,
  value  REAL NOT NULL CHECK (value >= 1 AND value <= 10),  -- 눈금 1단위, 타이핑 시 소수점 허용
  source TEXT NOT NULL DEFAULT 'scale' CHECK (source IN ('scale','ai')),
  PRIMARY KEY (date, field)
);
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
CREATE TABLE logs (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL REFERENCES daily(date),  -- 귀속일 (05:00 경계 반영, 기록 시점 확정)
  ts         TEXT NOT NULL,          -- 표시 시각 (자동 채움, 마감 전 수정 가능)
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE me (
  field      TEXT PRIMARY KEY,       -- direction | interests | career | personality | life_pattern …
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE me_history (
  id         INTEGER PRIMARY KEY,
  field      TEXT NOT NULL,
  old_value  TEXT,                   -- 최초 작성 시 NULL
  new_value  TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai')),
                                     -- 'ai' = 승인된 AI 제안(diff) — 구현 2
  changed_at TEXT NOT NULL
);
CREATE TABLE memos (
  id         TEXT PRIMARY KEY,      -- YYYYMMDD-NNN
  date       TEXT NOT NULL REFERENCES daily(date),
  ts         TEXT NOT NULL,          -- 사용자가 고른 표시 시각 (24h)
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL           -- 실제 작성 시각 ("작성 시각과 함께")
);
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
  defer_reason TEXT,                  -- 미루기 사유 (0007 ALTER 추가) — 도착지(새 예정) 항목에 남김
  UNIQUE (task_id, date),
  CHECK ((deferred_to IS NULL) = (deferred_at IS NULL)),
  CHECK (deferred_to IS NULL OR deferred_to > date)
);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                -- 단순 문자열 또는 JSON
);
CREATE TABLE summaries (
  kind         TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly')),
  key          TEXT NOT NULL,        -- daily = 'YYYY-MM-DD' · weekly/monthly 키 규약은 구현 2에서
  mech         TEXT,                 -- (a) 기계적 층위: 마감 시점 파생 섹션·필드값 물화 (JSON)
  ai_text      TEXT,                 -- (b) AI 압축 — 구현 2
  stale        INTEGER NOT NULL DEFAULT 0,   -- memo 추가 시 1 → lazy 재생성
  generated_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);
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
CREATE TABLE wait_extensions (
  id             INTEGER PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  prev_anchor_at TEXT NOT NULL,
  extended_at    TEXT NOT NULL
);

-- ─────────────────────────── INDEXES ───────────────────────────
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_logs_date ON logs(date, ts);
CREATE INDEX idx_memos_date ON memos(date);
CREATE INDEX idx_entries_date ON schedule_entries(date);
CREATE INDEX idx_entries_task ON schedule_entries(task_id, date);
CREATE INDEX idx_tasks_period ON tasks(period_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_wait_ext_task ON wait_extensions(task_id, extended_at);

-- ─────────────────────────── VIEWS ───────────────────────────
CREATE VIEW v_period_achievement AS
SELECT p.id, p.title, ROUND(AVG(s.current_rate), 1) AS achievement
FROM periods p LEFT JOIN v_task_stats s ON s.period_id = p.id
GROUP BY p.id;
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

-- ─────────────────────────── TRIGGERS ───────────────────────────
CREATE TRIGGER trg_analyses_no_del BEFORE DELETE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 삭제 불가'); END;
CREATE TRIGGER trg_analyses_no_upd BEFORE UPDATE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 수정 불가'); END;
CREATE TRIGGER trg_daily_frozen BEFORE UPDATE ON daily
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 daily는 수정할 수 없음 — memo만 추가 가능'); END;
CREATE TRIGGER trg_events_frozen_del BEFORE DELETE ON events
WHEN EXISTS (SELECT 1 FROM daily WHERE date = OLD.date AND status = 'closed')
BEGIN SELECT RAISE(ABORT, '마감된 날의 일정은 삭제할 수 없음'); END;
CREATE TRIGGER trg_events_frozen_upd BEFORE UPDATE ON events
WHEN EXISTS (SELECT 1 FROM daily WHERE date = OLD.date AND status = 'closed')
BEGIN SELECT RAISE(ABORT, '마감된 날의 일정은 수정할 수 없음'); END;
CREATE TRIGGER trg_feelings_frozen_del BEFORE DELETE ON feelings
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Feelings는 삭제할 수 없음'); END;
CREATE TRIGGER trg_feelings_frozen_ins BEFORE INSERT ON feelings
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날에는 Feelings를 추가할 수 없음'); END;
CREATE TRIGGER trg_feelings_frozen_upd BEFORE UPDATE ON feelings
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Feelings는 수정할 수 없음'); END;
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
CREATE TRIGGER trg_logs_frozen_del BEFORE DELETE ON logs
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Log는 삭제할 수 없음'); END;
CREATE TRIGGER trg_logs_frozen_ins BEFORE INSERT ON logs
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날에는 Log를 추가할 수 없음 — memo로'); END;
CREATE TRIGGER trg_logs_frozen_upd BEFORE UPDATE ON logs
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 Log는 수정할 수 없음 — memo로 추가'); END;
CREATE TRIGGER trg_memos_no_del BEFORE DELETE ON memos
BEGIN SELECT RAISE(ABORT, 'memo는 삭제할 수 없음'); END;
CREATE TRIGGER trg_memos_no_upd BEFORE UPDATE ON memos
BEGIN SELECT RAISE(ABORT, 'memo는 수정할 수 없음 — 새 memo로 추가'); END;
CREATE TRIGGER trg_entries_frozen_del BEFORE DELETE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 삭제할 수 없음'); END;
CREATE TRIGGER trg_entries_frozen_ins BEFORE INSERT ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날짜에는 일정을 추가할 수 없음'); END;
CREATE TRIGGER trg_entries_frozen_upd BEFORE UPDATE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 수정할 수 없음'); END;
CREATE TRIGGER trg_wait_ext_log AFTER UPDATE OF wait_anchor_at ON tasks
WHEN OLD.wait_anchor_at IS NOT NEW.wait_anchor_at
BEGIN
  INSERT INTO wait_extensions (task_id, prev_anchor_at, extended_at)
  VALUES (NEW.id, OLD.wait_anchor_at, NEW.wait_anchor_at);
END;
CREATE TRIGGER trg_wait_ext_no_del BEFORE DELETE ON wait_extensions
WHEN EXISTS (
  SELECT 1 FROM schedule_entries e JOIN daily d ON d.date = e.date
   WHERE e.task_id = OLD.task_id AND d.status = 'closed'
)
BEGIN SELECT RAISE(ABORT, '마감 기록이 있는 task의 연장 이력은 삭제할 수 없음'); END;
CREATE TRIGGER trg_wait_ext_no_upd BEFORE UPDATE ON wait_extensions
BEGIN SELECT RAISE(ABORT, '연장 이력은 수정할 수 없음'); END;
