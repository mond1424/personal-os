# T-14 — 기기 자동화 하네스 (1단계: 앱 콘솔에 명령을 보낸다)

**발행** Cowork · 2026-08-03 · **담당** Codex CLI · **상태** ⬜ 대기

---

## 목표

**PC에서 스크립트로 앱 콘솔의 JS를 실행하고 결과를 JSON으로 받는다.**

```cmd
node test/device.mjs "await Capacitor.Plugins.Guard.state()"
→ {"notifications":true,"fullScreenIntent":true,"overlay":true,...}
```

이것 하나면 된다. **시나리오·검사는 2단계다.**

## 왜

Guard 기기 코드가 셋으로 늘었다 — `GuardWatch`(ADR-025) · `GuardVerify`(T-04) · `GuardRecheck`(ADR-026).
**셋 다 검사가 하나도 없고 실측에만 의존한다.**

그리고 실측에는 세 가지 문제가 있다:

1. **사람이 병목이다.** 매번 폰 앞에 앉아야 하고, 그것 때문에 티켓 넷이 며칠씩 대기했다
2. **재현이 안 된다.** 사용자가 "내가 잘못 이해하고 실행한 부분이 있을 듯"이라고 했다 —
   그게 실측의 본질적 한계다
3. **회귀를 못 잡는다.** 5분을 3분으로, 상한 2를 3으로 바꿔도 아무것도 빨간불이 안 된다

**콘솔에 붙어 명령을 실행하는 것**이 자동화되면 나머지는 따라온다.
그것이 지금 사람이 손으로 하는 일의 대부분이다.

## 방법 — adb + Chrome DevTools Protocol

`capacitor.config.ts`가 `webContentsDebuggingEnabled: true`라 **릴리스 빌드도 CDP로 붙는다**
(그래서 `chrome://inspect`가 되는 것이다). 같은 경로를 스크립트가 쓴다.

```
① adb shell cat /proc/net/unix | grep webview_devtools_remote
     → 앱의 WebView 소켓 이름 (webview_devtools_remote_<pid>)
② adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
③ GET http://localhost:9222/json
     → 타겟 목록에서 webSocketDebuggerUrl
④ WebSocket으로 Runtime.evaluate
     { expression, awaitPromise: true, returnByValue: true }
⑤ 끝나면 adb forward --remove tcp:9222
```

**Node 22의 내장 `WebSocket`을 쓴다** — 의존성을 늘리지 않는다.
`awaitPromise: true`가 핵심이다. 없으면 `await`가 붙은 표현이 Promise 객체로 돌아온다.

## 실패가 이름을 말하게 한다

T-06에서 배운 것 그대로 — **모든 대기에 상한을 두고, 실패는 어디서 막혔는지 말한다.**

| 막힌 곳 | 메시지 |
|---|---|
| `adb` 없음 | 경로와 함께. `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` 안내 |
| 기기 없음 | `adb devices` 출력을 붙인다 |
| WebView 소켓 없음 | **앱이 안 떠 있다.** 앱을 열라고 말한다 |
| CDP 연결 실패 | 포트와 소켓 이름을 붙인다 |
| `Runtime.evaluate` 예외 | JS 예외 메시지를 그대로 |

**어느 단계에도 상한 없는 대기를 두지 않는다.**

## 범위

```
test/device.mjs        (신규) 하네스
package.json           스크립트 한 줄 (선택)
docs/DEVICE-HARNESS.md (신규) 쓰는 법 · 한계
```

**`src/`·`public/`·`android/`를 건드리지 않는다.** 앱은 이미 CDP를 열어 두고 있다.
앱 코드에 손이 필요하면 **멈춰서 보고한다** — 검사를 위해 앱을 고치는 것은 이 프로젝트에서 가장 위험한 방향이다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 앱 코드 수정 | 검사를 위해 앱이 바뀌면 앱이 검사에 맞춰진다 |
| 새 npm 의존성 | Node 22에 `WebSocket`·`fetch`가 있다 |
| `npm run verify`에 편입 | **기기가 없으면 못 돈다.** verify는 기기 없이 돌아야 한다 |
| 상한 없는 대기 | T-06에서 15분 hang을 만든 자리다 |
| 실제 DB·서버를 건드리는 명령을 기본으로 | 하네스는 실행만 한다. 무엇을 실행할지는 호출자가 정한다 |

