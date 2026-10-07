# T-90 — 스키마 덤프를 리포 안의 명령 하나로

**발행** 설계층 · 2026-10-06 · **담당** 감독층 · **상태** ✅ 닫힘
**근거** `CONVENTIONS.md` §세션 종료 규칙 3 · 함정 16 · 17 · 18 · `docs/schema-current.sql` 머리
**스크립트 하나 + `package.json` 한 줄 · 동작 변경 없음 · 마이그레이션 없음 · 배포 없음**
⚠️ **착수 조건: T-89가 닫힌 뒤.**

---

## 목표

세션 종료 규칙 3("마이그레이션을 추가했으면 `docs/schema-current.sql` 재덤프")을 **리포 안의 명령 하나**로 돌게 한다.
왜: 지금까지 이 덤프는 리포 밖 임시 스크립트로 만들었다. 그 스크립트가 없으니, 다음에 마이그레이션을 추가하는 층은
덤프를 즉석에서 다시 짜게 되고, 짤 때마다 순서 · 빈 줄 · 줄 끝이 달라질 수 있다. 그러면 스냅샷의 diff가 내용이 아니라
형식 차이로 채워지고, 칼럼 · 제약을 이 파일로 확인하라는 규칙(`AGENT-CHAIN.md` §5)이 흔들린다.

## 범위 — 이 파일들만 고친다

```
scripts/dump-schema.mjs     새 파일
package.json                scripts에 "schema" 한 줄
docs/schema-current.sql     머리 주석 70행의 CLAUDE.md → CONVENTIONS.md 한 곳(본문은 스크립트 출력과 같아야 한다)
```

## 하는 일

- `migrations/*.sql`을 이름순으로 인메모리 SQLite(`node:sqlite` — `test/smoke.ts`가 이미 쓴다)에 적용하고 `sqlite_master`를 덤프한다
- **머리 주석**(파일 첫 줄부터 첫 `-- ====` 줄 앞까지)은 사람이 쓰는 영역이다. 스크립트는 지금 파일의 머리를 그대로 옮기고, 그 뒤만 만든다
- 본문은 지금 파일과 같은 모양이다 — 섹션 순서 테이블 → 뷰 → 인덱스 → 트리거, 섹션마다 `-- ====` 띠 셋,
  섹션 안은 이름순으로 보인다, 문장마다 `;`와 빈 줄 하나, `sql`이 없는 자동 인덱스는 빠진다. **보이는 대로 믿지 말고 출력을 대조해 맞춘다**
- `npm run schema` = 다시 쓰기. `npm run schema -- --check` = 쓰지 않고 다르면 다른 첫 줄을 찍고 0이 아닌 값으로 끝난다
- 비교와 쓰기는 줄 끝 `\r`을 걷은 뒤에 한다 — 이 리포는 Windows에서 CRLF로 체크아웃된다(함정 16)

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 지금 파일의 본문을 손으로 고쳐 스크립트 출력에 맞추기 | 순서가 거꾸로다. 지금 파일이 정답이고 스크립트가 맞춘다. 맞출 수 없는 차이가 있으면 멈추고 보고한다 |
| `npm run verify`에 `--check` 끼워 넣기 | 검사 구성이 바뀌는 결정이다. 넣을지는 보고에 의견만 쓴다 |
| `wrangler`로 덤프하기 | 로컬 D1 상태(`.wrangler/`)에 기대면 덤프가 그 PC의 상태를 따라간다. 마이그레이션 파일만 입력이어야 한다 |
| `CONVENTIONS.md` 고치기 | 설계층 소유다. 세션 종료 규칙 3에 명령을 적는 것은 최종 검토 때 설계층이 한다 |

## 읽을 것

- `CONVENTIONS.md` §세션 종료 규칙 · §마이그레이션 · 배포 · 함정 16(CRLF) · 17(heredoc) · 18(도구의 답)
- `docs/schema-current.sql` 머리 주석과 섹션 띠
- `test/smoke.ts`의 `node:sqlite` 사용처(`DatabaseSync`)

## 완료 조건

```
typecheck 통과 · smoke 534 → 534 · front 526 → 526 · 실패 0
npm run schema -- --check  → 지금 커밋된 docs/schema-current.sql(70행만 고친 것)과 같다 · exit 0
```

**`--check`가 살아 있다는 증거를 먼저 낸다**(함정 18) — 다음 둘이 빨간불이어야 한다. 끝나면 되돌린다.

1. `docs/schema-current.sql` 본문의 한 줄을 바꾼 뒤 `--check` → 다른 줄을 찍고 실패
2. 임시 마이그레이션(예: `migrations/9999_probe.sql`에 `CREATE TABLE probe(x);`)을 둔 뒤 `--check` → 실패. 파일은 지운다

