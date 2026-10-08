# T-94 — pOS의 과제 재촉 설정과 계산을 종료한다

**발행** 설계층 · 2026-10-08 · **담당** 감독층 · **상태** ⬜ 대기 · 사용자 승인 2026-10-08
**근거** ADR-050 2026-10-08 개정 · T-88 종결 결정
**서버 + 웹 · 마이그레이션 없음 · APK 변경 없음 · 구현 후 사용자 배포 필요**

---

## 목표

Tasks.org가 맡은 과제 알림을 pOS가 설정·계산·동기화하지 않는다. 라이브의 설정 두 칸은 실제로 수행할 기능이
없어졌으므로 제거한다. 수집한 과제와 기존 기록, 밤 Guard는 유지한다.

## 범위 — 이 파일들만 고친다

```
public/app.js                 재촉 설정 두 행·설명·편집 제목 및 관련 주석
public/api.js                 _wakeIfNudgeChanged와 그 호출
src/services/nudge.ts         재촉 전용 모듈 제거
src/services/guard.ts         nudge import·계산 호출 제거, nudges: [] 유지
src/services/collected.ts     hasNudges 호출·nudge_changed 제거, 과목명 관련 주석
src/services/tasks.ts         hasNudges 호출·nudge_changed 제거
src/services/events.ts        nudgeKey·연결 조회·변경 신호 제거
src/services/me.ts            옛 설정 키의 조회 제외·저장 종료 응답
src/db/index.ts               nudgeTargets·collectedTaskOfEvent 전용 질의 제거
src/lib/course.ts             재촉 의존을 설명하던 주석만 현행화 (함수 보존)
test/smoke.ts                 T-87·T-88 ① 검사 교체 및 새 종료 계약 검사
test/front.mjs                설정 행·재촉 sync 검사 교체
docs/api-surface.md           변경된 응답 계약 반영
```

감독층의 STATE·APP-BUILD·티켓 보고·커밋은 통상 종료 절차다. 범위 밖 구현은 멈추고 보고한다.

## 할 일

1. 「과제 재촉 — 전날 저녁/당일 아침」 두 행과 `nudge_evening`·`nudge_morning`의 웹 설명·편집 매핑을 뺀다.
   다른 설정과 수집 상태 행은 유지한다. 재촉 설정을 Tasks.org 설정으로 위장하거나 새 외부 연결 버튼을 만들지 않는다.
2. 서버 `getSettings`는 옛 두 키를 응답에서 제외한다. `putSetting`은 두 키에 **410**과
   `과제 알림은 Tasks.org에서 관리해요. pOS 재촉 설정은 종료됐어요.`를 반환한다.
   옛 화면도 저장 성공으로 오인하지 않게 한다. 기존 settings 행은 삭제하지 않으며 읽어서 동작에 쓰지도 않는다.
   일반 키의 검증·개인 키 마스킹은 유지한다. 키 종료 처리는 재촉 계산 모듈을 import하지 않는다.
3. `nudge.ts`와 전용 DB 질의·모든 계산 호출을 제거한다. `/api/guard/schedule`의 **`nudges: []`는 호환용으로 유지**한다.
   기존 `d`·`events`·`boundary`·`mode`·`friction_mult`·`wake` 및 보호 예약 계산은 그대로다.
4. 수락·완료·취소·취소 해제·일정 수정·설정 저장에서 `nudge_changed`를 제거한다. 웹의 해당 응답 처리만 제거한다.
   `syncGuardNative`와 부팅/일일 Guard 동기화, API 상한·실패 번역·다른 네이티브 연동은 보존한다.
5. `courseOf`·`titleOf`는 이 티켓에서 보존한다. 재촉을 없애며 수집·수락·일정·task·예정일을 바꾸지 않는다.
   신규 수락 종료는 사용자 결정에 따라 T-97에서 한다. 이 항목은 수락을 계속 운영하라는 결정이 아니라 티켓 사이의 범위 구분이다.
6. 옛 재촉 계약을 지키던 검사는 폐기/교체하되, 보호 일정·원장 불변·과목명·수락 멱등 등 살아 있는 계약까지 지우지 않는다.
   특히 T-87 검사 12의 **GuardSync.kt가 읽는 키를 실제 응답과 대조하는 검사**는 보존한다.
   설정 행 검사 20→18은 행 수의 변화이며 검사 건수 감소와 다르다. 삭제·교체·추가한 검사 이름과 수를 보고한다.
