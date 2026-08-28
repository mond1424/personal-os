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
| GET `/api/today` | — | Today 조립(todo·done·reassign·waiting·overdue·events·periods·feelings·logs·guard) · `guard = {fired, last_at, ignored}` 또는 집계 실패 시 `null` (T-45) | `daily.assembleToday` |
| POST `/api/logs` | `{text, ts?}` | `{date}` (201) | `daily.addLog` |
| PATCH `/api/logs/:id` | `{ts?, text?}` | `{id, date}` | `daily.editLog` |
| PUT `/api/daily/feelings` | `{values: Record<string,number>}` | `{date, fields}` | `daily.setFeelings` |
| PUT `/api/daily/feelings-text` | `{text}` | `{date}` | `daily.setFeelingsText` |
| PUT `/api/daily/score` | `{score}` | `{date, score}` | `daily.setScore` |
| POST `/api/daily/classify-feelings` | — | `{date, values, model}` | `daily.classifyFeelings` |
| POST `/api/daily/close` | `{kind?: manual\|brief}` | `{date, kind}` | `daily.closeDay` |
| GET `/api/calendar?start&end` | — | `{periods, entries, diary, events, memos}` | `daily.calendar` |
| GET `/api/days/:date` | — | 날짜 팝업 조립(relation·periods·tasks·events·daily·feelings·logs·memos[{id, ts, text, created_at, same_day}]) | `daily.assembleDay` |
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
| POST `/api/tasks/:id/cancel` | `{reason?}` | `{id, cancelled_at, cancelled_on, kept_dates, cancel_reason}` | `tasks.cancelTask` |
| POST `/api/tasks/:id/uncancel` | — | `{id, cancelled, waiting}` | `tasks.uncancelTask` |
| DELETE `/api/tasks/:id` | — | `{id, deleted}` (마감·Guard 기록 있으면 409 `{suggest:"cancel"}`) | `tasks.deleteTask` |
| PUT `/api/tasks/:id/rate` | `{date, rate}` | `{id, date, rate}` | `tasks.setRate` |
| GET `/api/periods` | — | 카드 rows(달성률·경과일 파생) | `periods.listPeriods` |
| POST `/api/periods` | `{title, start_date, end_date, color, goals?}` | `{id}` (201) | `periods.createPeriod` |
| GET `/api/periods/:id` | — | period + `{goals}` | `periods.getPeriodDetail` |
| PATCH `/api/periods/:id` | `{title?, start_date?, end_date?, color?, goals?}` | `{id}` | `periods.updatePeriod` |
| DELETE `/api/periods/:id` | — | `{id}` (task 참조 시 FK 409) | `periods.deletePeriod` |
| POST `/api/events` | `{title, date, time?, period_id?, note?}` | `{id, ...}` | `events.create` |
| PATCH `/api/events/:id` | `{title?, date?, time?, period_id?, note?}` | `{...}` (마감일 409) | `events.update` |
| DELETE `/api/events/:id` | — | `{id, deleted}` (마감일 409) | `events.remove` |
| POST `/api/cal/sync` | `{items:[{ext_uid, title, date, time?, all_day?, ext_updated?}], window:{from,to}}` | `{upserted, skipped_closed, skipped_stale, deleted, protected_kept, window}` · **멱등** · 앱 생성 일정(`ext_src IS NULL`)은 안 지운다 | `calsync.syncCal` |
| GET `/api/me` | — | `{fields, now}` | `me.getMe` |
| PUT `/api/me/:field` | `{value}` | `{field}` | `me.putMeField` |
| GET `/api/me/history?limit` | — | 이력 rows | `me.meHistory` |
| GET `/api/settings` | — | settings rows(개인 키 마스킹) | `me.getSettings` |
| PUT `/api/settings/:key` | `{value}` | `{key, value}` | `me.putSetting` |
| GET `/api/ai/providers` | — | `PROVIDERS` | `lib/ai.PROVIDERS` |
| GET `/api/ai/connections` | — | `{connections, low, high, fallback}` | `lib/ai.aiConfig` |
| POST `/api/ai/test` | `{which?: low\|high}` | `{ok, provider, model, ms, ...}` | `lib/ai.testConnection` |
| GET `/api/analyses` | — | 목록 | `analysis.list` |
| POST `/api/analyses` | `{prompt, depth?: normal\|detailed\|deep}` | 생성된 분석(2-pass) | `analysis.create` |
| GET `/api/analyses/context-raw` | — | `{text, meta, chars}` | `analysis.assembleContext` |
| GET `/api/analyses/context-preview` | — | 윈도우 미리보기 | `analysis.contextPreview` |
| GET `/api/analyses/:id` | — | 분석 + `{context_meta}` | `analysis.get` |
| GET `/api/lm/sections` | — | `{sections:[{section, schema_version, n, last}]}` | `lifemodel.sections` |
| POST `/api/lm/import-me` | — | `{imported, skipped}` · 원본 `me`는 지우지 않는다 · 멱등 | `lifemodel.importFromMe` |
| PATCH `/api/lm/item/:id` | `{title?, body?, data?}` | 갱신된 항목(version 포함) | `lifemodel.update` |
| DELETE `/api/lm/item/:id` | — | `{id, deleted}` | `lifemodel.remove` |
| GET `/api/lm/:section/schema` | — | `{section, version, schema, fields}` — 검증·프롬프트·폼이 같은 것을 읽는다. `fields[]` = `{key, type, title, required, enum?, itemType?}` · **`title`은 표시 라벨(0014), 없으면 `key`로 폴백** | `lifemodel.schema` |
| GET `/api/lm/:section` | — | 항목 rows(data는 객체로 복원) | `lifemodel.list` |
| POST `/api/lm/:section` | `{title, body?, data?}` | `{id, section, title, schema_version}` (201) · **data는 스키마 검증 통과분만** | `lifemodel.create` |
| PUT `/api/events/:id/protect` | `{protect_from?, protect_level?, protect_sleep_min?, protect_prep_min?}` 또는 `{protect:false}` | `{id, protected, ...}` · **본문 수정과 분리**(마감된 날에도 부착 가능) | `events.setProtect` |
| GET `/api/guard/events?limit` | — | 발동 이력 rows | `guard.events` |
| GET `/api/guard/schedule?days` | — | `{d, mode, friction_mult, events:[{event_id, start, deadline, fires[]}]}` · **기기가 하루 1회 pull** | `guard.schedule` |
| POST `/api/guard/events` | `{cause, level, client_id?, fired_at?, event_id?, risk_score?, risk_snapshot?, foreground_app?, source?, reaction?, reason?, ai_used?, ai_verdict?, ai_unavailable_reason?, ai_reason?}` | `{id, on_date, level, mode, duplicate?}` (201) · **upsert** — `client_id`로 재전송 멱등, 반응 후행 채움. `ai_unavailable_reason`(0016)은 `ai_verdict='unavailable'`일 때만 남고 **닫힌 목록 밖이면 조용히 비운다** — 400을 던지면 기기 `flush()`가 발동 행을 버린다. `ai_reason`(0017)은 그 **반대편**이다 — `approve`·`deny`일 때만 남는 자유 문자열(모델이 쓴 문장)이고, 500자를 넘으면 **거부가 아니라 자른다**(같은 이유). **판정만 담아 뒤늦게 보내도 된다**(T-39): `client_id`만으로 기존 행의 `ai_used`·`ai_verdict`·`ai_unavailable_reason`·`ai_reason`을 **`NULL → 값`으로만** 채운다(`ai_used`는 `0 → 1`만). `cause`·`level`이 없어도 400이 아니고, **`level`은 못 바꾼다**(불변성 트리거). **저장되는 `risk_snapshot`은 보낸 것과 다르다**(T-32): 서버가 §6.6 항을 `server` 키 아래 얹고 `risk_score`를 낸다 — 전부 **`fired_at` 기준**이라 오프라인 큐가 늦게 올라와도 그 밤의 값이다. 기기 항은 이름·값 그대로. `risk_snapshot`을 안 보내면 **얹지 않는다**(둘 다 NULL) | `guard.record` |
| POST `/api/guard/verify` | `{client_id, cause, level_candidate:4, event_id?, risk_snapshot?, foreground_app?}` | `{level:3\|4, approved, reason, ai_used, cached, source}` · **어떤 경우에도 200** — 판정 불가는 `level:3`. `source` = `ai\|cache\|cap\|timeout\|error\|off`. `level_candidate≠4`는 400(격상 전용) | `guard.verifyLevel4` |
| POST `/api/guard/events/:id/react` | `{reaction, reason?, reacted_at?}` | `{id, reaction, reacted_at}` · 두 번째는 409 | `guard.react` |
| POST `/api/guard/events/:id/outcome` | `{outcome}` | `{id, outcome, outcome_at}` · 재확정 409 | `guard.setOutcome` |
| GET `/api/guard/pending-outcome` | — | outcome 미확정 rows(+event_title) | `guard.pendingOutcome` |
| GET `/api/collected/pending` | — | `[{id, source, summary, starts_at}]` · **`state='new'`이고 `starts_at`이 `[t.now, +7일]`인 것만**(T-42 결정 ①). 창 밖·과거·`dismissed`·`starts_at IS NULL`은 안 준다. **`description`은 안 싣는다** — 카드가 원문 한 줄만 쓴다 | `collected.pending` |
| POST `/api/collected/:id/accept` | — | `{id, event_id, state:'accepted', duplicate}` · `events` 행 하나를 만든다(`title` = `summary` **원문 그대로** · `date`·`time` = `starts_at`). **보호 규칙은 안 붙인다**. ⚠️ **멱등** — 이미 `accepted`면 `events`를 또 만들지 않고 `duplicate:true`로 있던 id를 준다(순차 한정) | `collected.accept` |
| POST `/api/collected/:id/dismiss` | — | `{id, state:'dismissed'}` · **다시 묻지 않는다** — `last_modified`가 바뀌어도 그대로다(T-41의 touch가 `state`를 안 건드린다) | `collected.dismiss` |
| GET `/api/collected/status` | — | `{configured, last_collect_at, last_result, last_error_at, last_seen_count, counts{new,accepted,dismissed}, next_earliest_at}` · **`pending`과 가른 이유는 시야가 다르기 때문**(7일 창 vs 원장 전체) — 섞으면 어느 쪽 0인지 못 읽는다. ★ **`last_seen_count`가 "돌았지만 0건"(=0)과 "한 번도 안 돌았다"(=null)를 가른다**(T-43). ⚠️ **URL·토큰은 안 나간다** — `configured`는 있다/없다만 | `collected.status` |
| GET `/api/guard/modes` | — | `{modes[]+downgrade, active, protecting}` · 판정을 **조회 시 계산**해 싣는다(T-19) | `guard.modes` |
| PUT `/api/guard/modes/active` | `{key, reason?}` | `{active, downgrade, reason}` · 하향은 보호 중 409 · 사유 없으면 400 | `guard.setMode` |
| GET `/api/guard/watch-apps?source` | — | rows | `guard.listWatchApps` |
| POST `/api/guard/watch-apps` | `{source, identifier, label?}` | `{source, identifier}` (201) | `guard.addWatchApp` |
| DELETE `/api/guard/watch-apps/:source/:identifier` | — | `{deleted}` | `guard.removeWatchApp` |
| GET `/api/health` | — | `{ok, date, now}` | (인라인) |
| POST `/api/admin/auto-close` | — | `{closed, orphaned, guard_ignored, uclass, as_of}` | `scheduled.autoClose` |
| — | | ↑ `uclass`(T-41)는 학사 iCal 수집 결과다: `{skipped:'no_token'\|'too_soon'\|'error'\|null, collected, added, changed}`. **던지지 않는다** — `guard_ignored`와 같은 이유로 `.catch`로 삼키고 실패 사유는 `settings.uclass_last_error`에 남는다. 토큰(`UCLASS_ICAL_URL`)이 없으면 `no_token`으로 끝나 아무 일도 안 한다. **성공하면 `uclass_last_collect_at`·`uclass_last_seen_count`(VEVENT 수)를 쓰고 error를 지운다**(T-43). **2xx여도 `BEGIN:VCALENDAR`가 없으면 `not_calendar`로 실패**시킨다 — 로그인 HTML이 '0건 성공'으로 남으면 방학과 구별이 안 된다 | |

