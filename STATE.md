# STATE — 최종 갱신 2026-07-23

## 저장소
- repo: https://github.com/mond1424/personal-os
- branch: main
- 마지막 커밋: CAL-PLAN-0723 캘린더 셀 개선 — `3a26bbb`(1단계 일정 점 제거)·`0160ea3`(선행A +n 배지 잘림)·`2fad8ad`(.tt 클래스 충돌 글자커짐)·3단계(이 STATE 포함 커밋).
  - ✅ **push 완료** (main → origin/main). 직전 세션 커밋 `13f6c50`(실사용 피드백 4건 UX)도 push 완료.

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
typecheck 통과 / smoke 129 / front 151 / 실패 0
(2단계 smoke 124→127: 미루기 사유 저장 검사 3개. front 145 유지: 완료율 바 검사→사유 검사 교체.
 3단계 smoke 127→129: memo 어느 날짜에든 + diary 마커 검사. front 145→151: 통합 추가영역 세그·미래 memo 검사 6개.)

## 마이그레이션
최신: `0007_defer_reason` (0001_init · 0002_models · 0003_ai_provider · 0004_events · 0005_delete_scope · 0006_fix_model_high · 0007_defer_reason)
✅ **로컬·원격(remote) 모두 0007까지 적용 완료** (2026-07-23 확인 — `migrations list`가 로컬·원격 다 "No migrations to apply").
검증: 원격 `schedule_entries.defer_reason` 컬럼 존재(0007) · 원격 `settings.model_high = claude-sonnet-4-6`(0006 반영, 버그값 sonnet-5 아님).
- `0007_defer_reason`: `schedule_entries`에 `defer_reason TEXT` 추가(미루기 사유). **WORK-PLAN의 `task_entries` 표기는 오기** — 실제 테이블은 `schedule_entries`(예정 항목·rate가 있는 곳).

## 이번 세션 (2026-07-23) — CAL-PLAN-0723 캘린더 셀 개선 (마이그레이션 없음)
- **1단계** `public/style.css` — 시각 지정 일정 앞 점(`.ev.evt.timed::before`) 제거. 시각 있는/종일 일정의 제목 시작 위치 일치, 제목 1~2자 더 노출. `.timed` 클래스 부여는 향후 훅으로 유지(app.js). 시각은 날짜 팝업에서 '종일/14:30'으로 이미 명확.
- **2단계(진단만·코드 무변경)** 7/24 '포르쉐 바이브 티켓' 미표시 = **분기 B**로 확정. `deferred_to` 없는 살아있는 할 일 2건인데 셀은 할 일을 '항상 1줄 대표'로 압축 → 포르쉐는 대표(created_at 첫)가 아니라 `+1`에만 접힘. 조회 계층 정상·버그 아님 → 3단계 동적 예산으로 해소.
- **선행 A** `public/{app.js,style.css}` — `+n` 배지 잘림(실버그) 수정. 배지가 제목과 같은 `.ev`(overflow:hidden;ellipsis) 안이라 제목이 넘치면 배지까지 잘렸다. 제목을 `.etxt`로 감싸 말줄임 분리, `.ev.tsum` flex화. `.etxt`는 자체 포맷팅 문맥이라 부모 취소선이 안 번져 `text-decoration:inherit`로 완료·이동 취소선 회귀 방지. **처음 `.tt`로 썼다가 전역 `.tt`(14.5px 시트 제목)와 충돌해 셀 글자가 커진 것 발견 → `.etxt`로 개명(`2fad8ad`).**
- **3단계** 셀 memo 노출 + 종류별 보더 인코딩 + 동적 공간 예산 + `.dr` 마커 축소:
  - 3-a `src/db/index.ts` 신규 `calMemos`(날짜별 대표 1건[가장 이른 ts]+개수). `calendar()`(daily.ts) 응답에 **`memos` 추가**. `calDiaryDates`에서 **memo 조건 제거** → `.dr` 마커 = 마감·점수·감정·로그만.
  - 3-b `public/app.js` 셀 공간 예산을 **동적 재배분**(상수 `CELL_MAX_LINES=4, CELL_EV_MAX=2, CELL_TK_MAX=2`): 일정(최대2+초과 '일정 +N')→할 일 1줄→memo 1줄→남으면 할 일 2번째 줄. memo 자리를 먼저 비워 할 일 확장이 memo를 굶기지 않게. 할 일 여러 줄은 살아있는 항목(미완료·미이동) created_at 순 우선, `+n`은 마지막 표시 줄에. memo 줄은 보더 없이 `.etxt`+`+n`.
  - 3-c `public/style.css` `.ev.memo`(border-left transparent로 폭 유지·글자 시작 정렬, `--faint` 500). 3-d 팝업=전문/셀=대표+n 관계 주석.
  - `test/smoke.ts` — memo→diary 마커 검사를 **memo→`memos` 줄 검사**로 교체(마커 축소 반영, 개수 불변).
  - **회귀 잡음 1건**: 셀 memo 변수를 `mm`으로 뒀다가 `rowHtml(row, mm)`의 '월' 파라미터를 셰도잉 → TDZ ReferenceError로 renderCalendar 전체가 던져 셀 0개. **front가 잡아냄** → `mo`로 개명해 해소.
