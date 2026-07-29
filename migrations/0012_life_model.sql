-- 0012_life_model — Me Reinforcement Plan Phase 1-a (서버·스키마만. UI 없음)
--
-- 계획서: me-reinforcement-plan.md §2.1 · §2.2 · §2.3 · §1(기간 constraint)
--
-- 이 마이그레이션이 지금 필요한 이유는 계획서 §2.3이 직접 쓴다:
--   "이후 생성되는 모든 analysis가 처음부터 anchor·source_versions를 갖게 되어
--    Phase 3의 stale 판정이 소급 적용된다."
--
-- source_versions는 **생성 시점의 입력 스냅샷**이라 나중에 만들 수 없다.
-- 9~11월에 analysis가 anchor 없이 쌓이면 그 구간은 영영 stale 판정 밖이다.
-- guard_events.risk_snapshot과 같은 논리 — 데이터는 소급해서 만들 수 없다(ADR-020).


-- ============================================================
-- ① analysis 앵커 일반화 (§2.3)
--
-- "양자역학2 준비 분석" = anchor_type='entity'인 analysis.
-- 별도 객체를 만들지 않는다 — Life Model 분석·과목 분석·프로젝트 분석이 전부 이 구조를 재사용한다.
-- ============================================================

ALTER TABLE analyses ADD COLUMN anchor_type     TEXT;   -- 'date' | 'entity'
ALTER TABLE analyses ADD COLUMN anchor_id       TEXT;   -- 날짜 또는 lm_item.id
ALTER TABLE analyses ADD COLUMN model_tier      TEXT;   -- 'high' | 'medium' | 'low' (§3)
ALTER TABLE analyses ADD COLUMN source_versions TEXT;   -- JSON [{table,id,version}] — stale 판정의 근거

CREATE INDEX idx_analyses_anchor ON analyses(anchor_type, anchor_id);

-- 기존 행 backfill은 여기서 하지 않는다 — 0013으로 분리했다.
--
-- 이유: `trg_analyses_no_upd`가 analyses의 모든 UPDATE를 막는다(설계 §5.4 영구 보존).
--   로컬은 analyses가 0행이라 UPDATE가 no-op이 되어 트리거가 깨어나지 않았고,
--   실제 분석이 쌓인 원격에서만 터졌다. **로컬에서 통과한 마이그레이션이
--   원격에서 실패하는 경로** — 데이터 유무에 따라 트리거 발화가 갈린다.
--
-- 트리거를 잠시 내렸다 올리는 조작은 스키마 변경과 성격이 다르므로 파일을 나눈다.


-- ============================================================
-- ② 기간에 constraint/디데이 (§1)
--
-- "군입대까지 N개월" 같은 제약은 별도 구조를 만들지 않고 기간에 속성을 얹는다.
-- Goals와 연동되고, Guard의 고정 코어 컨텍스트(§6.2)에 들어간다.
-- ============================================================

ALTER TABLE periods ADD COLUMN kind       TEXT NOT NULL DEFAULT 'period';
                                          -- 'period' | 'constraint' — 제약은 배경 밴드가 아니라 디데이로 읽는다
ALTER TABLE periods ADD COLUMN dday_label TEXT;   -- '입대' 같은 표시명. NULL이면 디데이 표시 안 함


-- ============================================================
-- ③ lm_item — Life Model 공통 항목 (§2.1)
--
-- 섹션 하나에 테이블 하나를 만들지 않는다. 범용 테이블 하나 + 섹션 스키마로 형태를 규정한다.
-- Overview/Knowledge처럼 서술형은 body 위주, Education처럼 정형은 data 위주.
-- ============================================================

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

CREATE INDEX idx_lm_item_section ON lm_item(section, updated_at DESC);

-- 수정하면 version이 오른다. 이게 §5 stale 체인의 출발점 —
-- 트리거로 강제해야 서비스 계층이 빠뜨려도 판정이 깨지지 않는다.
CREATE TRIGGER trg_lm_item_version AFTER UPDATE ON lm_item
WHEN NEW.version = OLD.version
BEGIN
  UPDATE lm_item SET version = OLD.version + 1 WHERE id = NEW.id;
END;


-- ============================================================
-- ④ lm_schema — 섹션 스키마 레지스트리 (§2.2)
--
-- 스키마는 코드가 아니라 **데이터**로 둔다. 소비처가 셋이고 셋 다 같은 것을 읽는다:
--   쓰기 검증 · 프롬프트 주입 · UI 폼 생성
--
-- 필드 추가·변경 시 버전을 올리고, 기존 행은 마이그레이션하지 않고
-- lm_item.schema_version으로 구분해 읽는다.
-- ============================================================

CREATE TABLE lm_schema (
  section    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,          -- JSON Schema 부분집합 (type·required·enum·items·properties)
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (section, version)
);

-- 섹션당 활성 버전은 하나
CREATE UNIQUE INDEX idx_lm_schema_active ON lm_schema(section) WHERE active = 1;

-- v1 세 섹션. **필수 필드를 최소로** 둔다 — 빈칸 허용 원칙과 충돌하면 안 된다(§2.2).
INSERT INTO lm_schema (section, version, body, active, created_at) VALUES
('overview', 1, '{"section":"overview","version":1,"type":"object","required":[],"properties":{"summary":{"type":"string"}}}', 1, '2026-07-29'),
('goals', 1, '{"section":"goals","version":1,"type":"object","required":["horizon"],"properties":{"horizon":{"type":"string","enum":["long","short"]},"period_id":{"type":"string"},"metric":{"type":"string"},"note":{"type":"string"}}}', 1, '2026-07-29'),
('education', 1, '{"section":"education","version":1,"type":"object","required":["name","status"],"properties":{"name":{"type":"string"},"status":{"type":"string","enum":["completed","enrolled","planned"]},"term":{"type":"string"},"grade":{"type":"string"},"credits":{"type":"number"},"prerequisites":{"type":"array","items":{"type":"string"}},"note":{"type":"string"}}}', 1, '2026-07-29');
