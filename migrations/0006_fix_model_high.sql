-- 0006 — model_high 기본값 교정
--
-- 증상: 0002가 시드한 model_high 기본값 'claude-sonnet-5'는 실재하지 않는 모델 ID다.
--       (현행 Anthropic Sonnet은 claude-sonnet-4-6 — Sonnet 5는 존재하지 않는다.)
--       그대로 두면 설정 'AI 연결 테스트'나 analysis(구현 2)가 high 모델을 호출할 때
--       404("모델 이름을 찾을 수 없어요")로 실패한다.
--
-- 교정: 시드된 기본값을 현행 Sonnet으로 올린다. lib/ai.ts의 제공자 목록도 함께 교정했다.
--       WHERE value='claude-sonnet-5' 가드 — 사용자가 이미 설정에서 다른 모델로
--       바꿨다면 그 선택을 덮어쓰지 않는다.
UPDATE settings SET value = 'claude-sonnet-4-6'
 WHERE key = 'model_high' AND value = 'claude-sonnet-5';
