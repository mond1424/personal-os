# T-15 — 취소된 할 일이 Today에 뜬다

**발행** Cowork · 2026-08-03 · **담당** 미정 (재현 결과가 정한다) · **상태** ⬜ 대기

---

## 증상

사용자 보고:

> 취소된 할일이 todo에 떠있음. 미루기 하면 취소된 일이므로 취소를 풀고 미루라고 함. 역설적.

**둘째 문장이 첫째의 증상이다.** `deferTask`가 취소 가드를 예정 조회보다 **먼저** 확인하도록
`0008`에서 순서를 고쳤고 그 자체는 옳다(그전엔 entry 404가 먼저 터졌다).
문제는 **취소된 항목이 애초에 Today에 없어야 한다**는 것이다.

**이 목록의 유일한 버그다**(`BACKLOG-0803.md` 10번). 나머지는 개선이다.

## 먼저 알아야 할 것 — 설계는 이미 이 상황을 다뤘다

`0008`이 취소를 도입할 때 정한 것:

```
취소 → stDeleteOpenEntries(taskId)
       열린 날의 schedule_entries 를 지운다
       마감된 날 항목은 보존한다 (트리거가 막기도 하고, 기록이기도 하다)
```

즉 **취소하면 오늘·미래의 예정이 사라져 Today에서 없어지는 것이 설계다.**
그런데 떠 있다. 그러므로 **설계대로 안 도는 자리가 있다.**

`classifyAt`은 취소를 분류에 반영하지 않는다 — 주석이 명시한다:

```sql
(t.cancelled_at IS NOT NULL) AS is_cancelled  -- 표시 배지 전용. 분류(class)는 건드리지 않음
```

**이것도 의도다.** 마감된 날의 항목은 취소돼도 `done`/`missed`로 남아야 하기 때문이다.
그러니 **`classifyAt`을 고치는 것이 첫 수가 아니다.**

## 재현부터 — 어느 쪽인지 가른다

`stDeleteOpenEntries`는 `NOT EXISTS (closed daily)`로 지운다.
**오늘이 열린 날이면 오늘 entry도 지워져야 한다.** 그런데 남았다면 셋 중 하나다:

| 가설 | 확인 방법 |
|---|---|
| **A. 취소 후 다시 예정을 잡았다** | 그 task의 `schedule_entries`와 `cancelled_at` 시각을 비교 |
| **B. 취소 시점에 그날이 이미 `closed`였다** | 그날 `daily.status`. auto-close가 30분마다 도므로 가능하다 |
| **C. `cancelTask`가 `stDeleteOpenEntries`를 안 부른다** | `services/tasks.ts`의 `cancelTask` 본문 |

**실제 데이터로 확인한다:**

```js
// 그 항목의 id를 찾은 뒤
JSON.stringify(await Api.task("<id>"))
```

또는 콘솔에서 `/api/works/scheduled` 응답과 `cancelled_at`을 대조한다.
**T-14 하네스로 폰에서 그대로 뽑을 수 있다** — `node test/device.mjs "..."`.

**증상을 보이는 실제 항목이 있다.** 그것부터 본다. 가설로 코드를 읽지 않는다.

## 고칠 방향 — 원인에 따라 다르다

| 원인 | 고칠 곳 |
|---|---|
| A | **취소된 task에 예정을 못 잡게 한다.** `scheduleTask`에 취소 가드 (`deferTask`엔 이미 있다) |
| B | 취소가 **마감된 날의 entry를 남기는 것은 설계다.** 그러면 Today가 아니라 과거 날짜의 이야기다 — 증상 재확인 |
| C | `cancelTask`가 부르게 한다 |

**어느 쪽이든 `classifyAt`의 분류는 건드리지 않는다.** 거기를 고치면 마감된 날의
`done`/`missed` 계산이 흔들리고, 그 회귀는 달 단위로 늦게 드러난다.

## 범위 — 재현 뒤에 확정한다

