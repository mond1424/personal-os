-- 0026 — 이미 들어간 과제의 이름에서 끝의 "기한"을 뗀다 (T-86 ④ · 소급)
--
-- T-83 이 할 일만, T-86 이 일정과 목록까지 뗐다 — 둘 다 **앞으로 들어오는 것**이다.
-- 이미 수락된 것은 원문 그대로 남아 있었다. 이 파일이 그것을 한 번 고친다.
--
-- 실측 2026-10-01 (원격 D1) — 티켓 ① 전수:
--   collected_items 9 — summary 가 " 기한" 으로 끝나지 않는 행 0 (끝 공백 0 · NFC)
--     ★ 그 0 은 알려진 정답 둘로 갈랐다 — 같은 비교가 '학기과제 기한' 에 1 · '학기과제' 에 0 (함정 18)
--   events 9 — 제목이 원문 그대로 9 · tasks 6 — 원문 그대로 4 (둘은 T-83 이 이미 뗐다)
--   마감된 날에 걸린 일정 2 (09-09 · 09-26) — trg_events_frozen_upd 가 UPDATE 를 막는다
--
-- ★ **원장(`collected_items.summary`)은 안 건드린다** (T-74).
-- ★★ **원문과 같은 제목만 고친다** — 두 title 은 자유 변경 칸이라, 원문과 다르면 사용자가 고친 것이다.
--    짝은 `event_id`·`task_id` 로 잇는다. 제목으로 찾지 않는다.
-- ★★ **마감된 날의 일정은 건너뛴다 — 트리거를 우회하지 않는다.**
--    ⚠️ 거르지 않으면 한 행이 UPDATE 전체를 ABORT 시키고 **이 파일이 원격에서만 죽는다** —
--    0013 이 이미 한 번 물린 모양이다(로컬엔 그 행이 없어 통과한다). 건너뛴 행은 원문으로 남는다.
--    ⚠️ **몇 행이 건너뛰어지는지는 적용 시점의 `daily` 가 정한다** — 위 2 는 10-01 의 수다.
--    할 일에는 동결 트리거가 없어 그대로 고친다(`trg_task_cancel_excl` 은 취소 칸만 본다).
--
-- ⚠️⚠️ **이 SQL 은 `services/collected.ts` 의 `titleOf` 와 같은 규칙을 한 번 더 쓴다.**
--    한 번만 도는 일이라 받아들였다(티켓 ④). 규칙: 앞뒤 공백을 걷고 · 끝이 `기한` 이면 떼고 ·
--    다시 걷고 · 비면 안 고친다. `smoke [T-86]` 검사 8 이 경계에서 두 벌이 같은 답을 내는지 센다.
--    ⚠️ **여기는 공백(' ')만 걷는다 — JS `trim()` 보다 좁다.** 좁은 쪽으로 어긋나면
--    *안 고치는* 쪽이라 안전하다. 실측 9건은 끝 공백이 0 이다.
--    **`titleOf` 를 나중에 고쳐도 이 파일은 고치지 않는다** — 이미 적용된 이력이다.
--
-- 새 제목은 **자기 제목에서** 만든다 — 조건이 *"제목 = 원문"* 이므로 같은 값이다.

UPDATE events
   SET title = trim(substr(trim(title, ' '), 1, length(trim(title, ' ')) - 2), ' ')
 WHERE EXISTS (SELECT 1 FROM collected_items c
                WHERE c.event_id = events.id AND c.summary = events.title)
   AND substr(trim(title, ' '), -2) = '기한'
   AND trim(substr(trim(title, ' '), 1, length(trim(title, ' ')) - 2), ' ') <> ''
   AND NOT EXISTS (SELECT 1 FROM daily d
                    WHERE d.date = events.date AND d.status = 'closed');

UPDATE tasks
   SET title = trim(substr(trim(title, ' '), 1, length(trim(title, ' ')) - 2), ' ')
 WHERE EXISTS (SELECT 1 FROM collected_items c
                WHERE c.task_id = tasks.id AND c.summary = tasks.title)
   AND substr(trim(title, ' '), -2) = '기한'
   AND trim(substr(trim(title, ' '), 1, length(trim(title, ' ')) - 2), ' ') <> '';
