# CLAUDE.md — Personal OS Worker

학생 사용자의 개인 판단-보조 에이전트 PWA. **폰에 설치해 실사용 중이므로 회귀에 민감하다.**
Cloudflare Worker (Hono / TS) + D1 + `[assets]` 정적 서빙.

## 문서 위계

`personal-agent-design_v0.9.md`(철학·구조 — 최상위 권위) > `README0722.md`(구현 현황·함정) > 코드.
**설계와 어긋나는 구현은 고치기 전에 지적한다.** (문서 v1.0 갱신은 사용자 지시로 연기 중.)
사용자용 안내는 `사용설명서0722.md`. 리팩토링 검토 기록은 `REFACTOR-PLAN.md`.
파일 지도(어느 파일을 고칠지)는 `docs/api-surface.md`, 스키마 스냅샷은 `docs/schema-current.sql`.

## 기준선 보고 규칙

**현재 기준선: typecheck 통과 · smoke 129 · front 151 · 실패 0.**
작업 후에는 반드시 이 숫자로 보고한다 — **"통과했다"가 아니라 "smoke 124 → 127"** 형식.
검사가 옛 동작을 검사하고 있으면 **검사를 고치고 그 사실을 말한다**. 숫자가 안 맞으면 원인을 찾기 전엔 끝내지 않는다.

| 명령 | 하는 일 |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | HTTP 계층 서버 검사 (node:sqlite 셰임) |
| `npm run front` | 격리 러너 `e2e.mjs`(임시 D1 + jsdom). 실 DB 불변 |
| `npm run verify` | 위 셋을 한 번에 |

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
- id = `YYYYMMDD-NNN`(불변) / title 자유 변경. 하루 경계 05:00, 귀속일은 기록 시점에 확정(경계 바꿔도 과거 불변).

## 함정 — 실제로 물렸던 것들 (README0722.md 요약)

1. **`scrollIntoView` 금지** — `.phone`이 overflow:hidden이라 셸이 밀린다. 위치는 `scrollTop`만.
2. **트랙 위치는 % `transform`** — 손가락분만 px(`clientWidth||380` 폴백). jsdom은 clientWidth=0.
3. **jsdom 제스처는 좌표를 `MouseEvent` 생성자로** — 나중에 붙이면 `dx=NaN`→'세로' 오판→검사 거짓 통과.
4. **`boot()` 중복 실행 가드(`booted`)** — DOMContentLoaded 두 번이면 스와이프 한 번에 탭 두 칸. 지우지 말 것.
5. **색은 CSS 변수만** — 다크 대응은 항상 짝(`[data-theme="dark"]` + `@media prefers-color-scheme:dark`).
6. **마감된 날은 트리거가 동결** — logs·feelings·schedule_entries·daily 수정/삭제 불가(일정은 추가만). 프론트는 `day_status`로 판단, 추측하면 409.
7. **`wait_extensions` FK + `0005`** — 삭제는 '마감 기록 있을 때만' 차단. task 삭제 순서 = 연장이력→항목→task.
8. **`e2e.mjs`는 격리 임시 D1** — 실 `.wrangler/state` 불변. 끝의 `spawnSync ETIMEDOUT`은 무해. front는 간헐 플레이크 가능(재실행 확인).
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
