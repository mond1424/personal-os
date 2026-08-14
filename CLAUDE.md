# CLAUDE.md — Personal OS Worker

학생 사용자의 개인 판단-보조 에이전트 PWA. **폰에 설치해 실사용 중이므로 회귀에 민감하다.**
Cloudflare Worker (Hono / TS) + D1 + `[assets]` 정적 서빙.

## 문서 위계

`personal-agent-design_v0.9.md`(철학·구조 — 최상위 권위) > `README0722.md`(구현 현황·함정) > 코드.
**설계와 어긋나는 구현은 고치기 전에 지적한다.**
- 파일명은 `_v0.9`지만 **§6.4와 §8은 v1.0으로 개정됐다**(2026-07-29, 네이티브 전환). 나머지 v1.0 백로그는 연기 중.
- **8월 Guard v1은 `APP-PLAN.md`(무엇을·어떤 순서로) · `APP-ADR.md`(왜·기각한 대안) · `APP-BUILD.md`(진행 상태) · `GUARD-DEV-LOOP.md`(빌드·권한 절차)** 를 따른다. ADR은 설계문서를 대체하지 않고 그 아래에 놓인다.
사용자용 안내는 `사용설명서0722.md`. 리팩토링 검토 기록은 `REFACTOR-PLAN.md`.
파일 지도(어느 파일을 고칠지)는 `docs/api-surface.md`, 스키마 스냅샷은 `docs/schema-current.sql`.
작업 시작 시 STATE.md를 먼저 읽는다. 마이그레이션 적용 여부·배포 상태·미해결 항목은 반드시 STATE.md 기준으로 판단하고, 기억이나 과거 문서 사본으로 단정하지 않는다.

## 에이전트 체인

**사용자 → Cowork → Claude Code → Codex CLI.** 경계·소유권·보고 형식은 `AGENT-CHAIN.md`.
Codex의 진입 파일은 `AGENTS.md`(이 문서를 원본으로 가리킨다 — 규약을 복사하면 반드시 갈라진다).

이 층(Claude Code)이 지는 것: **`STATE.md`·`APP-BUILD.md`·`docs/*`·git의 유일한 편집자**,
`npm run verify`로 숫자를 만드는 유일한 층, 위임 금지 영역(트리거·마이그레이션·귀속일·Guard 발동 경로) 직접 구현.
설계 문서·`APP-PLAN`·`APP-ADR`은 **읽기만** 한다 — 고칠 것이 있으면 Cowork에 올린다.

**미커밋 코드가 남은 채 다음 티켓을 착수하지 않는다.**
두 번 물렸다 — T-08(넷이 섞임)·T-16(둘이 섞임). 락은 *동시* 작업을 막지만 *순차 누적*은 안 막는다.
섞이면 커밋을 hunk로 갈라야 하고, 그때 불합격분이 딸려 들어갈 위험이 생긴다.

**문서는 여기서 말하는 코드가 아니다.** 티켓·계획·규약은 작업 중에 갱신되는 것이 정상이고
(§보고·§검토를 채운다), 코드 파일과 겹치지 않아 hunk를 가를 일이 없다.
다만 **티켓이 닫힐 때 함께 커밋한다** — 쌓이면 어느 티켓의 결정이었는지 흐려진다.

**실측 확인은 검토를 대체하지 않는다.** 실측은 "증상이 사라졌는가", 검토는
"전수였는가 · 검사가 하드코딩과 구별되는가"다. 앞이 통과해도 뒤는 남는다.

## 작업 방식
 - 전체 프로젝트 재탐색 금지. 수정 범위와 직접 관련된 함수만 먼저 읽고, 호출부·의존 함수는 필요성이 확인될 때만 넓힌다.
 - 여러 이슈를 동시에 조사하지 않는다. 현재 이슈 하나에만 집중한다.
 - **확신이 부족하면 추측으로 범위를 넓히지 말고 사용자에게 질문한다.** 브라우저에서 직접 확인해야 하는 사항(렌더 결과·실제 폭·터치 동작)은 자동화 수단이 없으면 확인 절차를 제시하고 결과를 받는다.

## 기준선 보고 규칙

**현재 기준선은 `STATE.md` §기준선에 있다. 여기에 숫자를 적지 않는다** —
두 곳에 두면 갈라진다(실제로 두 번 낡았다). 숫자를 만드는 층이 `STATE.md`의 주인이므로
갱신이 한 걸음에 끝난다. 파생을 두 벌 두지 않는 것과 같은 이유다.

작업 후에는 반드시 그 숫자로 보고한다 — **"통과했다"가 아니라 "smoke 124 → 127"** 형식.
검사가 옛 동작을 검사하고 있으면 **검사를 고치고 그 사실을 말한다**. 숫자가 안 맞으면 원인을 찾기 전엔 끝내지 않는다.

| 명령 | 하는 일 |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | HTTP 계층 서버 검사 (node:sqlite 셰임) |
| `npm run front` | 격리 러너 `e2e.mjs`(임시 D1 + jsdom). 실 DB 불변 |
| `npm run verify` | 위 셋을 한 번에 |

## 사람이 하는 것의 상태는 적지 않는다

