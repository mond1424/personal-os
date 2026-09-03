# Personal OS · Worker

학생 사용자의 **개인 판단-보조 에이전트 PWA**. 폰에 설치해 **실사용 중**이므로 회귀에 민감하다.

- **목적은 기록이 아니라 판단 보조** — 장기 목표와 지금 행동이 어긋나는 순간을 알아차리게 하는 것.
- Cloudflare **Worker (Hono / TypeScript) + D1 + `[assets]` 정적 서빙**. 상시 서버 불필요.
- 진실의 원천(설계 권위): `personal-agent-design_v0.9.md` · 스키마: `migrations/`
- **사용자용 안내는 [`사용설명서0722.md`](./사용설명서0722.md).**

## 문서 위계

`personal-agent-design_v0.9.md`(철학·구조 — 최상위 권위) > 이 README·구현 문서 > 코드.
설계와 어긋나는 구현은 고치기 전에 지적한다. (문서 v1.0 갱신은 사용자 지시로 연기 중.)
리팩토링 검토 기록은 `REFACTOR-PLAN.md`.

## 구조

```
src/
├─ index.ts        라우터(Hono) — 얇게. 인증(선택)·트리거 에러 → 409/400 번역만
├─ services/       도메인 규칙·트랜잭션 순서가 사는 곳
│   daily.ts       Today 조립 · Log·Feelings·Score · 마감(기록→물화→close) · 캘린더·팝업
│   tasks.ts       생성 · 미루기/재배정 · 일정 확정 · 대기 연장 · 완료 · 완료율 · Works
│   periods.ts     기간 CRUD + 달성률·경과일 파생
│   events.ts      일정(event) — 캘린더 전용 사건(완료 개념 없음, task와 분리)
│   memos.ts       memo 추가(어느 날짜에든 · daily 없으면 자동 ensure) + summary stale 연쇄
│   me.ts          Me 필드(+이력) · '지금' 파생 · settings 검증
│   analysis.ts    조회 + 5.2 컨텍스트 조립 + 5.3 2-pass 생성 (구현 2)
│   guard.ts       구현 3 자리 (이벤트 조회만)
├─ db/index.ts     쿼리 전부 — SQL은 이 파일에만 산다
├─ lib/time.ts     귀속일(경계 05:00) · ISO · 주(월요일) — 시간 규칙의 단일 구현
├─ lib/id.ts       'YYYYMMDD-NNN' 생성
├─ lib/ai.ts       AI 중계(제공자별 요청 형식 흡수) — 얇은 서버
└─ scheduled.ts    Cron — 자동 마감. 구현 3에서 Guard 평가가 얹힌다
public/            index.html · style.css · api.js · app.js · manifest.json · icon.svg
migrations/        0001_init · 0002_models · 0003_ai_provider · 0004_events · 0005_delete_scope · 0006_fix_model_high
test/              smoke.ts · e2e.mjs · front.mjs · seed.mjs · d1shim.ts
```

**핵심 원칙**: 파생(Todo/Done/Missed·이월 횟수·대기 일수·달성률·'지금')은 전부 **조회 시 계산, 저장하지 않는다**. 물화되는 파생은 마감 시 `summaries.mech`(cache 계층)뿐. **불변성은 API가 아니라 DB 트리거가 최종 강제**하고, Worker는 그 거부를 사람이 읽는 409/400으로 번역만 한다. 화면은 전부 원본의 조인 뷰다.

## 셋업 & 실행

```powershell
npm install
# wrangler.toml의 database_id는 본인 D1(이미 마이그레이션 적용된 그것) — 건드리지 말 것
npx wrangler dev            # http://localhost:8787
```

`[assets] directory = "public"` 라서 프론트도 같은 워커가 서빙한다. **`public/` 하위엔 실제 자산만 둔다** — 소스·마이그레이션을 넣으면 그대로 외부에 노출된다.

## 명령 & 기준선

| 명령 | 하는 일 |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | HTTP 계층까지 통째로 태우는 서버 검사 (node:sqlite 셰임, 서버 불필요) |
| `npm run front` | **격리 러너 `e2e.mjs`** — 임시 D1로 dev 서버를 띄우고 jsdom으로 렌더 검증. 실 DB 불변 |
| `npm run front:manual <base>` | 외부(반드시 버릴/격리) 서버에 직접 붙는 옛 방식 |
| `npm run verify` | 위 셋을 한 번에 |
| `npm run dev` · `deploy` | wrangler dev · deploy |

