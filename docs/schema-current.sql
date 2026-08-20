-- docs/schema-current.sql — 스키마 스냅샷 (자동 생성)
-- migrations/ 전체를 인메모리 sqlite에 적용한 뒤 sqlite_master를 덤프한 것.
-- 최신 마이그레이션: 0018_collected_items.sql  ·  갱신 2026-08-21
-- 0013·0014는 DDL을 바꾸지 않는다: 0013 = analyses backfill(트리거를 원문 그대로 복원) ·
--   0014 = lm_schema.body에 title 얹기(UPDATE만).
-- 0015 = me_history에 reason TEXT 추가(ADR-027 — 모드 하향 사유). ALTER라 컬럼이 표 끝에 붙는다.
-- 0016 = guard_events에 ai_unavailable_reason TEXT 추가(T-31 — 왜 못 불렀는가). 같은 이유로 표 끝.
--   ai_verdict의 CHECK는 건드리지 않았다 — 값을 넓히면 과거 행과 모양이 갈라지고,
--   CHECK 위반이 400이 되어 기기의 flush()가 발동 행을 버린다.
-- 0017 = guard_events에 ai_reason TEXT 추가(T-38 — 왜 그렇게 답했는가). 같은 이유로 표 끝.
--   위 ai_unavailable_reason과 **반대편**이다: 저쪽은 판정이 없을 때(닫힌 목록 · 기계가 센다),
--   이쪽은 판정이 있을 때(자유 문자열 · 사람이 읽는다). CHECK도 NOT NULL도 두지 않는다 —
--   옛 APK가 이 키 없이 올리는 행이 살아야 한다.
-- ⚠️ ai_unavailable_reason의 CHECK **주석 두 줄**이 T-37에서 바뀌었다(숫자를 뺐다).
--   이미 만들어진 DB의 sqlite_master에는 옛 문구가 남아 있다 — 주석이라 동작은 같다.
-- 0018 = collected_items 신설(T-41 — 학사 마감 수집). **새 테이블이라 표 순서에 알파벳으로 낀다.**
--   summary·description은 **원문 그대로**다 — 형식을 아직 모르므로 해석하지 않는다(ADR-037 §실측).
--   uid UNIQUE가 diff 기준이자 멱등 키다. 사라진 항목을 **지우지 않는 것**이 이 표의 성질이고,
--   그래서 last_seen_at이 있다(창이 -5일~+365일이라 지난 마감은 저절로 빠진다).
-- 손으로 고치지 않는다 — 마이그레이션을 추가하고 다시 덤프한다 (CLAUDE.md 세션 종료 규칙).

-- ==========================================================
-- 테이블
-- ==========================================================

CREATE TABLE analyses (
  id           TEXT PRIMARY KEY,     -- YYYYMMDD-NNN
  prompt       TEXT NOT NULL,
  pass1        TEXT NOT NULL,        -- 과거 analysis 없이 독립 생성
  pass2        TEXT NOT NULL,        -- 과거를 읽으며 추가 (1차 수정 금지)
  context_meta TEXT,                 -- 조립된 윈도우 기록 (JSON) — 재현·감사용 (v0.8 확정, 5.4)
  created_at   TEXT NOT NULL
, anchor_type     TEXT, anchor_id       TEXT, model_tier      TEXT, source_versions TEXT);

CREATE TABLE collected_items (
  id            TEXT PRIMARY KEY,                 -- 'YYYYMMDD-NNN' (리포 관례)
  uid           TEXT NOT NULL UNIQUE,             -- iCal UID. diff 기준 · 멱등 키
  source        TEXT NOT NULL DEFAULT 'uclass'
                  CHECK (source IN ('uclass')),   -- 원천이 늘 것을 전제로 칸을 둔다
  summary       TEXT NOT NULL,                    -- 원문 그대로. 해석 금지
  description   TEXT,                             -- 원문 그대로. 비어 있어도 칸을 둔다
  starts_at     TEXT,                             -- DTSTART를 로컬 오프셋 표기로 정규화
  ends_at       TEXT,                             -- DTEND. 쓰는 곳은 아직 없지만 **버리지 않는다**
  last_modified TEXT,                             -- LAST-MODIFIED — 변경 감지
  first_seen_at TEXT NOT NULL,                    -- 처음 본 시각
  last_seen_at  TEXT NOT NULL,                    -- 마지막으로 목록에 있던 시각 ← 사라짐 판정 근거
  state         TEXT NOT NULL DEFAULT 'new'
                  CHECK (state IN ('new','accepted','dismissed')),
  event_id      TEXT REFERENCES events(id),       -- accepted일 때 만들어진 일정 (T-42)
  created_at    TEXT NOT NULL
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
, protect_from      TEXT, protect_level     INTEGER, protect_sleep_min INTEGER, protect_prep_min  INTEGER);

