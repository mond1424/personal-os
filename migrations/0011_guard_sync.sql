-- 0011_guard_sync — 기기가 만든 식별자. ADR-023(로컬 우선 기록)의 전제.
--
-- 왜 필요한가:
--   Guard는 네트워크 없이 발동한다(ADR-021). 그러면 기록도 네트워크 없이 남아야 한다 —
--   개입이 실패하는 밤은 대개 상황이 정상이 아닌 밤이고, 하필 그날 기록이 비면 안 된다.
--   그래서 기기 로컬에 먼저 쓰고 온라인일 때 밀어 올린다.
--
--   밀어 올리기는 **재시도가 안전해야 한다.** POST가 서버에 닿았는데 응답만 유실되면
--   기기는 재시도하고, 서버 id는 서버가 만들므로 같은 발동이 두 행이 된다.
--   기기가 만든 client_id를 UNIQUE로 두면 두 번째는 조용히 같은 행을 가리킨다.
--
-- append-only라 충돌 해소가 필요 없다 — 설계 §9 #5가 "Log·memo는 비교적 안전"이라 한 것과 같은 구조.

ALTER TABLE guard_events ADD COLUMN client_id TEXT;

-- NULL(웹에서 직접 만든 것)은 여러 개 있어도 되고, 값이 있으면 유일해야 한다.
CREATE UNIQUE INDEX idx_guard_events_client ON guard_events(client_id) WHERE client_id IS NOT NULL;