- 검증: typecheck 통과 · smoke 129(무변경, 검사 1건 재타겟) · front 151(무회귀) · 실패 0. **마이그레이션·스키마 무변경.** 배포는 사용자 직접.

## 직전 세션 (2026-07-23) — 실사용 피드백 4건 (UX, 프런트+문서만)
- **[#1 캘린더 기간]** `public/app.js` renderCalendar — `#p-list`를 범례와 동일한 이번 달 겹침 필터(`start_date≤curTo && end_date≥curFrom`)로 축소. `#p-cnt`도 이번 달 기준. 빈 문구 "이번 달엔 기간이 없어요". 목록·편집(`openPeriod`)·다른 달(달 넘기면 재표시)은 유지 — 전체 나열만 제거.
- **[#2 me 직접입력]** `public/{app.js,index.html}` — 고정 5필드를 값 없어도 항상 노출("아직 없음 — 눌러서 입력해요")로 직접입력 진입 명확화 + 필드별 가이드(`ME_GUIDE`: 시트 상시설명 `#me-guide` + textarea placeholder 예시). 5필드가 다 보여 무의미해진 '+ 필드 추가'(`me-add`)·`addMeField` 제거. **백엔드·마이그레이션 무변경**(`putMeField`는 이미 `/^[a-z_]{1,40}$/` 임의 필드 허용). 설계 §3(고정 필드 프레임)과 정합.
- **[#3 캘린더 모션]** `public/{app.js,index.html,style.css}` — 둥근 카드 chrome(border·radius·bg)과 요일줄(`CAL_WKDAYS`)을 고정 프레임 `.calbox`→각 `.calpane`(월 카드)로 이전. 이제 **카드가 통째로 슬라이드**(고정 창 안 grid만 미끄러지던 '흉내' 해소). ‹/› 화살표도 무모션 즉시교체→`calGo` 슬라이드로 통일. 색은 기존 변수만(다크 자동, 함정 5). 슬라이드 자체는 원래 진짜 3-pane 트랙 — 구조 재설계가 아니라 카드 단위로 격상. front line 216(cal-next)이 이제 `calGo` 경로를 타지만 translateX 문자열 동일→검사 통과.
- **[#4 대기행 폭]** `public/index.html` — `#today-wait` `width:65%`→`fit-content;min-width:60%;max-width:90%`, `#tw-text` `nowrap`+`ellipsis`+`min-width:0`. 내용따라 60~90% 유동·항상 한 줄(초과 시 …).
- **문서**: `CLAUDE.md` 기준선 문구 `smoke124/front145`→`129/151`로 정정(직전 세션에 STATE는 이미 129/151, CLAUDE만 지연됨. stash로 변경 전 코드도 151 확인).
- 검증: typecheck 통과 · smoke 129(무변경) · front 151(무회귀) · 실패 0. **사용자 `deploy` + 폰 실사용 정상 확인 완료.**

## 직전 세션 (2026-07-23) — WORK-PLAN-0723 (1~3단계 완료)
- **1단계 완료** (항목 1·2·3·5, 프런트 표시/모션만, 백엔드 무변경):
  - [#1] `public/style.css` — 다크모드 `.wseg.on` 선택색 오버라이드 2곳 추가(미디어쿼리+data-theme). "이월 중" 세그가 hotN 명시도에 밀려 선택 시 배경이 안 바뀌던 것 수정.
  - [#2] `public/style.css` — `.screens`에 `touch-action:pan-y` 추가. 탭 가로 스와이프가 네이티브 스크롤에 먹혀 무효화되던 것. **폰 실측 대기**.
  - [#3] `public/app.js` — 경계 스트레치 진폭↑(`STRETCH_MAX 48→90`, `STRETCH_K 0.3→0.42`)+스냅백 전용 곡선 분리(`STRETCH_BACK_MS 460`/`cubic-bezier(.22,1,.36,1)`, 탭 전환 `TRACK_MS` 미접촉). **폰 실측 후 미세조정**.
  - [#5] `public/index.html` — `#today-wait` 인라인 `width:100%→65%`+`margin-right:auto`(좌측 고정). 대기 행을 시각적으로 하위로.
  - 검증: typecheck 통과 · smoke 124 · front 145 · 실패 0 (무회귀).
- **2단계 완료** (완료율 화면 제거 + 미루기 사유 `defer_reason`, migration 0007):
  - 2-a 완료율 **화면만 제거**(DB 컬럼·완료 로직·`rate=100` 완료 신호는 유지): `app.js` 리스트 pct 배지 2곳·날짜 시트 tag/모노칸 제거·치환. `rbar`/`rateSet`/`rateOf`/`setRate`/`stSetRate` 등 함수·라우터는 그대로.
  - 2-b `migrations/0007_defer_reason.sql`(`schedule_entries.defer_reason`) + `db.stSetDeferReason` + `tasks.deferTask(reason?)` + 라우터/`api.js` `defer(reason)` + 미루기 시트를 완료율 바→사유 `textarea`(#dfx-reason)로 교체. 사유는 도착지(새 예정) 항목에 저장.
  - **2단계 보강**(사용자 지시): task 상세 시트(`#tk-rates`)의 완료율도 제거 — 헤더 `완료율`→`상태`, 본문 `{n}%`/문구를 상태(완료/대기/예정)로, SCHEDULE 이력의 `완료율 {n}%` 제거, 완료 버튼 `완료 100%`→`완료`, 완료 토스트 `완료 100%`→`완료`, 날짜 시트 '할 일' 부제 `완료율·미루기…`→`예정·미루기 이력`. 이제 리스트·날짜 시트·미루기 시트·상세 시트 **어디에도 % 없음**. `rbar`/`rateSet`/`setRate`/DB·완료(rate=100) 로직은 유지(B-1 재사용 대비).
  - `defer_reason` 분석 화면 노출은 향후.
  - 검증: typecheck 통과 · smoke 124→127 · front 145 · 실패 0.
- **3단계 완료** (memo 통합 — 어느 날짜에든 + 날짜 시트 통합 입력 폼, **신규 마이그레이션 없음**):
  - 3-a `memos.ts addMemo`: daily 없으면 404 대신 `stOpenDaily`(기존 INSERT…ON CONFLICT DO NOTHING)로 open daily ensure 후 memo 붙임. → 과거·오늘·미래 어디든 memo.
  - 3-a `db.calDiaryDates`: 캘린더 `.dr` 마커가 **빈 daily**를 오인하지 않게, `status=closed` 또는 score/feelings/logs/memos가 실제로 있는 날만 반환하도록 변경(빈 자동 daily 제외, memo 있는 날은 포함).
  - 3-b `app.js openDay`: 흩어진 3개 추가 UI(일정 버튼·`#day-add` 할일·`#memo-input` memo)를 **통합 추가영역** `addZoneHtml(k,relation,closed)` + `setAddMode`로 합침. 세그 `[일정|할 일|memo]`, relation별 가용(past=일정·memo / today·future=셋 다). 일정은 기존 `openEventSheet`(시각 드럼·마감 경고) 재사용, 할일·memo는 인라인(`addTaskOn`/`sendMemo` 그대로). memo 표시는 전 relation으로 확장.
  - 검증: typecheck 통과 · smoke 127→129 · front 145→151 · 실패 0.

## 최근 세션에서 바뀐 것 (UX 개선 A-1~A-6)
- A-1 [#3] `public/style.css` — 다크모드 캘린더 색: 다른 달 날짜 `var(--faint)`, 일요일 헤더 다크 오버라이드
- A-2 [#7] `src/lib/ai.ts` — Gemini 모델 `-latest` 별칭(gemini-2.5-* 404 회피, 요청 로직 불변)
- A-3 [#5 Phase1] `public/{app.js,style.css}`·`test/front.mjs` — 완료율 인라인 막대 제거→읽기전용, 편집은 미루기 시트만
- A-4 [#2] `public/{app.js,style.css}`·`test/front.mjs` — 캘린더 달 간격(CAL_GAP=20)+터치 씹힘 완화(dragBlockUntil 200·전환 후 즉시 재중심화·calGen 가드)
- A-5 [#1] `public/app.js` — 스와이프 인접탭 프리렌더(드럼 느낌)+민감도 하향(AXIS_LOCK20·축비1.9·RATIO0.35·FLICK0.5)
- A-6 [#4] `public/app.js` — 경계 스트레치(러버밴드 대체, `bindEdgeStretch` 격리·off 가능)
- **기준선 smoke 124 · front 147→145**(A-3에서 인라인 완료율 검사를 미루기 시트 재탭 검사로 이동·통합). 매 커밋 전 검증, 실패 0

## 미해결 / 다음 할 것
- ✅ **마이그레이션 0006·0007 원격 적용 + 코드 `deploy` 완료**(2026-07-23 확인). 이전 경고(라이브 model_high=sonnet-5·미루기 사유 컬럼 없음)는 해소됨. 라이브 = 최신.
- **폰 실측 후 미세조정**(이번 세션 산출, 코드 주석에도 표시): 스와이프 민감도 상수(AXIS_LOCK·축비·TRACK_RATIO·FLICK_V) · 캘린더 gap(20px) · 경계 스트레치 on/off(boot의 `bindEdgeStretch()`) · 다크모드 색(다른달·일요일) · 세로선 농도
- **다음 세션 구현 대기 (B, 미착수)**: B-1[#5 Phase2] 미완료 전환/수동 마감 시 완료율 입력 · B-2[#6] light task 플래그(신호 오염 금지) · B-3[#8] 튜토리얼 상세화(step3 전 필수) · B-4[#4] 러버밴드 원안 보류 기록 → REFACTOR-PLAN "재구상/보류" 정리 예정
- 최종 정리(리포 밖 상위 Pos/): 스캐폴딩 중복·대용량 백업

## 설계와 어긋난 지점
- **완료율 100%** — 지난 세션에 "인라인 100%=즉시 완료"로 이탈했으나, **A-3(#5 Phase1)에서 인라인 막대를 제거하며 폐기 → 완료는 완료 버튼 전용으로 설계 §1.4 재정합**(이제 설계와 일치). 완료율 편집은 미루기 시트에서만.
- **events 마감일 추가** — 마감된 날에도 일정 추가 허용(1.3 "과거엔 추가만 가능"과 정합, 경고문 표시). 설계 위반 아님, 명시적 결정.
- **완료율 화면 제거(2단계+보강, 2026-07-23)** — 완료율 개념을 **화면에서 전면 제거**(리스트·날짜 시트·미루기 시트·**task 상세 시트**). DB `rate` 컬럼·`completeTask`의 `rate=100` 완료 신호·`setRate`/`rbar` 경로는 **물리적으로 유지**(되돌리기 쉽게, 완료 로직 안전, B-1 재사용 대비). 물리적 소거는 향후 별도.
- **미루기 사유 도착지 보존** — 사유(`defer_reason`)는 원 항목이 아니라 **도착지(새 예정) 항목**에 남긴다. 마감된 날의 원 항목은 트리거가 수정을 막으므로, 열린 날/재배정 두 갈래 모두 균일하게 도착지에 붙여 보존.
- **memo 개념 확장(3단계, 2026-07-23)** — 설계 §1.3 "memo = 마감 후 유일한 추가 통로"를 **"memo = 어느 날짜에든 붙는 짧은 노트(마감된 날은 여전히 불변)"**로 확장. daily 없으면 자동으로 빈 open daily를 만들어 붙인다(마감된 날의 불변은 트리거가 계속 강제). 빈 daily가 캘린더 '기록 있는 날' 마커로 오인되지 않도록 `calDiaryDates`를 내용 기준으로 조정. **문서 v1.0 갱신은 사용자 지시로 연기 중이나, 이 확장은 명시적 결정으로 여기 기록.**
  - **(2026-07-23 CAL-PLAN 3단계 갱신)** memo는 이제 캘린더 **셀 본문에 직접** 노출되므로 `calDiaryDates`의 `.dr` 마커 조건에서 **memo를 다시 제외**했다. 마커 = '마감·점수·감정·로그'만 의미(선명해짐). 빈 daily 오인 방지 취지는 그대로 유지.