## 확인 절차 (사용자)

없다 — 화면 · 폰에 닿는 변경이 없다.

## 이 티켓이 안 하는 것

- `docs/api-surface.md` 생성 — 시그니처 지도는 사람이 고르는 요약이라 스크립트로 만들지 않는다
- `verify`에 덤프 검사 넣기 · `CONVENTIONS.md` 갱신

---

## 보고 (담당이 채운다)

### 최초 보고 — 검증 보류 당시의 기록 (보존)

```
티켓: T-90
층 · 도구: 감독층 · codex (GPT)
바꾼 파일: scripts/dump-schema.mjs, package.json, docs/schema-current.sql,
  STATE.md, 이 티켓의 §보고. APP-BUILD.md는 작업 중 락만 변경했고 복원해 커밋 diff는 없다.
시작 전 확인: 통과 · AGENTS.md 10555 B
기준선: typecheck 통과 · smoke 534 → 532 (실패 0 → 2) · front 526 → 526 (실패 0, 단독 실행) · verify exit 1
--check: 지금 파일과 같음 · exit 0 · 빨간불 대조 둘 모두 exit 1 (아래 기록)
verify에 넣을지 의견: 추가에 찬성한다. 마이그레이션 뒤 재덤프 누락을 잡고 실 D1에 기대지 않는다.
  검사 구성은 설계층이 결정하므로 이번에는 verify 명령을 바꾸지 않았다.
설계와 어긋난 점: 생성 결과는 현재 본문과 같다. 기존 머리말 53행의 sqlite_sequence 설명은 본문과 다르다(아래).
막힌 것: 기존 T-71 smoke 검사 2·7 실패. test/smoke.ts는 이 티켓 범위 밖이라 고치지 않았다.
판정: 덤프 기능과 대조 검증 완료. 전체 verify 완료 조건은 미충족이며 티켓을 닫지 않는다.
```

### 구현과 범위

- T-89의 닫힘과 깨끗한 작업 트리를 확인한 뒤 시작했다. T-88 ②는 대기 상태로 두고 T-90 작업 락을 걸었다.
  범위 안 구현과 보고를 커밋하기 전에 T-88 대기 락으로 복원했다. T-90의 전체 검증 보류는 STATE와 이 보고에 남긴다.
- 마이그레이션 파일을 이름순으로 인메모리 `DatabaseSync`에 적용한다. `sqlite_master`에서 SQL이 있는
  객체만 읽고, 테이블 → 뷰 → 인덱스 → 트리거 안에서 이름순으로 출력한다. 실 `.wrangler/`는 읽지 않는다.
- 첫 `-- ====` 줄 앞은 사람이 쓴 머리말로 보존한다. 읽기·비교·쓰기는 CR을 제거한 LF 기준이다.
  `--check`는 쓰지 않고 첫 다른 행의 번호·현재 줄·생성 줄을 출력하며 exit 1로 끝난다.
- `docs/schema-current.sql`의 커밋 대비 diff는 70행의 규약 파일명 한 곳뿐이다. 본문을 손으로 고치지 않았다.
  API 구조와 마이그레이션은 그대로이므로 api-surface 재생성과 새 마이그레이션은 없다.

### 덤프 검사 (2026-10-07 · Node v24.14.1 · 기본 샌드박스)

PowerShell 실행 정책은 바꾸지 않고 `npm.cmd`를 썼다.

| 실행 | 실제 결과 |
|---|---|
| `npm.cmd run schema -- --check` | 마이그레이션 26개 · 객체 71개 일치 · exit 0 |
| 본문 75행을 `CREATE TABLE analyses_probe (`로 변경 후 check | 첫 차이 75행 · exit 1 · 변경한 파일의 SHA256 불변(쓰기 없음) |
| `migrations/9999_probe.sql`에 `CREATE TABLE probe(x);`를 둔 뒤 check | 첫 차이 295행 · exit 1 · 스냅샷 SHA256 불변 |
| 두 변이 복원 뒤 check | 26개 · 71개 일치 · exit 0 · 스냅샷 원본 SHA256 복원 · 임시 마이그레이션 제거 |
| 머리말에 대조 주석을 넣고 CRLF로 저장한 뒤 check | exit 0 · CRLF 파일 SHA256 불변(쓰기 없음) |
| 그 CRLF 파일을 `npm.cmd run schema`로 생성 | exit 0 · 대조 머리말 보존 · LF 변환 · 기대 문자열과 정확히 일치 |
| 같은 파일을 한 번 더 생성 | exit 0 · 첫 생성과 SHA256 일치 |
| 원본 바이트 복원 후 최종 생성·check | 모두 exit 0 · 최종 생성 전후 SHA256 일치 |