원인이 A·C면 `src/services/tasks.ts` + `test/smoke.ts`.
**서버 조회 계층(`db/index.ts`)에 손이 필요하면 멈춰서 보고한다** — 위임 금지에 가깝다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `classifyAt`의 `class` 계산 수정 | 마감된 날의 done/missed가 흔들린다. 회귀가 달 단위로 늦게 보인다 |
| 프런트에서 취소를 걸러 내는 것 | 증상만 가린다. 데이터는 여전히 어긋나 있다 |
| 재현 없이 세 가설 중 하나를 고르는 것 | 엉뚱한 곳을 고치고 증상은 남는다 |
| `0008`의 "마감된 날 항목 보존"을 깨는 것 | 취소는 기록을 지우는 것이 아니다 |

## 읽을 것

- `STATE.md` §설계 정책 — `0008` 취소 도입의 결정 전문
- `src/db/index.ts` `stDeleteOpenEntries`(451행) · `classifyAt`(144행)
- `src/services/tasks.ts` `cancelTask` · `deferTask` · `scheduleTask`
- `migrations/0008_cancel_task.sql` — `v_task_stats.state`와 트리거

## 완료 조건

```
typecheck 통과 · smoke 237 → 240 이상 · front 210(변화 없음) · 실패 0
```

검사에 들어가는 것:

1. **취소하면 오늘·미래 예정이 사라진다** (열린 날)
2. **마감된 날의 항목은 남는다** — `0008`의 보존 규칙
3. 원인이 A였다면: **취소된 task에 예정을 잡으면 409**

**2번을 빠뜨리면 안 된다.** 1번만 지키는 구현은 기록을 지우는 쪽으로 갈 수 있다.

## 확인 절차 (사용자)

deploy 후:

```
□ 증상을 보이던 그 항목이 Today에서 사라졌다
□ 새 할 일을 오늘에 예정 → 취소 → Today에서 사라진다
□ 과거 마감된 날의 취소 항목은 그대로 (취소 배지와 함께)
```

---

## 보고 (담당이 채운다)

```
티켓: T-15
재현 결과: 원인 = B
           Today(귀속일 2026-08-03)의 reassign에 취소된 20260721-002·20260721-004가 실제로 노출됐다.
           20260721-002는 7/22·7/24·7/27 entry가 모두 closed이고 7/31 23:29에 취소됐다.
           20260721-004는 7/22 entry가 closed이고 7/23 23:54에 취소됐다.
           cancelTask는 stDeleteOpenEntries를 호출하고 scheduleTask에는 취소 409 가드가 있어 A·C가 아니다.
바꾼 파일: src/db/index.ts, test/smoke.ts, docs/tickets/T-15-cancelled-in-today.md
전수 판정:
  TaskRow.status — 원시 tasks.status 응답형이고 판정 자리가 아니다 → 그대로 둠.
  DailyRow.status — daily의 open/closed 응답형으로 task 취소 판정과 무관하다 → 그대로 둠.
  todayTodo — 취소 task를 Today Todo에 포함하면 안 된다 → v_task_stats.state='not_finished'로 변경.
  todayDone — finished_on 당일의 실제 완료만 찾고 cancelled는 물리 status가 not_finished라 이미 제외된다 → status 그대로 둠.
  reassignQueue — 취소 task를 재배정 대기에 포함하면 안 된다 → v_task_stats.state='not_finished'로 변경.
  calEntries의 t.status — 과거 일정 표시용 원시값이고 is_cancelled를 별도 투영한다 → status 그대로 둠.
  calDiaryDates의 d.status — 날짜의 open/closed 수명주기 판정이며 task 취소와 무관하다 → status 그대로 둠.
  classifyAt의 t.status='finished' — cancelled는 물리 status가 not_finished라 결과가 같고 과거 done/missed를 보존해야 한다 → 그대로 둠.
  classifyAt의 daily.status — 마감일의 missed 판정이며 task 취소 상태가 아니다 → 그대로 둠.
  stCloseDaily — daily 원시 status를 closed로 바꾸는 UPDATE다 → 그대로 둠.
  openDatesBefore — 열린 daily를 찾는 조건이며 task 취소 상태가 아니다 → 그대로 둠.
  stInsertClosedDaily — daily 원시 status를 생성하는 INSERT다 → 그대로 둠.
  liveEntry의 d.status — 일정이 속한 날의 open/closed를 day_status로 투영한다 → 그대로 둠.
  stFinishTask — tasks 원시 컬럼 조작의 UPDATE WHERE다 → status 그대로 둠.
  stCancelTask — tasks 원시 컬럼 조작의 UPDATE WHERE다 → status 그대로 둠.
  worksScheduled — 취소 task를 예정 목록에 포함하면 안 된다 → v_task_stats.state='not_finished'로 변경.
  worksDone의 t.status='finished' — 완료 branch이고 cancelled는 cancelled_at branch가 명시적으로 담당한다 → 그대로 둠.
  taskEntries의 d.status — 과거 entry의 day_status 표시용이며 task 취소 판정이 아니다 → 그대로 둠.
  closedEntryDates — 보존할 마감일 entry를 찾는 daily 조건이다 → 그대로 둠.
  stDeleteOpenEntries의 d.status — closed entry를 보존하는 경계이고 task 취소 상태가 아니다 → 그대로 둠.
  dailyRange의 d.status — 분석용 날짜 상태 투영이며 task 취소 판정이 아니다 → 그대로 둠.
검사: 검사 추가 뒤 코드 수정 전 smoke 238 통과 · 3 실패(Today Todo·예정 목록·재배정 대기 제외) · 취소 해제 재등장은 통과.
      수정 후 취소 제외 3곳과 취소 해제 재등장까지 모두 통과.
기준선: typecheck 통과 · smoke 237 → 241 · front 210 → 210 · 실패 0
설계와 어긋난 점: 없음
막힌 것: 없음
```

