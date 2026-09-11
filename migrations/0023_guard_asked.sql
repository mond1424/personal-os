-- 0023 — 안 물은 것을 안 했다고 적지 않는다 (T-70 · ADR-047 §정정)
--
-- 40일치 `ignored`가 관측이 아니었다. L2 알림에는 `addAction`이 없어 **반응 버튼이
-- 사용자 앞에 선 적이 없는데**, 유예(36시간)가 지나면 cron이 그것을 `ignored`로 박았다.
-- 그 거짓 수를 T-60의 나그 카드가 세어 "N번 그냥 지나갔어요 — 꺼 둘까요?"를 띄웠고,
-- 사용자가 껐고, 켤 자리가 없어 T-63이 났다.
-- **안 물어봐 놓고 안 했다고 세면, 그 수가 사람에게 권한다.**
--
-- 둘을 한다:
--   ① asked — **반응 버튼이 사용자 앞에 있었는가.** 기기가 발동과 함께 올린다
--   ② reaction CHECK에 'unasked' — 물었다고 볼 수 없는 발동이 받는 값


-- ============================================================
-- ① 왜 `shown`이 아니라 `asked`인가
--
-- 티켓 ①은 이 값을 `shown`(화면이 떴는가)이라 불렀다. **이름을 바꿨고 뜻은 그대로다.**
-- 세는 것은 *"반응 버튼이 사용자 앞에 있었는가"* 이지 *"알림이 떴는가"* 도
-- *"화면이 떴는가"* 도 아니다. 기기에는 `FireResult.shown`(개입 화면이 떴는가)과
-- `posted`(알림이 떴는가)가 이미 있고, 이 칸 이름이 `shown`이면 **다음 사람이 그 둘 중
-- 하나를 여기에 꽂는다** — 오늘은 답이 같아서 아무 검사도 안 잡는다(함정 15가 `#cal-list`
-- 하나로 물린 그 모양). 이름이 세는 것과 같으면 잘못 꽂을 수가 없다.
--
-- 값의 뜻:
--   1      반응 버튼이 앞에 있었다 — GuardAlertActivity 가 떴다
--   0      없었다 — 알림뿐이었고 탭해서 열지도 않았다
--   NULL   ★ **이 발동을 올린 층이 그것을 안 셌다**(옛 APK). "없었다"가 아니라 "모른다"
--
-- ★ NULL 이 경계다(티켓 ④). **날짜를 적지 않는다** — 배포일·설치일은 이 층이 모르는
--   값이고(CLAUDE.md §사람이 하는 것의 상태), 그것에 규칙을 매다는 것이 이 리포가 네 번
--   물린 자리다. 이 칸이 비었으면 옛 뜻, 값이 있으면 새 뜻이다.
--   **행 자체가 자기가 어느 쪽인지 말한다.**
--
-- ⚠️ **표 끝에 붙인다.** 0016·0017이 ALTER로 붙인 자리 그대로다 — 아래 재작성은
--    **옛 정의를 글자 그대로 옮긴 것**이라, 순서를 손대면 옮긴 것과 옮겨진 것을 못 맞춘다.
-- ============================================================

-- ============================================================
-- ② 왜 ALTER가 아니라 재작성인가 — 0010과 같은 이유다
--
-- `reaction` CHECK가 ('accepted','override','ignored')뿐인데 **'unasked'가 필요하다.**
-- SQLite는 CHECK를 변경할 수 없으므로 재작성이 유일한 길이다.
--
-- ⚠️ **0010이 같은 일을 했을 때는 행이 없거나 극소수였다. 지금은 40일치가 있다.**
--    그래서 아래 CREATE TABLE 은 **적용된 정의(sqlite_master)를 글자 그대로 옮기고**
--    딱 셋만 고쳤다: 표 이름 · reaction CHECK 에 'unasked' · 끝에 asked.
--    ★ **눈으로 맞추지 않는다** — smoke 가 0022까지의 스키마와 0023까지의 스키마를
--      각각 만들어 **컬럼·인덱스·트리거를 전수로 비교**하고 차이가 그 셋뿐임을 센다.
--      한 줄이라도 흘리면 그 검사가 빨간불이다(0019 §트리거 재작성과 같은 방벽).
--
-- ⚠️ **'unasked'는 기기가 보내는 값이 아니다.** `applyReaction`의 입력 목록에 안 넣었다 —
--    넣으면 기기가 자기 발동을 "안 물었다"로 선언할 수 있고, 그건 반응이 아니라 사후 판정이다.
--    쓰는 곳은 `finalizeIgnored` 하나다.
--
-- ⚠️ DROP TABLE 은 `trg_guard_event_nodelete` 를 안 태운다 — FK 때문에 도는 암묵 DELETE 도
--    트리거를 안 태운다(SQLite 계약). 0010 이 이미 지난 길이다.
-- ============================================================

