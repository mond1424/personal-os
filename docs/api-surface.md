# API Surface — Personal OS Worker

목적: **코드를 열지 않고 "어느 파일·함수를 고쳐야 하는지" 판단**하기 위한 시그니처 지도.
구조가 바뀌면 세션 종료 시 재생성한다 (CLAUDE.md 규칙). 코드 본문은 옮기지 않는다 — 시그니처만.

계층 흐름: **HTTP(`src/index.ts`) → 서비스(`src/services/*.ts`) → DB(`src/db/index.ts`)**. 시간·id·AI 중계는 `src/lib/`.
공통 인자 `env`(=`{DB, API_TOKEN?, ANTHROPIC_API_KEY?}`), `t`(=요청 시간 컨텍스트 `TimeCtx {d, now, compact, boundary, offsetMin}`).

---

## 1. HTTP 엔드포인트 (`src/index.ts`)

라우터는 얇다. body 파싱 실패 400, 트리거 거부는 `translateDbError`로 409/400. `API_TOKEN` 시크릿 있으면 `/api/*`에 Bearer 필수.

| 메서드 · 경로 | 요청 body | 응답(요약) | 담당 |
|---|---|---|---|
| GET `/api/today` | — | Today 조립(todo·done·reassign·waiting·overdue·events·periods·feelings·logs) | `daily.assembleToday` |
| POST `/api/logs` | `{text, ts?}` | `{date}` (201) | `daily.addLog` |
| PATCH `/api/logs/:id` | `{ts?, text?}` | `{id, date}` | `daily.editLog` |
| PUT `/api/daily/feelings` | `{values: Record<string,number>}` | `{date, fields}` | `daily.setFeelings` |
| PUT `/api/daily/feelings-text` | `{text}` | `{date}` | `daily.setFeelingsText` |
| PUT `/api/daily/score` | `{score}` | `{date, score}` | `daily.setScore` |
| POST `/api/daily/classify-feelings` | — | `{date, values, model}` | `daily.classifyFeelings` |
| POST `/api/daily/close` | `{kind?: manual\|brief}` | `{date, kind}` | `daily.closeDay` |
| GET `/api/calendar?start&end` | — | `{periods, entries, diary, events, memos}` | `daily.calendar` |
| GET `/api/days/:date` | — | 날짜 팝업 조립(relation·periods·tasks·events·daily·feelings·logs·memos) | `daily.assembleDay` |
| GET `/api/diary?limit` | — | 일기 목록 rows | `daily.diaryFeed` |
| POST `/api/memos` | `{date, ts?, text}` | `{id, date}` (201) | `memos.addMemo` |
| GET `/api/works/:segment` | — | seg rows (scheduled·waiting·deferring·periods·done) | `tasks.segment` |
| POST `/api/tasks` | `{title, period_id?, date?}` | `{id, title, waiting}` (201) | `tasks.createTask` |
| GET `/api/tasks/:id` | — | stats + `{wait_age, entries, extensions}` | `tasks.getTask` |
| PATCH `/api/tasks/:id` | `{title?, period_id?}` | `{id, title, period_id}` | `tasks.updateTaskMeta` |
| POST `/api/tasks/:id/defer` | `{from, to, rate?, reason?}` | `{id, from, to, reassigned, rate, reason?}` | `tasks.deferTask` |
| POST `/api/tasks/:id/schedule` | `{date}` | `{id, date}` | `tasks.scheduleTask` |
| POST `/api/tasks/:id/extend` | — | `{id, anchor, deadline}` | `tasks.extendWait` |
| POST `/api/tasks/:id/complete` | — | `{id, finished_on, planned_on, rate_applied}` | `tasks.completeTask` |
| DELETE `/api/tasks/:id` | — | `{id, deleted}` (마감 기록 있으면 409) | `tasks.deleteTask` |
| PUT `/api/tasks/:id/rate` | `{date, rate}` | `{id, date, rate}` | `tasks.setRate` |
| GET `/api/periods` | — | 카드 rows(달성률·경과일 파생) | `periods.listPeriods` |
| POST `/api/periods` | `{title, start_date, end_date, color, goals?}` | `{id}` (201) | `periods.createPeriod` |
| GET `/api/periods/:id` | — | period + `{goals}` | `periods.getPeriodDetail` |
| PATCH `/api/periods/:id` | `{title?, start_date?, end_date?, color?, goals?}` | `{id}` | `periods.updatePeriod` |
| DELETE `/api/periods/:id` | — | `{id}` (task 참조 시 FK 409) | `periods.deletePeriod` |
| POST `/api/events` | `{title, date, time?, period_id?, note?}` | `{id, ...}` | `events.create` |
| PATCH `/api/events/:id` | `{title?, date?, time?, period_id?, note?}` | `{...}` (마감일 409) | `events.update` |
| DELETE `/api/events/:id` | — | `{id, deleted}` (마감일 409) | `events.remove` |
| GET `/api/me` | — | `{fields, now}` | `me.getMe` |
| PUT `/api/me/:field` | `{value}` | `{field}` | `me.putMeField` |
| GET `/api/me/history?limit` | — | 이력 rows | `me.meHistory` |
| GET `/api/settings` | — | settings rows(개인 키 마스킹) | `me.getSettings` |
| PUT `/api/settings/:key` | `{value}` | `{key, value}` | `me.putSetting` |
| GET `/api/ai/providers` | — | `PROVIDERS` | `lib/ai.PROVIDERS` |
| GET `/api/ai/connections` | — | `{connections, low, high, fallback}` | `lib/ai.aiConfig` |
| POST `/api/ai/test` | `{which?: low\|high}` | `{ok, provider, model, ms, ...}` | `lib/ai.testConnection` |
| GET `/api/analyses` | — | 목록 | `analysis.list` |
| POST `/api/analyses` | `{prompt}` | 생성된 분석(2-pass) | `analysis.create` |
| GET `/api/analyses/context-raw` | — | `{text, meta, chars}` | `analysis.assembleContext` |
| GET `/api/analyses/context-preview` | — | 윈도우 미리보기 | `analysis.contextPreview` |
| GET `/api/analyses/:id` | — | 분석 + `{context_meta}` | `analysis.get` |
| GET `/api/guard/events` | — | guard 이벤트(구현 3 전 빈 목록) | `guard.events` |
| GET `/api/health` | — | `{ok, date, now}` | (인라인) |
| POST `/api/admin/auto-close` | — | `{closed, orphaned, as_of}` | `scheduled.autoClose` |

