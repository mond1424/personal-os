# Personal OS — 리팩토링 계획 (REFACTOR-PLAN)

작성 2026-07-21 · 대상 `personal-os-worker/worker/` (+ 최상위 잡파일 정리)
전체를 한 번에 검토하면 용량에 걸리므로 **단독 검토 가능한 크기(≤약 540줄 / ≤33KB)** 로 15개 섹터로 분할한다.

---

## 진행 현황

| 섹터 | 이름 | 무게 | 상태 |
|---|---|---|---|
| sector0 | 저장소 위생 & 기준선 | 가벼움 | ✅ 완료 |
| sector1 | 설계 문서 & 규약 | 가벼움-중간 | ✅ 완료 |
| sector2 | 스키마 & 마이그레이션 | 중간 | ✅ 완료 |
| sector3 | DB 접근 계층 | 중간 | ✅ 완료 |
| sector4 | 진입·라우팅·유틸·크론 | 가벼움-중간 | ✅ 완료 |
| sector5 | 핵심 도메인 서비스 | 중간 | ✅ 완료 |
| sector6 | 주변 도메인 서비스 | 중간 | ✅ 완료 |
| sector7 | 프론트 셸(마크업·API·PWA) | 중간 | ✅ 완료 |
| sector8 | 스타일 | 중간 | ✅ 완료 |
| sector9 | app.js A (~1–435줄) | 중간 | ✅ 완료 |
| sector10 | app.js B (~436–870줄) | 중간 | ✅ 완료 |
| sector11 | app.js C (~871–1350줄) | 중간 | ✅ 완료 |
| sector12 | app.js D (~1351–1861줄) | 중간 | ✅ 완료 |
| sector13 | 서버 테스트 | 중간 | ✅ 완료 |
| sector14 | 프론트 테스트 | 중간 | ✅ 완료 |

상태 범례: ⬜ 대기 · 🟡 진행 중 · ✅ 완료

## ⚠️ 사용자 실행 대기

- [ ] **0006 마이그레이션 적용 + 배포** (sector4 — 모델 ID `claude-sonnet-5`→`claude-sonnet-4-6` 교정). 적용 전까지 **라이브 DB의 `model_high`는 여전히 `claude-sonnet-5`**(연결 테스트 404 유지).
  ```powershell
  cd "C:\Users\LG\Desktop\새 폴더\Pos\personal-os-worker\worker"
  npx wrangler d1 migrations apply personal-os --local
  npx wrangler d1 migrations apply personal-os --remote
  npm run deploy
  ```

---

## 의도 확인 필요 (사용자 판단 — 설계 vs 코드)

> 코드가 문서와 어긋나거나 판단이 사용자 몫인 항목. 리뷰 중 발견 시 모음. **블라인드 수정 안 함.**

| # | 항목 | 권장/상태 | 섹터 |
|---|---|---|---|
| A | **완료율 4칸 바 100%** — 사용자 결정: **100%에 닿으면 즉시 완료**. `rateSet`·`setRateOn`이 rate 100이면 `Api.complete` 호출(미루기 시트 `dfxRate`는 제외). | ✅ 반영 | s10·s14·후속 |
| B | **events 마감일 INSERT** — 사용자 결정: **추가 허용 + 경고문**. `openDay`가 마감일에도 추가 노출, 시트에 "수정·삭제 불가" 경고(`#evx-warn`), ×는 미마감만. | ✅ 반영 | s6·후속 |

폰 확인(시각): 다크 색 짝 2건·세로선 농도 → 아래 "최종 정리 대기"의 "폰 확인 후" 항목.

---

## 변경 요약 (실제 변경분 — 한눈에)

> 리팩토링으로 **실제 바뀐 것**만 모음. 섹터별 분석·근거는 아래 "완료 기록" 참조. 변경 생길 때마다 갱신.

**코드·문서 수정**

| 파일 | 변경 | 이유 | 섹터 |
|---|---|---|---|
| `README.md` | 테스트 숫자 90/71 → 124/147 | 실측과 불일치(스테일) | s1 |
| `src/lib/ai.ts` | 모델 ID `claude-sonnet-5` → `claude-sonnet-4-6` | 실재하지 않는 ID(호출 시 404) | s4 |
| `public/app.js` | Feelings 필드명 렌더 2곳 `esc(k)` | XSS 하드닝(일관성) | s11 |
| `src/services/me.ts` | feelings_fields 형식 `^[a-z_]{1,40}$` 강제 | 필드명 XSS 근본 방어 | s13 |
| `test/smoke.ts` | 스키마 목록에 `0006` 추가 | 전체 마이그레이션 검사 | s13 |
| `public/app.js` | 완료율 100% 도달 시 즉시 완료(`rateSet`·`setRateOn`) | 의도확인 A — 사용자 지시 | 후속 |
| `public/{app.js,index.html}` | 마감된 날 일정 추가 허용 + 경고문(×는 미마감만) | 의도확인 B — 사용자 지시 | 후속 |
| `README.md`(worker) | 개발 README 보강 — 셋업·기준선·배포·함정11·**완전 API 표** | 개발 문서 완성 + API 표 드리프트 해소 | 후속 |
| `사용설명서.md`(신규) | 사용자 실용 가이드 — 목적·5탭·개념·제스처·설치 | 사용자 문서 부재 해소 | 후속 |

**신규 파일**

| 파일 | 내용 | 섹터 |
|---|---|---|
| `migrations/0006_fix_model_high.sql` | 라이브 `model_high` 기본값 교정(override 보존 가드) | s4 |
| `REFACTOR-PLAN.md` | 이 계획·기록 문서 | s0 |

**삭제 (승인된 순수 쓰레기)**

| 대상 | 이유 | 섹터 |
|---|---|---|
| `public/{public,src,test,migrations}` | 정적 서빙으로 소스·스키마 노출, 미추적·낡음 | s0 |
| `pos-worker-changed-only/` · `.zip` | 반영 완료된 낡은 배치물 | s0 |
| 최상위 `copy` · `npx` | 0바이트 셸 실수 산물 | s0 |

**검증**: 전 구간 기준선 유지 — **typecheck 통과 · smoke 124 · front 147 · 실패 0** (매 변경 후 재측정)