CREATE TABLE guard_events_new (
  id              TEXT PRIMARY KEY,                 -- 'YYYYMMDD-NNN'
  fired_at        TEXT NOT NULL,                    -- 발동 시각 (벽시계 ISO)
  on_date         TEXT NOT NULL,                    -- 귀속일 (ADR-011 — 기기 날짜 아님)
  cause           TEXT NOT NULL,                    -- 발동 원인 규칙 키
  level           INTEGER NOT NULL CHECK (level BETWEEN 1 AND 4),

  mode            TEXT,                             -- 발동 시점의 Guard 모드 (ADR-019)
                                                    -- 보정 집계를 모드로 나눈다 — 섞으면 오염된다
  source          TEXT NOT NULL DEFAULT 'android'
                    CHECK (source IN ('android','pc')),   -- ADR-022 PC 확장 자리
  foreground_app  TEXT,                             -- 발동 시점에 쓰던 앱/프로세스 (보조 입력)

  risk_score      INTEGER,                          -- 1단계 결정론 점수 (기록만 — 발동 게이트 아님)
                                                    -- **서버가 record()에서 낸다** (T-32). 기기는 항 값만 뜬다 —
                                                    -- 발동이 끝난 뒤 계산해야 게이트가 될 수 없다(ADR-021)
  risk_snapshot   TEXT,                             -- JSON. 판단 시점의 항 값 전부 ★자기 보정의 원재료
                                                    -- 기기 항은 최상위 · 서버 항(§6.6)은 `server` 아래 (T-32)

  ai_used         INTEGER NOT NULL DEFAULT 0,       -- model_high 호출 여부 (ADR-024)
  ai_verdict      TEXT CHECK (ai_verdict IN ('approve','deny','unavailable')),

  reaction        TEXT CHECK (reaction IN ('accepted','override','ignored','unasked')),
                                                    -- NULL = 아직 반응 없음. 발동 시점엔 비어 있다
                                                    -- 'unasked' = 물었다고 볼 수 없는 발동 (T-70 · 0023)
                                                    --   ★ "안 했다"가 아니라 "안 물었다(또는 모른다)"다
                                                    --   쓰는 곳은 finalizeIgnored 하나. 기기는 못 보낸다
  reacted_at      TEXT,
  override_reason TEXT,                             -- §6.3 마찰에서 타이핑한 한 문장
  override_class  TEXT CHECK (override_class IN ('avoidant','legitimate')),
                                                    -- model_low 사후 분류 — 보정의 입력

  task_id         TEXT REFERENCES tasks(id),
  period_id       TEXT REFERENCES periods(id),
  event_id        TEXT REFERENCES events(id),       -- 보호 규칙이 붙은 일정
  outcome         TEXT CHECK (outcome IN ('success','failure')),
  outcome_at      TEXT,
  created_at      TEXT NOT NULL, client_id TEXT, ai_unavailable_reason TEXT
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
  ), ai_reason TEXT,

  -- ★ T-70. **반응 버튼이 사용자 앞에 있었는가.** 알림이 떴는가가 아니다(위 ①).
  --   NULL = 이 발동을 올린 층이 그걸 안 셌다(옛 APK) — "없었다"가 아니라 "모른다".
  asked           INTEGER CHECK (asked IN (0,1)),

  CHECK (reaction != 'override' OR override_reason IS NOT NULL)   -- Override엔 사유 필수 (§6.3)
);

-- ⚠️ **컬럼을 명시한다.** `SELECT *`로 옮기면 한 칸이 밀려도 조용히 들어간다.
--    `asked`는 목록에 없다 — **옛 행은 전부 NULL이 맞다. 그것이 경계다**(위 ①).
INSERT INTO guard_events_new
  (id, fired_at, on_date, cause, level, mode, source, foreground_app,
   risk_score, risk_snapshot, ai_used, ai_verdict,
   reaction, reacted_at, override_reason, override_class,
   task_id, period_id, event_id, outcome, outcome_at, created_at,
   client_id, ai_unavailable_reason, ai_reason)
