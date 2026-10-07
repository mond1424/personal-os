# T-93 — verify가 스키마 스냅샷까지 대조한다

**발행** 설계층 · 2026-10-07 · **담당** 감독층 · **상태** 🟨 구현 완료 · 설계층 검토 대기
**근거** T-90 §보고(의견: 추가 찬성) · T-90 §검토(채택)
**`package.json` 한 줄 · 동작 변경 없음 · 마이그레이션 없음 · 배포 없음**
⚠️ **착수 조건: T-90이 닫힌 뒤.**

---

## 목표

`npm run verify`가 마지막에 `npm run schema -- --check`까지 돈다.
왜: 마이그레이션을 더하고 재덤프를 잊어도 지금은 어느 검사도 빨간불이 되지 않는다 — 세션 종료 규칙 3이 사람의 기억에 걸려 있다.
`--check`는 실 D1에 기대지 않고 몇 초면 끝난다.

## 범위 — 이 파일만 고친다

```
package.json    "verify"
```

## 금지

| 하지 말 것 | 왜 |
|---|---|
| schema 대조를 맨 앞에 두기 | `&&`로 이어지므로 앞에서 멈추면 smoke · front 숫자가 안 나온다. 숫자가 먼저다 |
| `CONVENTIONS.md` 고치기 | 설계층 소유다. 이 티켓이 닫히면 설계층이 §기준선 표를 고친다 |

## 완료 조건

```
typecheck 통과 · smoke · front 수 그대로 · 실패 0 · schema 일치 · verify exit 0
```

**빨간불 대조** — 스냅샷 본문의 한 줄을 바꾸면 verify가 exit 1로 끝나고 마지막 출력이 schema의 "첫 차이"다. 바꾼 줄은 되돌린다.

## 확인 절차 (사용자)

없다.

---

## 보고 (담당이 채운다)

```
티켓: T-93
층 · 도구: 감독층 · codex (GPT)
바꾼 파일: package.json의 verify 한 줄 · 이 티켓의 상태/보고 · STATE.md
기준선: typecheck 통과 · smoke 537 → 537 · front 526 → 526 · 실패 0
        schema 일치 — 마이그레이션 26개 · 객체 71개 (쓰기 없음) · verify exit 0
빨간불 대조: 스냅샷 본문 73행 임시 변경 → typecheck 통과 · smoke 537 · front 526 · 실패 0
             마지막 schema 단계가 첫 차이 73행을 출력 · verify exit 1
             원문 바이트 복원 뒤 SHA256 동일 · schema 일치 · exit 0 · 스냅샷 git diff 없음
설계와 어긋난 점: 없음
막힌 것: 구현/검사 없음 · 설계층 최종 검토와 사용자 push 허락 대기
```

- **진입/범위:** `통과 · AGENTS.md 10651 B`. T-90 닫힘, 깨끗한 작업 트리와 빈 WIP를 확인한 뒤
  T-93 락을 걸었다. `verify` 끝에 `&& npm run schema -- --check`만 추가했다.
  검사 파일·덤프 스크립트·마이그레이션은 변경하지 않았다. 구조/마이그레이션 변경이 없어
  api-surface 재생성과 스키마 재덤프 대상은 없다. `CONVENTIONS.md`의 기준선 명령 표 갱신은 설계층 몫이다.
- **최초 실행 실패도 보존:** 기본 샌드박스의 `npm.cmd run verify`는 typecheck 통과·smoke 537/실패 0 뒤
  `.wrangler/tmp/dev-XXXXXX`의 `mkdtemp EPERM`으로 Worker 기동에 실패해 exit 1이었다.
  front 본문/집계와 schema는 실행되지 않았다. T-06 배제 목록을 읽고 추가 권한 환경에서 재실행했다.
  추가 권한 셸의 첫 시도는 홈 폴더에서 시작해 `C:\Users\LG\package.json` ENOENT·exit -4058이었다.
  이후 두 전체 실행 모두 `Set-Location -LiteralPath 'C:\dev\personal-os-worker\worker'`를 명시했다.
- **정상 전체 실행:** 추가 권한 환경에서 `npm.cmd run verify`로 위 기준선과 exit 0을 확인했다.
  front 157.2초·실패 0, 임시 DB 정리 완료. schema가 front 뒤에 실행돼 26개 마이그레이션·71개 객체의 일치를 냈다.
- **빨간불 전체 실행:** 백업과 현재 파일의 SHA256이 같은지, 변경 앵커가 한 곳인지 먼저 확인했다.
  스냅샷 본문 `-- 테이블` 한 줄을 `-- 테이블 (T-93 빨간불 대조)`로 바꾸고,
  추가 권한 환경에서 `npm.cmd run verify`를 실행했다. front 156.9초·526/실패 0 뒤 마지막 출력은 아래와 같았다.

  ```text
  [schema] docs/schema-current.sql: 첫 차이 73행
  현재: "-- 테이블 (T-93 빨간불 대조)"
  생성: "-- 테이블"
  VERIFY_EXIT=1
  ```

  `finally`에서 백업의 원문 바이트로 복원하고 SHA256
  `43DCAF55B03C02C6F29B0A51683600608278E8D6C8E5542E99A9E3A96258EC03`의 전후 일치를 확인했다.
  복원 뒤 `npm.cmd run schema -- --check`도 26개/71개 일치·exit 0이었다.
  앞의 정상 전체 실행과 복원한 스냅샷이 같은 바이트이므로 전체 verify는 추가 반복하지 않았다.
- **원출력 위치:** `%TEMP%/personal-os-t93-verify-green.log`(최초 EPERM),
  `%TEMP%/personal-os-t93-verify-green-retry.log`(정상 전체 실행),
  `%TEMP%/personal-os-t93-verify-red.log`(빨간불 전체 실행).
  ENOENT는 도구 실행 결과에 기록했다. 기본 환경의 Worker 기동 실패를 front 간헐 hang 해결/재현으로 해석하지 않는다.
