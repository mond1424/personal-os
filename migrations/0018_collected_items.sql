-- 0018 — 학사 일정 수집 원장 (T-41 · ADR-037)
--
-- cron이 iCal 토큰 URL을 읽어 VEVENT를 여기 쌓는다. 화면에 꺼내는 것은 T-42다.
--
-- ★ **해석하지 않는다.** `summary`·`description`은 **원문 그대로** 넣는다.
--   실측(ADR-037 §실측)에서 확인된 것과 아닌 것이 갈렸다:
--     ✅ UID · SUMMARY · DESCRIPTION · CLASS · LAST-MODIFIED · DTSTAMP · DTSTART · DTEND
--     ✅ DTSTART는 UTC(Z)
--     ❌ CATEGORIES가 없다 — 강좌 구분이 어디 실리는지 모른다
--     ❌ 과제 due 이벤트의 SUMMARY 형식을 모른다
--   **모르는 것을 지금 정하면 개강 첫날 틀린다.** 원문을 남겨 두면 형식을 알게 된 뒤에
--   다시 뽑을 수 있고, 버렸으면 그 기간이 통째로 못 쓰게 된다.
--
-- ★ **이것은 파생값이 아니다** — 원칙 1(파생은 저장하지 않는다)과 충돌하지 않는다.
--   원천이 **밖**에 있고 내보내기 창이 `-5일 ~ +365일`로 고정이라
--   **지나가면 다시 못 가져온다.** 조회로 재현되지 않으므로 사본이 아니라 **기록**이다.
--   (같은 이유로 `guard_events`도 기록이다. `summaries.mech`만이 캐시다.)
--
-- ★ **목록에서 사라져도 지우지 않는다.** 창이 좁아 **지난 마감은 자동으로 빠진다** —
--   사라짐을 삭제로 읽으면 **어제 한 과제가 오늘 사라진다.** 취소와 만료를 가르는 것은
--   `starts_at`이 과거인지로 볼 일이지 목록 부재로 볼 일이 아니다.
--   그래서 삭제 대신 `last_seen_at`만 갱신한다 — "언제까지 목록에 있었나"가 사실이다.
--
-- `uid`가 UNIQUE인 것이 diff의 기준이자 재수집의 멱등 키다(0011의 `client_id`와 같은 역할).
-- 해시가 아니라 UID인 이유는 ADR-037 §근거 ②: 해시는 "무언가 바뀌었다"까지고
-- UID는 "어느 것이 바뀌었다"다.

CREATE TABLE collected_items (
  id            TEXT PRIMARY KEY,                 -- 'YYYYMMDD-NNN' (리포 관례)
  uid           TEXT NOT NULL UNIQUE,             -- iCal UID. diff 기준 · 멱등 키
  source        TEXT NOT NULL DEFAULT 'uclass'
                  CHECK (source IN ('uclass')),   -- 원천이 늘 것을 전제로 칸을 둔다
  summary       TEXT NOT NULL,                    -- 원문 그대로. 해석 금지
  description   TEXT,                             -- 원문 그대로. 비어 있어도 칸을 둔다
  starts_at     TEXT,                             -- DTSTART를 로컬 오프셋 표기로 정규화
  ends_at       TEXT,                             -- DTEND. 쓰는 곳은 아직 없지만 **버리지 않는다**
  last_modified TEXT,                             -- LAST-MODIFIED — 변경 감지
  first_seen_at TEXT NOT NULL,                    -- 처음 본 시각
  last_seen_at  TEXT NOT NULL,                    -- 마지막으로 목록에 있던 시각 ← 사라짐 판정 근거
  state         TEXT NOT NULL DEFAULT 'new'
                  CHECK (state IN ('new','accepted','dismissed')),
  event_id      TEXT REFERENCES events(id),       -- accepted일 때 만들어진 일정 (T-42)
  created_at    TEXT NOT NULL
);

-- 제안 카드가 "아직 안 묻은 것"을 시각순으로 꺼낸다 (T-42).
CREATE INDEX idx_collected_state ON collected_items(state, starts_at);