> 라우트 순서 주의: `/api/analyses/context-*`·`context-preview`는 `/api/analyses/:id`보다 **앞**에 둔다(:id가 먼저 잡으면 안 됨).

---

## 2. 서비스 계층 (`src/services/*.ts`)

도메인 규칙·트랜잭션 순서가 사는 곳. 파생은 여기서 조립(저장 X). 다중 쓰기는 `env.DB.batch([...])`(원자).

### daily.ts — Today·기록·마감·캘린더
- `assembleToday(env, t)` → Today 한 화면 조인(파생 전부 계산)
- `addLog(env, t, text, ts?)` → `{date}` · Log 추가(하루 열기 batch 앞)
- `editLog(env, id, patch)` → `{id, date}` · 마감 전만(마감 후 트리거 409)
- `setFeelings(env, t, values)` → `{date, fields}` · 눈금 upsert
- `setFeelingsText(env, t, text)` → `{date}` · manual 서술
- `classifyFeelings(env, t, date?)` → `{date, values, model}` · AI(low 모델) 분류, 마감 시 자동 호출
- `setScore(env, t, score)` → `{date, score}`
- `closeDay(env, t, kind, date?)` → `{date, kind}` · **기록→mech 물화→close** 순서 batch
- `assembleDay(env, t, k)` → 날짜 팝업 조인(과거는 done/deferred/missed)
- `calendar(env, start, end)` → `{periods, entries, diary, events, memos}` (memos: 날짜별 대표 1건+개수 — 셀 memo 줄)
- `diaryFeed(env, t, limit=30)` → 일기 rows(최대 90)

