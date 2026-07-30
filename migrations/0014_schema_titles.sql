-- 0014_schema_titles — lm_schema의 각 필드에 표시 라벨(`title`)을 넣는다.
--
-- 왜 프런트가 아니라 스키마인가 (§2.2):
--   레지스트리를 둔 근거는 "검증·프롬프트 주입·UI 폼이 **같은 것**을 읽는다"다.
--   라벨만 프런트에 두면 스키마가 v2로 오를 때 새 필드가 영문 키로 남고, 그 어긋남은 조용히 생긴다.
--   폼 필드 목록은 서버에서 오는데 라벨만 프런트에 있으면 레지스트리를 반만 쓰는 것이다.
--
-- **버전을 올리지 않는다.** `version`은 §5 stale 판정의 기준이고, 라벨은 검증 의미를 바꾸지 않는다.
--   올리면 기존 lm_item 전부에 거짓 stale 신호가 나간다.
--   대가는 v1 본문의 사후 수정이지만, 검증 규칙이 동일하므로 "v1으로 검증됐다"는 기록은 그대로 참이다.
--
-- `json_set`을 쓰는 이유 — body를 통째로 다시 쓰지 않는다:
--   전체 치환은 원격 body가 조금이라도 갈라져 있으면 그걸 조용히 되돌린다.
--   json_set은 지정한 경로에만 얹으므로 다른 키를 건드리지 않고, 재실행해도 같은 결과다(멱등).
--
-- 0013의 교훈("로컬 통과, 원격 실패")이 여기엔 걸리지 않는다:
--   ① `lm_schema`에는 트리거가 없다(0012의 유일한 트리거는 `trg_lm_item_version` — lm_item 대상).
--   ② 대상 3행은 0012가 직접 INSERT한 것이라 **모든 환경에 반드시 존재한다.**
--      트리거 발화가 데이터 유무에 갈리던 그 경로가 아니다.
--
-- 검증기(`validate`)는 `title`을 해석하지 않는다 — 부분집합을 넓히지 않는다.
-- `parseSchema`가 모르는 키를 그대로 통과시키므로 읽기 경로도 안전하다.

UPDATE lm_schema
   SET body = json_set(body,
         '$.properties.name.title',          '과목명',
         '$.properties.status.title',        '상태',
         '$.properties.term.title',          '학기',
         '$.properties.grade.title',         '성적',
         '$.properties.credits.title',       '학점',
         '$.properties.prerequisites.title', '선수과목',
         '$.properties.note.title',          '메모')
 WHERE section = 'education' AND version = 1;

UPDATE lm_schema
   SET body = json_set(body,
         '$.properties.horizon.title',   '기간',
         '$.properties.period_id.title', '연결 기간',
         '$.properties.metric.title',    '지표',
         '$.properties.note.title',      '메모')
 WHERE section = 'goals' AND version = 1;

UPDATE lm_schema
   SET body = json_set(body, '$.properties.summary.title', '요약')
 WHERE section = 'overview' AND version = 1;
