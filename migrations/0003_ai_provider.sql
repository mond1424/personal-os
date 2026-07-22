-- 0003: AI 연결 일반화 — Claude 외 제공자도 쓸 수 있게 (8장 '얇은 서버' 유지)
--   ai_provider : anthropic | openai | google
--   ai_api_key  : 사용자 개인 키. 조회 API는 값을 돌려주지 않고 설정 여부만 알려준다.
--                 (비워 두면 서버 시크릿 ANTHROPIC_API_KEY로 넘어간다)
-- utc_offset은 지금까지 코드 기본값(+09:00)으로만 존재해 설정 화면에서 비어 보였다 — 행으로 명시.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai_provider', 'anthropic'),
  ('ai_api_key',  ''),
  ('utc_offset',  '+09:00');