> **라우트 순서 주의** — 리터럴 경로를 와일드카드보다 **앞**에 둔다. 실제로 두 번 물렸다:
> `/api/analyses/context-*`는 `/api/analyses/:id`보다 앞 · `/api/lm/{sections,import-me,item/:id}`는 `/api/lm/:section`보다 앞.
> 뒤에 두면 `POST /api/lm/import-me`가 `:section`에 잡혀 `section="import-me"`로 들어간다.

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
- `assembleDay(env, t, k)` → 날짜 팝업 조인(과거는 done/deferred/missed) · memo의 `same_day`는 `attributionOfIso(created_at, boundary) === k`로 조회 시 계산
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
- `cancelTask(env, t, id, reason?)` → `{id, cancelled_at, cancelled_on, kept_dates, cancel_reason}` · 열린 날 예정만 비우고 마감된 날 항목은 보존(0008). state='cancelled'. 사유는 append-only(0009) — 500자 제한, 빈값 정규화
- `uncancelTask(env, id)` → `{id, cancelled:false, waiting}` · 예정 복구 없이 대기로 복귀
- `deleteTask(env, id)` → `{id, deleted}` · 마감·Guard 기록 있으면 409 `{suggest:"cancel"}`(사유 날짜로), 삭제 순서 연장이력→항목→task
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

