# T-31 — 9~11월이 읽을 것을 지금 늘린다

**발행** Cowork · 2026-08-11 · **담당** Claude Code
**상태** 🟡 구현·보고 완료 (2026-08-11) · **검토 대기** · ⚠️ **티켓 전제 정정 있음** (§보고 첫 절)

---

## 왜 지금인가

**9월 1일부터 §6.5의 전례가 쌓인다.** 그때 없던 항은 12월에 만들 수 없다 —
과거 `guard_events`에 소급되지 않기 때문이다. **관측을 늘릴 마지막 기회가 8월이다.**

8/11 밤 실측이 **읽을 수 없는 자리 둘**을 드러냈다. 둘 다 값이 틀린 것이 아니라
**나중에 가를 수 없다**는 문제다.

## ① `unavailable`이 이유를 말하지 않는다

여섯 후보 중 넷이 `unavailable`이었다(02:30·03:00·03:30·04:00).
지금 기록은 **"부를 수 없었다"까지**이고, 왜 못 불렀는지가 없다:

```
Doze가 네트워크를 끊었나
Wi-Fi 절전이 껐나
앱 대기 버킷(App Standby)이 막았나
서버가 늦었나
```

**셋의 대응이 완전히 다르다.** 구분이 없으면 ADR-024를 재검토할 재료가 없고,
지금 ADR을 쓰면 원인을 모르고 자리를 정하는 것이 된다.

**형태는 접두사를 유지한다:**

```
"unavailable"            지금까지 (과거 행)
"unavailable:timeout"    새로
"unavailable:dns"
"unavailable:http_503"
```

**`ai_verdict`의 타입을 넓혀야 한다**(`db/index.ts:567`). 캐시는 안 건드린다 —
`ai_verdict IN ('approve','deny')`(`db/index.ts:655`)라 `unavailable*`은 애초에 안 걸린다.

> **읽는 쪽은 접두사로 본다.** `=== "unavailable"`로 비교하는 자리가 생기면
> 이유가 붙는 순간 조용히 어긋난다. 지금 그런 자리는 없고, **없다는 것을 확인하고 넓힌다.**

## ② `risk_snapshot`이 개입 구간을 가르지 못한다

**T-30 보고가 발행자의 오류를 짚었고, 그것이 맞다.** T-30 §왜 급한가 ③이
*"`screen_on_min`이 부풀려진다"*고 썼는데 **부풀려진 것이 아니다** —
개입 중에도 화면은 실제로 켜져 있었고 `screen_on_sec`은 이름 그대로다.

**진짜 문제는 그 초가 누구 것인지 모른다는 것이다.** 12월에 §6.5가
*"이 사람은 개입 뒤에도 화면을 오래 켜 둔다"*를 읽으면, 그게 사용자인지
`FLAG_KEEP_SCREEN_ON`인지 구별할 수 없다.

T-30이 `intervene_on`·`intervene_off` 표본을 버퍼에 남겼으므로 **`recent()`로는 갈린다.**
그러나 `snapshot()`은 요약하지 않고, **서버로 올라가는 것은 `snapshot()`뿐이다.**

```
snapshot() 에 개입 구간 초를 항으로 더한다
```

**기존 항을 건드리지 않는다.** `screen_on_sec`은 그대로 두고 옆에 놓는다 —
읽는 쪽이 빼면 되고, 과거 스냅샷엔 그 키가 없어 `undefined`가 *"모른다"*로 읽힌다.
**빼서 저장하지 않는다**: 파생을 물화하는 것이고(원칙 1), 이름과 뜻이 갈라진다.

> **JSON에 키를 더하는 것이 왜 지금 안전한가.** T-30 보고가 *"9~11월 전례가 그걸 읽는다"*고
> 걱정했는데, **지금은 8월이다.** 9월 전에 넣으면 전례 기간 내내 일관되고,
> 안 넣으면 9~11월 데이터에 그 항이 영영 없다. **미루는 쪽이 되돌릴 수 없다.**

