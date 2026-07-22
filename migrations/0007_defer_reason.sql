-- 미루기 사유: 도착지 항목(새 예정)에 남긴다.
-- 원 항목은 마감된 날이면 트리거가 수정을 막으므로, 열린 날/재배정 두 갈래 모두
-- '새로 만들어지는 도착지 항목'에 사유를 붙여 균일하게 보존한다.
-- (테이블명: 예정 항목은 schedule_entries 이다 — WORK-PLAN의 task_entries 표기는 오기.)
ALTER TABLE schedule_entries ADD COLUMN defer_reason TEXT;
