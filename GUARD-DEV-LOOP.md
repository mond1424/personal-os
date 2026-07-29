# Guard 개발 루프 — 매 업데이트마다 이대로

## 원칙: 릴리스 빌드 하나만 쓴다

**`npx cap run android`를 쓰지 않는다.** 디버그 빌드는 서명이 달라 릴리스 앱을 덮어쓸 수 없고,
Android가 삭제 후 재설치를 강제한다. 그때 **권한과 예약 원본이 통째로 날아간다.**

`capacitor.config.ts`의 `webContentsDebuggingEnabled: true` 덕분에 릴리스 빌드도
`chrome://inspect`로 붙는다. 디버그 빌드가 필요 없다.

---

## 1. 빌드 · 설치

```cmd
cd C:\dev\personal-os-worker\worker
npx cap sync android
cd android
gradlew assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

`-r`이 핵심이다 — 같은 서명이면 **데이터를 유지한 채** 교체된다.
`adb`가 PATH에 없으면 `"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"`.

> 웹(`public/`)만 고쳤으면 빌드가 필요 없다. `npm run deploy`만 하고 앱을 껐다 켠다.

## 2. 앱 한 번 열기

채널 생성·예약 복구(`GuardAlarms.restoreAll`)가 앱 시작 시 돈다.

## 3. 권한 확인 — `chrome://inspect` 콘솔

```js
const G = Capacitor.Plugins.Guard;
await G.state();
```

`notifications` · `overlay` · `batteryUnrestricted` 중 `false`가 있으면:

```js
await G.requestNotifications();   // 알림 권한 팝업
await G.openOverlaySettings();    // '다른 앱 위에 표시' 허용
await G.openBatterySettings();    // 예/아니오 다이얼로그
```

각각 폰에서 허용 → 앱 복귀 → `await G.state();`로 셋 다 `true` 확인.

**`-r`로 업데이트하면 권한이 유지된다.** 매번 다시 해야 한다면 서명이 바뀐 것이다
(= 디버그 빌드가 섞였다는 뜻).

### 삼성 추가 — 수동, 자동화 불가

설정 → 배터리 → 백그라운드 사용 제한 → **절전 시 사용 중지 앱**에서 Personal OS 제외.
배터리 최적화 예외와 **별개 설정**이고, 이것 하나로 새벽에 조용히 죽는다.

## 4. 상태 한 줄 점검

```js
console.table([await G.state(), await G.getSettings(), await G.listAlarms()]);
```

---

## 자주 쓰는 것

```js
const G = Capacitor.Plugins.Guard;

// 즉시 발동
await G.testNotify({ level: 3 });

// 예약 (앱이 죽어 있어도 시스템이 깨운다)
await G.scheduleIn({ seconds: 180, level: 3 });
await G.scheduleAt({ hhmm: "03:00", level: 3 });

await G.listAlarms();
await G.cancelAlarms();
await G.restoreAlarms();   // 복구 경로 자체를 강제 실행

// 소리·진동
await G.getSettings();
await G.setSettings({ sound: true, vibration: true, overrideSilentAtL4: false });
await G.stopAlarm();       // 울리는 중 멈추기
```