### calsync.ts — 폰 캘린더 미러 (0020 · ADR-029 · T-52)
- `CAL_SRC` = `'devcal'` — `events.ext_src`에 그대로 들어간다. **NULL이면 앱이 만든 일정**
- `syncCal(env, t, {items[], window:{from,to}})` → `{upserted, skipped_closed, skipped_stale, deleted, protected_kept, window}`
  - **멱등**: 창 범위를 통째로 받아 그 상태에 맞춘다. 같은 것을 두 번 보내면 한 행
  - 항목 키는 `(ext_src, ext_uid)` — 반복은 **인스턴스 단위** `'<eventId>:<날짜>'`
  - ★ **마감된 날은 건너뛴다**(ADR-029 영구 이탈). `events`엔 `_ins` 트리거가 없어(함정 6)
    **DB가 안 막아 준다 — 여기가 유일한 방어선**이다. UPDATE·DELETE 쪽 트리거는 409로
    배치를 깨는 모양이라, 어느 쪽이든 서버가 먼저 판단한다
  - ★ **삭제 후보는 `db.extEventsInWindow`가 `ext_src='devcal'`로 고른다** —
    앱이 만든 일정은 후보 집합에 **구조적으로** 안 들어온다. 조건을 `if`로 두지 않는다
  - guard 이력이 참조하면 삭제 대신 `protect` 해제 + 보존 → `protected_kept`
  - LWW: `ext_updated`(ISO8601 UTC 문자열)가 저장된 것보다 오래되면 무시 → `skipped_stale`
  - ⚠️ **받지 않는 것**: `protect_*`(앱 전용) · 위치·참석자·알림 · 귀속일 재계산(벽시계 그대로)

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
- `create(env, t, prompt, depth?)` → 2-pass 생성(1차 독립·2차 추가), high 모델. depth(normal/detailed/deep, 기본 detailed)가 문단 지시+maxTokens 결정, 잘못된 값은 400 아니라 detailed로 fallback. 선택값은 `context_meta.depth`에 보존

