# Personal OS · Worker (구현 1 — AI 없는 뼈대)

진실의 원천: `personal-agent-design_v0.8.md` · 스키마: `migrations/0001_init.sql`

## 구조

```
src/
├─ index.ts        라우터(Hono) — 얇게. 인증(선택)·트리거 에러 → 409/400 번역
├─ services/       도메인 규칙·트랜잭션 순서가 사는 곳
│   daily.ts       Today 조립 · Log·Feelings·Score · 마감(G: 물화 → close) · 캘린더·팝업
│   tasks.ts       생성 · 미루기/재배정 · 일정 확정 · 대기 연장 · 완료 · 다이얼 · Works
│   periods.ts     기간 CRUD + 달성률·경과일 파생
│   memos.ts       memo 추가 + summary stale 연쇄
│   me.ts          Me 필드(+이력) · '지금' 파생 · settings
│   analysis.ts    조회 + 5.2 컨텍스트 미리보기 (생성은 구현 2)
│   guard.ts       구현 3 자리 (이벤트 조회만)
├─ db/index.ts     queries.sql 1:1 — SQL은 이 파일에만
├─ lib/time.ts     귀속일(경계 05:00) · ISO · 주(월요일) — 시간 규칙의 단일 구현
├─ lib/id.ts       'YYYYMMDD-NNN' 생성
└─ scheduled.ts    Cron — 자동 마감(H). 구현 3에서 Guard 평가가 얹힘
```

원칙: 파생(Todo/Done/Missed·이월·대기 일수·달성률)은 전부 조회 시 계산.
저장되는 파생은 마감 시 `summaries.mech`(cache 계층)뿐. 불변성은 DB 트리거가
최종 강제하고 Worker는 그 거부를 사람이 읽는 에러로 번역만 한다.

## 실행

```bash
npm install
# wrangler.toml에 본인 database_id 기입 (이미 migration 적용된 그 DB)
npx wrangler dev          # http://localhost:8787
npx wrangler deploy
# 인증을 켜려면: npx wrangler secret put API_TOKEN
```

로컬 검증(선택):

```bash
npm run typecheck   # 타입
npm run smoke       # 백엔드 90항목 — node:sqlite 셰임 위, 서버 불필요
npm run front       # 프론트 E2E 71항목 — 아래 참고
npm run verify      # 위 셋을 한 번에
```

`npm run front` 는 **격리 러너**(`test/e2e.mjs`)다. OS 임시폴더에 일회용 D1 을 만들어
마이그레이션·픽스처를 넣고, 그 DB 로 워커를 띄워 검사한 뒤, 끝나면 워커를 끄고 임시폴더를
통째로 지운다. 즉 **실제 로컬 dev DB(`.wrangler/state`)에는 테스트 데이터가 절대 섞이지 않는다.**
픽스처 정의는 `test/seed.mjs`.

> 외부에 이미 띄운 서버(반드시 버릴/격리 DB)에 직접 붙여 디버깅하려면
> `npm run front:manual <base>` — 이 경우 기간·Me direction 등은 미리 시드돼 있어야 하고,
> 대상 DB에 픽스처를 쓰므로 실제 dev 서버에는 쓰지 말 것.

## API

| 메서드·경로 | 역할 |
|---|---|
| GET `/api/today` | Today 한 화면 조립 (todo·done·재배정·대기·overdue·기간 칩·log·feelings) |
| POST `/api/logs` · PATCH `/api/logs/:id` | Log 추가·수정 (마감 후 409) |
| PUT `/api/daily/feelings` · `/feelings-text` · `/score` | 눈금·서술·Score |
| POST `/api/daily/close` `{kind: manual\|brief}` | 마감 — mech 물화 → close |
| GET `/api/calendar?start&end` | 월 그리드 (기간 밴드·셀 글줄·일기 마커) |
| GET `/api/days/:date` | 날짜 팝업 조립 (과거는 F 분류: done/deferred/missed) |
| GET `/api/diary` | 일기 몰아 읽기 목록 |
| POST `/api/memos` | memo 추가 (+daily summary stale) |
| GET `/api/works/:seg` | scheduled · waiting · deferring · periods · done |
| POST `/api/tasks` | 생성 — `date` 없으면 대기 |
| GET · PATCH `/api/tasks/:id` | 상세(entries·연장 이력·wait_age) · title/period 변경 |
| POST `/api/tasks/:id/defer` `{from,to}` | 미루기. from이 마감된 날이면 재배정(insert-only, `reassigned:true`) |
| POST `/api/tasks/:id/schedule` `{date}` | 대기 → 일정 확정 |
| POST `/api/tasks/:id/extend` | 대기 연장 — 앵커=now, 이력은 트리거 자동 |
| POST `/api/tasks/:id/complete` | 완료 (오늘 항목 rate 100 + 귀속) |
| PUT `/api/tasks/:id/rate` `{date,rate}` | 완료율 다이얼 |
| GET·POST `/api/periods` · GET·PATCH·DELETE `/api/periods/:id` | 기간 |
| GET `/api/me` · PUT `/api/me/:field` · GET `/api/me/history` | Me (+'지금' 파생) |
| GET `/api/settings` · PUT `/api/settings/:key` | day_boundary · utc_offset · feelings_fields |
| GET `/api/analyses` · `/:id` · `/context-preview` | 분석 조회 · 5.2 윈도우 미리보기 |
| GET `/api/guard/events` | Guard 이벤트 (구현 3 전까지 빈 목록) |
| GET `/api/health` · POST `/api/admin/auto-close` | 상태 · Cron 수동 트리거(개발용) |

날짜 선택(미루기·일정 확정)은 오늘부터 2주 이내로 서버가 강제한다 (7장).
