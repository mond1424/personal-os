# 실측 지시서 — 2026-08-03

**미실측 넷을 한 번에 확인한다.** APK를 한 번만 굽고 순서대로 걷는다.

| 티켓 | 무엇 | 필요한 것 |
|---|---|---|
| T-05 | 보호 규칙이 알람까지 이어지는가 | 콘솔 |
| T-04 | Level 4가 검증을 거치는가 | **APK** |
| T-09 | Goals 디데이 · 하단 바 | 이미 배포됨 |
| T-11 | 수락 재확인 · 무음 존중 | **APK** |
| S1.3 ③ | 밤 03:00 알람 | 자기 전 |

**순서를 지킨다.** 뒤의 항목이 앞의 결과에 기댄다.
막히면 **거기서 멈추고 기록한다** — 넘어가면 원인이 섞인다.

---

## 0. 준비

작업 트리가 깨끗하고 `main == origin/main`인지 확인한다. 아니면 여기서 멈춘다.

```cmd
cd C:\dev\personal-os-worker\worker
git status
```

---

## 1. APK 빌드·설치

```cmd
npx cap sync android
cd android
gradlew assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
cd ..
```

- **`-r`이 핵심이다** — 같은 서명이면 데이터를 유지한 채 교체된다.
  빼면 권한과 `GuardAlarmStore`가 날아가고, 그 때문에 재부팅 복구 검사가 한 번 실패했었다
- `adb`가 PATH에 없으면 `"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"`
- 서명 오류가 나면 `android/keystore.properties` 확인

**설치 후 앱을 한 번 연다.** 채널 생성·알람 복구(`GuardAlarms.restoreAll`)가 앱 시작 시 돈다.

---

## 2. 권한 확인

`chrome://inspect` → 앱 콘솔:

```js
const G = Capacitor.Plugins.Guard;
await G.state();
```

```
□ notifications: true
□ overlay: true
□ batteryUnrestricted: true
□ fullScreenIntent: true
```

**하나라도 false면 여기서 멈춘다.** 뒤의 검사가 전부 무의미해진다.
`G.requestNotifications()` · `G.openOverlaySettings()` · `G.openBatterySettings()`로 연다.

---

## 3. T-09 — Goals · 하단 바 (APK 무관, 이미 배포됨)

```
□ Me › Goals — 비어 있으면 안내 문구가 뜬다
□ 목표 하나 추가 (horizon만) → 목록에 뜬다
□ kind='constraint' + dday_label 있는 기간에 연결 → 디데이가 뜬다
□ kind='period' 기간에 연결 → 디데이가 안 뜬다
□ 하단 바에서 Me가 4탭과 구분되어 보인다        ← 검사로 대체 불가
□ 탭 스와이프가 그대로 (한 번에 두 칸 안 넘어간다 — 함정 4)
```

기간에 `kind`·`dday_label`이 없으면 콘솔에서 만든다:

```js
JSON.stringify(await Api.periods())
```

---

## 4. T-05 — 보호 규칙이 알람까지 이어지는가

**이 티켓의 진짜 완료 조건이다.** 화면이 아니라 알람까지 가야 시각 발동 경로가 산다.

```
□ 09:00 일정을 만들고 보호를 켠다 → 데드라인이 01:30으로 뜬다
□ 수면을 300분으로 고친다 → 02:30으로 바뀐다
□ 저장 후 목록·캘린더에 보호 표시가 보인다
```

그다음 콘솔:

```js
await G.sync();
await G.listAlarms();
```

```
□ 그 일정의 발동이 예약되어 있다 (여러 건 — Level 1·2·3·4)
□ 보호를 풀고 await G.sync() → 그 예약이 사라진다
```

**예약이 안 보이면 멈춘다.** `await G.syncStatus()`로 마지막 동기화 시각·결과를 본다.

---

## 5. T-04 — Level 4가 검증을 거치는가

