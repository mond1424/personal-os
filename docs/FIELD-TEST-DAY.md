# 낮 실측 — APK 설치 뒤 한 번에

**2026-08-11 설치분**: T-28 · T-29 · T-30 · T-31 · T-34.
`FIELD-TEST-NIGHT.md`의 짝이다 — **밤에만 되는 것은 저쪽, 낮에 되는 것은 여기.**

전체 10분. `chrome://inspect` 콘솔이 필요한 것은 ②부터다.

---

## 순서가 있다

```
① 뒤로가기        앱만        감지 창을 안 건드린다
② 감지 + 개입 초  콘솔        창을 열었다가 ★반드시 되돌린다
③ Level 4         콘솔+앱     ②를 되돌린 뒤에 — 안 그러면 감지가 끼어든다
④ 서버 항         콘솔        ②③이 만든 발동을 읽는다
⑤ outcome 카드    콘솔        ③에 반응을 남겼으면 뜬다
```

**②를 되돌리지 않고 ③으로 가면 안 된다.** 창이 종일로 열려 있어 감지가 낮에도 돈다.

---

## ① 뒤로가기 (T-34) — 앱만

```
□ 시트 열고 뒤로가기        → 시트만 닫힌다 (앱 살아 있음)
□ 시트 둘 겹치고 뒤로가기    → 하나씩 닫힌다
□ 날짜 선택 중 뒤로가기      → 원래 탭으로
□ 캘린더 탭에서 뒤로가기     → Today로
□ Today에서 뒤로가기        → 앱이 닫힌다        ★ 갇히지 않는다
```

**마지막이 이 티켓의 절반이다.** Capacitor는 `backButton` 리스너를 달면 **기본 동작을 끈다** —
`exitApp()`을 안 부르면 앱에 갇힌다. 담당이 그것을 찾아 넣었고, 실물 확인이 남았다.

## ② 감지가 자기 화면을 안 세는가 (T-30) · 개입 초 (T-31)

```js
const G = Capacitor.Plugins.Guard;
await G.setWatch({ enabled: true, bedFrom: "00:00", bedTo: "23:59", minutes: 20 });
await G.watchStatus();          // continuousMin ← 기준값을 적어 둔다
```

```js
await G.testNotify({ level: 3 });
```

**개입 화면이 뜨면 닫지 말고 30초 두었다가** 닫는다.

```js
await G.watchStatus();          // continuousMin
await G.detectStatus();         // snapshot 안에 intervene_sec
```

```
□ 닫은 직후 continuousMin 이 0에 가깝다            ← T-30 고쳐졌다
□ 기준값 + 경과분 그대로면 안 고쳐진 것이다
□ snapshot 에 intervene_sec 이 있고 0이 아니다     ← T-31
□ screen_on_sec 도 그대로 있다                     ← 짝. 기존 항을 안 지웠다
```

화면을 **몇 분 켜 둔 채로** 한 번 더:

```js
await G.watchStatus();
```

```
□ continuousMin 이 다시 오른다   ← 짝의 뒤쪽. 진짜 사용은 안 죽었다
```

**★ 반드시 되돌린다:**

```js
await G.setWatch({ enabled: true, bedFrom: "00:30", bedTo: "06:00", minutes: 20, maxPerNight: 5 });
await G.resetWatchNight();
```

## ③ Level 4 — 기록 (T-28) · 날짜 게이트 (T-29)

**②를 되돌린 뒤에. `level: 4`는 하루 한 번만** — AI 상한이 5회다.

```js
await G.testNotify({ level: 4 });
```

화면을 닫고 **30분 안에**:

```js
await G.level4State();          // { level4: true, until: … }   ← T-28
```

앱에서:

```
□ 캘린더 오늘 칸이 흐려져 있다
□ 오늘에 일정 추가 → 내일로 가고 이유가 뜬다
□ 대기에 담는 것은 그대로 된다        ← 짝. 막지 않았다
□ 미루기로 오늘을 고를 수 없다
□ 개입 화면에서 뒤로가기 → 아무 일도 없다   ← T-34의 반대쪽 경계. 마찰이 살아 있다
```

> **⚠️ 이 뒤 30분간 오늘 날짜가 안 붙는다.** 고장이 아니라 T-29다.
> 급하면 30분을 기다린다 — 창은 마지막 격상 승인 + 30분이다.

## ④ 서버 항 (T-32)

②③이 발동을 몇 개 만들었으니 그것을 읽는다.

```js
(await Api.guardEvents(3)).map(e => [e.fired_at, e.risk_score, e.risk_snapshot])
```

```
□ risk_score 가 숫자다 (NULL 아님)
□ risk_snapshot.server 에 logs_24h · score_last · deadline_min 이 있다
□ 최상위에 screen_on_sec · intervene_sec · top_apps 도 그대로   ← 짝
```

## ⑤ outcome 카드 (T-33)

```js
document.querySelector("#td-guard").dataset.state    // ask | none | error
```

```
□ error 가 아니다        ← error 면 지금까지 침묵하던 회귀다
```

`ask`가 뜨면 카드가 실제로 보이는지, 버튼을 누르면 **다음 것이 이어 뜨는지**까지 본다.

---

## 낮에 확인되지 않는 것

| | 왜 | 어디서 |
|---|---|---|
| `unavailable`의 이유 (T-31 ①) | 낮엔 네트워크가 있어 `approve`·`deny`가 나온다 | 밤 실측 |
| Doze 통과 | 화면이 켜져 있으면 Doze에 안 들어간다 | 밤 실측 |
| `outcome`이 실제로 쌓이는지 | 사람이 눌러야 생긴다 | 9~11월 데이터 |

**첫 줄이 ADR-024 재검토의 재료다.** 그 밤 하나가 있어야 fail-closed를 다시 볼 수 있다.

## 결과를 어디에 적나

`APP-BUILD.md` 결정 기록 — *"확인했다"*가 아니라 **"어느 조건에서 어떻게 됐다"**로.
티켓 다섯의 §확인 절차가 여기로 모였으므로, 통과분은 각 티켓 상태도 함께 닫는다.