### lifemodel.ts — Life Model (0012, me-reinforcement-plan Phase 1)
- `sections(env)` → 스키마가 등록된 섹션만. **만들지 않은 섹션은 빈 껍데기로 노출하지 않는다**(§1)
- `schema(env, section)` → `{schema, fields}` · `fields`는 스키마에서 파생 — 폼을 손으로 만들면 스키마와 어긋난다
- `list` / `create` / `update` / `remove` — `data`는 저장 전 스키마 검증(§0-6). **빈칸 허용**이라 `data` 없이도 저장된다(§0-2)
- `importFromMe(env, t)` → 기존 `me` 5필드를 Overview로 **복사**. 원본은 지우지 않는다(`me_history`가 분석 입력이므로). 제목이 같으면 건너뛰어 멱등
- `version`은 서비스가 아니라 **트리거**가 올린다 — 서비스가 빠뜨려도 stale 체인(§5)이 안 깨진다

### events.ts — 보호 규칙 (0010)
- `setProtect(env, id, input)` → `{id, protected, ...}` · **`stUpdateEvent`를 타지 않는다** — 보호 규칙은 '계획'이라 마감된 날 트리거에 걸리면 안 된다. `stSetProtect` 전용 경로

### guard.ts — Guard v1 (8월). **기록과 조회만 한다 — 발동은 기기가**(ADR-021)
- `events(env, limit)` → 발동 이력
- `schedule(env, t, days)` → 기기가 알람을 예약할 재료. **데드라인을 여기서 역산**한다(저장 X, 원칙 4):
  `deadline = 일정시각 − protect_prep_min − protect_sleep_min` (기본 90·360 → 09:00 시험이면 01:30, 설계 §6.1 예시)
  Level 1(진입)·2(−2h·−1h)·3(데드라인)·4(+30m부터 30분 간격 6회)를 전부 시각으로 펼쳐 준다. 활성 모드의 `max_level`로 상한