## 범위

```
android/.../guard/GuardVerify.kt        예외 종류 → unavailable:<이유>
android/.../guard/GuardActivityLog.kt   snapshot() 에 개입 구간 항
src/db/index.ts                         ai_verdict 타입을 넓힌다
test/smoke.ts                           검사
```

**마이그레이션 없다** — `ai_verdict`는 문자열이고 값만 늘어난다.
**프런트 무변경. `GuardWatch`·발동 순서·캐시 조건 무변경.**

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 캐시 조건(`IN ('approve','deny')`)에 손대기 | `unavailable`은 판정이 아니다. 지금이 옳다 |
| `screen_on_sec`의 뜻을 바꾸기 | 과거 데이터와 갈라진다. **더하고, 빼지 않는다** |
| 개입 구간을 뺀 값을 저장 | 파생을 물화하지 않는다(원칙 1). 읽는 쪽이 뺀다 |
| 이유 문자열을 자유롭게 늘리기 | 12월에 세어야 한다. **닫힌 목록**을 정하고 그것만 쓴다 |
| `unavailable` 접두사를 버리기 | 과거 행과 새 행이 같은 부류로 읽혀야 한다 |
| 발동·격상 순서 수정 | ADR-024. 이 티켓은 **기록만** 늘린다 |

## 완료 조건

```
typecheck 통과 · smoke 283 → 285 이상 · front 271(변화 없음) · 실패 0
Kotlin 빌드 통과
```

검사:

1. `ai_verdict`가 `unavailable:*`인 행이 **캐시에 잡히지 않는다** — `IN` 조건이 그대로임을 보인다
2. **양성 대조** — `approve`·`deny`는 여전히 캐시에 잡힌다
   (1번만 보면 캐시가 통째로 죽어도 초록이다 — AGENT-CHAIN §5)
3. 이유 문자열이 **닫힌 목록 안**이다 — 목록을 대장으로 둔다

**Kotlin 쪽은 검사가 없다 — 감추지 않는다.** `snapshot()`의 새 항은 아래 §확인 절차가 본다.

## 확인 절차 (사용자) — 낮에

APK 설치 후. `chrome://inspect` 콘솔:

```js
const G = Capacitor.Plugins.Guard;
await G.testNotify({ level: 3 });     // 개입 화면 → 30초 두었다가 닫기
await G.detectStatus();               // snapshot 에 개입 구간 항이 보인다
```

```
□ snapshot 에 개입 구간 항이 있고 0이 아니다
□ screen_on_sec 은 그대로 있다 (없어지지 않았다)
```

**두 번째가 짝이다.** 새 항만 보면 기존 항을 지워도 통과한다.

`unavailable`의 이유는 **다음 밤이 답한다** — 비행기 모드로 흉내 낼 수 있지만
그건 `timeout`이 아니라 즉시 실패라 새벽 조건과 다르다. 흉내로 결론 내지 않는다.

---

## 보고 (담당이 채운다)

```
티켓: T-31
바꾼 파일: migrations/0016_guard_unavailable_reason.sql (신규 — 티켓 전제와 다르다, 아래)
          · src/db/index.ts (GuardEventRow · stInsertGuardEvent)
          · src/services/guard.ts (UNAVAILABLE_REASONS 대장 · 정규화)
          · android/.../guard/GuardVerify.kt (Reason · Attempt · post()가 예외 종류를 남긴다)
          · android/.../guard/GuardActivityLog.kt (snapshot()에 intervene_sec)
          · test/smoke.ts (스키마 목록 + 검사 10건)
          · [범위 밖 둘] android/.../guard/GuardNotifications.kt · GuardEventQueue.kt — 배선. 아래 §설계
          · docs/schema-current.sql 재덤프 · docs/api-surface.md 갱신
기준선: typecheck 통과 · smoke 283 → 293 · front 271 (변화 없음) · 실패 0 · verify exit 0
       Kotlin: assembleRelease BUILD SUCCESSFUL
       · [signing] SHA-256=C1:D8:…:10:A6 (T-13 기록과 일치)
       마이그레이션: 0016 --local 적용 완료 · --remote는 배포와 함께 사용자 몫
```