**아직 반영 안 됨**: ⚠️ 0006 apply+deploy(위 참조, 미실행 시 라이브 `model_high`=claude-sonnet-5) · 최종 일괄 정리 목록(아래)

---

## 규약 (사용자 선호)

- 섹터마다 **번호 붙인 발견/리팩토링 후보** 를 제시하고 **승인 후** 구현한다. 승인 없이 코드를 고치지 않는다.
- **구조를 흔드는 변경은 위험도 순으로 정렬해 맨 끝**에 배치한다 (회귀 원인 좁히기).
- 검증은 **숫자로** 보고한다 ("smoke 124 → 127"). 검사가 옛 동작을 보면 검사를 고치고 그 사실을 말한다.
- `wrangler deploy` · 시크릿 · `wrangler.toml`의 `database_id` 는 **건드리지 않는다** (사용자 몫).
- 설명·주석은 한국어. 주석은 **왜** 그렇게 했는지를 남긴다.

---

## 확정할 불일치 (sector0/1에서 실측)

1. **기준선 숫자 불일치** — 메모리 smoke 90/front 71 · 인계프롬프트 118/139 · 2차 가이드 124/147. → 직접 실행해 확정.
2. **설계 문서 버전** — 디스크 `v0.8`, 문서들은 `v0.9`를 권위로 참조. v0.9 파일 부재.
3. **`worker/CLAUDE.md` 부재** — 인계 프롬프트가 저장하라고 한 인계 메모가 없음.
4. **중첩 중복·잡파일** — `public/public·public/src·public/test`(현재본과 다른 낡은 사본), zip 2개, `worker_backup_*`(67MB), 최상위 `0001_init.sql`/`queries.sql`/`verify_schema.py`. 최신 zip의 worker/ 반영 여부도 diff로 확정.

---

## 최종 정리 대기 (전 섹터 검토 후 일괄 — git 히스토리 정리 + 리뷰 중 비교용 보존)

> 리뷰 중 옛 스키마·쿼리와 대조할 일이 있을 수 있어 **삭제는 전 섹터 검토 후 한 번에**. (사용자 결정, 2026-07-22)

- [ ] 최상위 스캐폴딩: `Pos/0001_init.sql`·`Pos/migrations/`(worker와 바이트 동일 중복) · `Pos/queries.sql`(→db/index.ts) · `Pos/verify_schema.py`(→smoke/e2e) · `Pos/worker-README.md`(worker/README.md의 낡은 중복) — sector2
- [ ] `worker/CLAUDE.md` 생성 (인계프롬프트 내용, 숫자 124/147로 정정) — sector1 보류분
- [ ] 설계문서 `worker/docs/` 편입 여부 — sector1 보류분
- [ ] 미추적 실코드 `git add`: `migrations/0003·0004·0005`, `src/services/events.ts` — sector0
- [ ] 대용량 백업 정리: `worker_backup_2026-07-20/`(200MB) 압축 여부 — sector0
- [ ] `새 폴더/`(최신 zip 이미 반영됨, 참고용) 처리 — sector0
- [x] ~~README API 표 갱신~~ — 개발 README 보강 시 **전체 API 표 포함으로 해소**(후속)
- [ ] **폰 확인 후** 시각 조정: 다크모드 색 짝(`.c.mut .d`·`.wkdays span:first-child`) + 세로선 농도(`.c + .c` `.035`) — sector8

---

## 섹터 상세

### ① 토대 — 기준선·규약
- **sector0 · 저장소 위생 & 기준선** — 최신 zip 반영 여부 diff, `typecheck/smoke/front` 실측으로 진짜 기준선 확정, 삭제 후보 목록화(삭제 안 함), 설정파일 점검.
- **sector1 · 설계 문서 & 규약** — `personal-agent-design_v0.8.md`(26KB) + README·가이드·인계프롬프트에서 규칙 추출 → 대조 체크리스트 확정. v0.8/v0.9·CLAUDE.md 정리.

### ② 데이터 토대
- **sector2 · 스키마 & 마이그레이션** — `migrations/0001~0005`. 트리거(마감일 동결·삭제 범위·`wait_extensions` FK). 최상위 SQL과 대조.
- **sector3 · DB 접근 계층** — `src/db/index.ts`(456) + `guard.ts`. 삭제·트랜잭션 순서를 스키마와 대조.

### ③ 백엔드 로직
- **sector4 · 진입·라우팅·유틸·크론** — `index.ts`·`types.ts`·`scheduled.ts`·`lib/{ai,id,time}`.
- **sector5 · 핵심 도메인 서비스** — `daily.ts`+`tasks.ts`. 완료율·`defer(rate)` batch 순서·연장 삭제 순서.
- **sector6 · 주변 도메인 서비스** — `events`·`periods`·`me`·`analysis`·`memos`.

### ④ 프론트엔드
- **sector7 · 프론트 셸** — `index.html`·`api.js`·`manifest.json`·`icon.svg`.
- **sector8 · 스타일** — `style.css`(514). CSS 변수·다크모드 짝·`.calbox` 마스크.
- **sector9 · app.js A (~1–435)** — 헬퍼·트랙 엔진·상태/DOM·Today·Score.
- **sector10 · app.js B (~436–870)** — 날짜 팝업·드럼·시트·완료율·캘린더·날짜선택.
- **sector11 · app.js C (~871–1350)** — Works·task 시트·빠른추가·분석·Me/설정·기간·필드·AI.
- **sector12 · app.js D (~1351–1861)** — 설정편집·로그·분석실행·탭동기화·캐러셀·`boot()`.

### ⑤ 테스트
- **sector13 · 서버 테스트** — `smoke.ts`+`e2e.mjs`+`seed.mjs`+`d1shim.ts`.
- **sector14 · 프론트 테스트** — `front.mjs`(520).

---

## 완료 기록 (실시간)

<!-- 섹터 완료 시 여기에 추가: 날짜 · 발견 요약 · 검증 숫자 · 승인/구현 내역 -->

### sector0 · 저장소 위생 & 기준선 — 조사 완료 (정리 승인 대기) · 2026-07-21

