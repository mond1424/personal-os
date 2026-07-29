-- 0010_guard — Guard v1 (8월). 설계 §6 · APP-ADR 011·018·019·021·022·023·024
--
-- 셋을 한다:
--   ① guard_events 재작성 — 발동 스냅샷·모드·출처·AI 판정 추가, reaction에 'ignored' 허용
--   ② events에 보호 규칙 필드 — 데드라인 역산의 입력
--   ③ guard_modes · watch_apps — 3주차·PC 확장의 자리 (미리 깔아 마이그레이션을 아낀다)


-- ============================================================
-- ① guard_events 재작성
--
-- 왜 ALTER가 아니라 재작성인가:
--   reaction CHECK가 ('accepted','override')뿐인데 **'ignored'가 필요하다.**
--   Android 14+에서 알림을 밀어 지우는 걸 막을 수 없게 됐고(setOngoing 무력화),
--   막을 수 없다면 대신 센다 — 무시한 것 자체가 Guard Memory의 데이터다.
--   SQLite는 CHECK를 변경할 수 없으므로 재작성이 유일한 길이다.
--   구현 3 미착수라 행이 없거나 극소수다. 있으면 그대로 옮긴다.
--
-- 핵심 컬럼은 risk_snapshot이다. 자기 보정(§6.5)은 "어떤 입력에서 어떤 판단을 했고
-- 결과가 어땠는가"의 집계이므로, 판단 시점의 항 값이 없으면 보정 자체가 불가능하다.
-- 소급해서 만들 수 없다 — 그래서 발동 로직보다 먼저 스키마에 넣는다.
-- ============================================================

CREATE TABLE guard_events_new (
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
  risk_snapshot   TEXT,                             -- JSON. 판단 시점의 항 값 전부 ★자기 보정의 원재료

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
  created_at      TEXT NOT NULL,

  CHECK (reaction != 'override' OR override_reason IS NOT NULL)   -- Override엔 사유 필수 (§6.3)
);

INSERT INTO guard_events_new
  (id, fired_at, on_date, cause, level, reaction, override_reason,
   task_id, period_id, outcome, outcome_at, created_at)
SELECT
  id, fired_at, substr(fired_at, 1, 10), cause, level, reaction, override_reason,
  task_id, period_id, outcome, outcome_at, created_at
FROM guard_events;

DROP TABLE guard_events;
ALTER TABLE guard_events_new RENAME TO guard_events;

CREATE INDEX idx_guard_events_date ON guard_events(on_date);
CREATE INDEX idx_guard_events_task ON guard_events(task_id);
CREATE INDEX idx_guard_events_event ON guard_events(event_id);

-- 불변성 (§1.3) — 단 '사후 확정'은 한 번만 채울 수 있다.
--
-- 발동 시점에 행을 만들고 반응·분류·결과는 나중에 온다. 그래서 통짜 금지가 아니라
-- **NULL → 값은 되고, 값 → 다른 값은 안 된다**는 append-only 의미로 건다.
-- 이렇게 해야 "발동했지만 아무 반응이 없었다"도 행으로 남는다.
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


-- ============================================================
-- ② events 보호 규칙 (설계 §6.2 사전 서약 · §9 #1 최소 확정)
--
-- 데드라인은 저장하지 않고 역산한다 — 파생은 저장하지 않는다(원칙 4).
--   취침 데드라인 = 일정 시각 − protect_prep_min − protect_sleep_min
--   예) 시험 09:00 − 90분 − 360분 = 01:30  (설계 §6.1 Level 3 예시와 일치)
--
-- NULL이면 보호 없음. 반복·복합 조건은 v1에 넣지 않는다.
-- ============================================================

ALTER TABLE events ADD COLUMN protect_from      TEXT;      -- '-1d 00:00' 보호 모드 진입(일정 기준 상대)
ALTER TABLE events ADD COLUMN protect_level     INTEGER;   -- 활성화할 최대 Level (1~4)
ALTER TABLE events ADD COLUMN protect_sleep_min INTEGER;   -- 필요 수면(분). NULL이면 설정 기본값
ALTER TABLE events ADD COLUMN protect_prep_min  INTEGER;   -- 기상~출발 준비(분). NULL이면 설정 기본값

CREATE INDEX idx_events_protect ON events(date) WHERE protect_from IS NOT NULL;


-- ============================================================
-- ③ guard_modes (ADR-019) — 규칙이 아니라 파라미터 프로파일
--
-- 규칙 집합은 하나고 모드가 강도를 스케일링한다. 모드 추가 = 행 하나.
-- 3주차(S3.4)에 UI만 붙이면 되도록 지금 깔아 둔다.
-- ============================================================

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

-- 활성 모드는 하나뿐
CREATE UNIQUE INDEX idx_guard_modes_active ON guard_modes(active) WHERE active = 1;

INSERT INTO guard_modes (key, label, max_level, risk_threshold, friction_mult, use_fsi, use_overlay, ai_daily_cap, sort, active) VALUES
  ('secretary', '비서 — 알려주고 기록한다', 2, 70, 0.0, 0, 0, 0, 0, 0),
  ('coach',     '코치 — 개입한다',          4, 40, 1.0, 1, 1, 5, 1, 1);


-- ============================================================
-- ④ watch_apps (ADR-022) — PC 감지의 스키마 자리
--
-- PC 에이전트 자체는 9월 이후다. 지금 필요한 것은 **폰 전용으로 굳지 않는 것**뿐이다.
-- 컬럼 하나 값이 학기 데이터보다 싸다.
-- ============================================================

CREATE TABLE watch_apps (
  source     TEXT NOT NULL CHECK (source IN ('android','pc')),
  identifier TEXT NOT NULL,              -- 패키지명 또는 프로세스명
  label      TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source, identifier)
);
