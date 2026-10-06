# T-89 — 감독층 인수: 새 도구에서 기준선을 다시 세운다

**발행** 설계층 · 2026-10-06 · **담당** 감독층 · **상태** ⬜ 대기
**근거** `AGENT-CHAIN.md` §1.1 · §1.2 · `OPERATIONS.md` §8 · `STATE.md` T-06(Codex 샌드박스)
**문서 · 주석만 · 동작 변경 없음 · 마이그레이션 없음 · 배포 없음**

---

## 목표

층의 도구 배정이 바뀌었다(`AGENT-CHAIN.md` §1.1). 새 감독층이 이 리포에서 처음 할 일은
**아무것도 고치지 않은 트리에서 `npm run verify`가 `STATE.md` §기준선과 같은 숫자를 내는지** 보는 것이다.
왜: 숫자를 만드는 층이 바뀌었다. 같은 숫자가 안 나오면 다음 티켓(T-88 ②)의 `→` 앞 숫자가 뜻을 잃는다.
Codex는 2026-07에 이 리포의 `npm run front`를 샌드박스 권한 때문에 기본 환경에서 못 돌렸다(T-06).

그다음 감독층 소유 문서와 코드 주석에 남은 옛 파일 이름(`CLAUDE.md`)을 고치고, `STATE.md`에 전환을 적는다.

## 범위 — 이 파일들만 고친다

```
STATE.md                    맨 위 §저장소에 전환 줄 · §raw 링크 · §기준선 재확인 한 줄
APP-BUILD.md                락 줄(27) · 락 형식 줄(64)
README0722.md               CLAUDE.md → CONVENTIONS.md (131) · §함정에 19 한 줄(CONVENTIONS 함정 19의 짝)
docs/api-surface.md         CLAUDE.md → CONVENTIONS.md (4 · 271)
src/services/collected.ts   주석 (177)
test/smoke.ts               주석 (1825 · 2274 · 3338)
test/runner-exit.mjs        주석 (6)
test/front.mjs              주석 (4588)
```

줄 번호는 발행 시점의 것이다. 파일을 열어 확인하고 고친다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 주석 밖의 코드 변경 | 이 티켓의 숫자는 "같다"여야 한다. 동작이 하나라도 바뀌면 환경 차이와 섞인다 |
| 닫힌 티켓 · `APP-ADR.md` · `STATE.md` 지난 항목 속 옛 이름 고치기 | 기록이다. `AGENT-CHAIN.md` §1.2 표로 읽는다 |
| 첫 verify가 다를 때 코드나 검사 고치기 | 다르면 환경이다. 고치지 말고 멈춰서 보고한다 |
| 리포 밖 설정 고치기(`~/.codex/config.toml` 등) | 적는 층과 지키는 층이 다르다. 바꿔야 할 것이 있으면 보고에 쓰고 사용자가 한다 |
| T-88 ② 착수 | 이 티켓이 닫힌 뒤다 — 미커밋 코드가 섞이지 않게 |

## 읽을 것

- `AGENTS.md` 전체 · `AGENT-CHAIN.md` §1 · §2 감독층 · §3
- `CONVENTIONS.md` §기준선 보고 규칙 · §세션 종료 규칙 · 함정 8 · 16 · 17 · 18
- `STATE.md` 맨 위 §저장소 · §기준선 · T-06(배제된 원인 목록)

## 할 일 — 순서대로

1. **시작 전 확인** — `AGENTS.md` §0의 명령. 출력을 그대로 보고에 붙인다. `통과`가 아니면 멈춘다
2. **락** — 지금 줄은 `WIP: T-88 과제 재촉 — ① 커밋 · 배포 대기 · 그 뒤 ② APK (claude-code, 10-02)`다.
   T-88은 ①이 커밋됐고 ②는 착수 전이라 미커밋 코드가 없다. 이 티켓 동안
   `WIP: T-89 감독층 인수 (감독층 · codex, MM-DD HH:MM) — 대기: T-88 ② APK`로 바꾸고,
   커밋 직전에 `WIP: T-88 과제 재촉 — ① 커밋 · 배포 대기 · 그 뒤 ② APK (감독층, 10-02)`로 되돌린다.
   64행의 형식 줄은 `AGENT-CHAIN.md` §3의 예(`(감독층 · codex, …)`)와 같게 고친다
