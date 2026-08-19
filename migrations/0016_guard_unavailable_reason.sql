-- 0016 — `unavailable`이 이유를 말한다 (T-31)
--
-- 8/11 밤 여섯 후보 중 넷이 `unavailable`이었다(02:30·03:00·03:30·04:00).
-- 기록은 "부를 수 없었다"까지이고 **왜**가 없다. Doze인지 · Wi-Fi 절전인지 ·
-- 앱 대기 버킷인지 · 서버가 늦은 것인지 — **셋의 대응이 완전히 다르다.**
-- 9월 1일부터 §6.5의 전례가 쌓이는데, 그때 없던 항은 12월에 만들 수 없다.
--
-- ★ `ai_verdict`는 건드리지 않는다. 값은 계속 'unavailable'이다.
--
-- 티켓 초안은 `ai_verdict`를 'unavailable:timeout'으로 넓히자고 했는데
-- **그대로 하면 기록이 사라진다.** 0010의 CHECK가 세 값만 받으므로 위반 → 400이 되고
-- (`translateDbError`), 기기의 `GuardEventQueue.flush()`는 400을 '재시도 무의미'로 보고
-- **큐에서 버린다.** 이유를 잃는 게 아니라 **발동 행 자체가** 사라진다 —
-- 그것도 네트워크가 나쁜 밤에만, 즉 이 티켓이 관측하려는 바로 그 밤에만.
--
-- 그래서 **더하고, 빼지 않는다**: 값은 그대로 두고 이유를 옆에 놓는다.
--   · `ai_verdict` CHECK 무변경 → 과거 행과 새 행이 **글자 그대로** 같은 부류다
--   · 캐시 조건 `IN ('approve','deny')` 무변경 → `unavailable`은 여전히 안 걸린다
--   · 읽는 쪽이 `= 'unavailable'`로 비교해도 **영원히 안 어긋난다** (모양이 안 변한다)
--   · 테이블 재작성 없음 → 개입 이력(영구 보존)을 옮기지 않는다
--
-- 과거 행은 NULL이다 — **"모른다"가 사실이다.** 소급해서 만들지 않는다.
--
-- 닫힌 목록인 이유: 12월에 **세어야** 한다. 자유 문자열이면 같은 원인이 세 가지 철자로
-- 흩어져 집계가 안 된다. 대장은 `src/services/guard.ts`의 `UNAVAILABLE_REASONS`이고
-- 이 CHECK는 그 메아리다 — smoke가 셋(TS · 이 파일 · GuardVerify.kt)이 같은지 본다.

ALTER TABLE guard_events ADD COLUMN ai_unavailable_reason TEXT
  CHECK (
    ai_unavailable_reason IN (
      -- 기기가 서버에 못 닿았다
      'timeout',        -- 기기가 기다리다 끊었다 (SocketTimeoutException). 상한은 GuardVerify.kt
      'dns',            -- 호스트 이름을 못 풀었다 (UnknownHostException)
      'network',        -- 연결 자체가 안 됐다 (ConnectException·SSL·소켓 끊김)
      'bad_response',   -- 2xx인데 본문이 판정이 아니다
      'no_base',        -- 서버 주소가 설정에 없다
      -- 서버는 답했는데 판정이 아니었다 (`source`가 그대로 온다)
      'server_timeout', -- 모델이 서버 예산(AI_TIMEOUT_MS)을 넘겼다
      'server_error',   -- 서버가 오류를 만났다
      'cap'             -- 일일 상한 (ADR-024 ③) — 못 부른 게 아니라 안 부른 것이다
    )
    -- 2xx가 아닌 응답. 코드까지 남긴다 — 401(토큰 만료)과 503(과부하)의 대응이 다르다.
    OR ai_unavailable_reason GLOB 'http_[0-9][0-9][0-9]'
  );