**기준선 실측**: typecheck 통과 · **smoke 124** · **front 147** · 실패 0
- `front` = `node test/e2e.mjs` (격리 임시 D1 러너, 실 DB 불변). 끝의 `spawnSync ETIMEDOUT`은 무해한 정리 경고.
- 문서 숫자 정정: **2차 가이드(124/147)가 정답**. 인계프롬프트(118/139)·메모리(90/71)는 구버전.

**최신 zip 반영 확인**: `새 폴더/pos-worker-changed-only_1.zip` 10개 파일 전부 worker/와 SAME → **이미 100% 반영, 재작업 불필요**.

**설정 점검**: `wrangler.toml` `[assets] directory="public"` → public/ 하위 전부 정적 서빙(노출). `database_id` 미변경(규약). `.gitignore` 정상(node_modules·.wrangler·시크릿 제외).

**발견 / 정리 후보**:
1. **public/ 노출 사본** — `public/{public,src,test,migrations}` (약 330KB). 정적 서빙으로 **소스·스키마 노출**, 미추적·낡은 사본. → 삭제 후보(안전).
2. **worker/ 낡은 배치물** — `pos-worker-changed-only.zip`(72KB) + `pos-worker-changed-only/`(빈 폴더). 최신본 반영됨. → 삭제 후보.
3. **최상위 빈 파일** — `copy`·`npx` (각 0바이트, 셸 실수 산물). → 삭제 후보.
4. **대용량 백업** — `worker_backup_2026-07-20/`(200MB, 언집) + `worker_backup_2026-07-21.zip`(64MB). → 보존 권장(사용자 안전망), 필요 시 압축.
5. **미추적 실제 코드** — `migrations/0003·0004·0005`, `src/services/events.ts` 는 실제 코드인데 git 미추적. → `git add` 권장(커밋은 사용자).
6. **CLAUDE.md 부재** — 인계 프롬프트에 내용 있음 → sector1에서 `worker/CLAUDE.md` 생성.
7. **최상위 스캐폴딩** — `0001_init.sql`·`queries.sql`·`verify_schema.py`·`migrations/`·`새 폴더/`. worker/로 대체된 원본. → sector2에서 대조 후 처리.

**실행 (승인 후)**: 정리 1·2·3 삭제 완료 — `public/{public,src,test,migrations}` · `pos-worker-changed-only(.zip)` · 최상위 `copy`·`npx` 제거. 4(백업)·5(git add)·6·7은 보류/후속.
**삭제 후 재검증**: typecheck 통과 · smoke 124 · front 147 · 실패 0 (기준선 유지).

**상태**: ✅ 완료.

### sector1 · 설계 문서 & 규약 — 체크리스트 확정 (문서 수정 승인 대기) · 2026-07-22

**권위**: 디스크 `personal-agent-design_v0.8.md` 가 현재 진실의 원천. 인계프롬프트가 부른 `v0.9`는 **부재** — v1.0 백로그(캐러셀·4칸 완료율·항상6주·통합 일정시트·defer rate)는 설계 §8에서 **사용자 지시로 연기 중**. 따라서 "코드가 문서에서 벗어남" 판정은 **[v0.8 + 두 적용가이드의 문서화된 델타]** 를 기준으로 한다.

**대조 체크리스트 (이후 섹터가 코드 검증에 사용)**:
- **원칙**: 파생(Todo/Done/Missed·이월수·대기일수·달성률·'지금')은 비저장·조회계산. 물화는 `summaries.mech`(cache)만. 불변성은 DB 트리거가 최종 강제, `index.ts`는 409/400 번역만. id(`YYYYMMDD-NNN` 불변)/title(가변) 분리.
- **시간(time.ts)**: 하루 경계 05:00(설정 가변), 새벽은 전날 귀속. 백엔드 주=월요일(analysis 윈도우). 자동마감=Cron(scheduled.ts).
- **daily**: 마감=Feelings확정+Log봉인→mech물화→close, 이후 memo만. 마감날 logs·feelings·schedule_entries·daily 동결(트리거). Missed=마감시 확정 파생. 재배정대기=최근예정<오늘 & 미완료 & 예정이력 있음.
- **tasks**: defer=schedule에 항목추가(**0%에서 시작**). 재배정=from이 마감날이면 insert-only(`reassigned:true`). defer(rate) batch는 `stSetRate`→`stMarkDeferred` 순서. 대기=`schedule:[]`. 21일 초과 차단 팝업, 연장=anchor now·이력 append-only. 삭제순서 **연장이력→항목→task**(0005). 완료=rate100+귀속, **100%는 버튼 전용**. period=명시필드(조인추정 금지). 날짜선택 2주 서버강제.
- **periods**: 달성률=기간 내 task 완료율 평균(완료100·미착수0·부분%, 파생). 캘린더 겹침=경계선 모델(n등분·created_at 순·전환점만 S곡선).
- **me/analysis**: Me 방향(원본)/지금(periods 조인 파생). 갱신=AI diff→승인·변경이력 보존. analysis=요청시만·2-pass(1차 독립,2차 추가·1차 수정금지)·context_meta·윈도우 11~17일. summary≠analysis(cache vs 영구).
- **프론트**: 캐러셀 %transform+손가락 px, 판정 거리25% 또는 속도0.35px/ms, 축잠금 첫10px. 캘린더 3-pane·**항상 6주**·`.calbox` overflow=캐러셀 마스크. 완료율 4칸 바·같은칸 재탭 시 down·100% 제외. 색=CSS변수+다크 짝. `scrollIntoView` 금지. `boot()` 중복실행 가드 유지.
- **API 표면**: README 표가 라우트 계약 → sector4에서 `index.ts`와 대조.

**발견 / 후보**:
1. `worker/README.md` 테스트 숫자 스테일 — "smoke 90 / front 71" (실측 124/147과 불일치).
2. `worker/CLAUDE.md` 부재 — 인계프롬프트에 전체 내용 있음(단 그 안 숫자 118/139도 구버전 → 124/147로 정정 필요).
3. 설계 문서가 git 저장소(worker/) **밖**(`../../`)에 있어 코드와 함께 버전관리 안 됨 + v0.8/v0.9 명명 불일치.

**적용**: 발견 1 반영 — `README.md` 테스트 숫자 정정(smoke 90→124 · front 71→147). 발견 2(CLAUDE.md 생성)·3(설계문서 git 편입)은 **사용자 결정으로 보류**.