**현재 기준선: typecheck 통과 · smoke 124 · front 145 · 실패 0.**
작업 후엔 이 숫자로 보고한다 — "통과했다"가 아니라 "smoke 124 → 127". 검사가 옛 동작을 검사하고 있으면 **검사를 고치고 그 사실을 말한다**.
※ 새 마이그레이션을 추가하면 `test/smoke.ts`의 스키마 목록에도 파일명을 넣어야 한다(하드코딩). `e2e.mjs`는 디렉터리 전체를 적용하므로 자동이다.

## 배포 & 마이그레이션

**마이그레이션은 배포보다 먼저**, `--local` → `--remote` 순서:

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

- `wrangler deploy`와 시크릿(`wrangler secret put API_TOKEN` 등)은 **사용자가 직접** 한다.
- `wrangler.toml`의 `database_id`는 건드리지 않는다.
- 인증: `API_TOKEN` 시크릿이 있으면 모든 `/api` 요청에 `Authorization: Bearer <토큰>` 필요. 없으면 열림(로컬 개발용).

## API

| 메서드·경로 | 역할 |
|---|---|
| GET `/api/today` | Today 한 화면 조립 (todo·done·재배정·대기·overdue·기간 칩·events·log·feelings) |
| POST `/api/logs` · PATCH `/api/logs/:id` | Log 추가·수정 (마감 후 409) |
| PUT `/api/daily/feelings` · `/feelings-text` · `/score` | 눈금·서술·Score |
| POST `/api/daily/classify-feelings` | manual 서술 → 필드 점수 분류 (소형 모델) |
| POST `/api/daily/close` `{kind: manual\|brief}` | 마감 — mech 물화 → close |
| GET `/api/calendar?start&end` | 월 그리드 (기간 밴드·셀 글줄·일기 마커·일정) |
| GET `/api/days/:date` | 날짜 팝업 조립 (과거는 done/deferred/missed 분류) |
| GET `/api/diary?limit` | 일기 몰아 읽기 목록 |
| POST `/api/memos` | memo 추가 — 어느 날짜에든(과거·오늘·미래), daily 없으면 자동 ensure (+daily summary stale) |
| GET `/api/works/:seg` | scheduled · waiting · deferring · periods · done |
| POST `/api/tasks` | 생성 — `date` 없으면 대기 |
| GET · PATCH · DELETE `/api/tasks/:id` | 상세 · title/period 변경 · 취소(마감 기록 있으면 409, 사유를 날짜로) |
| POST `/api/tasks/:id/defer` `{from,to,rate?}` | 미루기(+완료율 확정). from이 마감된 날이면 재배정(insert-only) |
| POST `/api/tasks/:id/schedule` `{date}` | 대기 → 일정 확정 |
| POST `/api/tasks/:id/extend` | 대기 연장 — 앵커=now, 이력은 트리거 자동 |
| POST `/api/tasks/:id/complete` | 완료 (살아 있는 항목 rate 100 + 귀속) |
| PUT `/api/tasks/:id/rate` `{date,rate}` | 완료율 |
| GET·POST `/api/periods` · GET·PATCH·DELETE `/api/periods/:id` | 기간 |
| POST `/api/events` · PATCH·DELETE `/api/events/:id` | 일정(캘린더 전용) — 마감된 날은 수정·삭제 409(추가는 가능) |
| GET `/api/me` · PUT `/api/me/:field` · GET `/api/me/history` | Me (+'지금' 파생) |
| GET `/api/settings` · PUT `/api/settings/:key` | day_boundary·utc_offset·feelings_fields·model_low/high·ai_* |
| GET `/api/ai/providers` · `/connections` · POST `/api/ai/test` | 제공자·연결 상태(키 마스킹)·연결 테스트 |
| GET `/api/analyses` · `/:id` · `/context-preview` · `/context-raw` · POST `/api/analyses` | 분석 조회·5.2 미리보기·2-pass 생성 |
| GET `/api/guard/events` | Guard 이벤트 (구현 3 전까지 빈 목록) |
| GET `/api/health` · POST `/api/admin/auto-close` | 상태 · Cron 수동 트리거(개발용) |

날짜 선택 중 **미루기**는 오늘부터 2주 이내로 서버가 강제한다. **신규 일정**(대기 확정·생성)은 상한 없이 앞날 아무 날짜나 가능하다.

## 함정 — 실제로 물렸던 것들