CREATE TABLE feelings (
  date   TEXT NOT NULL REFERENCES daily(date),
  field  TEXT NOT NULL,
  value  REAL NOT NULL CHECK (value >= 1 AND value <= 10),  -- 눈금 1단위, 타이핑 시 소수점 허용
  source TEXT NOT NULL DEFAULT 'scale' CHECK (source IN ('scale','ai')),
  PRIMARY KEY (date, field)
);

CREATE TABLE "guard_events" (
  id              TEXT PRIMARY KEY,                 -- 'YYYYMMDD-NNN'
  fired_at        TEXT NOT NULL,                    -- 발동 시각 (벽시계 ISO)
  on_date         TEXT NOT NULL,                    -- 귀속일 (ADR-011 — 기기 날짜 아님)
  cause           TEXT NOT NULL,                    -- 발동 원인 규칙 키
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),

  mode            TEXT,                             -- 발동 시점의 Guard 모드 (ADR-019)
                                                    -- 보정 집계를 모드로 나눈다 — 섞으면 오염된다
  source          TEXT NOT NULL DEFAULT 'android'
                    CHECK (source IN ('android','pc')),   -- ADR-022 PC 확장 자리
  foreground_app  TEXT,                             -- 발동 시점에 쓰던 앱/프로세스 (보조 입력)

  risk_score      INTEGER,                          -- 1단계 결정론 점수 (기록만 — 발동 게이트 아님)
                                                    -- **서버가 record()에서 낸다** (T-32). 기기는 항 값만 뜬다 —
                                                    -- 발동이 끝난 뒤 계산해야 게이트가 될 수 없다(ADR-021)
  risk_snapshot   TEXT,                             -- JSON. 판단 시점의 항 값 전부 ★자기 보정의 원재료
                                                    -- 기기 항은 최상위 · 서버 항(§6.6)은 `server` 아래 (T-32)

  ai_used         INTEGER NOT NULL DEFAULT 0,       -- model_high 호출 여부 (ADR-024)
  ai_verdict      TEXT CHECK (ai_verdict IN ('approve','deny','unavailable')),

  reaction        TEXT CHECK (reaction IN ('accepted','override','ignored')),
                                                    -- NULL = 아직 반응 없음. 발동 시점엔 비어 있다
  reacted_at      TEXT,
  override_reason TEXT,                             -- §6.3 마찰에서 타이핑한 한 문장
  override_class  TEXT CHECK (override_class IN ('avoidant','legitimate')),
                                                    -- model_low 사후 분류 — 보정의 입력

  task_id         TEXT REFERENCES tasks(id),
  period_id       TEXT REFERENCES periods(id),
  event_id        TEXT REFERENCES events(id),       -- 보호 규칙이 붙은 일정
  outcome         TEXT CHECK (outcome IN ('success','failure')),
  outcome_at      TEXT,
  created_at      TEXT NOT NULL, client_id TEXT, ai_unavailable_reason TEXT
  CHECK (
    ai_unavailable_reason IN (
      -- 기기가 서버에 못 닿았다
      'timeout',        -- 기기가 기다리다 끊었다 (SocketTimeoutException). 상한은 GuardVerify.kt
      'dns',            -- 호스트 이름을 못 풀었다 (UnknownHostException)
      'network',        -- 연결 자체가 안 됐다 (ConnectException·SSL·소켓 끊김)
      'bad_response',   -- 2xx인데 본문이 판정이 아니다
      'no_base',        -- 서버 주소가 설정에 없다
      -- 서버는 답했는데 판정이 아니었다 (`source`가 그대로 온다)
      'server_timeout', -- 모델이 서버 예산(AI_TIMEOUT_MS)을 넘겼다
      'server_error',   -- 서버가 오류를 만났다
      'cap'             -- 일일 상한 (ADR-024 ③) — 못 부른 게 아니라 안 부른 것이다
    )
    -- 2xx가 아닌 응답. 코드까지 남긴다 — 401(토큰 만료)과 503(과부하)의 대응이 다르다.
    OR ai_unavailable_reason GLOB 'http_[0-9][0-9][0-9]'
  ), ai_reason TEXT,

  CHECK (reaction != 'override' OR override_reason IS NOT NULL)   -- Override엔 사유 필수 (§6.3)
);