7. `docs/api-surface.md`와 STATE의 현행 T-88 ② 대기 안내를 정리한다. 예전 구현·배포·변이 보고는 이력으로 보존한다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| APK에 재촉 구현·해제 기능을 새로 넣기 | T-88 ②는 취소됐다. 현 소스의 GuardSync는 재촉을 예약하지 않는다 |
| settings 두 행이나 수집·task·event·guard_events를 삭제/변경하는 마이그레이션 | 종료할 것은 기능이다. 기록 폐기는 승인되지 않았다 |
| Tasks.org 완료를 pOS 완료로 간주하거나 양방향 연동 만들기 | 별도 원장이며 이번 결정에 동기화는 없다 |
| 모든 Guard.sync 호출 제거·밤 알림·보호 규칙 변경 | 종료 대상은 재촉 전용 신호뿐이다 |
| T-88 ① 커밋 전체 되돌리기 | 현재 코드·후속 검사와 섞여 있다. 전용 경로만 제거한다 |

## 읽을 것

- ADR-050 개정·종전 이력, T-87 §보고, T-88 §종결 결정
- `src/services/me.ts`, `guard.ts`의 schedule, `public/api.js`의 `_req`와 `public/app.js`의 `syncGuardNative`
- `android/.../guard/GuardSync.kt`의 schedule 응답 소비부(읽기만)
- `docs/schema-current.sql`의 settings·collected_items, CONVENTIONS 함정 14·15·17·18

## 완료 조건

```
typecheck 통과 · smoke A → B · front C → D · 실패 0 · schema 일치 · verify exit 0
```

착수 기준은 STATE에서 받고, 제거/교체 때문에 달라지는 검사 수를 항목별로 설명한다. 숫자를 미리 고정하지 않는다.

- 옛 두 설정이 D1에 있어도 GET에 없고 각각의 PUT은 410, 원문 값은 그대로다. 무관한 설정 PUT은 정상이다.
- 재촉 대상이 될 수 있는 수락 과제를 실제로 만든 뒤에도 `nudges`는 빈 배열이며, 같은 응답에 보호 예약·wake는 남는다.
  재촉이 없다는 검사에 빈 DB만 주지 않는다. 옛 설정값을 바꿔도 이 결과가 같아야 한다.
- 수락·완료·취소·취소 해제·일정 수정의 도메인 결과는 유지되고 `nudge_changed`는 없다.
- 화면 두 행이 없어지고 다른 설정/수집 상태는 남는다. Guard.sync 스파이로 재촉 응답 처리의 제거를 확인한다.
  옛 서버의 `nudge_changed:true` 응답을 넣어도 새 웹이 그 신호로 sync하지 않는 짝도 둔다. 부팅 동기화는 별도로 보존한다.
- 재촉 전용 코드의 import/호출 잔여를 조사한다. 남는 이름은 종료 키·호환 빈 배열·종료 검사·이력뿐이어야 하며,
  검색이 0일 때는 삭제 전 호출 예시를 같은 패턴에 먹여 검색 도구가 살아 있음을 확인한다.
- 삭제한 모듈을 그대로 복원해 미사용 코드를 두거나, 빈 배열을 기존 계산 결과로 돌려놓으면 무엇이 잡는지 구별해 보고한다.

## 확인 절차 (사용자)

1. 감독층 구현·검토 후 서버와 웹을 배포하고 앱을 새로 연다. Me에서 재촉 두 설정이 사라지고 다른 설정은 남는다(할 일 1).
2. 기존 과제·달력·밤 Guard가 종전처럼 보인다(할 일 3~5). APK 재빌드·설치는 이 티켓에 없다.
3. Tasks.org 알림은 그 앱에서 확인한다. pOS 완료가 외부 알림을 멈추는 시험은 하지 않는다 — 그런 계약은 없다.

---

## 보고 (담당이 채운다)

**2026-10-08 · 구현 완료 · 설계층 최종 검토 대기.**

```
티켓: T-94
층 · 도구: 감독층 · codex
바꾼 파일: public/app.js, public/api.js, src/services/nudge.ts(삭제),
           src/services/guard.ts, src/services/collected.ts, src/services/tasks.ts,
           src/services/events.ts, src/services/me.ts, src/db/index.ts,
           src/lib/course.ts, test/smoke.ts, test/front.mjs,
           docs/api-surface.md, STATE.md, 이 티켓의 §보고
기준선: typecheck 통과 · smoke 537 → 536 · front 526 → 529 · 실패 0 · schema 일치(마이그레이션 26개 · 객체 71개) · verify exit 0
검사 폐기·교체·추가 내역: 아래 참조
설계와 어긋난 점: 없음
막힌 것: 없음. 설계층 최종 검토·사용자 배포·폰 확인은 후속이다.
```