**상태**: ✅ 완료.

### sector2 · 스키마 & 마이그레이션 — 검토 완료 · 2026-07-22

**마이그레이션 지도**:
- **0001_init** — 테이블 14(settings·me·me_history·periods·tasks·wait_extensions·schedule_entries·daily·feelings·logs·memos·summaries·analyses·guard_events) + 뷰 2(`v_task_stats`·`v_period_achievement`) + **트리거 19**.
- **0002_models** — settings 시드 `model_low=claude-haiku-4-5-20251001` · `model_high=claude-sonnet-5`.
- **0003_ai_provider** — settings 시드 `ai_provider`·`ai_api_key`·`utc_offset(+09:00)`.
- **0004_events** — `events` 테이블(캘린더 전용, 완료개념 없음) + 마감일 동결 트리거 2 → 총 트리거 **21**.
- **0005_delete_scope** — `trg_wait_ext_no_del` 을 '마감 기록 있을 때만'으로 좁힘(**함정 7 해소**). task 삭제 순서 = 연장이력→항목→task.

**설계 정합**: 스키마는 v0.8 §8과 정합(트리거 19 확인). 파생은 뷰(`v_task_stats`의 defer_count·current_rate·is_waiting)로 계산 = 원칙 4 준수. 불변성 = 트리거가 최종 강제 확인.

**발견 / 후보**:
1. **model_high 기본값 `claude-sonnet-5`** — 실재하지 않는 모델 ID로 의심(현행 Sonnet=claude-sonnet-4-6). API 호출 시 실패 가능 → **sector4(lib/ai.ts)에서 claude-api 레퍼런스로 확정·검증**.
2. **events 동결 트리거 비대칭** — events는 UPDATE·DELETE 동결만, **INSERT 동결 없음**(schedule_entries엔 frozen_ins 존재). 조건식도 `EXISTS`로 스타일 상이(기능 동일). 의도 확인 → sector6(events.ts).
3. **최상위 스캐폴딩** — `Pos/0001_init.sql`·`Pos/migrations/0001_init.sql` = worker와 **바이트 동일 중복**(삭제 안전). `Pos/queries.sql`(→db/index.ts로 구현)·`Pos/verify_schema.py`(→smoke/e2e로 대체) = 레거시 참조.

**주의**: 마이그레이션은 적용된 불변 이력 → 스키마 변경은 **새 마이그레이션으로만**, 기존 파일 수정 안 함.

**상태**: ✅ 완료. 발견 1 → sector4 이월. 발견 2 → sector6 이월. 발견 3(최상위 스캐폴딩) = 사용자 결정 → **최종 일괄 정리로 보류**(리뷰 중 비교용 보존).

### sector3 · DB 접근 계층 — 검토 완료 · 2026-07-22

**대상**: `src/db/index.ts`(456줄, 쿼리 전부) + `src/services/guard.ts`(8줄, 조회 placeholder). `queries.sql`는 읽지 않음 — db/index.ts가 실행·검증(smoke 124)되는 원천이라 그것을 직접 검토, queries.sql은 참조로만.

**평가**: 구조·원칙 정합 양호. SQL은 이 파일에만 존재, **전부 바인드 파라미터(주입 위험 없음)**, `st*` 접두=배치 조립용, 반환 타입 명시. 파생은 뷰(`v_task_stats`·`v_period_achievement`)로 계산. 삭제 가드(`closedEntryDates`·`guardEventCount`)+삭제 순서(연장이력→항목→task) 스키마와 정합. **버그 없음, 필수 수정 없음.**

**소소한 후보(선택, 저위험)**:
1. `weeklySummaryGet`(key,stale) ⊂ `weeklySummaryFull`(key,ai_text,stale) — 후자로 통합 가능. 사용처 확인 후(sector6) 정리.
2. `guardEventsList` 반환 `Record<string,unknown>` — `GuardEvent` 인터페이스로 타입화(구현 3 때).
3. events 조회가 `SELECT e.*`+조인 — 허용 범위(컬럼 충돌 없음), 교체 이득 낮음.

**서비스 섹터로 이월(오케스트레이션에서 확정)**:
- `stSetRate`·`stRate100At`·`stMarkDeferred`의 `AND deferred_to IS NULL` — defer batch 순서(`stSetRate`→`stMarkDeferred`) 의존 → **sector5**.
- 마감된 날 live entry rate UPDATE 시 트리거 ABORT를 서비스가 삼키는지 → **sector5**.
- `todayDone` 조인(`e.date=d AND finished_on=d`)이 완료 플로우와 정합한지 → **sector5**.
- events INSERT는 DB에서 마감일 미차단(sector2 발견2) → **sector6**.

**상태**: ✅ 완료. 소소한 후보는 최종 cosmetic 배치 후보로 보류.

### sector4 · 진입·라우팅·유틸·크론 — 검토 완료 · 2026-07-22

**대상**: `index.ts`(208)·`types.ts`(21)·`scheduled.ts`(39)·`lib/{ai(125),id(14),time(80)}`.

**평가**: 라우터 얇고 설계 정합. `translateDbError`가 트리거 거부를 409/400으로 번역(불변성=DB, API=번역만 원칙 준수). auth→time 미들웨어 순서 적정(미인증은 loadTime 건너뜀). 특정 라우트가 `:id`보다 앞(`analyses/context-*` → `:id`) = 정상. `time.ts`=귀속일 단일 구현(`mondayOf`·`attributionDate`/`attributionOfIso` 정확, KST 고정오프셋 문서화). `id.ts`=테이블 화이트리스트로 주입 차단, 단일사용자 race=문서화된 트레이드오프. `scheduled.ts`=멱등 자동마감+orphan(행 없는 예정일) 처리 정확.

**확정된 버그 (sector2 발견1)**: **`claude-sonnet-5`는 실재하지 않는 모델 ID** — claude-api 레퍼런스 확인, 현행 Sonnet=`claude-sonnet-4-6`(Sonnet 5 없음). 위치 ① `lib/ai.ts:10` PROVIDERS.anthropic.models ② `0002_models.sql`의 `model_high` 시드(→ 로컬·remote DB에 이미 적재). **오늘 도달 가능**: 설정 'AI 연결 테스트'(`testConnection`→`callModel`)가 claude-sonnet-5로 호출→404→"모델 이름을 찾을 수 없어요". `opus-4-8`·`haiku-4-5-20251001`는 유효.