1. **`scrollIntoView` 금지.** `.phone`이 `overflow:hidden`이라 셸이 통째로 밀린다. 위치 제어는 `scrollTop`만.
2. **트랙 위치는 % 기반 `transform`.** px로 하면 폭을 재야 하는데 jsdom은 `clientWidth`가 0이라 검사가 무력해진다. 손가락 추적분만 px로 섞는다(`clientWidth||380` 폴백).
3. **jsdom 제스처 검사는 좌표를 `MouseEvent` 생성자로 실어야 한다.** 나중에 `clientX`를 붙이면 `undefined`로 남아 `dx`가 `NaN`이 되고, 어떤 제스처든 '세로'로 판정돼 **검사가 거짓 통과**한다.
4. **`boot()`에 중복 실행 가드(`booted`)가 있다.** `DOMContentLoaded`가 두 번 오는 환경에서 바인딩이 두 겹 걸려 스와이프 한 번에 탭이 두 칸 넘어간다. 지우지 말 것.
5. **색은 CSS 변수만.** 다크 대응이 항상 짝으로 필요하다 (`:root[data-theme="dark"]` + `@media (prefers-color-scheme:dark)` 둘 다).
6. **마감된 날은 트리거가 동결한다.** `daily.status='closed'`면 그 날의 logs·feelings·schedule_entries·daily는 수정·삭제 불가이고, **추가까지 막힌다** — `logs`·`feelings`·`schedule_entries` 셋 다 `*_frozen_ins`를 가진다. 마감된 날에도 **추가되는 것은 `events`(캘린더 일정)와 memo 둘뿐**이고, 그 둘엔 `_ins` 트리거가 아예 없다. 여기 '일정'은 `events`이지 `schedule_entries`(task의 예정)가 아니다 — **T-47이 이 한 글자에 물렸다**(검사 픽스처가 마감된 날에 예정을 넣으려다 죽었다). 프론트는 서버가 주는 `day_status`로 미리 판단하고, 추측하면 409로 드러난다.
7. **`wait_extensions`는 `tasks(id)`를 FK로 참조한다.** `0005`가 삭제 잠금을 '마감 기록이 있을 때'로 좁혔다. task 삭제는 **연장 이력 → 항목 → task 순서**로 지운다.
8. **`e2e.mjs`는 임시 D1로 격리 실행**한다. 실 `.wrangler/state`를 안 건드린다. **`spawnSync ETIMEDOUT`이 뜨면 진짜 hang이다 — 무시하지 않는다.** 전엔 "무해한 정리 단계 경고"라고 적혀 있었는데, 실제로는 `front.mjs`가 성공 경로에서 종료하지 않아(rAF 타이머가 남는다) 안전망 SIGKILL이 **유일한 종료 수단**이던 결함이었다. 193건이 전부 통과해도 `npm run front`가 `exit 1`이었고, 종료 코드를 믿는 셸·에이전트에는 매번 실패로 보였다. T-06이 `process.exit(0)`으로 없앴다. 이제 러너의 모든 대기(마이그레이션·헬스·시드·front)에 상한이 있어 **실패는 어디서 막혔는지 이름을 말한다.** (front는 실서버+jsdom이라 간헐 플레이크가 있을 수 있다 — 재실행으로 확인.)
9. **압축 해제·작업은 `worker\` 바로 아래.** 한 겹 더 들어가면 마이그레이션이 `No migrations to apply`로 조용히 넘어간다.
10. **마이그레이션은 배포보다 먼저** (`--local` 후 `--remote`).
11. **`weeksOf`는 항상 6주를 돌려준다.** 캐러셀 높이 고정의 전제라 4·5주로 되돌리면 전환이 깨진다.
12. **검사 fixture에 고정 날짜를 쓰지 않는다.** *언젠가 반드시 현재가 된다.* 두 번 물렸다 — T-12가 `front.mjs`에서, 그리고 8/14에 `smoke.ts`의 `2026-08-15`가 보호 구간 안으로 들어와 **한 번에 11건이 빨간불**이 됐다(회귀가 아니라 달력이 따라잡은 것). 날짜는 `guard/schedule`의 `d`나 `t.d`에서 **상대로** 잡는다. **피해야 할 시계는 "오늘"만이 아니다** — T-36이 `D+3`으로 고치자 11건은 돌아왔는데 **T-23이 주입하는 시계**(`D+2 09:01`)를 새 보호 구간이 삼켰다. 그 파일이 만드는 **모든 시각**을 피해야 한다.
13. **`npm run verify`는 Android를 안 본다 — 주석이 빌드를 깬다.** 두 번 물렸다: T-46은 XML 주석의 하이픈 둘(`--paper`)이 `mergeReleaseResources`에 거부됐고, T-48은 **Kotlin 주석에 적은 `/api/widget` + 별표의 `/`+`*`가 새 주석을 열어** 파일 둘이 끝까지 안 닫혔다. **둘 다 `verify`가 초록인 채로 `assembleRelease`만이 잡았다.** APK가 붙은 티켓에서 "verify 통과 = 안 깨졌다"로 읽지 않는다.
14. **검사는 "끝났다"를 관측이 아니라 계약으로 알아야 한다.** 세 번 물렸다: T-42는 고정 `sleep`(추측), T-53은 토스트, T-54는 `until(DOM 변화)`. **공통 뿌리는 "관측으로 끝을 알려 한 것"이다.** ⚠️ **`until`은 T-43이 고정 `sleep`을 없애려고 넣은 것이다**(`until(조건, 3초)`) — 상한은 생겼지만 *"끝났다"*를 여전히 **관측으로** 안다. 그래서 고쳐 놓은 것이 세 번째로 물렸다. `until`은 `refreshToday()` **도중에** 바뀌는 문구를 보고 먼저 빠져나온다 — 그러면 **그 핸들러는 아직 날고 있고**, 잔여 호출이 **다음 검사의 스파이에 섞인다.** 실제로 `until(calls.length >= 2)`가 **남의 한 벌을 자기 것으로 세고 초록**이었다(T-54 변이 배터리가 드러냈다: `invalidate|render|invalidate|render`). ⚠️ **대기를 늘리는 것은 경합을 없애는 게 아니라 미루는 것이다** — 4초에서 20초로 늘렸는데 다시 죽었다. **핸들러가 프라미스를 주면 `await`한다**: `el.click()` 대신 `await el.onclick()`이면 `run(...)`의 프라미스가 그대로 와서 시계가 사라진다.
15. **검사와 구현이 같은 이름을 공유하면 그 이름의 오류를 못 센다.** T-55에서 물렸다 — `index.html`에 `id="cal-list"`가 **둘**이었다(138행 캘린더 화면의 '몰아 읽기' 뷰 · `display:none` / 306행 T-53이 시트에 놓은 칸). `querySelector`가 문서 순서로 앞의 것을 주므로 **캘린더 목록 12개가 숨은 칸에 쓰였다.** ⚠️ **검사는 초록이었다** — 검사도 구현과 똑같이 `#cal-list`를 썼기 때문이다. 숨은 칸을 읽고 숨은 칸이 채워졌으니 통과다. **UI를 거친 검사(T-54 `2`)였는데도 못 잡았다.** ★ 그래서 **중복 `id`를 문서 전수로 세는 검사**를 뒀다(id 229개 중 중복은 그 하나뿐이었다). ⚠️ **두 번째 피해가 더 조용했다** — 그 `innerHTML =`이 숨은 칸을 덮어써 `#diary-list`를 **통째로 지웠고**, 폰에서 실제로 사라진 채 아무도 신고하지 않았다. **선택자·키·상수를 검사가 구현에서 복사해 오면, 그 값이 틀렸을 때 양쪽이 함께 틀린다.**

> ⚠️ **번호는 `CLAUDE.md` §함정과 같은 것을 가리켜야 한다.** 12가 여기 빠져 있어 13을 넣으면서 함께 채웠다 — 티켓이 *"함정 N번"*이라 쓰면 두 층이 서로 다른 것을 읽는다(`STATE.md` §규약 불일치 1이 기록한 실패다).

## 데이터 모델 요점

- 테이블 15 · 뷰 2(`v_task_stats`·`v_period_achievement`) · 트리거 21. 상세는 `migrations/0001_init.sql` 헤더.
- id = `YYYYMMDD-NNN`(불변, 생성일+당일 순번) / title은 자유 변경 — 참조는 항상 id.
- 하루 경계 = 05:00(설정 가변). 경계 이전 새벽 기록은 전날 귀속. **귀속일은 기록 시점에 계산·저장**하므로 경계를 바꿔도 과거는 재해석되지 않는다.
- 미루기 = schedule 배열에 항목 추가(복사 없음, identity 보존). 새 예정은 **0%에서 시작**. 이월 횟수 = 항목 수 − 1(파생).
