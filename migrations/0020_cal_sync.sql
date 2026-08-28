-- 0020 — 폰 캘린더가 보낼 자리 (T-52 · ADR-029)
--
-- 기기가 `POST /api/cal/sync`로 창 범위의 일정을 통째로 보내고, 서버가 `events`에 맞춘다.
-- **읽기 방향만이다** — 쓰기(앱 → 캘린더)는 9월이고, 그때까지 갈라짐을 물리적으로 차단한다.
--
-- ★ 세 칼럼이 하는 일:
--   ext_src      'devcal' | NULL. **NULL이 "앱이 만든 일정"이고, 동기화는 그것을 절대 안 지운다.**
--                삭제 후보를 고르는 SQL이 `ext_src = 'devcal'`로 시작하므로 구조가 그것을 강제한다.
--   ext_uid      기기 쪽 식별자. 반복은 인스턴스 단위 '<eventId>:<날짜>'다 —
--                마스터 1건으로 키잉하면 개강 후 수업이 통째로 한 행이 된다(ADR-029).
--   ext_updated  LWW 기준. 저장된 것보다 오래된 갱신은 무시한다(해소 UI 없음).
--
-- ★ 유니크 인덱스가 부분(partial)인 이유: 앱이 만든 일정은 `ext_src`도 `ext_uid`도 NULL이라
--   전체 유니크로 걸면 **두 번째 앱 일정부터 막힌다.** SQLite는 NULL을 서로 다르게 보므로
--   실제로는 안 막히지만, 조건을 명시해 **의도를 스키마에 남긴다** — 나중에 NOT NULL 기본값이
--   붙는 실수가 있어도 인덱스가 앱 일정을 건드리지 않는다.
--
-- ⚠️ 이 마이그레이션은 **DDL만 더한다.** 기존 행은 셋 다 NULL이 되고, 그것이 곧
--    "앱이 만든 일정"이라는 뜻이다 — 과거 데이터를 소급해서 devcal로 바꾸지 않는다.
--    (ADR-029의 "기존 수동 입력분과의 병합"은 별건이고 이 티켓 밖이다.)
--
-- ⚠️ **마감된 날 방어는 여기 없다.** `events`에는 `_ins` 트리거가 없어서(함정 6)
--    DB가 막아 주지 않는다 — **서버(`services/calsync.ts`)가 유일한 방어선**이고,
--    그래서 그쪽이 마감 여부를 **먼저 판단하고 건너뛴다.**
--    (UPDATE·DELETE는 `trg_events_frozen_upd`·`_del`이 막지만, 그건 409가 되어
--     동기화 배치를 통째로 깨뜨리는 모양이라 서버가 먼저 걸러야 한다.)

ALTER TABLE events ADD COLUMN ext_src TEXT;
ALTER TABLE events ADD COLUMN ext_uid TEXT;
ALTER TABLE events ADD COLUMN ext_updated TEXT;

CREATE UNIQUE INDEX idx_events_ext
  ON events(ext_src, ext_uid) WHERE ext_src IS NOT NULL;