3. **첫 verify — 아무것도 고치기 전에.** `npm run verify`.
   `typecheck 통과 · smoke 534 · front 526 · 실패 0 · exit 0`이어야 한다
   - EPERM(`.wrangler\tmp`)이나 헬스 대기 실패가 나면 그 출력을 붙이고, 샌드박스 밖 실행 승인을 받아 다시 돈다.
     **어느 환경에서 통과했는지**(기본 · `--add-dir` · 샌드박스 밖) 적는다
   - 숫자가 다르면 멈춘다(위 금지)
4. **`CLAUDE.md` → `CONVENTIONS.md`** — 범위의 주석 · 문서. 절 이름과 함정 번호는 그대로다.
   `README0722.md` §함정에 19(전역 클래스명 충돌)를 한 줄로 더한다 — `AGENT-CHAIN.md` §3의 *한 벌인데 주인이 다르다*.
   16~18도 요약에 없다. 이번에 채울지는 감독층이 정하고 보고에 적는다
5. **훑기** — `git grep -c "CLAUDE\.md"`로 남은 곳을 파일별로 센다. 남아도 되는 곳은 이 셋뿐이다.
   - 기록: `STATE.md` 지난 항목 · 발행된 티켓(이 티켓 · T-90 포함) · `docs/tickets/HANDOFF-0731.md` · `APP-ADR.md` ·
     `APP-PLAN.md` · `REFACTOR-PLAN.md` · `BRIEF-AGENCY-0810.md` · `APP-BUILD.md` 이력(95행)
   - 적용된 마이그레이션 주석(`0023` · `0024`)과 `docs/schema-current.sql` 머리 주석 — 덤프 쪽은 T-90이 고친다
   - 이름 대응: `AGENTS.md` §1 끝 줄 · `AGENT-CHAIN.md` §1.2 표
   이 밖에서 나오면, 범위의 파일이면 고치고 범위 밖이면 고치지 말고 보고한다.
   ⚠️ **0건이면 스캐너부터 의심한다** — `STATE.md` 지난 항목에 반드시 남아 있어야 한다(양성 대조 · 함정 17 · 18)
6. **둘째 verify** — 숫자가 3과 같아야 한다
7. **`STATE.md`**
   - 맨 위 §저장소에 전환 줄 하나: 날짜 · 배정은 `AGENT-CHAIN.md` §1.1(표를 옮기지 않는다) ·
     첫 verify가 통과한 환경 · T-88 락 상속
   - §raw 링크: 제목의 "Chat이"를 "채팅이"로, `CLAUDE.md` 줄을 `CONVENTIONS.md`로 바꾸고
     `AGENTS.md` · `AGENT-CHAIN.md` · `OPERATIONS.md` 줄을 더한다
   - §기준선: 숫자는 그대로 두고, 재확인한 날짜와 도구를 한 줄
8. **커밋** — 첫 줄 `docs(t89): 감독층 인수 — …`. push는 사용자가 대화에서 허락한 뒤(샌드박스 승인 창은 허락이 아니다)

## 완료 조건

```
시작 전 확인: 통과
typecheck 통과 · smoke 534 → 534 · front 526 → 526 · 실패 0 · verify exit 0 (첫 verify · 둘째 verify 둘 다)
CLAUDE.md 남은 곳: 5의 셋 안에서만 (파일별 개수)
```

## 확인 절차 (사용자)

1. 첫 응답의 첫 줄이 `층: 감독층 (T-89 담당)` 꼴인가 — `AGENTS.md` §1을 따랐다는 표시다.
   새 세션에서 `OPERATIONS.md` §8-5의 확인(명령 없이 `AGENTS.md` 첫 줄 대기)도 한 번 한다
2. 보고의 첫 verify가 어느 환경에서 통과했는지 보고, 그 환경을 매번 쓸지 정한다.
   샌드박스 밖에서만 통과했다면 설계층에 올려 `AGENT-CHAIN.md` §1.1의 여는 법을 고치게 한다

## 이 티켓이 안 하는 것

- 코드 동작 · 검사 · 마이그레이션 변경
- 옛 기록의 이름 고치기
- T-88 ②

---

## 보고 (담당이 채운다)