CREATE TABLE guard_modes (
  key             TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  max_level       INTEGER NOT NULL CHECK (max_level BETWEEN 1 AND 4),
  risk_threshold  INTEGER NOT NULL,      -- 기록용. v1은 발동 게이트로 쓰지 않는다 (ADR-021)
  friction_mult   REAL    NOT NULL,      -- Override 대기 시간 배수. 0 = 마찰 없음
  use_fsi         INTEGER NOT NULL,
  use_overlay     INTEGER NOT NULL,
  ai_daily_cap    INTEGER NOT NULL,      -- model_high 일일 상한 (ADR-024 지출 통제 ③)
  sort            INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lm_item (
  id             TEXT PRIMARY KEY,               -- 'YYYYMMDD-NNN' (전 엔티티 공통 id 규칙)
  section        TEXT NOT NULL,                  -- 'overview' | 'goals' | 'education' | ...
  title          TEXT NOT NULL,
  body           TEXT,                           -- 서술형 md
  data           TEXT,                           -- 섹션 스키마를 따르는 JSON (검증 통과분만)
  schema_version INTEGER NOT NULL DEFAULT 1,
  source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK (source IN ('manual','ai_approved')),
  version        INTEGER NOT NULL DEFAULT 1,     -- 수정 시 +1 — stale 판정의 기준
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE lm_schema (
  section    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,          -- JSON Schema 부분집합 (type·required·enum·items·properties)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (section, version)
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
, reason TEXT);

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
  created_at TEXT NOT NULL, kind       TEXT NOT NULL DEFAULT 'period', dday_label TEXT,          -- 겹침 밴드 위→아래 배정 순서 (2.2)
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
  created_at  TEXT NOT NULL, defer_reason TEXT,
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
  created_at     TEXT NOT NULL, cancelled_at TEXT, cancelled_on TEXT, cancel_reason TEXT, cancelled_by  TEXT,
  CHECK (status = 'not_finished' OR finished_on IS NOT NULL)
);

CREATE TABLE wait_extensions (
  id             INTEGER PRIMARY KEY,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  prev_anchor_at TEXT NOT NULL,
  extended_at    TEXT NOT NULL
);

CREATE TABLE watch_apps (
  source     TEXT NOT NULL CHECK (source IN ('android','pc')),
  identifier TEXT NOT NULL,              -- 패키지명 또는 프로세스명
  label      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, identifier)
);

-- ==========================================================
-- 뷰
-- ==========================================================

CREATE VIEW v_period_achievement AS
SELECT p.id, p.title, ROUND(AVG(s.current_rate), 1) AS achievement
FROM periods p LEFT JOIN v_task_stats s
  ON s.period_id = p.id AND s.state <> 'cancelled'
GROUP BY p.id;

CREATE VIEW v_task_stats AS
SELECT
  t.id, t.title, t.period_id,
  t.status,          -- 원시 저장 컬럼. 상태 판정에 쓰지 말 것 — 아래 state 를 쓴다.
  -- ★ 이 프로젝트에서 task 상태의 유일한 진실.
  --   'cancelled' 는 물리적으로 status='not_finished' AND cancelled_at IS NOT NULL 이다.
  --   status enum 을 안 쓴 이유는 schema-current.sql 의 tasks 주석 참조.
  CASE WHEN t.cancelled_at IS NOT NULL THEN 'cancelled'
       WHEN t.status = 'finished'      THEN 'finished'
       ELSE 'not_finished' END AS state,
  t.finished_on, t.cancelled_at, t.cancelled_on,
  t.cancel_reason, t.cancelled_by,   -- (0009) append-only
  t.wait_anchor_at, t.created_at,
  (SELECT COUNT(*) FROM schedule_entries e WHERE e.task_id = t.id)             AS entry_count,
  MAX((SELECT COUNT(*) FROM schedule_entries e WHERE e.task_id = t.id) - 1, 0) AS defer_count,
  (SELECT MAX(e.date) FROM schedule_entries e WHERE e.task_id = t.id)          AS latest_date,
  CASE WHEN t.status = 'finished' THEN 100
       ELSE COALESCE((SELECT e.rate FROM schedule_entries e
                      WHERE e.task_id = t.id ORDER BY e.date DESC LIMIT 1), 0)
  END AS current_rate,
  -- ★ 취소를 대기에서 제외한다. 빠뜨리면 취소한 일에 21일 시계가 계속 돌아간다.
  CASE WHEN t.status = 'not_finished'
        AND t.cancelled_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM schedule_entries e WHERE e.task_id = t.id)
       THEN 1 ELSE 0 END AS is_waiting
FROM tasks t;

-- ==========================================================
-- 인덱스
-- ==========================================================