**배포 여부 · `--remote` 적용 여부 · APK 설치 여부**는 사용자가 하고 이 층은 모른다.
문서에 적으면 **하는 층과 적는 층이 달라 반드시 낡는다** — 배포 상태만 네 번 정정했다.

**상태 대신 확인하는 법을 적는다:**

```powershell
npx wrangler deployments list           # 무엇이 언제 라이브가 됐나
npx wrangler d1 migrations apply personal-os --remote --dry-run   # 남은 마이그레이션
adb shell dumpsys package dev.mond1424.personalos | findstr versionCode
```

기준선 숫자를 여기서 뺀 것과 같은 이유다. **한 곳에만 두거나, 아예 두지 않는다.**

## 마이그레이션 · 배포

- **마이그레이션은 배포보다 먼저**, `--local` → `--remote` 순서.
- **`wrangler deploy`와 `wrangler secret put`은 사용자가 직접** 한다. Claude가 배포하지 않는다.
- **`wrangler.toml`의 `database_id`는 건드리지 않는다.**
- **새 마이그레이션을 추가하면 `test/smoke.ts`의 스키마 목록(하드코딩)에도 파일명을 넣는다.** (`e2e.mjs`는 디렉터리 전체를 적용하므로 자동.)

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

## 아키텍처 원칙

- **파생값은 저장하지 않는다.** Todo/Done/Missed·이월 횟수·대기 일수·달성률·'지금'은 전부 조회 시 계산. 물화되는 파생은 마감 시 `summaries.mech`(cache)뿐.
- **불변성은 API가 아니라 DB 트리거가 최종 강제**하고, Worker는 그 거부를 `409/400`으로 번역만 한다(`translateDbError`).
- **`public/` 하위엔 실제 자산만 둔다.** `[assets] directory="public"`이라 소스·마이그레이션을 넣으면 그대로 외부에 노출된다.
- 화면은 전부 원본의 조인 뷰. SQL은 `db/index.ts`에만. 도메인 규칙·트랜잭션 순서는 `services/`.
- id = `YYYYMMDD-NNN`(불변) / title 자유 변경. 귀속일은 기록 시점에 확정(경계 바꿔도 과거 불변).
  **하루 경계는 설정값이다 — 여기에 시각을 적지 않는다.** 실제 값은 `GET /api/guard/schedule`의
  `boundary`가 준다(여기 `05:00`이라 적혀 있었는데 실제로는 `06:00`이었다 — 기준선과 같은 사고다).

## 함정 — 실제로 물렸던 것들 (README0722.md 요약)

1. **`scrollIntoView` 금지** — `.phone`이 overflow:hidden이라 셸이 밀린다. 위치는 `scrollTop`만.
2. **트랙 위치는 % `transform`** — 손가락분만 px(`clientWidth||380` 폴백). jsdom은 clientWidth=0.
3. **jsdom 제스처는 좌표를 `MouseEvent` 생성자로** — 나중에 붙이면 `dx=NaN`→'세로' 오판→검사 거짓 통과.
4. **`boot()` 중복 실행 가드(`booted`)** — DOMContentLoaded 두 번이면 스와이프 한 번에 탭 두 칸. 지우지 말 것.
5. **색은 CSS 변수만** — 다크 대응은 항상 짝(`[data-theme="dark"]` + `@media prefers-color-scheme:dark`).
6. **마감된 날은 트리거가 동결** — logs·feelings·schedule_entries·daily 수정/삭제 불가(일정은 추가만). 프론트는 `day_status`로 판단, 추측하면 409.
7. **`wait_extensions` FK + `0005`** — 삭제는 '마감 기록 있을 때만' 차단. task 삭제 순서 = 연장이력→항목→task.
8. **`e2e.mjs`는 격리 임시 D1** — 실 `.wrangler/state` 불변. **`spawnSync ETIMEDOUT`이 뜨면 진짜 hang이다** — `front.mjs`가 성공 경로에서 종료하지 않아 안전망 SIGKILL이 유일한 종료 수단이던 결함을 T-06이 없앴다(그전엔 193건 전부 통과해도 `exit 1`이었다). 러너의 모든 대기에 상한이 있으므로 **실패는 어디서 막혔는지 이름을 말한다.**
9. **압축 해제·작업은 `worker\` 바로 아래** — 한 겹 더 들어가면 `No migrations to apply`.
10. **마이그레이션은 배포보다 먼저** (`--local`→`--remote`).
11. **`weeksOf`는 항상 6주** — 캐러셀 높이 고정의 전제.

## ★ 세션 종료 규칙 (선택 아님)

**세션을 마칠 때(또는 사용자가 "정리하자"라고 할 때) 반드시:**
1. **`STATE.md` 갱신**
2. 구조가 바뀌었으면 **`docs/api-surface.md` 재생성**
3. 마이그레이션을 추가했으면 **`docs/schema-current.sql` 재덤프**(migrations 전체를 인메모리 sqlite에 적용→`sqlite_master` 덤프)
4. **commit & push**

push하지 않으면 Claude Chat 쪽이 보는 코드가 낡는다. **push는 선택이 아니다.**