```
티켓: T-89
층 · 도구: 감독층 · codex (GPT), 티켓 머리의 담당으로 확정
바꾼 파일: STATE.md, APP-BUILD.md, README0722.md, docs/api-surface.md,
  src/services/collected.ts, test/smoke.ts, test/runner-exit.mjs, test/front.mjs, 이 티켓의 §보고
시작 전 확인: 통과 · AGENTS.md 10555 B
첫 verify (환경): 샌드박스 밖(require_escalated)에서 typecheck 통과 · smoke 534 · front 526 · 실패 0 · exit 0
  기본 환경(use_default)은 typecheck 통과 · smoke 534 · 실패 0 뒤, front 기동 중 EPERM으로 exit 1.
둘째 verify (환경): 같은 샌드박스 밖 환경에서 typecheck 통과 · smoke 534 · front 526 · 실패 0 · exit 0
기준선: typecheck 통과 · smoke 534 → 534 · front 526 → 526 · 실패 0 · verify exit 0 (변경 전·후 둘 다)
CLAUDE.md 남은 곳: §할 일 5가 허용한 세 분류 안에서만 남았다. 아래 최종 훑기에 파일별 개수를 기록한다.
설계와 어긋난 점: 동작 변경 없음. 기본 샌드박스의 EPERM이 재현돼 설계층에 실행 환경 판단을 올린다.
막힌 것: 시작 검사의 오탐은 c2d48c3의 개정 명령으로 해소. verify는 샌드박스 밖에서 통과했다.
  --add-dir를 별도로 적용한 새 세션은 측정하지 않았다. 리포 밖 설정은 바꾸지 않았다.
작업 상태: 감독층 구현·1차 검증 완료. 설계층 최종 검토와 사용자 push 허락은 남아 있다.
```

### 변경 범위와 판단

- 재개 시 미커밋 변경은 앞선 이 티켓의 보고뿐이었다. 미커밋 코드는 없었다.
- `CLAUDE.md` 참조는 지정된 문서와 코드 주석에서만 바꿨다. `STATE.md` 맨 위의 현행 확인법 안내 두 줄도
  §할 일 5에 따라 바꿨다. 지난 항목과 닫힌 티켓의 이름은 기록으로 남긴다.
- README 함정 16~18도 이번에 채우기로 했다. 19만 추가하고 중간 번호를 비우는 안은 원본과 요약의 대응을
  계속 불완전하게 남기므로 택하지 않았다. 16~19 모두 CONVENTIONS 원본을 요약한다.
- 소스 diff는 주석 여섯 줄의 파일명 치환뿐이다. API 구조와 스키마가 바뀌지 않아 지도 재생성·스키마 재덤프는 하지 않는다.
- T-88의 락을 티켓이 정한 형식으로 잠시 인수했다. 커밋 직전에 T-88 대기 락으로 되돌렸다.

### 검증 환경과 실행 기록

기본 셸은 Windows PowerShell 5.1.26100.9587이다. `npm run verify`는 `npm.ps1` 실행 정책에 막혀
검사 시작 전에 exit 1을 냈다. 같은 npm의 `npm.cmd run verify`로 실행했으며 실행 정책은 바꾸지 않았다.

변경 전 기본 샌드박스 실행은 typecheck와 smoke 534/0까지 통과했으나, 아래 오류로 front는 시작하지 못했다.
verify exit 1이며, 이 런을 front 실패 0으로 세지 않는다. 관련 출력 발췌(ANSI 색상 코드는 제거):

```text
[e2e] 오류: Error: dev 서버가 30초 안에 http://127.0.0.1:59621/api/health에 응답하지 않았다 (프로세스는 살아 있다).
EPERM: operation not permitted, mkdtemp 'C:\dev\personal-os-worker\worker\.wrangler\tmp\dev-XXXXXX'
The expression evaluated to a falsy value:
    (this.#tmpDir)
[e2e] 실패라 진단용으로 남겼다: C:\Users\LG\AppData\Local\Temp\personal-os-e2e-r89YTC
[e2e] 실제 dev DB(.wrangler/state)는 그대로.
```

샌드박스 밖 실행은 처음 두 번 홈 디렉터리에서 시작해 `C:\Users\LG\package.json`의 ENOENT로 exit 1을 냈다.
둘째 시도는 도구의 `workdir`를 지정했어도 같았다. 두 시도 모두 검사는 시작하지 못했다.
명령 안에서 경로를 지정하고 `login: false`로 실행하자 통과했다.

```powershell
Set-Location -LiteralPath 'C:\dev\personal-os-worker\worker'
npm.cmd run verify
```