CREATE INDEX idx_analyses_anchor ON analyses(anchor_type, anchor_id);

CREATE INDEX idx_collected_state ON collected_items(state, starts_at);

CREATE INDEX idx_entries_date ON schedule_entries(date);

CREATE INDEX idx_entries_task ON schedule_entries(task_id, date);

CREATE INDEX idx_events_date ON events(date);

CREATE INDEX idx_events_protect ON events(date) WHERE protect_from IS NOT NULL;

CREATE UNIQUE INDEX idx_guard_events_client ON guard_events(client_id) WHERE client_id IS NOT NULL;

CREATE INDEX idx_guard_events_date ON guard_events(on_date);

CREATE INDEX idx_guard_events_event ON guard_events(event_id);

CREATE INDEX idx_guard_events_task ON guard_events(task_id);

CREATE UNIQUE INDEX idx_guard_modes_active ON guard_modes(active) WHERE active = 1;

CREATE INDEX idx_lm_item_section ON lm_item(section, updated_at DESC);

CREATE UNIQUE INDEX idx_lm_schema_active ON lm_schema(section) WHERE active = 1;

CREATE INDEX idx_logs_date ON logs(date, ts);

CREATE INDEX idx_memos_date ON memos(date);

CREATE INDEX idx_tasks_period ON tasks(period_id);

CREATE INDEX idx_tasks_status ON tasks(status);

CREATE INDEX idx_wait_ext_task ON wait_extensions(task_id, extended_at);

-- ==========================================================
-- 트리거
-- ==========================================================

CREATE TRIGGER trg_analyses_no_del BEFORE DELETE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 삭제 불가'); END;

CREATE TRIGGER trg_analyses_no_upd BEFORE UPDATE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 수정 불가'); END;

CREATE TRIGGER trg_daily_frozen BEFORE UPDATE ON daily
WHEN OLD.status = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 daily는 수정할 수 없음 — memo만 추가 가능'); END;

CREATE TRIGGER trg_entries_frozen_del BEFORE DELETE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 삭제할 수 없음'); END;

CREATE TRIGGER trg_entries_frozen_ins BEFORE INSERT ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = NEW.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날짜에는 일정을 추가할 수 없음'); END;

CREATE TRIGGER trg_entries_frozen_upd BEFORE UPDATE ON schedule_entries
WHEN (SELECT status FROM daily WHERE date = OLD.date) = 'closed'
BEGIN SELECT RAISE(ABORT, '마감된 날의 schedule 항목은 수정할 수 없음'); END;

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

CREATE TRIGGER trg_guard_event_immutable BEFORE UPDATE ON guard_events
WHEN
     OLD.id            != NEW.id
  OR OLD.fired_at      != NEW.fired_at
  OR OLD.on_date       != NEW.on_date
  OR OLD.cause         != NEW.cause
  OR OLD.level         != NEW.level
  OR IFNULL(OLD.mode,'')          != IFNULL(NEW.mode,'')
  OR OLD.source        != NEW.source
  OR IFNULL(OLD.risk_snapshot,'') != IFNULL(NEW.risk_snapshot,'')
  OR IFNULL(OLD.risk_score,-1)    != IFNULL(NEW.risk_score,-1)
  OR (OLD.reaction       IS NOT NULL AND IFNULL(NEW.reaction,'')       != OLD.reaction)
  OR (OLD.override_reason IS NOT NULL AND IFNULL(NEW.override_reason,'') != OLD.override_reason)
  OR (OLD.override_class IS NOT NULL AND IFNULL(NEW.override_class,'') != OLD.override_class)
  OR (OLD.outcome        IS NOT NULL AND IFNULL(NEW.outcome,'')        != OLD.outcome)
BEGIN
  SELECT RAISE(ABORT, 'Guard 이벤트는 수정할 수 없음 — 사후 확정 필드만 한 번 채울 수 있음');
END;

CREATE TRIGGER trg_guard_event_nodelete BEFORE DELETE ON guard_events
BEGIN
  SELECT RAISE(ABORT, 'Guard 이벤트는 삭제할 수 없음 — 개입 이력은 영구 보존');
END;

CREATE TRIGGER trg_lm_item_version AFTER UPDATE ON lm_item
WHEN NEW.version = OLD.version
BEGIN
  UPDATE lm_item SET version = OLD.version + 1 WHERE id = NEW.id;
END;

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

CREATE TRIGGER trg_task_cancel_excl BEFORE UPDATE ON tasks
WHEN NEW.cancelled_at IS NOT NULL AND NEW.status = 'finished'
BEGIN SELECT RAISE(ABORT, '완료된 task는 취소할 수 없음'); END;

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