### ★ 티켓의 전제가 틀렸다 — 그대로 짜면 **기록이 사라진다**

티켓은 *"**마이그레이션 없다** — `ai_verdict`는 문자열이고 값만 늘어난다"*고 적었는데
**문자열이 아니라 닫힌 CHECK다**(`migrations/0010_guard.sql:41`):

```sql
ai_verdict      TEXT CHECK (ai_verdict IN ('approve','deny','unavailable')),
```

`unavailable:timeout`을 넣으면 이렇게 간다:

```
CHECK 위반 → translateDbError의 /constraint failed/ → 400 (src/index.ts:51)
          → GuardEventQueue.flush()가 400을 '재시도 무의미'로 보고 큐에서 버린다 (:142)
          → 그 발동 행이 서버에 영영 안 올라간다
```

**이유를 잃는 게 아니라 발동 행 자체가 사라진다.** 그것도 네트워크가 나쁜 밤에만 —
즉 **이 티켓이 관측하려는 바로 그 밤에만**. 전례를 늘리려던 티켓이 전례를 지운다.

그래서 **더하고, 빼지 않는 쪽으로 갔다**(사용자 결정): `ai_verdict`는 계속 `'unavailable'`이고
이유는 새 칼럼 `ai_unavailable_reason`에 놓는다. `ALTER TABLE ADD COLUMN` 한 줄이라
**개입 이력 테이블을 재작성하지 않는다** — CHECK를 넓히는 쪽은 SQLite에서 테이블 전체 재작성이고,
트리거 넷·인덱스 넷을 다시 세우며 영구 보존 원장을 통째로 옮겨야 한다.