### tasks.ts — task 생성·미루기·완료·Works
- `createTask(env, t, {title?, period_id?, date?})` → `{id, title, waiting}`
- `getTask(env, t, id)` → stats + `{wait_age, entries, extensions}`
- `updateTaskMeta(env, id, {title?, period_id?})` → `{id, title, period_id}`
- `deferTask(env, t, id, from, to, rate?, reason?)` → `{id, from, to, reassigned, rate, reason?}` · **순서 stSetRate→stMarkDeferred→stInsertEntry→stSetDeferReason(도착지)**, 마감된 날은 재배정(insert-only, rate 무시). rate는 화면 입력에서 제거(2단계)되고 사유가 대신 저장됨
- `scheduleTask(env, t, id, date)` → `{id, date}` · 대기→확정
- `extendWait(env, t, id)` → `{id, anchor, deadline}` · 앵커=now(이력은 트리거)
- `completeTask(env, t, id)` → `{id, finished_on, planned_on, rate_applied}` · live 항목 rate 100(마감된 날은 안 건드림)
- `deleteTask(env, id)` → `{id, deleted}` · 마감 기록 있으면 409(사유 날짜로), 삭제 순서 연장이력→항목→task
- `setRate(env, id, date, rate)` → `{id, date, rate}`
- `segment(env, t, name)` → Works 세그먼트 rows

### periods.ts — 기간(편집 가능 상태)
- `listPeriods(env, t)` → 카드 rows(달성률=뷰·경과일=파생)
- `createPeriod(env, t, {title, start_date, end_date, color, goals?})` → `{id}`
- `getPeriodDetail(env, id)` → period + `{goals}`
- `updatePeriod(env, id, patch)` → `{id}`
- `deletePeriod(env, id)` → `{id}` (task FK 참조 시 409)

### events.ts — 일정(캘린더 전용 사건)
- `create(env, t, input)` → `{id, ...}` · 마감된 날에도 추가 가능(불변)
- `update(env, id, input)` → `{...}` · 마감일 트리거 409
- `remove(env, id)` → `{id, deleted}` · 마감일 트리거 409

### memos.ts — 어느 날짜에든 붙는 짧은 노트(3단계)
- `addMemo(env, t, {date, ts?, text})` → `{id, date}` · 과거·오늘·미래 어디든. daily 없으면 `stOpenDaily`로 빈 open daily ensure 후 붙임(마감된 날 불변은 트리거 유지) · +daily summary stale

### me.ts — Me·설정
- `getMe(env, t)` → `{fields, now}` · '지금'=활성 기간 goals 조인 파생
- `putMeField(env, t, field, value)` → `{field}` · 이력+현재값 batch
- `meHistory(env, limit=50)` → 이력 rows(최대 200)
- `getSettings(env)` → settings rows(개인 키는 '설정됨' 마스킹)
- `putSetting(env, key, value)` → `{key, value}` · RULES로 키별 형식 검증

### analysis.ts — 분석(구현 2)
- `list(env)` → 목록
- `get(env, id)` → 분석 + `{context_meta}`
- `models(env)` → `{low, high}`
- `contextPreview(env, t)` → 5.2 윈도우 미리보기
- `assembleContext(env, t)` → `{text, meta}` · Me+기간+지난주+raw+Today 조립
- `create(env, t, prompt)` → 2-pass 생성(1차 독립·2차 추가), high 모델

### guard.ts — 구현 3 자리
- `events(env)` → guard_events 목록(조회만)

### scheduled.ts — Cron
- `autoClose(env)` → `{closed, orphaned, as_of}` · 열린 과거 마감 + 고아 예정일 처리
- `scheduled(event, env)` → void · Cron 엔트리(autoClose 호출)

---

## 3. DB 계층 (`src/db/index.ts`)

**SQL은 이 파일에만.** `st*` 접두 = batch 조립용 `D1PreparedStatement` 반환(호출부가 `.run()`/`batch`). 나머지 = 즉시 조회(`.all()`/`.first()`). 반환 타입은 제네릭으로 명시.
공통 타입: `TaskStats`, `Entry`, `DailyRow`, `PeriodRow`, `EventRow` (export interface).