## 완료 조건

```
typecheck 통과 · smoke 237(변화 없음) · front 210(변화 없음) · 실패 0
```

**검사 숫자는 안 늘어난다** — 하네스는 verify에 편입하지 않는다.

진짜 완료 조건:

```
node test/device.mjs "await Capacitor.Plugins.Guard.state()"
→ notifications·fullScreenIntent·overlay·batteryUnrestricted 가 실린 JSON
```

그리고 **실패 경로를 하나 이상 실제로 태워 본다** — 예를 들어 앱을 완전히 종료하고 돌려
"앱이 안 떠 있다"는 메시지가 나오는지. **진단이 비어 나오면 아무것도 만들지 않은 것이다**
(T-06 3차에서 사본으로 실패 경로를 강제해 확인한 것과 같은 이유).

## 확인 절차 (사용자)

기기를 USB로 연결하고 앱을 연 상태에서:

```cmd
cd C:\dev\personal-os-worker\worker
node test/device.mjs "await Capacitor.Plugins.Guard.state()"
node test/device.mjs "await Capacitor.Plugins.Guard.recheckStatus()"
node test/device.mjs "(await Api.guardEvents())[0].cause"
```

```
□ 셋 다 JSON이 돌아온다
□ 앱을 완전히 종료하고 다시 돌리면 "앱이 안 떠 있다"는 메시지가 나온다
```

---

## 2단계 이후 (이 티켓 아님)

기록만 해 둔다. **지금 하지 않는다.**

- 시나리오 스크립트 — `FIELD-TEST` 절차를 하네스 위에 얹는다
- 시간 의존 항목(재확인 5분·밤 03:00)은 **여전히 실제 시간이 필요하다.**
  다만 사람이 기다릴 필요가 없어진다
- 화면 캡처(`adb exec-out screencap`)로 색 대비를 픽셀로 비교
- Doze는 `dumpsys deviceidle force-idle`로 흉내 낼 수 있으나 **실제와 다를 수 있다** —
  밤 03:00 실측을 대체하지 못한다

---

## 보고 (담당이 채운다)

```
티켓: T-14
바꾼 파일: test/device.mjs, docs/DEVICE-HARNESS.md, docs/tickets/T-14-device-harness.md
기준선: typecheck 통과 · smoke 237 → 237 · front 210 → 210 · 실패 0
실제 실행 결과: {"notifications":true,"fullScreenIntent":true,"overlay":true,"batteryUnrestricted":true,"sdk":36,"manufacturer":"samsung"}
실패 경로 확인: 앱 force-stop 뒤 exit 1 · [device] WebView 소켓 없음 — 앱이 안 떠 있다. Personal OS를 열고 다시 실행하세요. (package=dev.mond1424.personalos)
설계와 어긋난 점: 없음
막힌 것: 없음
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
앱 코드를 안 건드렸는가: 예 — 변경은 test/device.mjs·사용 문서·티켓뿐이다
새 의존성이 없는가: 예 — package.json·package-lock.json 무변경, Node 내장 WebSocket·fetch만 사용
verify에 편입하지 않았는가 (기기 없이 verify가 도는가): 예 — verify 스크립트 무변경, 237/210/0 통과
모든 대기에 상한이 있는가: 예 — adb 5초, CDP HTTP·WebSocket·Runtime.evaluate 5초, 출력 종료 1초 폴백
실패 경로를 실제로 태워 봤는가: 예 — 앱 force-stop 뒤 exit 1과 "앱이 안 떠 있다" 메시지 확인
판정: ✅ 통과 — T-14 하네스 1단계 완료
```