### 구현·범위

- Me의 재촉 설정 두 행·설명·편집 제목을 제거했다. `getSettings`는 옛 두 키를 제외하고 개인 키 마스킹을 유지한다.
  `putSetting`은 값 형식 검사 전에 두 키를 410과 티켓의 종료 안내로 거절한다. 기존 D1 값은 삭제하거나 갱신하지 않는다.
- `nudge.ts`·`nudgeTargets`·`collectedTaskOfEvent`와 모든 import·계산 호출을 제거했다. Guard 응답은 호환용 `nudges: []`를 유지한다.
  보호 예약·wake·활성 모드·하루 경계와 기존 기기 소비 키는 유지한다.
- 수락·완료·취소·취소 해제·일정 수정·설정 저장에서 `nudge_changed`를 제거하고 웹의 전용 sync 처리도 제거했다.
  요청 상한·실패 번역·부팅의 configure→sync와 일일 기기 동기화는 유지한다.
- `courseOf`·`titleOf`와 기존 수집·수락·기록 동작은 유지한다. 신규 수락 종료는 T-97의 범위다.
  `events.update`·`tasks.uncancelTask`의 `t` 인자는 호출 계약을 바꾸지 않기 위해 유지했다.
- API 지도의 HTTP/서비스 응답·종료 키·DB 질의·과목명 설명을 갱신했다. DB export 지도의 새 누락은 없고 제거한 질의·신호는 남지 않았다.
  STATE의 현행 T-88 ② 대기는 이전 문서 발행분에서 해제되어 있으며 종결 이력을 보존했다.
- 범위 밖 구현 없음. `android/`·마이그레이션·`wrangler.toml` 무변경. APK 빌드·설치·배포·원격 D1 변경·Tasks.org 연동 없음.
  `%SystemDrive%/`는 기존 미추적 경로 그대로 제외했다.

### 검사 폐기·교체·추가 내역

**smoke: 537 − 20 + 19 = 536.** 기존 T-87 15개·T-88 5개 블록을 T-94 16개·보존 3개로 교체했다.

- **보존 3개:** T-87 ① 「목록 둘의 course·원문 categories·없으면 null」,
  T-87 12 「GuardSync.kt 소비 키와 실제 schedule 응답 대조」,
  T-87 10 「수락·조회·완료·취소 뒤 guard_events 불변」.
- **교체한 종전 17개:** T-87 1(점 넷)·2(지난 점)·3(1시간 미만, T-88 2 겸임)·4(묶음)·
  5(완료 후 점 제거)·6(취소/해제 후 점)·7(예정일 독립)·8(새벽 귀속일)·9(손 할 일 제외)·
  11(설정에 따라 점 변경)·+(중복 수락 행의 묶음 중복 방지)·13(변경 신호),
  T-88 1(정각 간격)·3(마감 뒤/같은 점)·4(수집 마감 수정 신호)·5(손 일정 수정 무신호)·+(제목만 수정).
  종료된 재촉 계산 계약을 폐기하고 아래 종료 계약으로 교체했다. 완료·취소·미루기·일정 수정의 도메인 계약은 유지했다.
- **새 T-94 16개(소스 번호):** 1 옛 키 조회 제외·일반 설정/마스킹 유지,
  2 저녁 PUT 410·원문 보존, 3 아침 PUT 410·형식과 무관한 종료·원문 보존,
  4 일반 설정 저장/400/404 유지, 5 수락 event/task/예정/원문 연결 보존,
  6 수락 재시도 멱등, 7 실제 수락 과제·옛 설정에도 빈 nudges와 보호 예약/wake 유지,
  8 옛 값 변경에도 빈 nudges·보호 예약/wake 동일, 9 미루기/마감 보존,
  10 수집 일정 시각·제목 수정/보호·연결 보존, 11 완료 귀속일·진행률,
  12 취소·열린 예정 제거·연결 보존, 13 취소 해제·대기·연결 보존,
  14 손 일정/할 일 동작, 15 미사용 재촉 모듈 부재,
  16 import/질의/호출/신호 잔여 없음과 삭제 전 예시 8개의 스캐너 대조.
  4~6·9~14는 false 값도 포함해 응답에서 변경 신호 키 자체가 없음을 본다.