```js
await G.scheduleIn({ seconds: 60, level: 4 });
```

```
□ 화면이 즉시 뜬다 (검증을 기다리며 늦지 않는다)
□ 승인이면 대기 180초 · 거부·실패면 60초
```

비행기 모드로 바꾸고 다시:

```
□ 비행기 모드 → Level 3으로 뜨고, 화면은 그대로 뜬다 (fail-closed)
```

비행기 모드를 풀고 발동 뒤:

```js
JSON.stringify((await Api.guardEvents())[0])
```

```
□ ai_used · ai_verdict 가 실려 있다      ← 없으면 통제 ③이 뚫린 채다
```

킬 스위치:

```js
const t = localStorage.getItem('api_token');
await fetch('/api/settings/guard_ai_verify', {
  method:'PUT', headers:{'content-type':'application/json','Authorization':'Bearer '+t},
  body: JSON.stringify({ value: 'off' })
});
await G.scheduleIn({ seconds: 60, level: 4 });
```

```
□ 킬 스위치 off → 항상 Level 4, ai_used: 0
□ 확인 후 다시 'on'으로 되돌린다
```

---

## 6. T-11 — 수락 재확인 · 무음 존중

**이번 빌드에서 가장 중요한 항목이다.** 매일 도는 경로를 바꿨다.

```js
await G.testNotify({ level: 3 });
```

```
□ [알겠습니다] → 화면이 닫힌다
□ 폰을 계속 쓴다 → 5분 뒤 같은 Level이 다시 뜬다      ← 이 티켓의 전부
□ 두 번째도 [알겠습니다] → 5분 뒤 또 온다 (2회째)
□ 세 번째는 오지 않는다 (하루 상한 2회)
```

상한을 비우고 다시:

```js
await G.recheckStatus();        // 무엇이 막고 있는지
```

화면 끄기 경로:

```
□ [알겠습니다] 후 화면을 끄고 5분 → 오지 않는다   ← 잤다는 뜻이다
```

무음:

```
□ 폰을 무음으로 → Level 4 발동 → 소리·진동 없이 화면만 뜬다
□ Me › 설정에 'overrideSilentAtL4'가 없다
```

기록:

```js
JSON.stringify((await Api.guardEvents())[0])
```

```
□ cause: "recheck:accepted" 인 행이 있다
```

---

## 7. 밤 03:00 (S1.3 ③) — 자기 전에

**충전기를 꽂지 않는다.** Doze 상태에서 알람이 깨는지가 이 검사의 전부다.

```js
await G.cancelAlarms();
await G.scheduleAt({ hhmm: "03:00", level: 3 });
await G.listAlarms();
```

아침에:

```js
await G.listAlarms();
```

```
□ count: 0  — 소비됐다는 뜻이다
□ 실제로 03:00에 울렸다
```

**울리지 않았으면 그것이 가장 중요한 발견이다.** 8월 계획 전체가 이 가정 위에 서 있다.

---

## 기록 방법

각 항목을 **✅ / ❌ / 미실시**로 표시해 그대로 가져온다. 실패는 **증상을 그대로** 적는다 —
"안 됨"이 아니라 "5분 뒤에도 안 뜸, `recheckStatus`는 `armed: true, elapsed: 7분`".

콘솔 출력은 `JSON.stringify(...)`로 감싸 통째로 복사한다. 접힌 객체는 읽을 수 없다.

**문제가 나오면 그 자리에서 멈춘다.** 다음 항목으로 넘어가면 두 변경이 섞여 원인을 못 가린다.

---

## 되돌리기

새 APK가 문제를 만들면:

```cmd
git log --oneline -5
```

`1df37a5`(T-11) 이전으로 되돌려 다시 빌드한다. **`-r`로 설치하면 데이터는 유지된다.**

서버는 되돌릴 필요가 없다 — T-11은 기기 코드뿐이고 서버는 그 전부터 호환된다.