- **변경 전 통과 런**: 샌드박스 밖 · typecheck 통과 · smoke 534/0 · front 526/0 · verify exit 0.
  마이그레이션 17.0초 · front 174.3초 · 러너가 임시 DB 삭제 완료를 출력했다.
- **변경 후 통과 런**: 같은 환경 · typecheck 통과 · smoke 534/0 · front 526/0 · verify exit 0.
  마이그레이션 18.6초 · front 158.7초 · 러너가 임시 DB 삭제 완료를 출력했다.
  두 통과 런에서 front 간헐 hang은 관측되지 않았다. 앞선 기본 환경의 기동 실패는 별도로 남긴다.
- **설계층에 올릴 것**: 기본 샌드박스에서 T-06의 EPERM이 재현됐다. 통과한 환경을 바탕으로
  AGENT-CHAIN.md §1.1의 여는 법을 판단해야 한다. `--add-dir` 효과는 이 세션에서 별도로 재지 않았다.
- **범위 밖 발견 — 수정하지 않음**: `test/e2e.mjs`의 헬스 오류 문구는 "30초"지만, 루프는 120회이고
  요청당 2초 타임아웃 뒤 250ms를 쉰다. 모든 요청이 타임아웃되면 대기 상한은 계산상 약 270초다.
  이번에 경과 시간을 별도 계측한 값은 아니다.

### 최종 훑기 (파일별 일치 행 수)

명령은 `git grep -c "CLAUDE\.md"`다. `-c`는 문자열 출현 횟수가 아니라 일치한 **행 수**를 센다.
양성 대조인 STATE의 지난 기록 41행과 APP-BUILD 이력 1행이 남아 있어, 빈 스캔을 통과로 읽지 않았다.
나머지도 발행된 티켓·기록, 마이그레이션/덤프 주석, 이름 대응표 안에만 있다. 범위 밖의 새 잔여물은 없다.

```text
AGENT-CHAIN.md:1
AGENTS.md:1
APP-ADR.md:4
APP-BUILD.md:1
APP-PLAN.md:2
BRIEF-AGENCY-0810.md:1
REFACTOR-PLAN.md:6
STATE.md:41
docs/schema-current.sql:1
docs/tickets/HANDOFF-0731.md:3
docs/tickets/T-01-education-form.md:1
docs/tickets/T-05-protect-ui.md:1
docs/tickets/T-06-codex-front-env.md:2
docs/tickets/T-07-ai-used-semantics.md:2
docs/tickets/T-09-goals-dday-nav.md:1
docs/tickets/T-10-mode-downgrade.md:1
docs/tickets/T-11-exit-cost.md:1
docs/tickets/T-12-front-date-checks.md:1
docs/tickets/T-16-memo-origin.md:1
docs/tickets/T-17-visual-feedback.md:1
docs/tickets/T-18-history-and-memory.md:1
docs/tickets/T-20-calendar-perf.md:1
docs/tickets/T-21-calendar-panes.md:1
docs/tickets/T-22-guard-memory-daily.md:1
docs/tickets/T-23-loadtime-once.md:1
docs/tickets/T-25-gesture-edge.md:1
docs/tickets/T-26-schedule-clock.md:1
docs/tickets/T-31-precedent-observability.md:1
docs/tickets/T-36-smoke-relative-dates.md:1
docs/tickets/T-37-nested-timeout-order.md:1
docs/tickets/T-40-flush-lost-update.md:1
docs/tickets/T-47-no-dead-end-defer.md:1
docs/tickets/T-50-ai-fields-append-only.md:1
docs/tickets/T-55-cal-list-empty.md:1
docs/tickets/T-57-fetch-has-a-ceiling.md:1
docs/tickets/T-60-l2-says-something.md:1
docs/tickets/T-61-wake-not-class.md:1
docs/tickets/T-67-runner-keeps-the-summary.md:2
docs/tickets/T-68-accept-remembers.md:1
docs/tickets/T-69-two-numbers-disagree.md:3
docs/tickets/T-70-unasked-is-not-ignored.md:6
docs/tickets/T-72-clean-clone-brings-crlf.md:2
docs/tickets/T-73-compose-spike-calendar.md:1
docs/tickets/T-76-the-window-end-says-nothing.md:1
docs/tickets/T-77-level-3-knows-less.md:2
docs/tickets/T-78-accepted-homework-becomes-a-task.md:1
docs/tickets/T-79-today-asks-less.md:3
docs/tickets/T-80-the-deadline-becomes-the-plan.md:1
docs/tickets/T-81-the-calendar-loses-the-gesture.md:1
docs/tickets/T-82-wait-for-what-is-visible.md:1
docs/tickets/T-83-a-task-has-a-tasks-name.md:1
docs/tickets/T-84-one-task-one-line.md:1
docs/tickets/T-86-deadline-suffix-off-the-screen.md:1
docs/tickets/T-88-nudge-rings-and-ends-with-one-tap.md:1
docs/tickets/T-89-lead-takes-over.md:8
docs/tickets/T-90-schema-dump-in-repo.md:1
migrations/0023_guard_asked.sql:1
migrations/0024_collected_categories.sql:1
```

