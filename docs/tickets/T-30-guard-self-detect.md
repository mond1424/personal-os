# T-30 — 감지가 Guard 자신의 개입 화면을 세지 않는다

**발행** Cowork · 2026-08-11 · **담당** Claude Code (**위임 금지** — Guard 발동 경로)
**상태** ✅ 합격 (코드 검토, 2026-08-11) · **§확인 절차 실측은 아직이다**

---

## 무엇이 어긋났나

**8/11 밤 실측에서 잡혔다.** 자고 있는데 30분마다 알림이 왔고, 원인이 Guard 자신이다.

```
02:00  protect  L3   ← 개입 화면이 화면을 켜고 켜둔 채 유지한다
02:20  watch:bedtime ← 정확히 20분 뒤 (watchMinutes = 20)
02:30  protect  L3
02:50  watch          ← 이후 30분 간격(REFIRE_MS)
03:20  watch
03:50  watch
```

경로가 코드로 확인된다:

```kotlin
GuardAlertActivity.kt:240   FLAG_TURN_SCREEN_ON     // 화면을 켠다
GuardAlertActivity.kt:244   FLAG_KEEP_SCREEN_ON     // 꺼지지 않게 유지한다
GuardService.kt:64          ACTION_SCREEN_ON → GuardActivityLog.note("screen_on")
GuardActivityLog.kt:67      continuousScreenOnMin — screen_off 가 와야 0으로 끊긴다
```

**Guard가 켠 화면이 사용자의 연속 사용으로 쌓인다.** `KEEP_SCREEN_ON` 때문에 타임아웃으로
꺼지지도 않아 `screen_off`가 오지 않고, 20분 뒤 임계를 넘어 감지가 스스로를 다시 발동시킨다.

8/8·8/9 기록에도 같은 모양이 있다 — **며칠째다.**

## 왜 급한가 — 알림이 아니라 기록이다

```
① 자는 사람을 30분마다 더 깨운다
② guard_events 에 없던 "watch:bedtime" 이 쌓인다
③ risk_snapshot 의 screen_on_min 이 부풀려진다
```

**②가 이 티켓의 이유다.** 기록에는 *"새벽 3시에 20분째 화면을 보고 있었다"*고 남는데
실제로는 자고 있었다. 9~11월이 §6.5의 전례를 쌓는 기간인데 **그 전례가 매일 밤 오염된다.**
T-28이 프롬프트의 거짓을 지웠고, 여기는 **데이터의 거짓**이다. 같은 종류다.

## 할 일 — 표식을 남기고 계산이 구별한다

**`screen_off`를 대신 남기지 않는다.** 화면은 실제로 켜져 있으므로 그건 원본에 거짓을 적는 것이고,
이 티켓이 고치려는 것과 같은 잘못이 된다. **원본에는 사실을 적고, 계산이 가른다.**

`GuardAlertActivity`가 자기 수명을 표본에 남긴다 — 뜰 때와 닫힐 때.

`continuousScreenOnMin`이 그 둘을 이렇게 읽는다:

| 표식 | 연속 시작점 | 왜 |
|---|---|---|
| 개입 화면 뜸 | **0으로 끊는다** | 그때부터는 Guard가 켠 화면이다. 사용자 연속이 아니다 |
| 개입 화면 닫힘 | **그 시각으로 시작** | 화면은 여전히 켜져 있다. **여기서부터가 사용자다** |

**둘이 짝이다.** 앞만 하면 개입 화면이 닫힌 뒤에도 `onAt`이 0이라 **진짜 사용을 영영 못 센다** —
`KEEP_SCREEN_ON`으로 켜진 화면은 `ACTION_SCREEN_ON`이 다시 오지 않기 때문이다.
뒤만 하면 개입이 떠 있는 동안 그대로 쌓인다. **한쪽만 고치면 반대로 샌다.**

**개입 중에 평가를 따로 막지 않아도 된다.** 시작점이 0이면 `usedMin`이 0이라
`evalInner`의 `usedMin < s.watchMinutes`에서 이미 걸린다 — 게이트를 두 벌 두지 않는다.

## 진짜 발동은 죽지 않는다

개입을 닫고 **사용자가 실제로 20분을 더 쓰면 감지는 그대로 걸린다.** 연속이 0에서 다시
세어질 뿐이다. 이 티켓은 **없던 것을 없애고, 있던 것은 남긴다.**

## 범위