**문서 드리프트(저)**: README API 표에 `classify-feelings`·`analyses/context-raw`·`ai/{providers,connections,test}`·defer의 `rate`·`DELETE tasks/:id` 누락.

**수정 후보**:
1. `lib/ai.ts` PROVIDERS: `claude-sonnet-5`→`claude-sonnet-4-6` [코드, 저위험]
2. 새 마이그레이션 `0006_fix_model_high.sql`: `UPDATE settings SET value='claude-sonnet-4-6' WHERE key='model_high' AND value='claude-sonnet-5'` — 라이브 기본값 교정(사용자 override는 보존). **사용자가 apply(local→remote)+deploy** [DB]
3. README API 표 갱신 [문서 → 최종 정리로]

**적용**: 후보 1(`lib/ai.ts` 모델 ID)·2(`migrations/0006_fix_model_high.sql` 생성) 반영. 재검증 = typecheck 통과 · smoke 124 · front 147(0006 격리 적용 포함) · 실패 0 (기준선 유지). **사용자 실행 대기**: 마이그레이션 apply(local→remote) + deploy (상단 ⚠️ 참조). 후보 3(README API 표)은 최종 정리로.

**상태**: ✅ 완료.

### sector5 · 핵심 도메인 서비스 (daily·tasks) — 검토 완료 · 2026-07-22

**대상**: `services/daily.ts`(226)·`services/tasks.ts`(210).

**sector3 이월 3건 — 전부 정합 확인**:
1. ✅ **defer batch 순서** — `deferTask`가 `stSetRate`를 `stMarkDeferred`보다 **먼저** 배치(ln 98). `stSetRate`의 `AND deferred_to IS NULL` 때문에 순서 필수. 정확.
2. ✅ **마감된 날 rate 처리** — `frozen = fromDaily.status==='closed'`이면 `setRate=false` + `stMarkDeferred` 생략 → 트리거 ABORT를 **애초에 시도 안 함**(catch가 아니라 사전 분기). 원 항목 `deferred_to=NULL` 유지 = Missed 보존, rate는 조용히 버리고 원값 반환. 2차 가이드와 일치.
3. ✅ **todayDone 정합** — Done = 그날 예정(`e.date=d`) + 그날 완료(`finished_on=d`)로 설계(1.2)와 일치. 조기·연장 완료는 daily가 아니라 Works(`worksDone`, planned_on 동반)로 노출 → 모순 없음. `completeTask`는 live 항목(미마감)에만 rate 100, 마감된 live는 안 건드림(1.3).

**그 외 정합**: 마감 순서(기록→mech 물화→close) batch 원자성 · `buildMech`가 열린 todo를 missed로 물화 · 삭제 순서(연장이력→항목→task)+차단 사유를 날짜로 명시 · 미루기 2주/신규일정 무제한 경계 · 완료율은 미루는 순간 확정. 전부 설계·트리거와 정합. **버그·필수 수정 없음.**

**소소한 후보(저, 선택)**: `diaryFeed`·`me.meHistory`의 `limit`이 비수치 쿼리(`?limit=abc`)면 `Number()`→NaN→`LIMIT NaN`. 클램프/기본값 가드 권장(단일 사용자·앱 제어라 영향 낮음).

**상태**: ✅ 완료.

### sector6 · 주변 도메인 서비스 (events·periods·me·analysis·memos) — 검토 완료 · 2026-07-22

**대상**: `events`(54)·`periods`(80)·`me`(66)·`analysis`(175)·`memos`(24).

**sector2 이월(발견2 — events INSERT 마감일 미차단) 해소**: `events.create`는 마감된 날에도 INSERT 가능(트리거는 upd/del만 차단). **버그 아님 — 1.3 '과거엔 추가만 가능' 원칙과 정합**(memo와 동일한 append-only). 추가된 event는 그 날이 closed면 upd/del 트리거로 즉시 불변. `schedule_entries`가 INSERT까지 막는 건 마감 시 물화된 Missed/Done을 보호하기 위함이고, event는 그 물화(mech)에 참여하지 않아 막을 이유가 없다. → **현행 유지 권장**(막으려면 1.3과 모순되는 `trg_events_frozen_ins` 필요).

**정합 확인**:
- **analysis(5장)**: `windowSpec` = 5.2 윈도우(경과≥4 이번주만 / ≤3 지난주 포함 + 완결주 weekly = 총 11~17일) 정확. 2-pass = 1차 독립·2차 추가(1차 수정 금지)·`context_meta` 저장 → 5.3/5.4 일치. weekly 없/stale이면 mech 대체(원칙4). **high 모델 사용 → sector4 0006 교정이 이 경로를 살린다.**
- **me(3장)**: '지금'=활성기간 goals 조인 파생(비저장). 갱신=이력+현재값 원자 batch. 개인 키 MASKED("설정됨"). 설정 RULES 검증(모델 ID는 형식만 — 미래 모델 허용, 의도적). 정합.
- **periods(2장)**: 상태(편집 가능)로 취급, 달성률=뷰·경과일=파생, start≤end 검증. 정합.
- **memos(1.3)**: 기존 daily에만 부착, 마감 후 유일 추가 통로, 추가 시 daily summary stale. 정합.

**소소한 후보(저, 선택)**:
- `periods.deletePeriod`: task가 FK로 막으면 "다른 기록이 참조" 일반 문구만 — task 삭제처럼 **어떤 task가 막는지** 이름 붙이면 UX 개선.
- `me.getMe`: `getPeriod(...)!.goals` 비-널 단언(동시 삭제 시 500 가능, 극저확률) + 활성기간마다 N+1. 선택적 하드닝.

**상태**: ✅ 완료. 버그·필수 수정 없음.

### sector7 · 프론트 셸 (index.html·api.js·manifest·icon) — 검토 완료 · 2026-07-22

**대상**: `index.html`(414)·`api.js`(78)·`manifest.json`(12)·`icon.svg`.