### 재개 시 시작 전 확인 (2026-10-06 · c2d48c3의 AGENTS.md §0 원문 명령)

사용자 지시로 AGENTS.md를 다시 읽고, 기본 셸 Windows PowerShell 5.1에서 개정 명령을 그대로 실행했다.
exit 0이며 출력은 다음과 같다. 아래의 앞선 원출력과 대체 확인 기록은 보존한다.

```text
통과 · AGENTS.md 10555 B
```

### 시작 전 확인 원출력 (2026-10-06 · AGENTS.md §0 원문 명령)

```text
Get-ChildItem : 'C:\Users\LG\.codex\.sandbox-secrets' 경로에 대한 액세스가 거부되었습니다.
위치 줄:3 문자:29
+ ... (Test-Path $p) { $n = (Get-ChildItem $p -Recurse -File -Force | Measu ...
+                            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : PermissionDenied: (C:\Users\LG\.codex\.sandbox-secrets:String) [Get-ChildItem], Unauth
   orizedAccessException
    + FullyQualifiedErrorId : DirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand

Get-ChildItem : 'C:\Users\LG\.codex\app-server-control' 경로에 대한 액세스가 거부되었습니다.
위치 줄:3 문자:29
+ ... (Test-Path $p) { $n = (Get-ChildItem $p -Recurse -File -Force | Measu ...
+                            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : PermissionDenied: (C:\Users\LG\.codex\app-server-control:String) [Get-ChildItem], Unauth
   orizedAccessException
    + FullyQualifiedErrorId : DirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand

Get-ChildItem : 'C:\Users\LG\.codex\app-server-daemon' 경로에 대한 액세스가 거부되었습니다.
위치 줄:3 문자:29
+ ... (Test-Path $p) { $n = (Get-ChildItem $p -Recurse -File -Force | Measu ...
+                            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : PermissionDenied: (C:\Users\LG\.codex\app-server-daemon:String) [Get-ChildItem], Unautho
   rizedAccessException
    + FullyQualifiedErrorId : DirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand

~/.codex/AGENTS.md : 100571 B
→ 멈추고 보고한다
```

### 지정된 자리만 별도로 확인한 결과

파일과 디렉터리를 `Get-Item -LiteralPath`의 `PSIsContainer`로 나누고, 파일은 `Length`를 읽었다.
디렉터리일 때만 `Get-ChildItem -LiteralPath ... -Recurse -File -Force -ErrorAction Stop`으로 합산한다.
이 확인은 원문 명령의 통과로 간주하지 않았다.

```text
Path                        Exists Bytes
----                        ------ -----
GEMINI.md                    False     0
AGENTS.override.md           False     0
.agent                       False     0
.agents                      False     0
~/GEMINI.md                  False     0
~/.agents                    False     0
~/.gemini/GEMINI.md           False     0
~/.gemini/AGENTS.md           False     0
~/.codex/AGENTS.md             True     0
~/.codex/AGENTS.override.md   False     0
AGENTS.md: 9566 B
```

`Get-Command pwsh`와 아래 세 경로에서 PowerShell 7 실행 파일을 찾지 못했다.

- `C:\Program Files\PowerShell\7\pwsh.exe`
- `C:\Program Files\PowerShell\7-preview\pwsh.exe`
- `$env:LOCALAPPDATA\Microsoft\PowerShell\7\pwsh.exe`

첫 응답 첫 줄은 층 표시 형식을 지키지 못했다. 현재 리포의 개정된 AGENTS.md와 티켓 담당을 읽은 뒤
`층: 감독층 (T-89 담당)`으로 정정했다. 새 세션의 진입 확인(OPERATIONS.md §8-5)은 미실시다.