---

## 개정 (Cowork · 08-03) — 범위를 연다 · 전수 조사를 넣는다

**재현이 정확했고, 멈춘 것이 옳았다.** `db/index.ts`에 손이 필요하다는 것을 확인하고
코드를 안 건드린 채 보고했다 — 티켓이 요구한 그대로다.

**내 티켓의 원인 지도가 틀렸다.** B를 "그러면 과거 날짜 이야기지 Today가 아니다"로 처리했는데,
**Today에 뜨는 경로가 `classifyAt`만이 아니었다.** `reassignQueue`(재배정 대기)라는 별개 경로가
있고 거기가 물리 `status`를 본다.

### 이것은 한 자리가 아니다

`0008`이 **"상태의 유일한 진실은 `v_task_stats.state`"** 로 통일했는데,
물리 `status`를 직접 보는 자리가 남아 있다. 확인된 것만 셋:

```
src/db/index.ts:45    todayTodo       t.status = 'not_finished'
src/db/index.ts:61    reassignQueue   s.status = 'not_finished'   ← 확인된 버그
src/db/index.ts:283   (예정 조회)      t.status = 'not_finished'
```

**T-07 → T-12와 같은 패턴이다.** 7/31에 날짜 검사 한 건만 고쳤다가 8/3에 다섯이 터졌다.
**한 자리만 고치면 나머지가 나중에 터진다. 지금 전부 훑는다.**

### 판정 기준 — 하나다

> **이 자리가 cancelled를 포함하면 안 되는가?**

| 예 | `v_task_stats.state`로 바꾼다 |
|---|---|
| **아니오** | `status` 그대로 둔다 |

`status`가 **맞는** 자리(고치지 않는다):

- `stCompleteTask`·`stCancelTask`의 `WHERE ... status = 'not_finished'` — **원시 컬럼 조작**이다.
  `state`는 뷰라 UPDATE의 조건으로 쓸 수 없다
- `classifyAt`의 `t.status = 'finished'` — 취소는 `status='not_finished'`라 **결과가 같다.**
  **과잉 수정 금지** — 바꿔서 얻는 것이 없고 diff만 늘어난다

**각 자리마다 "여기는 왜 이렇게 판정했는가"를 보고에 한 줄씩 쓴다.**

### 범위 (개정)

```
src/db/index.ts        status → state 로 바꿔야 하는 자리들
src/services/tasks.ts  필요하면
test/smoke.ts          검사
```

**위임 금지 영역이지만 이 티켓에 한해 연다.** 근거는 `AGENT-CHAIN.md` §4의 원래 기준 —
"고치는 시간보다 왜 그런지 설명하는 시간이 더 크면 넘기지 않는다". **판정 기준이 위에 한 줄로
있으므로 그 조건이 해소됐다.** 대신 조건 셋:

