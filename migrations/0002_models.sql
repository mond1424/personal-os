-- 0002: 구현 2 — 모델 이원화 (설계 8장, High-Low mix)
--   low  = 일상 소형 작업 (feelings 분류 등)
--   high = 추론 작업 (analysis 2-pass · 이후 Guard)
-- 값은 설정(PUT /api/settings/model_low|model_high)에서 언제든 변경.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('model_low',  'claude-haiku-4-5-20251001'),
  ('model_high', 'claude-sonnet-5');
