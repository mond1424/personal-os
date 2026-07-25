-- 취소 사유: '왜 접었는가'를 기록으로 남긴다. Guard가 패턴을 읽으려면 사유가 있어야 한다.
-- ★ append-only — 취소 시점에 한 번 쓰고, 취소 상태인 동안 수정하지 않는다.
--   취소 해제 시에도 NULL 로 지우지 않고 남긴다(다음 취소가 덮어쓴다).
--   진짜 이력이 필요해지면 wait_extensions(trg_wait_ext_no_del/no_upd)와 동형의
--   task_cancellations 테이블로 승격한다. Guard 스켈레톤 전까지는 컬럼으로 시작.
ALTER TABLE tasks ADD COLUMN cancel_reason TEXT;   -- 취소 사유(자유 텍스트, NULL 허용) (0009)
ALTER TABLE tasks ADD COLUMN cancelled_by  TEXT;   -- 'user' | 'guard' — 취소 주체 (0009)

-- 뷰 재생성 — 두 컬럼을 TaskStats 로 노출하기 위함.
-- 0008 의 state CASE 식과 cancelled_at/cancelled_on, is_waiting 의 취소 제외 조건,
-- v_period_achievement 의 state <> 'cancelled' 는 한 글자도 바꾸지 않는다. 두 컬럼만 추가한다.
-- 트리거 trg_task_cancel_excl 은 tasks 에 걸려 있어 뷰 재생성과 무관하다(건드리지 않음).
DROP VIEW v_period_achievement;
DROP VIEW v_task_stats;

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

-- ★ 달성률 오염 방지: 접은 일의 current_rate(대개 0)가 평균에 섞이면
--   "취소 때문에 기간 달성률이 깎이는" 왜곡이 생긴다.
CREATE VIEW v_period_achievement AS
SELECT p.id, p.title, ROUND(AVG(s.current_rate), 1) AS achievement
FROM periods p LEFT JOIN v_task_stats s
  ON s.period_id = p.id AND s.state <> 'cancelled'
GROUP BY p.id;