빨간불 원출력의 핵심 줄:

```text
[schema] docs/schema-current.sql: 첫 차이 75행
현재: "CREATE TABLE analyses_probe ("
생성: "CREATE TABLE analyses ("

[schema] docs/schema-current.sql: 첫 차이 295행
현재: "CREATE TABLE schedule_entries ("
생성: "CREATE TABLE probe(x);"
```

임시 변이는 `try/finally`로 복원했다. 종료 후 임시 파일이 없고 원본 바이트가 돌아왔는지를 별도로 확인했다.

### 전체 검사에서 발견한 기존 실패 — 범위 밖, 수정하지 않음

`AGENT-CHAIN.md` §1.1에 따라 샌드박스 밖에서 다음 명령으로 실행했다.

```powershell
Set-Location -LiteralPath 'C:\dev\personal-os-worker\worker'
npm.cmd run verify
```

typecheck는 통과했다. smoke는 총 534건 중 **532 통과 · 2 실패**로 끝나 verify exit 1이며,
`&&` 뒤의 front는 이 실행에서 시작하지 않았다. 실패는 다음 둘이다.

```text
✗ FAIL 2 ★ protect_prep_min 이 붙은 칸에도 실린다 — 그 값만큼 (ADR-047 ① 회귀) — 간격=NaN(기대 95) 설정합=60
✗ FAIL 7 ★ 예약이 전제하는 기상과 문구가 말할 기상이 같다 — 한쪽만 침묵하지 않는다 (전수) — 선언만=true 값붙음=false 갈린칸=없음
통과 532 · 실패 2
```

이후 같은 샌드박스 밖 환경에서 `npm.cmd run front`를 따로 실행했다.
**526 통과 · 실패 0 · exit 0**, 마이그레이션 20.0초 · front 170.1초 · 임시 DB 정리 완료를 확인했다.
이 결과를 verify exit 0으로 읽지 않는다.

**확인한 원인:** 두 검사가 공유하는 T-71 픽스처가 항상 그날의 가장 이른 일정인 것은 아니다.

- T-80의 미래 마감은 `atPlus(20 * DAY)`로 만든다(`test/smoke.ts:2617`).
- T-71의 값 붙은 일정은 귀속일 `D + 21`에 만들고, 기존 일정보다 한 시간 이르게 잡되
  `Math.max(60, first - 60)`으로 01:00보다 이르게 만들지 못한다(`test/smoke.ts:4125`).
- 자정 뒤 귀속일 경계 전에는 두 날짜가 겹친다. 기존 마감이 00:30이면 새 일정은 01:00이 되어,
  `wakePoints`가 올바르게 더 이른 **보호 없는 마감**을 고른다. 그러면 `leaveBy`가 없고 2·7이 실패한다.
- `git diff -- src test migrations public`는 비어 있었다. verify 명령도 그대로이며 새 schema 명령을 호출하지 않는다.

기존 `makeD1`, `loadTime`, `events.create/setProtect`, `guard.schedule`을 호출하는 최소 재현을
별도 인메모리 DB에서 실행했다. 시스템 시계나 리포 파일을 바꾸지 않고 각 시각을 `loadTime`에 주입했다.

| 주입 시각(KST) | 귀속일 D | T-80 마감 | T-71 일정 | 실제 선택 / 기상 간격 |
|---|---|---|---|---|
| 2026-10-07 00:30 | 10-06 | 10-27 00:30 | 10-27 01:00 | T-80 · leaveBy 없음 · NaN |
| 2026-10-07 02:30 | 10-06 | 10-27 02:30 | 10-27 01:30 | T-71 · 95분 |
| 2026-10-07 12:30 | 10-07 | 10-27 12:30 | 10-28 11:00 | T-71 · 95분 |

세 경우가 예상대로 갈리는 것을 단언해 exit 0을 확인했다. 이 최소 재현의 통과를 전체 smoke 통과로 세지 않는다.
수정하려면 T-71 픽스처가 가장 이른 일정이 될 수 있는 날짜·시각을 고르도록 해야 한다. 이 티켓에서는 변경하지 않았다.

### 기존 머리말의 불일치 — 수정하지 않음

스냅샷 53행은 `sqlite_sequence`가 SQL이 NULL이라 덤프에 없다고 설명하지만,
321행에는 `CREATE TABLE sqlite_sequence(name,seq);`가 있고 이번 26개 마이그레이션 재생성에도 포함된다.
이번 범위는 머리말 70행만 고치도록 했으므로 53행은 보존하고 설계층에 올린다.

---