```
android/.../guard/GuardAlertActivity.kt   뜰 때·닫힐 때 표식
android/.../guard/GuardActivityLog.kt     continuousScreenOnMin 이 표식을 읽는다
```

**서버·프런트·마이그레이션 무변경.** `GuardWatch`의 규칙(창·임계·상한·REFIRE)은 손대지 않는다 —
규칙이 아니라 **규칙이 읽는 값**이 틀렸다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `screen_off`를 대신 기록 | 화면은 켜져 있다. 원본에 거짓을 적는 것 — 이 티켓이 고치는 잘못 그 자체 |
| `FLAG_KEEP_SCREEN_ON` 제거 | 개입 화면은 대기 동안 살아 있어야 한다(마찰 60/180초) |
| `GuardWatch`의 임계·창·상한 조정 | 규칙은 옳다. 입력이 틀렸다 |
| 개입 중 평가를 따로 막는 게이트 추가 | 시작점이 0이면 이미 걸린다. 두 벌 두면 갈라진다 |
| `live` 참조로 판정 | ADR-035 ③ — 정상 경로로 나오면 이미 null이다 |

## 완료 조건

```
typecheck 통과 · smoke 283(변화 없음) · front 271(변화 없음) · 실패 0
Kotlin 빌드 통과
```

**이 층에 Kotlin 러너가 없다 — 감추지 않는다.** 근거는 코드 읽기와 빌드까지이고,
**실검사는 아래 §확인 절차다.** 낮에 2분이면 답이 나오므로 밤을 기다리지 않는다.

## 확인 절차 (사용자) — 낮에, 2분

APK 재빌드·설치 후. `chrome://inspect` 콘솔:

```js
const G = Capacitor.Plugins.Guard;
await G.setWatch({ enabled: true, bedFrom: "00:00", bedTo: "23:59", minutes: 20 });  // 창을 지금으로
await G.watchStatus();        // continuousMin 을 적어 둔다  ← 기준값
await G.testNotify({ level: 3 });
```

개입 화면이 뜨면 **닫지 말고 30초 두었다가** 닫는다. 그다음:

```js
await G.watchStatus();        // continuousMin
```

```
□ 개입 화면을 닫은 직후 continuousMin 이 0에 가깝다   ← 고쳐졌다
□ 기준값 + 경과분 그대로면 안 고쳐진 것이다
□ 그 뒤 화면을 계속 켜 두면 continuousMin 이 다시 오른다   ← 진짜는 살아 있다
```

**세 번째가 짝이다.** 첫 둘만 보면 *"아무것도 안 센다"*로 고쳐도 통과한다.

끝나면 되돌린다:

```js
await G.setWatch({ enabled: true, bedFrom: "00:30", bedTo: "06:00", minutes: 20, maxPerNight: 5 });
await G.resetWatchNight();
```

---

## 보고 (담당이 채운다)

```
티켓: T-30
바꾼 파일: android/.../guard/GuardAlertActivity.kt (표식 둘)
          · android/.../guard/GuardActivityLog.kt (continuousScreenOnMin)
기준선: typecheck 통과 · smoke 283 (변화 없음) · front 271 (변화 없음) · 실패 0 · verify exit 0
       Kotlin: assembleRelease BUILD SUCCESSFUL
       · [signing] SHA-256=C1:D8:…:10:A6 (T-13 기록과 일치)
```

서버·프런트·마이그레이션 무변경. `GuardWatch`의 창·임계·상한·`REFIRE_MS` 무변경 —
**규칙은 옳고 규칙이 읽는 값이 틀렸다.**

### 표식을 어디에 남겼나 · 순서 경합이 결과를 바꾸는가

```kotlin
onCreate  : GuardActivityLog.note(this, "intervene_on",  null)   // showOverLockScreen() 앞
onDestroy : GuardActivityLog.note(this, "intervene_off", null)
```

**`onCreate`의 표식은 `showOverLockScreen()`보다 앞에 뒀다.** 그쪽의 `FLAG_TURN_SCREEN_ON`이
`ACTION_SCREEN_ON`을 부르고, `GuardService`가 그걸 받아 `screen_on`을 남기기 때문이다.

**순서 경합은 실재한다 — 그리고 나쁜 쪽이 유력했다.** 화면 켜기는 윈도 부착 시점이라
`onCreate` **뒤**에 일어나므로 브로드캐스트도 뒤에 온다. 표식만 남기고 계산이 순진하면:

```
intervene_on (onAt=0) → screen_on (onAt=t) → ... 개입 중인데 연속이 다시 쌓인다
```

