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

```
티켓: T-94
층 · 도구:
바꾼 파일:
기준선: typecheck 통과 · smoke A → B · front C → D · 실패 0 · schema 일치 · verify exit 0
검사 폐기·교체·추가 내역:
설계와 어긋난 점:
막힌 것:
```