SELECT
   id, fired_at, on_date, cause, level, mode, source, foreground_app,
   risk_score, risk_snapshot, ai_used, ai_verdict,
   reaction, reacted_at, override_reason, override_class,
   task_id, period_id, event_id, outcome, outcome_at, created_at,
   client_id, ai_unavailable_reason, ai_reason
FROM guard_events;

DROP TABLE guard_events;
ALTER TABLE guard_events_new RENAME TO guard_events;

-- 인덱스 넷 — 0010의 셋과 0011의 하나. DROP TABLE 과 함께 사라졌다.
CREATE INDEX idx_guard_events_date ON guard_events(on_date);
CREATE INDEX idx_guard_events_task ON guard_events(task_id);
CREATE INDEX idx_guard_events_event ON guard_events(event_id);
CREATE UNIQUE INDEX idx_guard_events_client ON guard_events(client_id) WHERE client_id IS NOT NULL;

-- 트리거 둘 — 0019의 것을 글자 그대로 옮기고 `asked` 한 줄을 더했다.
-- ⚠️ 0019가 적어 둔 경고가 여기도 그대로다: **한 줄이라도 빠뜨리면 조용히 보호가 사라진다.**
--    smoke 의 전수 비교가 그 방벽이다.
CREATE TRIGGER trg_guard_event_immutable BEFORE UPDATE ON guard_events
WHEN
     OLD.id            != NEW.id
  OR OLD.fired_at      != NEW.fired_at
  OR OLD.on_date       != NEW.on_date
  OR OLD.cause         != NEW.cause
  OR OLD.level         != NEW.level
  OR IFNULL(OLD.mode,'')          != IFNULL(NEW.mode,'')
  OR OLD.source        != NEW.source
  OR IFNULL(OLD.risk_snapshot,'') != IFNULL(NEW.risk_snapshot,'')
  OR IFNULL(OLD.risk_score,-1)    != IFNULL(NEW.risk_score,-1)
  OR (OLD.reaction       IS NOT NULL AND IFNULL(NEW.reaction,'')       != OLD.reaction)
  OR (OLD.override_reason IS NOT NULL AND IFNULL(NEW.override_reason,'') != OLD.override_reason)
  OR (OLD.override_class IS NOT NULL AND IFNULL(NEW.override_class,'') != OLD.override_class)
  OR (OLD.outcome        IS NOT NULL AND IFNULL(NEW.outcome,'')        != OLD.outcome)
  -- ── 여기부터 T-50이 더한 넷 ──────────────────────────────
  OR (OLD.ai_used != 0 AND NEW.ai_used != OLD.ai_used)
  OR (OLD.ai_verdict            IS NOT NULL AND IFNULL(NEW.ai_verdict,'')            != OLD.ai_verdict)
  OR (OLD.ai_unavailable_reason IS NOT NULL AND IFNULL(NEW.ai_unavailable_reason,'') != OLD.ai_unavailable_reason)
  OR (OLD.ai_reason             IS NOT NULL AND IFNULL(NEW.ai_reason,'')             != OLD.ai_reason)
  -- ── 여기부터 T-70이 더한 하나 ────────────────────────────
  -- ★ `ai_used`와 **같은 모양이고 같은 이유다: 한 번 앞에 섰으면 선 것이다.**
  --   NULL → 0 · NULL → 1 · 0 → 1 은 된다(기기가 뒤늦게 "그 화면이 떴다"를 올린다 — T-39의 자리).
  --   1 → 0 · 1 → NULL 은 안 된다 — 되돌리면 물었던 발동이 안 물은 것이 된다.
  OR (IFNULL(OLD.asked,0) != 0 AND IFNULL(NEW.asked,-1) != OLD.asked)
BEGIN
  SELECT RAISE(ABORT, 'Guard 이벤트는 수정할 수 없음 — 사후 확정 필드만 한 번 채울 수 있음');
END;

CREATE TRIGGER trg_guard_event_nodelete BEFORE DELETE ON guard_events
BEGIN
  SELECT RAISE(ABORT, 'Guard 이벤트는 삭제할 수 없음 — 개입 이력은 영구 보존');
END;