### 닫기 전 재확인 (감독층 · codex · 2026-10-07)

설계층 검토 `7990342`의 1~4와 사용자의 후속 지시를 수행했다. 사용자는 조건 충족 시 닫기·커밋·push까지 승인했다.
위 최초 보고의 실패 원출력과 최소 재현 기록은 그대로 남긴다.

```text
시작 전 확인: 통과 · AGENTS.md 10555 B
바꾼 파일: docs/schema-current.sql 머리말 53행, 이 티켓의 상태·보고, STATE.md
기준선: typecheck 통과 · smoke 534 → 534 · front 526 → 526 · 실패 0 · verify exit 0
이전 실패 실행 대비: smoke 532/실패 2 → 534/실패 0
--check: 마이그레이션 26개 · 객체 71개 일치 (쓰기 없음) · exit 0
판정: 설계층의 닫힘 조건 1·2 충족 → T-90 닫힘
```

1. **시간 조건과 전체 검사:** 2026-10-07 **14:04:03 +09:00**에 샌드박스 밖에서
   `Set-Location -LiteralPath 'C:\dev\personal-os-worker\worker'` 후 `npm.cmd run verify`를 실행했다.
   00:00~01:00 밖이며 typecheck·smoke·front가 모두 완료되고 exit 0이었다.
   smoke 집계는 별도 `npm.cmd run smoke`에서도 **534 통과·실패 0·exit 0**을 확인했다.
   front는 **526 통과·실패 0**, 마이그레이션 26.7초·front 180.5초, 임시 DB 정리 완료였다.
2. **머리말 정정:** 53행을 `sqlite_sequence`는 SQL이 있어 덤프에 실린다는 설명으로 고쳤다.
   본문은 바꾸지 않았고 `npm.cmd run schema -- --check`는 위 수치로 일치·exit 0이었다.
3. **종료 기록:** 머리의 상태와 STATE의 T-90 줄을 닫힘으로 갱신했다. T-88 대기 락은 작업 중 인수했다가
   커밋 전에 원래 줄로 복원했다. 사용자 승인에 따라 커밋 후 push한다.
4. **재실패 여부:** 이번 전체 검사는 예상 숫자와 같았다. 앞선 새벽 실패가 해결됐다는 뜻은 아니다.
   시각 의존 픽스처 수정은 **T-92**, verify에 schema 대조 추가는 **T-93**의 범위로 남긴다.
   `src`·`test`·`migrations`·`public`·verify 명령·덤프 스크립트는 이번 후속 작업에서 변경하지 않았다.

---

## 검토 (설계층 · 2026-10-07)

```
층 · 도구: 설계층 · Claude(Cowork, 전환 기간) — 감독층(GPT)과 계열이 다르다
판정: 조건부 합격 — 아래 1·2가 맞으면 닫는다
```

- **구현** — `--check`가 지금 파일과 같고, 빨간불 대조 둘이 실제로 빨간불이며 쓰기가 없다(SHA256). CRLF · 머리말 보존 ·
  반복 생성도 확인됐다. 스크립트를 읽었다 — 입력이 마이그레이션과 머리말뿐이고, 첫 차이를 찾는 반복이 끝나지 않는 경우가 없다.
- **smoke 실패 둘은 이 티켓 탓이 아니다.** `src` · `test` · `migrations` · `public` diff가 비었고, 최소 재현이 시각만으로 갈린다.
  T-71 픽스처가 01:00 밑으로 못 내려가서, 귀속일 경계 전 00시대에는 T-80 마감(`now + 20일`)이 그날 더 이른 일정이 된다 → **T-92**.
- **verify에 넣는 것** — 채택한다. 재덤프 누락을 결정론적으로 잡고 실 D1에 기대지 않는다. 검사 구성이 바뀌는 일이라 **T-93**으로 따로 낸다.
- **머리말 53행** — 사실과 다르다(`sqlite_sequence`는 sql이 있어 덤프에 실린다 · 321행). 범위를 넓혀 감독층이 고친다.

닫기 전에 감독층이 할 것 — 설계층이 미리 허락한다.

1. 00:00~01:00이 아닌 때 `npm.cmd run verify`를 다시 돌린다. typecheck 통과 · smoke 534 · front 526 · 실패 0 · exit 0이어야 한다
2. 머리말 53행을 사실대로 고치고 `npm.cmd run schema -- --check`가 일치를 내는지 본다
3. 1·2가 맞으면 §보고에 숫자를 적고, 머리의 **상태**를 `✅ 닫힘`으로 바꾸고, `STATE.md`의 T-90 줄을 닫힘으로 고쳐 커밋한다
4. 1이 또 다르면 닫지 않고 보고한다