- `record(env, t, input)` → `{id, on_date, level, mode, duplicate?}` · **`fired_at`은 기기 시각**이고 귀속일도 그걸로 계산(오프라인 큐가 나중에 올라오므로)
  - **upsert(0011)**: `client_id`가 이미 있으면 그 행을 돌려주고, 반응만 왔으면 그것만 채운다. 셋을 한 엔드포인트로 받는다 — 발동만 / 발동+반응 동시(오프라인) / 반응 후행
  - `applyReaction`을 `react()`와 공유 — Override 사유 검증이 한 곳에만 있다
- `react(env, t, id, input)` → 반응 한 번만(409). Override는 **사유가 비어 있지만 않으면** 통과 —
  **길이 하한(20자)은 S3.2에서 폐기했다**(마찰이 아니라 강제로 읽혔다. §6.3은 "비용을 치르게 한다"이지 "분량을 채우게 한다"가 아니다)
- `setOutcome(env, t, id, outcome)` → 사후 확정 한 번만(409). **Guard가 판단하지 않는다**(§6.5)
- `pendingOutcome(env)` → outcome 미확정 목록(Today 확정 카드용)
- `finalizeIgnored(env, t)` → `{ignored, cutoff}` · **루프의 닫는 쪽**(ADR-025). 반응 없이 `GRACE_H`(36시간)를
  넘긴 발동을 `ignored`로 확정한다. 유예가 긴 이유는 오프라인 큐다 — 기기가 발동과 반응을 **함께** 나중에
  올리므로(ADR-023) 서버가 먼저 박으면 트리거가 진짜 반응을 막고 소급 복구가 안 된다.
  `autoClose`가 부르고, 거기서 던지면 자동 마감이 통째로 멈추므로 `.catch`로 격리돼 있다
- `modes(env, t)` / `setMode(env, t, key, reason?)` → 파라미터 프로파일(ADR-019). active는 부분 유니크 인덱스라 **해제 → 설정 batch**
  - **`t`는 라우트가 넘긴다**(T-23) — 서비스가 `loadTime`을 다시 부르면 05:00 경계에서 미들웨어와 갈라진다
  - `modes(env, t)`는 **판정을 응답에 싣는다**(T-19 — 화면이 PUT *전에* 알아야 대기를 걸지 말지 정한다):
    `modes[].downgrade`(활성 모드 기준 `isDowngrade`) · `protecting`(보호 중이면 `{title, start, until}`, 아니면 `null`).
    `start`=`protect_from`(진입) · `until`=`start`(차단 종료). 둘 다 `normalizeIso`로 **로컬 표기**(`5687455`)
  - **파생을 저장하지 않는다**(원칙 4) — `guard_modes`에 컬럼이 늘지 않았고 전부 조회 시 계산이다.
    프런트가 다시 계산하는 것은 ADR-027 위반이라 **서버가 준다**
  - **하향에만 마찰**(부수 규칙 1·2 · ADR-027): 보호 구간 중이면 409, 밖이면 사유 없이는 400. **상향·동일은 그대로 자유**
  - `isDowngrade(from, to)` → 강도 파라미터 **다섯**을 `STRENGTH_DIR`로 비교. `risk_threshold`만 방향이 반대(**문턱**이라 높아지면 약함).
    `ai_daily_cap`(지출 통제 · ADR-024)·`sort`(표시 순서)는 판정에서 제외
  - `protectingNow(env, t)` → **`schedule()`을 그대로 쓴다.** `[protect_from, start]`에 `t.now`가 들면 보호 중 — 역산식을 두 벌 두지 않는다
  - 대기(60초)는 서버가 걸지 않는다(ADR-027 ③) — 클라이언트가 센다. 사유는 `me_history(field='guard_mode', reason)`에 남는다(0015)