**이 형태가 티켓의 §금지를 하나도 어기지 않는다.** 접두사를 버리기는커녕 값이 **글자 그대로**
그대로다. 오히려 티켓이 걱정한 *"`=== "unavailable"`로 비교하는 자리가 생기면 조용히 어긋난다"*가
**아예 성립하지 않게 된다** — 모양이 안 변하기 때문이다. §②가 택한 논리("기존 항을 건드리지
않는다 · 과거엔 그 키가 없어 '모른다'로 읽힌다")를 ①에도 그대로 적용한 것이다.

### 이유의 닫힌 목록을 무엇으로 정했나

**8월 실측이 세운 가설 넷에 대응시켰다** — 티켓 §①이 나열한 Doze · Wi-Fi 절전 · 앱 대기 버킷 ·
서버 지연. 기기가 실제로 구별할 수 있는 것은 **예외의 종류**이므로 거기서 잘랐다:

| 이유 | 언제 | 왜 따로 세는가 |
|---|---|---|
| `timeout` | 6초 안에 응답 없음 (`SocketTimeoutException`) | **Doze가 가장 유력한 자리다** |
| `dns` | 이름 못 풀음 (`UnknownHostException`) | 네트워크가 통째로 내려간 쪽 |
| `network` | 그 밖 연결 실패 | 더 잘게 안 가른다 — 실제로 뭐가 오는지는 9~11월이 말한다 |
| `bad_response` | 2xx인데 본문이 판정이 아님 | 통신은 됐다 — network와 섞으면 오진한다 |
| `no_base` | 서버 주소 미설정 | 네트워크를 타 보지도 않았다 |
| `server_timeout` | `source=timeout` | **기기 6초와 서버 8초는 다른 사건이다** |
| `server_error` | `source=error` | 서버는 답했다 |
| `cap` | `source=cap` | 못 부른 게 아니라 **안 부른 것**이다 |
| `http_NNN` | 2xx 아닌 응답 | 401(토큰 만료)과 503(과부하)의 대응이 다르다 |

**`timeout`과 `server_timeout`을 가른 것이 이 목록의 핵심이다.** 티켓의 네 가설 중
*"서버가 늦었나"*와 *"Doze가 끊었나"*가 바로 이 둘이고, 한 이름으로 세면 12월에 못 가른다.

**대장은 `src/services/guard.ts`의 `UNAVAILABLE_REASONS` 하나다.** `0016`의 CHECK와
`GuardVerify.kt`의 `object Reason`은 그 메아리이고, **셋이 갈라지면 smoke가 빨간불이 된다.**
두 곳에 두면 갈라진다는 것을 이 리포가 기준선 숫자로 두 번 물렸다.

### `=== "unavailable"`로 비교하는 자리가 정말 없었나 (전수)

**없다.** `worker/` 전체(`node_modules` 제외)에서 `unavailable`을 훑었다.
만드는 곳 둘 · 읽고 **비교**하는 곳 **0**:

```
만든다  GuardVerify.kt:53              source가 cap·timeout·error일 때
        GuardNotifications.kt:246      판정을 아예 못 받았을 때 (v == null)
비교한다 ─ 없음
```

가장 가까운 자리가 `services/guard.ts:392`의 `hit.ai_verdict === "approve"`인데
**`approve`를 보지 `unavailable`을 보지 않는다.** `db/index.ts:656·659`의 캐시 조건도
`IN ('approve','deny')`라 배제 쪽이다. `public/`에는 한 건도 없다.

**그리고 이제 이 질문 자체가 무의미해졌다** — 값의 모양을 안 바꿨으므로
설령 그런 자리가 생겨도 어긋날 수 없다.

### `snapshot()`에 더한 항 · 기존 항 무변경 확인

```
+ intervene_sec     창 안에서 개입 화면이 켜 둔 초
  screen_on_sec     그대로 — intervene_sec을 포함한 채다
```

**빼서 저장하지 않았다.** 파생을 물화하지 않고(원칙 1) 읽는 쪽이 뺀다.
smoke가 `screenOnMs -=` 같은 감산 자리가 없는 것까지 본다.

**창 필터보다 앞에서 읽는다.** 개입은 창 밖에서 시작해 창 안까지 이어질 수 있고 —
소리는 3분에 멎지만 화면은 `KEEP_SCREEN_ON`으로 남는다 — **그게 T-30이 잡은 그 밤이다.**
기존 `screen_on` 처리와 같은 자리에 두면 그 구간이 통째로 0으로 읽혀
**가장 필요한 경우에만 못 가른다.** 아직 안 닫힌 개입은 `now`까지로 센다.

### 검사가 실제로 빨간불이 되는가 — 변이 다섯, 겹침 0

**첫 변이가 내 검사를 떨어뜨렸다.** 캐시 검사를 처음엔 `deny` 위에 `unavailable`을 얹는
모양으로 짰는데, `IN`을 지워도 **293/0 그대로였다** — `guard.ts:392`가 `=== "approve"`만 보므로
캐시가 `unavailable`을 집어도 **결과가 `deny`와 글자 그대로 같다.** 숫자만 올린 검사였다.
`approve`를 깔고 그 위에 얹는 모양으로 고쳐 감도를 만들었다.

| 변이 | 결과 | 빨간불이 된 검사 |
|---|---|---|
| 캐시의 `IN ('approve','deny')` → `IS NOT NULL` | **292/1** | unavailable이 캐시에 안 잡힌다 |
| Kotlin 이유 하나를 바꾼다 (`dns`→`dns_fail`) | **292/1** | 대장 셋 일치 |
| `screen_on_sec`을 지우고 새 항만 남긴다 | **292/1** | snapshot 짝 |
| 목록 밖 이유에 400을 던진다 | **291/2** | 행 생존 + http 모양 |
| 0016 스캐너를 죽인다 (정규식이 `[]`) | **292/1** | 대장 셋 일치 |

**마지막이 T-26의 교훈 자리다** — 기대값이 비어 있지 않으므로 스캐너가 죽으면 그 자체로
빨간불이다. `'0건'`으로 짰으면 못 찾을 때도 초록이었다.

**네 번째가 이 티켓의 안전장치를 지킨다.** 목록 밖 이유에 400을 던지면 CHECK에 걸리는 것과
결과가 같아진다 — `flush()`가 발동 행을 버린다. 그래서 서버는 **이유만 비우고 행은 살린다.**
구버전 서버 + 신버전 APK가 실제로 그 자리다.

### 설계와 어긋난 점

**범위 밖 파일 둘을 건드렸다 — Cowork 확인 필요.**

```
GuardNotifications.kt   verify() → attempt()  (이유를 받아 amendFire에 넘긴다)
GuardEventQueue.kt      amendFire에 unavailableReason 파라미터 (기본값 null)
```

**티켓의 §범위가 `GuardVerify.kt`만 적었는데 거기서는 기록에 닿을 수 없다.**
이유를 만드는 곳은 `GuardVerify`가 맞지만, `ai_verdict`를 실제로 **싣는 자리**는
`GuardNotifications.kt:246`이고(판정을 못 받은 경우의 `"unavailable"` 폴백이 거기 있다)
페이로드를 만드는 곳은 `GuardEventQueue.amendFire`다. 셋을 잇지 않으면
이유가 계산만 되고 **아무 데도 안 남는다** — 티켓의 목적이 통째로 빈다.
티켓의 누락으로 판단하고 이었다(T-03이 `me.ts` 한 줄을 그렇게 처리한 전례).

**발동·격상 순서는 손대지 않았다**(§금지). `attempt()`는 `verify()`가 하던 일을 그대로 하고
`verify()`는 그 얇은 겉면으로 남겼다 — fail-closed도 6초도 캐시 조건도 무변경이다.
**늘어난 것은 기록뿐이다.**

**`GuardPlugin.verifyNow`는 안 건드렸다.** 진단용이고 `reached:false`만 돌려주는데
이유를 붙이면 유용하겠지만 범위를 더 넓히지 않았다 — 필요하면 별건이다.

### 막힌 것

**`--remote` 마이그레이션과 배포는 사용자 몫이다.** `--local`만 적용했다.
**순서가 강제된다 — 마이그레이션이 배포보다, 배포가 APK보다 먼저다.**
칼럼이 없는 서버에 신버전 APK가 `ai_unavailable_reason`을 보내면 그 키는 무시되지만
(모르는 필드다) 이유가 그냥 사라진다. 반대 순서는 안전하다.

**Kotlin 러너가 없다 — 감추지 않는다.** `Reason`과 `snapshot()`은 smoke가 **소스를 읽어서**
확인한 것이지 실행한 것이 아니다. 예외 → 이유 매핑이 실제로 맞는지는 코드 읽기와 빌드까지다.
**실검사는 §확인 절차이고, `unavailable`의 이유는 티켓 말대로 다음 밤이 답한다.**

⚠️ **`network`가 뭉뚱그려질 것이다.** `SocketTimeout`·`UnknownHost` 밖은 전부 여기로 간다.
9~11월 기록에서 이 항이 크면 그때 갈라야 하는데, **그러려면 목록을 늘려야 하고
그건 0016 CHECK·TS 대장·Kotlin 셋을 함께 고치는 일이다.** 지금 미리 쪼개면 12월에
쓰이지 않을 이름이 목록에 남는다 — **실측이 답하기 전에는 안 늘린다.**

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
접두사가 유지되는가 (과거 행과 같은 부류로 읽히는가):
캐시 조건이 무변경인가 · 양성 대조가 있는가:
screen_on_sec 이 그대로인가 (더하고 빼지 않았는가):
이유가 닫힌 목록인가:
설계 위반 · 함정 재발:
판정:
```
