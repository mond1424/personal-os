-- 0005 — task 취소를 막던 '보이지 않는 참조' 해소
--
-- 증상: 한 번이라도 대기 연장을 한 task 는 취소가 되지 않고
--       "다른 기록이 참조하고 있어 지울 수 없어요"(FK 번역)만 떴다.
--
-- 원인: wait_extensions 가 tasks(id) 를 FK 로 참조하는데,
--       trg_wait_ext_no_del 이 그 행의 삭제를 무조건 막고 있었다.
--       즉 부모도 자식도 지울 수 없는 잠금이 되어 버렸다.
--
-- 해소: 1.3 은 "계획은 지울 수 있고, 기록은 지울 수 없다"이고
--       task 취소는 '마감된 날의 항목이 하나도 없을 때'만 허용된다.
--       그 조건을 만족하는 task 는 아직 어떤 하루에도 기록되지 않은 순수한 계획이므로,
--       거기 붙은 연장 이력도 따로 보존할 대상이 아니다.
--       그래서 잠금의 범위를 '마감 기록이 있을 때'로 좁힌다 —
--       수정 금지(trg_wait_ext_no_upd)는 그대로, append-only 성질도 그대로다.

DROP TRIGGER trg_wait_ext_no_del;

CREATE TRIGGER trg_wait_ext_no_del BEFORE DELETE ON wait_extensions
WHEN EXISTS (
  SELECT 1 FROM schedule_entries e JOIN daily d ON d.date = e.date
   WHERE e.task_id = OLD.task_id AND d.status = 'closed'
)
BEGIN SELECT RAISE(ABORT, '마감 기록이 있는 task의 연장 이력은 삭제할 수 없음'); END;