1. **전수 목록을 먼저 낸다.** `status`를 참조하는 자리 전부와 각각의 판정
2. **판정 기준 밖으로 나가지 않는다.** "이왕이면 이것도" 금지
3. **검토 세션이 자리마다 한 줄씩 대조한다**

### 완료 조건 (개정)

```
typecheck 통과 · smoke 237 → 241 이상 · front 210(변화 없음) · 실패 0
```

검사에 들어가는 것:

1. **취소된 task가 재배정 대기(`reassignQueue`)에 안 뜬다** ← 확인된 버그
2. **마감된 날의 항목은 남는다** — `0008`의 보존 규칙. 이것을 빠뜨리면 기록을 지우는 쪽으로 간다
3. **취소를 해제하면 다시 뜬다** — `state`가 `not_finished`로 돌아오므로.
   이 검사가 "그냥 숨기는 것"과 "state를 보는 것"을 가른다
4. 고친 다른 자리마다 대응 검사

**3번이 이 티켓의 덫이다.** 취소된 것을 빼기만 하는 구현은 3번에서 빨간불이 된다.

### 확인 절차 (사용자) — 개정

```
□ 20260721-002 · 20260721-004 가 Today 재배정에서 사라졌다
□ 그 둘의 취소를 풀면 다시 나타난다
□ 과거 마감된 날의 항목은 그대로 (취소 배지와 함께)
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
재현이 먼저였는가 (가설로 코드를 읽지 않았는가): 통과. 보고에 실제 노출 항목
  20260721-002·20260721-004, 각 closed entry와 취소 시각이 먼저 제시됐고 원인을 B 및
  reassignQueue의 raw status 판정으로 확정한 뒤 수정했다. cancelTask 호출 누락이나 취소 후
  재예정이라는 A·C 가설을 코드만 보고 임의 선택하지 않았다.
classifyAt 의 class 계산을 안 건드렸는가: 통과. T-15 db diff는 todayTodo·reassignQueue·
  worksScheduled의 필터 세 줄만 status→state로 바꾼다. classifyAt의 CASE, 완료 판정
  t.status='finished', daily.status='closed', is_cancelled 투영은 모두 불변이다. stFinishTask와
  stCancelTask의 UPDATE WHERE status='not_finished', stUncancelTask, stDeleteOpenEntries도
  건드리지 않았다.
마감된 날 항목 보존 검사가 있는가: 통과. smoke가 취소 뒤 closed 날짜의 schedule_entry가
  남고 kept_dates에 포함되는지 확인하며, 같은 항목이 classifyAt에서 계속 missed인지도
  확인한다. 별도로 Today Todo·예정 목록·재배정 대기 제외 3건과 취소 해제 후 재등장 1건이 있다.
설계 위반: 발견 없음. src/ 전체의 status 참조를 다시 훑었다. cancelled 포함 여부를 판정하는
  누락은 없으며 todayTodo·reassignQueue·worksScheduled만 canonical v_task_stats.state가
  필요하다. todayDone·worksDone의 task status는 완료 branch, calEntries·TaskRow는 원시값 투영,
  classifyAt은 과거 class 보존, stFinishTask·stCancelTask는 원시 컬럼 UPDATE 조건이다. 나머지는
  daily open/closed 또는 ApiError HTTP status라 task 취소 판정이 아니다. SQL은 db/index.ts 안에
  있고 마이그레이션·트리거·프런트 변경도 T-15에는 없다.
판정: 통과. 정상 구현은 합쳐진 현재 트리에서 typecheck 통과 · smoke 244/0 · front 213/0 ·
  verify exit 0을 재현했다. 검토 중 reassignQueue에 append-only cancelled_by IS NULL을 추가해
  "한 번 취소된 항목을 영구 숨김"으로 변이하자 제외 3건과 마감 보존은 통과한 채 검사 3
  "취소 해제하면 재배정 대기에 다시 등장"만 실패해 smoke 243/1이 됐다. 이후 src/db/index.ts는
  원래 SHA-256 0DA8C1DF0A8DB89FDA2265DA2413624B439ABEDCB28A4293BD7E9874E4B6CE5F로 복원했다.
```