- `listWatchApps` / `addWatchApp` / `removeWatchApp` → PC 확장 자리(ADR-022)
- `verifyLevel4(env, t, input)` → **Level 3→4 격상만** 검증(ADR-024). Level 1~3은 손대지 않는다(ADR-021).
  통제 순서에 뜻이 있다: **⑤킬 스위치 → ②캐시 → ③일일 상한 → 키 확인 → ④타임아웃 8초 → ①호출**
  - **캐시가 상한보다 먼저다** — 적중은 돈이 0이므로, 상한이 찼다고 받은 판정을 버리면 그 밤의 Level 4가 이유 없이 죽는다
  - 킬 스위치(`settings.guard_ai_verify='off'`)는 **항상 격상**(결정론 복귀) — Level 3으로 떨구면 끄기가 벌이 된다
  - 실패·타임아웃·파싱 실패는 전부 `level:3`. **fail-open을 하지 않는다**(ADR-024가 명시적으로 기각)
  - `callModel`의 시그니처를 바꾸지 않고 **호출부에서 `Promise.race`로** 타임아웃을 씌운다(분석 경로가 물린다)
  - ⑥기록은 여기서 하지 않는다 — 기기가 발동을 올릴 때 `record()`가 `ai_used`·`ai_verdict`를 받는다.
    검증만 하고 발동하지 않은 밤의 **유령 행이 개입 이력을 오염**시키기 때문

### lib/context.ts — 고정 코어 컨텍스트(§6.2)
- `buildCoreContext(env, t)` → 프롬프트용 텍스트. **빈 섹션을 생략하지 않는다**(`"Education: 정보 없음"`) —
  생략하면 모델이 빈 곳을 상상으로 메운다. 섹션 목록은 **`lm_schema`에서** 가져온다(손으로 적으면 새 섹션이 조용히 빠진다)
- 소비처는 지금 `guard.verifyLevel4` 하나. §6.3 관리인 chat(Phase 4)까지 **범용 확장을 미리 하지 않는다**

### scheduled.ts — Cron
- `autoClose(env, t)` → `{closed, orphaned, guard_ignored, as_of}` · 열린 과거 마감 + 고아 예정일 처리 + `finalizeIgnored`
  - **`t`를 받는다**(T-23). `t.now`가 `daily`·`summaries.mech`에 **저장**되므로 경계에서 갈라지면
    마감 기록이 잘못된 날에 남고 트리거가 그것을 동결한다. `/api/admin/auto-close`는 미들웨어의 `t`를 넘긴다