**구조 정합 (캐러셀·시트 아키텍처 지지)**:
- `main.screens > .track#tab-track` 안 5 `.screen`(today/cal/works/anal/me)=5-pane 트랙. `nav`·`.logbar`·`.fab`는 `.screens` **바깥**(transform 영향 없음·fixed 안전) — 2차 가이드/함정 일치.
- 캘린더 `.calbox`(overflow=마스크) 안 `.wkdays`(일~토)+`#cal-rows > .caltrack#cal-track`(3-pane). 요일 헤더 박스 안 — 일치.
- 시트 전부 단일 `.sheet`. `sh-event`에 시각 드럼 내장(`dial-h/m`), `sh-defer`에 완료율 바(`dfx-rate`) — 2차 통합 일정시트·완료율 C안 일치.
- api.js→app.js 말미 로드·인라인 스크립트 없음(boot 중복가드 유지). PWA 메타(viewport-fit=cover·theme-color·manifest·apple-touch) 완비. 키칸 `autocomplete="new-password"`/`off` — front '자동완성 차단' 충족.

**api.js**: 얇은 fetch 래퍼. 라우트 1:1(index.ts와 대조 일치, `defer`는 rate 전달). 401→친절 문구·`.status` 부착. 상태·렌더 없음. 정합.

**소소한 후보(저, 선택)**:
- `.screen.on`(scr-today) — 5-pane 트랙에선 display 토글 아닌 잔재 가능. **sector8에서 `.screen{display:none}` 잔존 확인**(있으면 트랙 충돌 — front 147 통과라 무해할 것).
- `manifest` 아이콘 SVG 1개(any maskable) — 설치 배너 호환 위해 PNG 192/512 폴백 + maskable 세이프존(선택).
- CSP 메타 없음(단일 사용자·동일 출처라 저위험, 선택) · 인라인 onclick(스타일, 유지).

**상태**: ✅ 완료. 버그·필수 수정 없음. `.screen.on` 확인은 sector8로 이월.

### sector8 · 스타일 (style.css 514) — 검토 완료 · 2026-07-22

**sector7 이월 해소**: `.screen{display:none}` 규칙 **없음** — `.screen{flex:0 0 100%}`로 5개가 늘 트랙에 살아 있고 트랙 transform만 미끄러진다. scr-today의 `class="screen on"`에서 `on`은 **CSS 미반응(잔재)** → 트랙 충돌 없음(front 147 정합). 원하면 `on` 제거=순수 정리, 무해.

**정합 확인**:
- **CSS 변수 + 다크 짝(트랩5)**: 색 전부 `:root` 변수. 다크는 두 경로 모두 — `@media(prefers-color-scheme:dark) :root:not([data-theme="light"])` + `:root[data-theme="dark"]`, 개별 오버라이드(`.ev`·`.bbar`·`.wseg.hot*`·`.band`·`.dline`·`--bar`·`.toast` 등)도 **쌍으로** 중복 정의. 규율 준수.
- `.calbox overflow:hidden`=마스크 · `.caltrack/.calpane` 3-pane · `.navdot` 20% 폭 · 드럼=scrollTop/scroll-snap(scrollIntoView 회피, 트랩) · 모바일 셸 fixed+safe-area · z-index 계층 · `.rbar.big` 4칸 완료율 — 전부 정합.

**발견 (다크모드 색 짝 누락 — 실제, 저)**:
- `.c.mut .d{color:#CFC9BD}`(ln144) 하드코딩·**다크 짝 없음** → 다크에서 인접월 날짜가 현재월(--sub)보다 **더 밝게** 보임(강조 역전). 변수화/다크 오버라이드 권장. **폰 확인 필요**.
- `.wkdays span:first-child{color:#C77}`(ln134) 일요일 색 하드코딩·다크 짝 없음(대개 무해하나 규율 이탈).

**소소한 후보(선택, 위험)**: append 누적으로 규칙 산재·후행 오버라이드(`.ev` 148/431·`.cells` 140/426·`.closerow` 110/346·`#cal-rows` 129/461). 통합 가능하나 **시각 회귀 위험 + front 시각 미검증** → 최종 on-device 패스로 보류 권장.

**상태**: ✅ 완료. 필수 코드 수정 없음. 다크 색 짝 2건은 "폰 확인" 항목으로.

### sector9 · app.js A (1–435: 헬퍼·트랙엔진·상태/DOM·Today·Score) — 검토 완료 · 2026-07-22

