# Device Harness

USB로 연결된 Android 기기의 Personal OS WebView에 Chrome DevTools Protocol로 붙어
JavaScript 표현식 하나를 실행하고 결과를 JSON으로 돌려준다.

## 준비

- Node.js 22 이상. 별도 npm 의존성은 없다.
- USB 디버깅을 허용한 기기 한 대
- release 앱이 설치되어 있고 화면에 열린 상태
- `adb`가 PATH에 있거나 Android SDK 기본 경로에 설치된 상태
  - Windows: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
  - 또는 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 아래 `platform-tools`

## 실행

저장소 루트에서 표현식을 따옴표로 감싸 실행한다.

```cmd
node test/device.mjs "await Capacitor.Plugins.Guard.state()"
node test/device.mjs "await Capacitor.Plugins.Guard.recheckStatus()"
node test/device.mjs "(await Api.guardEvents())[0].cause"
```

성공하면 stdout에는 결과 JSON 한 줄만 나온다.

```json
{"notifications":true,"fullScreenIntent":true,"overlay":true,"batteryUnrestricted":true}
```

JS 예외는 원래 메시지를 포함해 stderr로 나오며 종료 코드는 1이다.

## 실패 진단

하네스는 다음 단계를 순서대로 확인하며 각 adb·HTTP·WebSocket·평가 대기를 5초 안에 끝낸다.

1. `adb devices`에서 연결된 기기 선택
2. 앱 PID와 `/proc/net/unix`에서 그 앱의 `webview_devtools_remote_<pid>` 소켓 확인
3. `tcp:9222`를 WebView 소켓으로 포워딩
4. `http://127.0.0.1:9222/json`에서 CDP target 확인
5. WebSocket `Runtime.evaluate` 실행 (`awaitPromise: true`, `returnByValue: true`)
6. 성공·실패와 관계없이 `tcp:9222` 포워딩 제거

대표 오류:

- `adb를 찾을 수 없습니다` — 메시지에 나온 SDK 경로 확인
- `기기 없음` — 함께 출력된 `adb devices` 결과 확인
- `WebView 소켓 없음 — 앱이 안 떠 있다` — Personal OS를 열고 재실행
- `CDP 연결 실패 (port=9222, socket=...)` — 포트와 소켓 이름으로 연결 단계 확인
- `Runtime.evaluate 예외: ...` — 표현식의 JS 예외를 그대로 확인

## 한계

- 앱을 자동으로 열지 않는다. 앱 종료 상태는 의도적으로 실패한다.
- 시나리오·단언·화면 캡처는 하지 않는다. 이 파일은 콘솔 명령 전달만 담당한다.
- 실행할 표현식은 호출자가 정한다. 실제 서버나 DB를 바꾸는 표현식을 기본 제공하지 않는다.
- `npm run verify`에는 포함되지 않는다. 기기가 없는 환경의 verify는 계속 독립적으로 돈다.
- 시간 의존 동작과 실제 Doze·밤 03:00 알람을 대체하지 않는다.