- `scheduled(event, env)` → void · Cron 엔트리. **cron에는 요청이 없으므로 여기가 `loadTime`의 경계다**

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
**J. Works 세그먼트** — `worksScheduled(env, d)` · `worksDeferring(env, d)`(이월 중 = 미룬 것 **또는** 지난 예정 · T-47) · `worksByPeriod(env)` · `worksDone(env)`(planned_on 포함)
**일정(event)** — `eventGet(env, id)` · `eventsAt(env, date)` · `eventsRange(env, start, end)` · `stInsertEvent(env, id, title, date, time, periodId, note, now)` · `stUpdateEvent(...)` · `stDeleteEvent(env, id)`
**기간** — `periodCards(env)`(+달성률 뷰) · `getPeriod(env, id)` · `stInsertPeriod(env, p)` · `stUpdatePeriod(env, p)`
**K. 일기 목록** — `diaryList(env, before, limit)`
**엔티티 단건** — `taskStats(env, id)` · `taskEntries(env, id)`(+`day_status`) · `taskEntryAt(env, id, date)` · `waitExtensions(env, id)`
**삭제 가드/실행** — `closedEntryDates(env, taskId)`(막는 날짜 이름) · `guardEventCount(env, taskId)` · `stDeleteExtensions` · `stDeleteEntries` · `stDeleteTask(env, id)` · `stDeletePeriod(env, id)`
**Me** — `meAll(env)` · `meGet(env, field)` · `stMeHistory(env, field, oldV, newV, source, now, reason?)` · `stMeUpsert(env, field, value, now)` · `meHistory(env, limit)`
**collected_items(0018)** — `collectedByUid(env, uid)`(UNIQUE가 diff 기준이자 멱등 키) · `collectedGet(env, id)` · `collectedList(env, limit)` · `collectedPending(env, from, to)`(`state='new'` + 창 안 + `starts_at NOT NULL`) · `stInsertCollected` · `stTouchCollected`(**`state`는 안 건드린다**) · `stAcceptCollected`(`AND state <> 'accepted'`로 멱등) · `stDismissCollected` · `collectedCountsByState(env)`(T-43 · **없는 state는 행이 안 나온다** — 0은 세는 쪽이 채운다)
**settings** — `settingsAll(env)` · `stSettingPut(env, key, value)` · 수집 상태 키는 `uclass_last_collect_at`·`uclass_last_error`·`uclass_last_seen_count`(**이름의 주인은 `services/uclass.ts`의 export 상수** — 읽는 쪽이 문자열을 다시 적으면 그 순간 두 벌이다)
**analyses/summary** — `analysesList(env)` · `analysisGet(env, id)` · `weeklySummaryGet(env, key)` · `weeklySummaryFull(env, key)` · `mechDaily(env, key)`
**컨텍스트 범위 조회** — `dailyRange` · `logsRange` · `feelingsRange` · `memosRange` (각 `(env, start, end)`) · `analysesRecentFull(env, n)` · `stInsertAnalysis(env, id, prompt, pass1, pass2, meta, now)`
**Life Model(0012)** — `lmItems(env, section)` · `lmItemGet` · `lmSections`(섹션별 개수) · `stInsertLmItem` · `stUpdateLmItem`(version은 트리거) · `stDeleteLmItem` · `lmSchemaActive(env, section)` · `lmSchemasAll`
**analysis 앵커(0012)** — `stInsertAnalysis(..., anchorType, anchorId, modelTier, sourceVersions)` · `analysesByAnchor(env, type, id)`
**보호 규칙(0010)** — `stSetProtect(env, id, from, level, sleepMin, prepMin)`(본문 수정과 분리) · `protectedEvents(env, fromDate, days)`(앞으로의 보호 일정 — 예약 재료)
**guard(0010)** — `guardEventsList(env, limit)` · `guardEventGet(env, id)` · `stInsertGuardEvent(env, e)` · `stReactGuardEvent(env, id, reaction, reason, at)`(`AND reaction IS NULL`) · `stClassifyOverride` · `stSetGuardOutcome`(`AND outcome IS NULL`) · `guardEventsUnreacted(env, before)` · `guardEventsPendingOutcome(env)` · `guardAiCallsOn(env, onDate)`(ADR-024 일일 상한) · `guardAiVerdictFor(env, onDate, eventId)`(ADR-024 캐시 — `'unavailable'`은 제외, `fired_at DESC, id DESC`)
**guard_modes** — `guardModes(env)` · `guardActiveMode(env)` · `stClearActiveMode` · `stSetActiveMode` (부분 유니크 인덱스 때문에 **해제 → 설정** 순서)
**watch_apps** — `watchApps(env, source?)` · `stAddWatchApp` · `stRemoveWatchApp`
**guard(구)** — `guardEventsList(env)`

**뷰(스키마)**: `v_task_stats`(**state**=상태의 유일한 진실 `not_finished`/`finished`/`cancelled` · cancelled_at·cancelled_on·cancel_reason·cancelled_by(0009, append-only) · entry_count·defer_count·latest_date·current_rate·is_waiting) · `v_period_achievement`(달성률=current_rate 평균, **취소 제외**). 상태 판정은 언제나 `state`(status는 원시 컬럼).

---

## 부록. lib/ (유틸)

- **`lib/time.ts`** — `loadTime(env, utcMs?)` → `TimeCtx` · `attributionDate` · `attributionOfIso` · `isoNow` · `normalizeIso` · `addDays` · `diffDays` · `mondayOf` · `isDate`. 귀속일(경계 05:00)·주(월요일)의 단일 구현.
  (`utcMs`는 기본값 `Date.now()`인 검사용 이음매다 — 순수 함수 검사가 시각을 고정한다)
  - **`loadTime`을 부르는 곳은 진입 계층 둘뿐이다**(T-23): `index.ts`의 `/api/*` 미들웨어와 `scheduled()`.
    서비스는 `t`를 **인자로 받는다** — smoke `[11]`이 그 0건을 양성 대조와 함께 지킨다
- **`lib/id.ts`** — `nextId(env, table, compact)` → `'YYYYMMDD-NNN'`. 테이블 화이트리스트.
- **`lib/ai.ts`** — `PROVIDERS` · `aiConfig(env)` · `callModel(env, call)`(=`callClaude`) · `testConnection(env, which)` · `splitModel` · `parseModelJson`. 제공자별 요청 형식 흡수.
