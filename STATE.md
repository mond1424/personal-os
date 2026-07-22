# STATE — 최종 갱신 2026-07-22

## 저장소
- repo: https://github.com/mond1424/personal-os
- branch: main
- 마지막 커밋: `e6ce675` docs: CLAUDE.md·STATE.md·api-surface·schema 스냅샷 추가 (직전: `865402a` 코드)
  - ✅ **push 완료** (main → origin/main, 2026-07-22). 이 STATE 갱신은 뒤이은 커밋에 포함.

## raw 링크 (Chat이 직접 읽는 주소)
- 설계문서(권위) https://raw.githubusercontent.com/mond1424/personal-os/main/personal-agent-design_v0.9.md
- CLAUDE.md      https://raw.githubusercontent.com/mond1424/personal-os/main/CLAUDE.md
- README0722     https://raw.githubusercontent.com/mond1424/personal-os/main/README0722.md
- 사용설명서0722 https://raw.githubusercontent.com/mond1424/personal-os/main/사용설명서0722.md
- REFACTOR-PLAN  https://raw.githubusercontent.com/mond1424/personal-os/main/REFACTOR-PLAN.md
- STATE.md       https://raw.githubusercontent.com/mond1424/personal-os/main/STATE.md
- api-surface    https://raw.githubusercontent.com/mond1424/personal-os/main/docs/api-surface.md
- schema         https://raw.githubusercontent.com/mond1424/personal-os/main/docs/schema-current.sql
- 라우터         https://raw.githubusercontent.com/mond1424/personal-os/main/src/index.ts
- types          https://raw.githubusercontent.com/mond1424/personal-os/main/src/types.ts
- db/index.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/db/index.ts
- daily.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/daily.ts
- tasks.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/tasks.ts
- periods.ts     https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/periods.ts
- events.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/events.ts
- memos.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/memos.ts
- me.ts          https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/me.ts
- analysis.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/analysis.ts
- guard.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/guard.ts
- scheduled.ts   https://raw.githubusercontent.com/mond1424/personal-os/main/src/scheduled.ts
- lib/time.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/time.ts
- lib/id.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/id.ts
- lib/ai.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/ai.ts
- app.js         https://raw.githubusercontent.com/mond1424/personal-os/main/public/app.js
- api.js         https://raw.githubusercontent.com/mond1424/personal-os/main/public/api.js
- index.html     https://raw.githubusercontent.com/mond1424/personal-os/main/public/index.html
- style.css      https://raw.githubusercontent.com/mond1424/personal-os/main/public/style.css

## 기준선
typecheck 통과 / smoke 124 / front 147 / 실패 0

## 마이그레이션
최신: `0006_fix_model_high` (0001_init · 0002_models · 0003_ai_provider · 0004_events · 0005_delete_scope · 0006_fix_model_high)
⚠️ 0006은 라이브 DB에 **미적용** — 사용자가 `--local`→`--remote` 적용 + `deploy` 필요.

## 최근 세션에서 바뀐 것
- `src/lib/ai.ts` · `migrations/0006_fix_model_high.sql` — 모델 ID `claude-sonnet-5`(실재 안 함)→`claude-sonnet-4-6` 교정
- `src/services/me.ts` · `public/app.js` — Feelings 필드명 XSS 하드닝(형식 강제 + esc)
- `public/app.js` · `public/index.html` — 완료율 100% 도달 시 즉시 완료 / 마감된 날 일정 추가 허용 + 경고문
- `test/smoke.ts` — 스키마 목록에 0006 추가
- 문서 — `README0722.md`(개발) 보강·`사용설명서0722.md`(사용자) 신규·`CLAUDE.md`·`STATE.md`·`docs/api-surface.md`·`docs/schema-current.sql`·`REFACTOR-PLAN.md`
- `public/{public,src,test,migrations}`·낡은 zip·빈 파일 삭제(노출·잡파일 정리)

## 미해결 / 다음 할 것
- ✅ GitHub push 완료 (main → origin/main).
- ⚠️ **0006 마이그레이션 apply(local→remote) + deploy** — 사용자 직접 (안 하면 라이브 model_high=claude-sonnet-5, AI 연결 테스트 404)
- 폰 확인: 완료율 100%=완료·마감일 일정 경고 동작 / 다크모드 색 짝 2건(`.c.mut .d`·`.wkdays span:first-child`) / 세로선 농도
- 최종 정리(이 리포 밖, 상위 Pos/): 스캐폴딩 중복·대용량 백업 (worker/ git 루트와 무관)
- (선택) 기간 삭제 confirm 추가 · analysis 문단 `white-space` · REFACTOR-PLAN "폰 확인 후" 항목

## 설계와 어긋난 지점
- **완료율 100%** — 설계/가이드 §4는 "100%는 바에서 제외, [완료] 버튼 전용"이었으나, 사용자 지시로 **"100% 도달 시 즉시 완료"**로 변경. 문서 v1.0에 반영 대기.
- **events 마감일 추가** — 마감된 날에도 일정 추가 허용(1.3 "과거엔 추가만 가능"과 정합). 추가 시 수정·삭제 불가 경고문 표시. (설계 위반 아님, 명시적 결정.)