**front: 526 − 2 + 5 = 529.**

- T-87 13 「신호가 있으면 sync」·「무관하면 미호출」 2개를 T-94 5개로 교체했다:
  1 옛 서버 설정 응답에서도 재촉 행/입구 없음·아침 설정/수집 상태 유지,
  2 실제 종료 PUT의 410 안내 전달·sync 미호출,
  3 일반 완료 왕복의 sync 미호출,
  4 옛 서버 `nudge_changed:true`에도 sync 미호출,
  5 부팅이 쓰는 네이티브 동기화 configure→sync와 서버 주소 유지.
- 설정 행 수 검사의 기대값만 **20 → 18**로 고쳤다. 검사 건수는 1개 그대로다.
  기존 T-57의 실제 부팅 configure→sync 검사와 API 상한·연결 실패 복구 검사를 보존했다.

### 실행·변이 대조

시작 전 확인은 `통과 · AGENTS.md 11188 B`, 실제 착수 기준은 STATE의 smoke 537·front 526이다.
추가 권한 환경에서 명령 안에 `Set-Location -LiteralPath 'C:\dev\personal-os-worker\worker'`를 넣고 실행했다.

- 최초 `npm.cmd run typecheck`는 새 설정 픽스처 배열의 `string | undefined` 때문에 TS2769를 냈다.
  설정 쌍을 `as const` 튜플로 확정해 고쳤다. 최초 smoke는 536·실패 0·exit 0이었다.
- **M1 예상:** 삭제한 `nudge.ts`만 HEAD 원본으로 복원하되 런타임에서 import하지 않으면 T-94 15만 실패한다.
  **실측:** `npm.cmd run smoke` → **통과 535 · 실패 1 · 총계 536 · exit 1**, 실패는 15 하나였다.
  미사용 모듈은 기능 검사만으로 잡히지 않으므로 존재 검사가 별도로 필요하다.
- M1을 되돌려 모듈 부재·DB/Guard 파일 SHA256 동일을 확인한 뒤 M2를 적용했다.
- **M2 예상:** 원본 모듈·전용 DB 질의·Guard의 기존 계산 호출을 복원하면 빈 예약 검사 7·8, 존재 15, 잔여 16이 실패한다.
  **실측:** `npm.cmd run smoke` → **통과 532 · 실패 4 · 총계 536 · exit 1**. 실패는 예상한 7·8·15·16이었다.
  7·8은 실제 수락 과제의 계산 결과가 돌아온 것을, 15·16은 제거한 코드가 돌아온 것을 잡는다.
- M2 후 DB/Guard를 저장한 원본 바이트로 복원하고 SHA256 동일·`nudge.ts` 부재를 확인했다.
  런타임 전체 `src/`·`public/` 검색에서 남은 것은 종료 키, 종료 안내/주석, 호환용 빈 배열뿐이다.
  smoke 16은 같은 패턴에 삭제 전 import/호출 예시 8개를 먹여 검색이 살아 있음을 확인한다.
- 복원한 최종 트리에서 `npm.cmd run verify` → **typecheck 통과 · smoke 537 → 536 · front 526 → 529 · 실패 0 ·
  schema 일치(마이그레이션 26개 · 객체 71개) · verify exit 0**.
  마이그레이션 25.7초·front 본문 159.9초이며 기존 front 간헐 hang은 이번 실행에서 관측하지 않았다.
  격리 러너는 실 dev DB를 건드리지 않았고 임시 DB를 정리했다. `git diff --check` 통과.

원출력은 OS 임시 폴더의 `personal-os-t94-smoke.log`, `personal-os-t94-m1-smoke.log`,
`personal-os-t94-m2-smoke.log`, `personal-os-t94-verify.log`에 있다.
스키마 변경이 없어 재덤프는 하지 않았고 verify의 대조만 실행했다.

보고를 파일에 쓰려던 첫 도구 호출은 자동 승인 검토의 사용량 한도 때문에 실행되지 않았다.
사용자가 이어서 보고·기준선 기록과 커밋을 지시한 뒤 문서 기록을 재개했다.

**후속:** 설계층 최종 검토 후 사용자가 서버/웹을 배포하고 티켓의 폰 확인 절차를 수행한다.
라이브 종료·실제 폰 렌더·밤 알림 수신·Tasks.org 알림 상태는 이번 실행으로 확인하지 않았다.
T-95는 T-94의 코드 커밋·설계 검토·종료 뒤에 착수하며 이번 세션에서 시작하지 않았다.
