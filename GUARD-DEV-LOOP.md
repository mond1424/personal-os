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

### 삼성 추가 — 수동, 자동화 불가. **재설치할 때마다 초기화된다.**

두 곳 다 확인한다. 배터리 최적화 예외(`state()`의 `batteryUnrestricted`)와 **별개 설정**이라
API로는 안 보인다 — 눈으로 확인하는 수밖에 없다.

1. 설정 → 배터리 → 백그라운드 사용 제한 → **절전 시 사용 중지 앱** — Personal OS가 **없어야** 한다
2. 설정 → 배터리 → 백그라운드 사용 제한 → **자동 절전 앱 지정** — 꺼져 있거나 예외에 넣는다
3. 설정 → 앱 → Personal OS → 배터리 → **제한 없음**

> **증상**: 최근 앱에서 밀어 종료하면 알람이 안 울린다(홈 버튼으로 두면 울림).
> 삼성이 스와이프 종료를 강제 종료로 취급하면 예약이 통째로 취소되고, 앱을 손으로 다시
> 열기 전까지 리시버도 안 깨어난다. 위 설정이 이걸 막는다.
>
> **FSI 권한도 같이 초기화된다** — `state()`의 `fullScreenIntent`가 `false`면 재부여한다.

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
// { configured, hasToken, lastOkAt, lastError, lastCount, boundary, nextSyncAt, queued }
```

| 확인 | |
|---|---|
| `configured: true` · `hasToken: true` | ⬜ |
| **`boundary`가 실제 설정값과 같다** (지금 06:00) | ⬜ |
| **`nextSyncAt` = 경계 + 10분** (06:10) | ⬜ |
| `lastOkAt`이 최근 · `lastError` 없음 | ⬜ |
| `queued: 0` | ⬜ |

> 경계를 바꾼 뒤에는 앱을 한 번 열어 재동기화해야 `nextSyncAt`이 따라온다.

### 2.2 상시 서비스 + 감지 (S1.4·S2.5)

```js
await G.detectStatus();
// { usagePermission, currentApp, samples, snapshot:{hour, screen_on_min, unlocks, top_apps} }
```

`usagePermission: false`면 특수 권한이라 런타임 요청이 안 된다 — 설정으로 보낸다:

```js
await G.openUsageSettings();   // 설정 > 특별한 앱 액세스 > 사용 정보 접근 > Personal OS 허용
await G.startService();
```

| 확인 | |
|---|---|
| 알림에 **"Guard · 지켜보는 중"** 상시 표시 | ⬜ |
| `usagePermission: true` | ⬜ |
| 다른 앱을 잠깐 쓰고 오면 `currentApp`이 그 앱 | ⬜ |
| 몇 분 뒤 `samples`가 늘어난다 | ⬜ |
| `snapshot.screen_on_min` · `unlocks`가 채워진다 | ⬜ |
| **최근 앱에서 밀어 종료해도 상시 알림이 남는다** ← 생존 확인 | ⬜ |

```js
await G.recentActivity({ minutes: 30 });   // 무엇이 잡히는지 원본으로
```

> 감지는 **보조 입력**이다(ADR-018·021). 권한을 안 줘도 Guard는 그대로 돈다 —
> 보호 규칙은 시각으로 예측되고 알람은 시스템이 들고 있다. 없으면 `risk_snapshot`이 얇아질 뿐이다.

### 2.5 로컬 우선 기록 (S2.4) — **이 라운드의 핵심**

발동 기록이 서버 없이도 남는가. 순서는 `로컬 → 화면 → 알림 → (온라인이면) 밀어 올리기`.

**온라인**

```js
await G.testNotify({ level: 3 });    // 화면 뜸 → [닫기]
await G.syncStatus();                // queued: 0 (닫을 때 자동 flush)
(await g('/guard/events'))[0];       // client_id(UUID) 붙어 있고 reaction: 'accepted'
```

**오프라인 — ADR-023이 실제로 지켜지는지**

```js
// ① 비행기 모드 켜기
await G.testNotify({ level: 3 });    // 화면은 그대로 뜬다
await G.syncStatus();                // queued: 1  ← 서버에 못 갔지만 기록은 남았다
// ② 비행기 모드 끄기
await G.flushEvents();               // { sent: 1, remaining: 0 }
(await g('/guard/events'))[0];       // 방금 것이 서버에 있다
```

| 확인 | |
|---|---|
| 오프라인에서도 개입 화면이 뜬다 | ⬜ |
| `queued`가 1로 오른다 (기록 유실 없음) | ⬜ |
| 복귀 후 `flushEvents`로 서버에 도달 | ⬜ |
| 서버 행에 `client_id`와 `reaction`이 있다 | ⬜ |

> **여기가 통과하면 "새벽에 서버가 안 붙어도 개입 기록이 남는다"가 증명된다.**

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

**멱등 확인** — 같은 동기화를 두 번 해도 예약이 늘면 안 된다.

```js
await G.sync();                     // 한 번 더
await G.listAlarms();               // count 그대로여야 한다
```

정리:

```js
await g(`/events/${ev.id}/protect`,'PUT',{ protect:false });
await G.sync();                     // scheduled: 0
await G.listAlarms();               // 서버발 예약이 사라졌는지 (테스트 알람은 남는다)
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

### 6. 감지 발동 (ADR-025) — 두 번째 경로

시각 예약과 무관하게, 규칙이 스스로 발동하는지 본다. **상시 서비스와 사용정보 접근이 켜져 있어야 한다.**

```js
// ① 지금 시각을 창 안으로 끌어온다 (예: 지금이 21:40이면)
await G.setWatch({ enabled: true, bedFrom: "21:00", bedTo: "23:59", minutes: 1, maxPerNight: 5 });

// ② 무엇이 막고 있는지 본다 — inWindow / continuousMin / thresholdMin
await G.watchStatus();

// ③ 폴링(60초)을 기다리지 않고 한 번 평가
await G.evaluateWatch();
```

- `fired: true` → Level 2 개입 화면. 한 번 더 부르면 30분 안에는 `false`(재발동 간격)
- `fired: false`면 `status`를 읽는다. `inWindow: false`(창 밖) · `continuousMin < thresholdMin`(연속 부족, 화면을 끈 적이 있으면 0으로 리셋됨) · `firedTonight >= maxPerNight`(상한)
- 같은 밤에 처음부터 다시 하려면 `await G.resetWatchNight()`
- 확인이 끝나면 **기본값으로 되돌린다**: `await G.setWatch({ bedFrom: "00:30", bedTo: "06:00", minutes: 20 })`

발동이 서버에 닿았는지: `(await g('/guard/events'))[0]` → `cause: "watch:bedtime"`.
반응 없이 지나간 발동은 30분 cron이 **36시간 뒤** `ignored`로 확정한다(즉시 아니다 — ADR-025).

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

// 감지 발동 (ADR-025)
await G.watchStatus();
await G.evaluateWatch();
await G.resetWatchNight();
await G.setWatch({ enabled: true, bedFrom: "00:30", bedTo: "06:00", minutes: 20, maxPerNight: 5 });
```
