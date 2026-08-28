-- 0019 — AI 판정도 한 번만 채워진다 (T-50)
--
-- `trg_guard_event_immutable`이 스스로 적어 놓은 원칙:
--   "발동 시점에 행을 만들고 반응·분류·결과는 나중에 온다. 그래서 통짜 금지가 아니라
--    NULL → 값은 되고, 값 → 다른 값은 안 된다는 append-only 의미로 건다."
--
-- 그 보호를 받던 사후 필드는 넷이었다(reaction · override_reason · override_class · outcome).
-- **AI 판정 넷은 WHEN 절에 아예 없었다** — 0010이 ai_used·ai_verdict를 빼먹었고,
-- 0016(ai_unavailable_reason)·0017(ai_reason)도 트리거를 안 고쳤다.
--
-- 지금 그것을 막고 있는 것은 `db/index.ts`의 `stAmendGuardAi` 하나다:
--   ai_used = MAX(ai_used, ?) · 나머지 셋은 COALESCE(기존, ?)
-- 서버가 그렇게 쓰기 때문에 실제로는 안 덮인다. 그런데 이 리포의 원칙은
-- **"불변성은 API가 아니라 DB 트리거가 최종 강제한다"**(아키텍처 원칙 2)이고,
-- 그 마지막 방벽만 AI 판정에는 없었다. 새 경로 하나가 UPDATE를 날리면 그날로 뚫린다.
--
-- ★ `level`은 구멍이 아니다 — 완화하지 않았다.
--   `POST /api/guard/verify`는 판정만 돌려주고 기기가 그 level로 발동한다.
--   **행은 그 뒤에 생기므로** 발동 시점의 level은 사실이고 바뀔 경로가 없다(ADR-024).
--
-- ★ 옛 트리거를 DROP하고 다시 만든다 — SQLite는 트리거를 수정할 수 없다.
--   **한 줄이라도 빠뜨리면 조용히 보호가 사라진다.** 아래 WHEN 절의 앞쪽 열세 줄은
--   0010의 것을 글자 그대로 옮긴 것이고, smoke가 그 보호(reaction·outcome·level)를
--   다시 센다 — 그것이 이 작업의 유일한 위험에 대한 방벽이다.
--
-- ⚠️ 0010의 SQL은 한 글자도 안 고쳤다. 적용된 마이그레이션은 불변이다.
--   (이미 만들어진 DB의 sqlite_master엔 옛 트리거 정의가 남았다가 이 DROP으로 교체된다.)


-- ============================================================
-- 센티넬을 컬럼 타입에 맞춘다
--
--   ai_verdict · ai_unavailable_reason · ai_reason   TEXT NULL
--     → 이웃(reaction·outcome)과 **같은 모양**: OLD IS NOT NULL 이면 못 바꾼다.
--       NEW가 NULL이면 IFNULL(...,'')로 '지우기'도 변경으로 잡는다.
--
--   ai_used                                          INTEGER NOT NULL DEFAULT 0
--     → ★ **여기만 모양이 다르고, 다를 수밖에 없다.**
--       이 컬럼은 NULL이 될 수 없어서 "아직 안 채워짐"이 NULL이 아니라 **0**이다.
--       `OLD.ai_used IS NOT NULL`로 쓰면 **항상 참**이라 첫 기입(0 → 1)까지 막히고,
--       그러면 T-39가 되찾은 경로(발동 행이 먼저 올라간 뒤 판정만 뒤늦게 오는 밤)가
--       통째로 죽는다. 그 판정이 안 실리면 ADR-024 ③의 일일 상한 회계도 뚫린다(T-07).
--       그래서 **0을 '아직 안 채워짐'으로 읽는다**: 0 → 1은 되고, 1 → 0은 안 된다.
--       `IFNULL(NEW.ai_used, ...)`도 쓰지 않는다 — NOT NULL이라 NULL이 올 수 없다.
-- ============================================================

DROP TRIGGER IF EXISTS trg_guard_event_immutable;

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
  -- ── 여기부터 T-50이 더한 넷 ──────────────────────────────
  OR (OLD.ai_used != 0 AND NEW.ai_used != OLD.ai_used)
  OR (OLD.ai_verdict            IS NOT NULL AND IFNULL(NEW.ai_verdict,'')            != OLD.ai_verdict)
  OR (OLD.ai_unavailable_reason IS NOT NULL AND IFNULL(NEW.ai_unavailable_reason,'') != OLD.ai_unavailable_reason)
  OR (OLD.ai_reason             IS NOT NULL AND IFNULL(NEW.ai_reason,'')             != OLD.ai_reason)
BEGIN
  SELECT RAISE(ABORT, 'Guard 이벤트는 수정할 수 없음 — 사후 확정 필드만 한 번 채울 수 있음');
END;