**B. Today 조인** — `todayTodo(env, d)` · `todayDone(env, d)` · `reassignQueue(env, d)`(최근예정<오늘&미완료) · `waitingList(env)`(is_waiting=1)
**C. 하루 열기** — `stOpenDaily(env, d, now)` · `getDaily(env, d)`
**D. 캘린더 그리드** — `calPeriods(env, start, end)` · `calEntries(env, start, end)` · `calDiaryDates(env, start, end)` (memo 제외 — 마감·점수·감정·로그만) · `calMemos(env, start, end)` (날짜별 대표 1건+개수)
**E. 날짜 팝업 조각** — `periodsAt(env, k)` · `feelingsAt(env, k)` · `logsAt(env, k)` · `memosAt(env, k)`
**F. 파생 분류** — `classifyAt(env, k)` → done/deferred/missed/todo (마감일이면 todo→missed)
**G. 마감 조각** — `stUpsertMech(env, kind, key, mech, now)` · `stCloseDaily(env, d, kind, now)`
**H. 자동 마감** — `openDatesBefore(env, d)` · `orphanEntryDates(env, d)` · `stInsertClosedDaily(env, date, now)`
**I. 쓰기 조각** — `stInsertLog` · `getLog(env, id)` · `stUpdateLog(env, id, ts, text)` · `stUpsertFeeling(env, d, field, value, source)` · `stSetScore` · `stSetFeelingsText` · `stInsertTask(env, id, title, periodId, now)` · `stInsertEntry(env, taskId, date, now)` · `stMarkDeferred(env, taskId, from, to, now)`(`AND deferred_to IS NULL`) · `stExtendWait(env, taskId, now)` · `liveEntry(env, taskId)`(미뤄지지 않은 마지막 항목) · `stRate100At` · `stFinishTask(env, taskId, now, d)` · `stSetRate(env, taskId, date, rate)`(`AND deferred_to IS NULL`) · `stUpdateTaskMeta` · `stInsertMemo(env, id, date, ts, text, now)` · `stStaleSummary(env, kind, key)`
**J. Works 세그먼트** — `worksScheduled(env, d)` · `worksDeferring(env)` · `worksByPeriod(env)` · `worksDone(env)`(planned_on 포함)
**일정(event)** — `eventGet(env, id)` · `eventsAt(env, date)` · `eventsRange(env, start, end)` · `stInsertEvent(env, id, title, date, time, periodId, note, now)` · `stUpdateEvent(...)` · `stDeleteEvent(env, id)`
**기간** — `periodCards(env)`(+달성률 뷰) · `getPeriod(env, id)` · `stInsertPeriod(env, p)` · `stUpdatePeriod(env, p)`
**K. 일기 목록** — `diaryList(env, before, limit)`
**엔티티 단건** — `taskStats(env, id)` · `taskEntries(env, id)`(+`day_status`) · `taskEntryAt(env, id, date)` · `waitExtensions(env, id)`
**삭제 가드/실행** — `closedEntryDates(env, taskId)`(막는 날짜 이름) · `guardEventCount(env, taskId)` · `stDeleteExtensions` · `stDeleteEntries` · `stDeleteTask(env, id)` · `stDeletePeriod(env, id)`
**Me** — `meAll(env)` · `meGet(env, field)` · `stMeHistory(env, field, oldV, newV, source, now)` · `stMeUpsert(env, field, value, now)` · `meHistory(env, limit)`
**settings** — `settingsAll(env)` · `stSettingPut(env, key, value)`
**analyses/summary** — `analysesList(env)` · `analysisGet(env, id)` · `weeklySummaryGet(env, key)` · `weeklySummaryFull(env, key)` · `mechDaily(env, key)`
**컨텍스트 범위 조회** — `dailyRange` · `logsRange` · `feelingsRange` · `memosRange` (각 `(env, start, end)`) · `analysesRecentFull(env, n)` · `stInsertAnalysis(env, id, prompt, pass1, pass2, meta, now)`
**guard** — `guardEventsList(env)`

**뷰(스키마)**: `v_task_stats`(entry_count·defer_count·latest_date·current_rate·is_waiting) · `v_period_achievement`(달성률=current_rate 평균).

---

## 부록. lib/ (유틸)

- **`lib/time.ts`** — `loadTime(env)` → `TimeCtx` · `attributionDate` · `attributionOfIso` · `isoNow` · `addDays` · `diffDays` · `mondayOf` · `isDate`. 귀속일(경계 05:00)·주(월요일)의 단일 구현.
- **`lib/id.ts`** — `nextId(env, table, compact)` → `'YYYYMMDD-NNN'`. 테이블 화이트리스트.
- **`lib/ai.ts`** — `PROVIDERS` · `aiConfig(env)` · `callModel(env, call)`(=`callClaude`) · `testConnection(env, which)` · `splitModel` · `parseModelJson`. 제공자별 요청 형식 흡수.