**그래서 계산에 구간 플래그를 뒀다** — 표식 순서에 의존하지 않는다:

```kotlin
var intervening = false
"screen_on"     -> if (!intervening && onAt == 0L) onAt = at
"screen_off"    -> onAt = 0L
"intervene_on"  -> { intervening = true;  onAt = 0L }
"intervene_off" -> { intervening = false; onAt = at }
```

이 플래그가 **전원 버튼 경로도 함께 맞춘다.** 개입 중 전원을 누르면
`screen_off` → (돌아와서) `screen_on` 순인데, 그 `screen_on`은 개입 구간이라 무시된다.
그래서 닫는 시점의 `intervene_off`가 시작점이 되고 — 그때는 사용자가 실제로 켜서
반응한 것이 맞다. (소리는 전원 버튼으로 안 멎는다 — `onPause`에서 안 멈추는 그 설계.)

### 닫힌 뒤 진짜 사용이 다시 세어지는가

**세어진다. 그게 짝의 뒤쪽이다.** `intervene_off`가 `onAt`을 **닫은 시각으로 시작**시킨다.

앞만 고쳤다면 여기서 죽었다 — `FLAG_KEEP_SCREEN_ON`으로 켜진 화면에는
`ACTION_SCREEN_ON`이 **다시 오지 않으므로** `onAt`이 0에 붙박이고, 사용자가 그 뒤로
몇 시간을 써도 `continuousScreenOnMin`이 0이다. **감지가 통째로 죽는다.**
§확인 절차 3번이 그것을 보는 자리다.

### 설계와 어긋난 점

없다. **원본에는 사실만 적었다** — `screen_off`를 대신 남기지 않았고, 화면이 실제로
켜져 있다는 사실은 표본에 그대로다. 가르는 일은 전부 계산에서 한다.
개입 중 평가를 막는 별도 게이트도 두지 않았다 — 시작점이 0이면 `usedMin`이 0이라
`evalInner`의 `usedMin < s.watchMinutes`에서 이미 걸린다.

⚠️ **범위 밖 관찰 하나 (Cowork 판단).** §왜 급한가 ③이 *"`risk_snapshot`의
`screen_on_min`이 부풀려진다"*고 적었는데, **그 필드는 부풀려진 것이 아니다** —
이름 그대로 `screen_on_sec`이고 개입 중에도 화면은 **실제로** 켜져 있었다.
문제는 값이 아니라 **나중에 그 둘을 가를 수 없다**는 것이고, 이제 `intervene_on/off`
표본이 버퍼에 있으므로 `recent()`로는 가를 수 있다. 다만 `snapshot()`은 그걸 요약하지 않는다.
**요약에 항을 더하는 것은 `risk_snapshot` JSON 모양을 바꾸는 일**이라(9~11월 전례가 그걸 읽는다)
이 티켓에서 하지 않았다. 필요하면 별건이다.

### 막힌 것

**Kotlin 러너가 없다 — 감추지 않는다.** 근거는 코드 읽기와 빌드 통과까지다.
`continuousScreenOnMin`은 순수 함수에 가까운데(입력이 prefs의 JSON 배열) **검사할 자리가 없다.**
smoke·front는 Worker와 웹만 태운다. **실검사는 §확인 절차이고 낮에 2분이면 답이 나온다.**

⚠️ **`onDestroy`가 안 불리면 `intervening`이 끝까지 참으로 남아 감지가 0을 준다.**
프로세스가 강제 종료되는 경우다. **다음 개입이 정상으로 닫히면 스스로 회복되고**
(마지막 `intervene_off`가 플래그를 내린다) 링 버퍼(300)에서도 결국 밀려난다.
시간 상한을 두어 막을 수 있지만 그건 §금지의 "게이트를 두 벌 두지 않는다"에 걸리고,
경로 B는 보조 입력이다(ADR-018·021) — **알고 남긴다.**

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

**검토 · 2026-08-11 · 합격 (수정 없음) · 근거는 `bb109ff` diff와 현재 코드**

