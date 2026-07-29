-- 0013_analysis_backfill — 기존 analysis에 날짜 앵커를 채운다.
--
-- 0012에서 분리한 이유:
--   `trg_analyses_no_upd`가 analyses의 **모든 UPDATE를 막는다**(설계 §5.4 — analysis는 영구 보존).
--   0012에 backfill을 넣었더니 로컬(analyses 0행)에서는 UPDATE가 no-op이라 통과하고,
--   실제 분석이 쌓인 원격에서만 SQLITE_CONSTRAINT_TRIGGER로 터졌다.
--   **데이터 유무에 따라 트리거 발화가 갈리는 경로** — 로컬 검증이 원격을 보장하지 못한다.
--
-- 불변성을 완화하지 않는다. 트리거를 잠시 내렸다가 **원문 그대로** 다시 건다.
-- 앞으로 생성되는 analysis는 INSERT 시점에 앵커를 받으므로(services/analysis.ts)
-- 이 UPDATE 경로는 이 마이그레이션 한 번뿐이다.

DROP TRIGGER IF EXISTS trg_analyses_no_upd;

-- id가 'YYYYMMDD-NNN'이라 앞 8자리가 곧 생성 날짜다. 별도 조인이 필요 없다.
UPDATE analyses
   SET anchor_type = 'date',
       anchor_id   = substr(id,1,4) || '-' || substr(id,5,2) || '-' || substr(id,7,2)
 WHERE anchor_type IS NULL;

-- 0001_init.sql과 동일하게 복원. 문구도 같아야 translateDbError가 그대로 번역한다.
CREATE TRIGGER trg_analyses_no_upd BEFORE UPDATE ON analyses
BEGIN SELECT RAISE(ABORT, 'analysis는 영구 보존 — 수정 불가'); END;
