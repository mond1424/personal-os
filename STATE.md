# STATE — 최종 갱신 2026-07-23

## 저장소
- repo: https://github.com/mond1424/personal-os
- branch: main
- 마지막 커밋: `641f213` feat(#4) 경계 스트레치 (A-6) — 이번 세션 A-1~A-6 반영
  - ✅ **push 완료** (main → origin/main). 이 STATE 갱신은 뒤이은 커밋에 포함.

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
typecheck 통과 / smoke 124 / front 145 / 실패 0

## 마이그레이션
최신: `0006_fix_model_high` (0001_init · 0002_models · 0003_ai_provider · 0004_events · 0005_delete_scope · 0006_fix_model_high)
⚠️ 0006은 라이브 DB에 **미적용** — 사용자가 `--local`→`--remote` 적용 + `deploy` 필요.

## 이번 세션 (2026-07-23) — WORK-PLAN-0723 진행 중
- **1단계 완료** (항목 1·2·3·5, 프런트 표시/모션만, 백엔드 무변경):
  - [#1] `public/style.css` — 다크모드 `.wseg.on` 선택색 오버라이드 2곳 추가(미디어쿼리+data-theme). "이월 중" 세그가 hotN 명시도에 밀려 선택 시 배경이 안 바뀌던 것 수정.
  - [#2] `public/style.css` — `.screens`에 `touch-action:pan-y` 추가. 탭 가로 스와이프가 네이티브 스크롤에 먹혀 무효화되던 것. **폰 실측 대기**.
  - [#3] `public/app.js` — 경계 스트레치 진폭↑(`STRETCH_MAX 48→90`, `STRETCH_K 0.3→0.42`)+스냅백 전용 곡선 분리(`STRETCH_BACK_MS 460`/`cubic-bezier(.22,1,.36,1)`, 탭 전환 `TRACK_MS` 미접촉). **폰 실측 후 미세조정**.
  - [#5] `public/index.html` — `#today-wait` 인라인 `width:100%→65%`+`margin-right:auto`(좌측 고정). 대기 행을 시각적으로 하위로.
  - 검증: typecheck 통과 · smoke 124 · front 145 · 실패 0 (무회귀).
- 2단계(완료율 화면 제거+미루기 사유 0007)·3단계(memo 통합)는 **미착수** — WORK-PLAN-0723.md 참조.

## 최근 세션에서 바뀐 것 (UX 개선 A-1~A-6)
- A-1 [#3] `public/style.css` — 다크모드 캘린더 색: 다른 달 날짜 `var(--faint)`, 일요일 헤더 다크 오버라이드
- A-2 [#7] `src/lib/ai.ts` — Gemini 모델 `-latest` 별칭(gemini-2.5-* 404 회피, 요청 로직 불변)
- A-3 [#5 Phase1] `public/{app.js,style.css}`·`test/front.mjs` — 완료율 인라인 막대 제거→읽기전용, 편집은 미루기 시트만
- A-4 [#2] `public/{app.js,style.css}`·`test/front.mjs` — 캘린더 달 간격(CAL_GAP=20)+터치 씹힘 완화(dragBlockUntil 200·전환 후 즉시 재중심화·calGen 가드)
- A-5 [#1] `public/app.js` — 스와이프 인접탭 프리렌더(드럼 느낌)+민감도 하향(AXIS_LOCK20·축비1.9·RATIO0.35·FLICK0.5)
- A-6 [#4] `public/app.js` — 경계 스트레치(러버밴드 대체, `bindEdgeStretch` 격리·off 가능)
- **기준선 smoke 124 · front 147→145**(A-3에서 인라인 완료율 검사를 미루기 시트 재탭 검사로 이동·통합). 매 커밋 전 검증, 실패 0

## 미해결 / 다음 할 것
- ⚠️ **로컬 worker 전체 갱신 완료 → 사용자 배포 필요**: `wrangler d1 migrations apply personal-os --local`→`--remote` + `npm run deploy`. (미적용 0006 포함 — 안 하면 라이브 model_high=claude-sonnet-5, AI 연결 테스트 404)
- **폰 실측 후 미세조정**(이번 세션 산출, 코드 주석에도 표시): 스와이프 민감도 상수(AXIS_LOCK·축비·TRACK_RATIO·FLICK_V) · 캘린더 gap(20px) · 경계 스트레치 on/off(boot의 `bindEdgeStretch()`) · 다크모드 색(다른달·일요일) · 세로선 농도
- **다음 세션 구현 대기 (B, 미착수)**: B-1[#5 Phase2] 미완료 전환/수동 마감 시 완료율 입력 · B-2[#6] light task 플래그(신호 오염 금지) · B-3[#8] 튜토리얼 상세화(step3 전 필수) · B-4[#4] 러버밴드 원안 보류 기록 → REFACTOR-PLAN "재구상/보류" 정리 예정
- 최종 정리(리포 밖 상위 Pos/): 스캐폴딩 중복·대용량 백업

## 설계와 어긋난 지점
- **완료율 100%** — 지난 세션에 "인라인 100%=즉시 완료"로 이탈했으나, **A-3(#5 Phase1)에서 인라인 막대를 제거하며 폐기 → 완료는 완료 버튼 전용으로 설계 §1.4 재정합**(이제 설계와 일치). 완료율 편집은 미루기 시트에서만.
- **events 마감일 추가** — 마감된 날에도 일정 추가 허용(1.3 "과거엔 추가만 가능"과 정합, 경고문 표시). 설계 위반 아님, 명시적 결정.
