-- 취소: 삭제가 1.3 불변성에 막히는 일을, 기록을 보존한 채 목록에서 내리는 길.
ALTER TABLE tasks ADD COLUMN cancelled_at TEXT;  -- 실제 취소 시각(ISO). NULL = 살아 있음
ALTER TABLE tasks ADD COLUMN cancelled_on TEXT;  -- 취소가 귀속된 날(경계 반영, YYYY-MM-DD)

-- 완료와 취소는 동시에 성립하지 않는다. ALTER 로 CHECK 을 못 다니 트리거로 강제.
CREATE TRIGGER trg_task_cancel_excl BEFORE UPDATE ON tasks
WHEN NEW.cancelled_at IS NOT NULL AND NEW.status = 'finished'
BEGIN SELECT RAISE(ABORT, '완료된 task는 취소할 수 없음'); END;

-- 뷰 재생성. v_period_achievement 가 v_task_stats 를 참조하므로 drop 순서를 지킬 것.
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
