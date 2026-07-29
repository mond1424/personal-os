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

---

## 유선 디버깅 검증 항목

USB 연결 + `chrome://inspect` 상태에서. 위에서 아래 순서로.

### 0. 서버 API 헬퍼

```js
const G = Capacitor.Plugins.Guard;
const tok = localStorage.getItem('api_token');
const g = async (p, m='GET', b) => (await fetch('/api'+p, {
  method: m,
  headers: { ...(tok && {Authorization:'Bearer '+tok}), ...(b && {'Content-Type':'application/json'}) },
  body: b && JSON.stringify(b)
})).json();
```

### 1. 권한 — 매번 먼저

```js
await G.state();     // notifications · overlay · batteryUnrestricted 셋 다 true
```

### 2. 동기화 상태 (S2.3)

```js
await G.syncStatus();
// { configured:true, hasToken:true, lastOkAt, lastCount, boundary, nextSyncAt }
```

| 확인 | |
|---|---|
| `configured: true` · `hasToken: true` | ⬜ |
| **`boundary`가 실제 설정값과 같다** (지금 06:00) | ⬜ |
| **`nextSyncAt` = 경계 + 10분** (06:10) | ⬜ |
| `lastOkAt`이 최근 · `lastError` 없음 | ⬜ |

> 경계를 바꾼 뒤에는 앱을 한 번 열어 재동기화해야 `nextSyncAt`이 따라온다.

### 3. 서버 Guard API + 예약 연결

```js
await g('/guard/modes');            // coach 활성
const ev = await g('/events','POST',{ title:'테스트 시험', date:'2026-08-15', time:'09:00' });
await g(`/events/${ev.id}/protect`,'PUT',{ protect_from:'-1d 00:00', protect_level:4 });

const s = await g('/guard/schedule');
console.log(s.boundary, s.events[0].deadline, s.events[0].fires.length);

await G.sync();                     // { ok:true, scheduled: N }
await G.listAlarms();               // fires 개수만큼 잡혀야 한다
```

| 확인 | |
|---|---|
| `deadline`이 08-15 01:30 (09:00 − 90 − 360) | ⬜ |
| `sync()`의 `scheduled`가 `fires.length`와 일치 | ⬜ |
| `listAlarms()`에 같은 수가 잡힘 · `atLocal`이 맞음 | ⬜ |

정리:

```js
await g(`/events/${ev.id}/protect`,'PUT',{ protect:false });
await G.sync();                     // scheduled: 0 으로 돌아가야 한다 (멱등 확인)
await G.listAlarms();
```

### 4. 재부팅 복구 (S1.3 ②)

```js
await G.cancelAlarms();
await G.scheduleIn({ seconds: 1800 });
await G.listAlarms();               // count: 1
```

→ **폰 재시작** → 잠금 해제 → 앱 열기 →

```js
await G.listAlarms();               // 여전히 count 1, inSeconds 줄어 있음
```

### 5. 밤 03:00 (S1.3 ③) — 자기 전, USB 뽑고

```js
await G.cancelAlarms();
await G.scheduleAt({ hhmm: "03:00", level: 3 });
await G.listAlarms();
```

충전기 꽂지 말 것. 아침에 `await G.listAlarms()` → `count: 0`이면 소비된 것.

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