**꼼꼼 검토 — 함정·정합 확인**:
- **캐러셀 엔진**: `trackSet`=`translateX(-i*100%)` · `trackDrag`=`calc(-i*100% + dx px)`(%+손가락 px, 트랩2) · `trackDir`=플릭 0.35px/ms **또는** 거리 25% · `navSlide`=20%폭 소수 인덱스 · TRACK_MS 300/ease. 2차 가이드와 정확히 일치.
- **`weeksOf` 항상 6주**(트랩11) · `capRx`는 jsdom 무레이아웃 시 폰폭 근사(트랩2) · Score는 `scrollLeft`로 스크롤(scrollIntoView 회피, 트랩1).
- **XSS**: 사용자 콘텐츠(title·log·필드명)는 전부 `esc()`. `toast`는 textContent(안전). id/date는 서버 형식(`YYYYMMDD-NNN`)이라 onclick 인라인 안전. 색은 데이터(p.color=서버 #RRGGBB 검증)·테마는 `var(--)` — 트랩5 정합.
- **경계선 모델**(`bandPaths`)=2.2 n등분·created_at 순·전환점만 S곡선·실제 시작끝 면만 둥근 cap. front 147 통과가 기하 검증.
- `renderFeelings`는 입력 중 textarea 안 덮음(activeElement 가드) · 마감 시 입력줄→memo 전환.

**발견 / 확인 이월**:
- **`confirmAsk`의 `cf-text`는 innerHTML**(ln202, `<b>` 강조 의도) → **호출부가 사용자 콘텐츠를 `esc()` 해야** XSS 없음. 호출부는 Parts B–D(sector10~12)에서 확인. (cf-title은 textContent, 안전.)
- (극저) `paintScore` 이중 페인트 + diary 도착이 점수 드래그 중이면 today 바 교체로 드래그 끊길 이론적 레이스. 선택 하드닝.

**상태**: ✅ 완료. 버그 없음. `confirmAsk` esc 계약은 이후 섹터에서 검증.

### sector10 · app.js B (436–870: 날짜팝업·드럼·시트·완료율·캘린더·날짜선택) — 검토 완료 · 2026-07-22

**정합 확인**:
- **날짜 팝업**(openDay): 과거=읽기+memo·미래=일정·오늘=Today 이동. innerHTML 보간의 user 콘텐츠는 전부 `esc()`(title·log·memo·event). 정합.
- **시각 드럼**: 값은 상태(dialSt), 위치는 `scrollTop`만(scrollIntoView 회피 트랩·jsdom 대응).
- **캘린더 3-pane**: 이전·현재·다음 3개월을 `/calendar` **한 번**에, `trackSet(cal-track,1)`로 늘 가운데. 셀=일정 우선+할일 압축(대표는 live entry). deferred 미래는 새 날짜만. 설계·트랩 일치.
- **날짜 선택**: defer=2주·schedule=무제한(서버와 일치). `applyPickDim` 흐림. `assignDate` frozen 판정=`day_status==='closed'`(트랩: day_status로 마감 판단).
- **미루기 확정**: rate는 원 예정일 entry에서, frozen이면 rate undefined 전송(서버가 버림, sector5 정합).
- **confirmAsk 계약**: Part B 유일 호출 `removeEvent`는 **정적 문구**(user 콘텐츠 없음) → 안전.

**발견 (설계-코드 불일치, 저 — 확인 필요)**:
- **완료율 4칸 바의 4번째 칸=100%가 탭 가능**. 가이드 §4는 "100%는 바에서 제외 → [완료] 버튼 전용"인데, `RATE_STEPS=4`라 셀4 탭 시 `rateOf(4,cur)→100`으로 **바에서 100% 설정 가능**(완료 상태변경 없이 rate만 100). 무해(재탭으로 내려감·완료 표시엔 4칸 필요)하나 **문서 의도와 어긋남**. → sector14(front.mjs) + 폰 확인 후, 100을 완료 전용으로 둘지 결정(두면 상호작용 바에서 셀4 가드).

**상태**: ✅ 완료. 버그 아님. 완료율 4칸/100% 불일치는 의도 확인 대상.

### sector11 · app.js C (871–1350: Works·task시트·빠른추가·분석·Me/설정·기간·필드·AI) — 검토 완료 · 2026-07-22

**정합 확인**:
- **Works**: 세그먼트 경고색(대기 ring·기한 hot3, 이월 hot1/2/3)·예정 오늘/이번주/이후·대기 age·연장(age≥21만)·완료 planned/finished. user 콘텐츠 전부 `esc()`.
- **task 상세**(openTask): live=미뤄지지 않은 마지막 항목(미래 포함), `locked=day_status==='closed'`(트랩), 버튼 맥락별(대기→일정정하기·연장은 기한 닿아야·완료 시 잠금). big 4칸 바 → 100% 이슈 A 공유.
- **task 삭제 confirmAsk**: `esc(t.title)` **적용** + n회 이월 시 강한 문구 + "차라리 미루기" 대안. 계약 준수.
- **차단 팝업**(showStale): `esc(o.title)`, 지금 정하기→task 상세 직행. **Me/설정·기간·필드·분석**: 렌더 user 콘텐츠 전부 `esc()`, 파생 '지금' 비저장 표시, analysis 통합 산문(textContent).

**confirmAsk 계약 결론(sector9 이월)**: 3개 호출 중 `removeEvent`(정적)·`tk-delete`(esc) 안전. **`toggleField`만 `${k}` 미이스케이프**(아래).

**발견 (하드닝, 저)**:
- **필드명 `k` 이스케이프 불일치**: `renderFieldList`(ln1314, innerHTML+onclick)·`toggleField` confirmAsk(ln1324)가 `k`를 `esc()` 안 함. `renderFeelings`(Part A)는 함. `k`는 FIELD_CATALOG 키 또는 저장된 feelings_fields(서버는 문자열배열만 검증·내용 무제한) → 실사용 위험 ~0(단일 사용자·자기 데이터)이나 일관성/방어 갭. 수정=두 곳 `esc(k)`(+선택 me.ts `^[a-z_]+$` 강화).
- (저) 기간 삭제(pd-delete)는 confirmAsk 없이 즉시(task 삭제엔 있음). periods=편집 가능 상태라 덜 민감·서버 참조 시 409. 선택적 확인.
- (극저·구현2) `toggleAna` textContent `\n\n`이 `.abody`에 `white-space:pre-wrap` 없어 문단 안 나뉨.

**적용**: 필드명 `esc(k)` 2곳(ln1314·1324) 반영 — 재검증 typecheck·smoke 124·front 147 유지. onclick 문맥은 esc로 완전방어 불가 → **근본 방어(서버 `me.ts` feelings_fields 형식 `^[a-z_]+$` 강제)는 sector13 테스트 검토 후 판단**. 기간삭제 confirm·analysis 문단은 선택 보류.

**상태**: ✅ 완료.

### sector12 · app.js D (1351–1861: AI연결·설정편집·로그·분석실행·탭동기화·캐러셀·boot) — 검토 완료 · 2026-07-22

**꼼꼼 검토 — 함정·정합**:
- **제스처 엔진**(bindCarousel): 축잠금 첫 10px(트랩)·세로면 놓아줌·`setPointerCapture`·**속도는 VEL_WIN(90ms) 창으로**(이벤트당 계산의 무한대/요동 회피, ≥16ms만 인정)·놓을 때 VEL_STALE로 '멈췄다 뗌' 구분·`clientWidth||380` 폴백(jsdom). 매우 견고.
- **bindSwipe**: `noSwipe`로 가로스크롤·드럼·시트 제외 · 양끝 `dx*0.35` 감쇠 · S.pick 중 탭스와이프 차단. **calGo**: `transitionend` + `TRACK_MS+150` 폴백(jsdom 유실 대비) 후 addMonth·3-pane 재조립·재중심화. 2차 가이드 일치.
- **boot()**: `booted` 가드로 **중복 실행 1회 보장(트랩4)** · DOMContentLoaded 바인딩 · `module.exports`로 순수함수 테스트 노출.
- **XSS**: bootUI/conn-test 등 innerHTML은 `esc(e.message/r.error/…)`. 설정 옵션 `data-v`는 서버 enum(안전).
- **confirmAsk 계약 최종**: 7개 호출 전부 안전 — removeEvent·api_token·ai_api_key·conn-clear·askClose(정적/서버라벨) · tk-delete·toggleField(esc 적용).

**발견 / 이월**:
- **feelings_fields 설정 자유입력**(bindSettingSheet ln1493)이 임의 필드명 허용 → 필드명 XSS 벡터가 **UI로도 도달**. renderFieldList onclick은 esc로 못 막으니 **근본 방어=서버 `me.ts` feelings_fields 형식 `^[a-z_]{1,40}$` 강제** → **sector13 테스트 확인 후 적용 권장**(FIELD_CATALOG와 정합).
- (극저) `switchTab`이 `.screen.on` 토글하나 CSS 미반응(vestigial, s7/8) — 무해.

**상태**: ✅ 완료. **app.js 4파트 전부 검토 끝.** 버그 없음.

### sector13 · 서버 테스트 (smoke·e2e·seed·d1shim) — 검토 완료 · 2026-07-22

**구조 확인**:
- **d1shim**: node:sqlite(:memory:) 위 D1 표면. **batch=BEGIN…COMMIT/ROLLBACK**(원자성 재현)·FK ON. 충실.
- **smoke.ts(124)**: `worker.fetch`를 d1shim env로 HTTP 계층 통째 검사 — 시간·생성·Today·defer(순서/rate/재배정)·마감+mech 물화·동결 트리거 409·memo stale·연장/확정/완료·자동마감(Cron)·캘린더/달성률/Me/설정·5.2 윈도우·삭제(마감날 차단·0005 연장이력)·모델설정·AI연결(마스킹)·event·인증. **내 리뷰 결론을 테스트가 그대로 확증.**
- **e2e.mjs**: 임시폴더 일회용 D1 → `wrangler d1 migrations apply`(디렉터리 전체=**0006 포함**) → dev 서버 자식 → seed → front.mjs → killTree+rm. 실 `.wrangler/state` 불변(트랩8). 견고.
- **seed.mjs**: API 픽스처, 카탈로그 안전값만.

**발견**:
- **smoke 스키마 목록 하드코딩·0006 누락**(ln16, 0001~0005만): 새 마이그레이션 수동 추가 필요 = 드리프트. → 0006 추가 권장(model_high 값 미검사라 124 유지).
- **feelings_fields 형식 미검사**: smoke에 없음 → `me.ts` 서버검증 강화 **안전**(sector11/12 이월 하드닝 적용 가능).
- (극소) smoke ln280이 `claude-sonnet-5`를 형식-테스트 픽스처로 사용 — 무해.

**제안(승인 시)**: ① `me.ts` feelings_fields → `^[a-z_]{1,40}$`(+non-empty) 강제 = 필드명 XSS 근본 방어. ② `smoke.ts` 스키마에 `0006` 추가 = 전체 마이그레이션 검사.

**적용**: 제안 ①② 반영 — `me.ts` feelings_fields 형식 강제 + `smoke.ts`에 0006 추가. 재검증 typecheck·smoke 124·front 147(필드 카탈로그·"새 축 추가" 검사 통과) 유지.

**상태**: ✅ 완료.

### sector14 · 프론트 테스트 (front.mjs 520) — 검토 완료 · 2026-07-22

**구조**: index.html+api.js(BASE 치환)+app.js를 jsdom에 `<script>`로 주입(eval 아님=렉시컬 정상), DOMContentLoaded 발화, VirtualConsole로 런타임 오류 포집. 부팅 폴링·날짜무관 픽스처·3-pane 인지($cur=.calpane.cur).

**정합·트랩 확인**:
- **제스처 검사가 좌표를 `MouseEvent` 생성자로 실음**(ln338, **트랩3 준수**) → 축잠금(가로→탭·세로시작→무시·짧음→무시) 유효 검사.
- **탭 트랙 `translateX(-200%)`·nav-dot `translateX(200%)`·nav 강조**(ln357–363) + **calGo 재중심화·3-pane 유지**(ln366–375) → **인계 백로그의 "transform·nav 검사 없음"은 이미 해소됨.**
- 항상 6주·3-pane·bandPaths 기하(둥근 cap Q4·0~96·주경계 수직·겹침 공유곡선)·드럼 24/12·완료율 4칸 재탭 감소(50→25)·defer-rate(원75/신0)·키 마스킹 autocomplete·boot 복구(Invalid time value 회귀 가드) 전부 검사.
- me.ts 변경과 정합: 필드 시트가 `toggleField("sleep")`(카탈로그 키)로 검사 → 새 검증 통과(front 147 유지 근거).

**이슈 A 최종**: front는 완료율 **2번째 칸 재탭 감소만** 검사, **4번째 칸(→100)·100 제외는 미검사** → 가이드 vs 코드 불일치는 **테스트로 확정 불가, 폰에서 판단**(의도확인 A).

**상태**: ✅ 완료. front.mjs 자체 버그 없음. **전 15섹터 검토 끝.**

### 후속 · 의도 확인 A·B 반영 (사용자 지시) · 2026-07-22

0006 배포 전, 사용자 요청으로 두 UI 동작 변경:
- **A — 완료율 100% = 즉시 완료**: `rateSet`(Today·Works 행)·`setRateOn`(task 시트)에서 `rateOf`가 100이면 `Api.setRate` 대신 `Api.complete`(+토스트, 시트 닫기). 진행률 100과 '완료'를 하나로. 미루기 시트 `dfxRate`는 "미루기 직전 진행률" 기록이라 제외.
- **B — 마감된 날 일정 추가 허용 + 경고**: `openDay`가 과거·마감일에도 일정 섹션·"+ 일정 추가" 노출(1.3 append-only). `openEventSheet(k, closed)`가 마감일이면 시트에 경고문(`#evx-warn`). 삭제(×)는 마감 안 된 날에만(마감일은 트리거가 삭제 차단).

**검증**: typecheck·smoke 124·front 147·실패 0. (front은 실서버+jsdom 타이밍이라 간헐 146 플레이크 관측 → 재실행 시 147, 변경과 무관.)

**의도 확인 A·B 해소.** → 이제 0006 마이그레이션 적용+배포 가능.
