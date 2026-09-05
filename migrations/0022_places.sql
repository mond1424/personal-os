-- 0022: 장소 — **WiFi 가 말하는 것은 "어디"가 아니라 "어느 네트워크"다** (ADR-046 · T-59)
--
-- 귀가·등교가 지금 아무 데도 안 남는데, 그것은 Guard 가 가장 쓰고 싶어 하는 재료다.
-- 사용자가 손으로 적을 리는 없으므로 **입력 비용을 0 으로 만든다**(ADR-028).
--
-- ★ 좌표가 없다. 이 앱이 알아야 하는 것은 *"집인가 학교인가"* 지 *"북위 몇 도인가"* 가 아니고,
--   좌표는 한 번 쌓이면 되돌릴 수 없는 종류의 기록이다(ADR-046 ①).
--
-- ★ SSID 원문도 없다. 네트워크 이름 자체가 장소를 말한다(ADR-046 ②) — 기기가 해시만 보내고
--   아래 CHECK 가 **그 형식이 아닌 값을 아예 못 들어오게 한다.** 원문을 저장하는 구현은
--   API 를 고치는 것만으로는 못 만든다.

CREATE TABLE places (
  id         TEXT PRIMARY KEY,
  -- 이름은 **사용자가 붙인다.** 시스템이 "자주 있는 곳이 집이겠지"를 하지 않는다 —
  -- 그것이 틀리는 날은 하필 평소와 다른 날이고, 이 앱이 관심 있는 날이 정확히 그날이다.
  name       TEXT NOT NULL,
  -- SHA-256(SSID) 앞 16자리 소문자 hex. 기기의 WifiProbe.netId 와 같은 약속이다.
  -- ⚠️ BSSID(AP 의 MAC)는 안 섞는다 — 학교처럼 AP 가 여럿인 곳에서 같은 네트워크가
  --    AP 마다 다른 장소가 되어 버린다. 진단 프로브는 섞었고, 기능은 안 섞는다.
  net_id     TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (length(trim(name)) > 0),
  CHECK (length(name) <= 40),
  CHECK (length(net_id) = 16 AND net_id NOT GLOB '*[^0-9a-f]*')
);

-- 전이 — **상태가 아니라 바뀐 순간을 남긴다**(ADR-046 ③ · 원칙 1).
-- *"지금 집에 있다"* 는 지금 물으면 알 수 있으므로 저장할 이유가 없다.
--
-- ★ `logs` 가 아니다(ADR-046 ④ · ADR-044 와 같은 판단). `logs` 는 **사용자가 적은 것**이고,
--   여기 자동 기입을 넣으면 *"내가 적었다"* 와 *"기계가 봤다"* 가 한 칸에 섞인다.
-- ★ 그리고 마감 동결 트리거를 두지 않는다. `logs`·`feelings`·`schedule_entries` 셋은
--   `*_frozen_ins` 가 삽입까지 막는데(함정 6), 늦게 도착한 관측은 **사람이 그날을 마감한
--   뒤에 도착하는 것이 정상**이다. 저기 넣었으면 그 관측이 409 로 죽었다.
CREATE TABLE place_visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id   TEXT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  at         TEXT NOT NULL,   -- 관측 시각 (ISO8601, 오프셋 포함)
  date       TEXT NOT NULL,   -- 귀속일 — 기록 시점에 확정. 경계를 바꿔도 과거는 안 바뀐다
  created_at TEXT NOT NULL
);

CREATE INDEX idx_place_visits_date ON place_visits(date, at);
CREATE INDEX idx_place_visits_at ON place_visits(at);