```
원본에 거짓을 적지 않았나 (screen_off 대체가 아닌가):
  ✅ note() 호출 둘 다 새 kind다 — "intervene_on"/"intervene_off".
     screen_off를 부르는 자리는 GuardService.kt:67 하나 그대로(ACTION_SCREEN_OFF).
짝 둘이 다 있는가 (뜰 때 0 · 닫힐 때 재시작):
  ✅ GuardAlertActivity.kt:94(onCreate) · :284(onDestroy).
     계산은 GuardActivityLog.kt:87 `onAt = 0L` · :91 `onAt = o.optLong("at")`.
GuardWatch 규칙이 무변경인가:
  ✅ 커밋이 건드린 코드는 .kt 둘뿐(+STATE.md·티켓). GuardWatch.kt에 `intervene` 0건.
     REFIRE_MS 30분(:26) · watchMinutes 임계(:60) · l2done 상한(:68) 그대로.
게이트가 두 벌이 되지 않았나:
  ✅ 게이트는 GuardWatch.kt:60 `usedMin < s.watchMinutes` 하나뿐이다.
     개입 중을 따로 보는 분기가 evalInner에 없다 — 값만 0이 되어 그 한 줄에 걸린다.
설계 위반 · 함정 재발:
  없음. Kotlin 둘만 바뀌어 프런트 함정(scrollIntoView·전역 클래스명·색 리터럴·booted)과
  겹치는 면이 없고, 파생 물화·SQL 위치·귀속일 어느 것도 건드리지 않았다.
판정:
  ✅ 합격 — 다만 **숫자가 이 티켓을 지키지 못한다**(아래). 실측이 남았다.
```

### 숫자가 이 티켓을 지키지 못한다 — 그래서 §확인 절차가 검사다

HANDOFF-0731 §2의 3번은 *"구현을 잘못했다면 이 검사가 빨간불이 되는가"*다.
**여기서는 그 답이 '아니다'이고, 보고가 그것을 감추지 않았다.**

`smoke 283 · front 271 무변경`은 통과가 아니라 **이 티켓이 태울 검사가 없다는 뜻**이다.
`continuousScreenOnMin`은 순수 함수에 가까운데(입력이 prefs의 JSON 배열) 이 층에
Kotlin 러너가 없고, smoke·front는 Worker와 웹만 태운다. **틀린 구현도 283/271이 나온다.**

그래서 **§확인 절차 3번이 이 티켓의 유일한 변이 검사다.** 앞의 둘(닫은 뒤 0에 가깝다)만
보면 *"아무것도 안 센다"*로 고쳐도 통과하고, 그 고침은 **감지를 통째로 죽인다**.
티켓이 그 짝을 미리 박아 둔 것이 맞았다. **APK 설치 → 낮 2분이 남은 관문이다.**

### 순서 경합 — 보고의 진단을 코드에서 확인했다

표식만 남기고 계산이 순진했다면 실제로 샜다. 화면 켜기는 윈도 부착 시점이라
`ACTION_SCREEN_ON` → `GuardService.kt:64`의 `screen_on`이 `onCreate`의 `intervene_on`
**뒤에** 온다. 구간 플래그(`intervening`)가 `GuardActivityLog.kt:84`에서
`if (!intervening && onAt == 0L)`로 그 표본을 삼키므로 **표식 순서에 의존하지 않는다.**

같은 플래그가 **세 번째 경로도 함께 맞춘다**: 개입 중 서비스가 재시작되면
`GuardService.kt:119`의 부트스트랩이 `screen_on`을 한 번 더 남기는데, 그것도 개입 구간이라
무시된다. 보고는 전원 버튼 경로만 적었는데 **실제로는 `screen_on`을 남기는 세 자리가 전부 덮인다.**

### `onDestroy` 미호출 — 알고 남긴 것에 동의한다

강제 종료로 `intervening`이 참에 남으면 감지가 0을 준다(보고 §막힌 것).
**시간 상한을 두지 않은 판단이 맞다** — §금지의 "게이트를 두 벌 두지 않는다"에 걸리고,
경로 B는 보조 입력이다(ADR-018·021). 회복 경로도 실재한다: 다음 개입이 정상으로 닫히면
`intervene_off`가 플래그를 내리고, 링 버퍼(MAX=300)에서도 결국 밀려난다.
**방향이 안전한 쪽이다** — 고장 나면 덜 개입한다(ADR-024와 같은 방향).

### 범위 밖 관찰은 옳았고, T-31이 받는다

보고가 §왜 급한가 ③(*"`screen_on_min`이 부풀려진다"*)을 **발행자의 오류로 짚었고 그것이 맞다.**
그 필드는 `snapshot()`의 `screen_on_sec`이고 개입 중에도 화면은 실제로 켜져 있었다.
`snapshot()`이 `intervene_*`를 요약하지 않는 것은 **이 티켓의 결함이 아니다** — 범위가
`continuousScreenOnMin`이었다. **T-31 ②가 그 자리를 받는다.**
