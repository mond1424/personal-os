# T-13 — APK 서명 불일치 · 매 업데이트마다 데이터가 날아간다

**발행** Cowork · 2026-08-03 · **담당** Codex CLI · **상태** ⬜ 대기 · **우선**

---

## 증상

```
adb install -r app\build\outputs\apk\release\app-release.apk
Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package dev.mond1424.personalos
         signatures do not match newer version; ignoring!]
```

사용자가 **앱을 삭제하고 새로 설치**해서 넘어갔다. 그때 날아간 것:

```
권한          POST_NOTIFICATIONS · SYSTEM_ALERT_WINDOW · UsageStats · 배터리 최적화 제외
GuardAlarmStore  예약 원본 전부
GuardSettings    감지 창 · 임계 · 재확인 상태
GuardActivityLog 활동 표본
```

## 왜 지금 고치나

**고치지 않으면 매 업데이트마다 반복된다.** 그리고 9~11월 실사용에서 이 일이 나면
그 밤의 예약이 통째로 사라진다 — 사용자가 눈치채지 못한 채로.

`GUARD-DEV-LOOP.md`가 **정확히 이 사고를 막으려고 쓰인 문서**다:

> 디버그 빌드는 서명이 달라 릴리스 앱을 덮어쓸 수 없고, Android가 삭제 후 재설치를 강제한다.
> **그때 권한과 예약 원본이 통째로 날아간다.**

그 문서가 있는데도 났다. 그러니 **문서가 못 막은 경로가 있다.**

## 진단부터 — 추측하지 않는다

세 지문을 뽑아 비교한다.

```cmd
cd C:\dev\personal-os-worker\worker\android

REM ① 지금 빌드된 APK가 무슨 키로 서명됐나
"%LOCALAPPDATA%\Android\Sdk\build-tools\<버전>\apksigner.bat" verify --print-certs ^
  app\build\outputs\apk\release\app-release.apk

REM ② keystore가 가진 키의 지문
keytool -list -v -keystore <keystore 경로> -alias <alias>

REM ③ 폰에 설치된 앱이 무슨 키로 서명됐나 (삭제 전이었으면 좋았을 것)
adb shell dumpsys package dev.mond1424.personalos | findstr /i "signatures\|pkgFlags"
```

`apksigner`가 없으면 `keytool -printcert -jarfile app-release.apk`.

**가르는 표:**

| ①과 ②가 | 뜻 |
|---|---|
| **다르다** | 빌드가 keystore를 안 썼다 — 디버그 키로 서명됐다. **가장 유력** |
| 같다 | 폰에 있던 것이 다른 키였다. 과거 어느 시점에 디버그 빌드가 설치됐다 |

## 유력한 원인 — 확인해야 할 자리

`GUARD-DEV-LOOP.md`에 **"서명 환경변수 없으면 빌드 중단"** 가드가 있는데
`BUILD SUCCESSFUL`이 났다. 셋 중 하나다:

1. **`keystore.properties`는 읽혔는데 값이 틀렸다** — 가드는 "있는지"만 보고 "맞는지"는 못 본다
2. **가드가 릴리스 빌드에서 안 돈다** — `assembleRelease` 경로에 안 걸려 있다
3. **gradle 데몬이 옛 환경을 들고 있었다** — `gradlew --stop`이 필요한 상황
   (`STATE.md`에 `ANDROID_HOME` 때문에 같은 일이 있었다)

`android/app/build.gradle`의 signingConfig 블록과 그 가드를 **읽고 확인한다.**

## 고칠 방향

**빌드가 조용히 디버그 키로 서명되는 경로를 없앤다.**

- 가드를 "파일이 있는가"가 아니라 **"릴리스 서명이 실제로 붙었는가"**로 바꾼다
- 가능하면 빌드 끝에 **지문을 찍는다** — 매 빌드가 자기 서명을 말하면 다음에 눈으로 걸린다
- `GUARD-DEV-LOOP.md`의 빌드 절차에 **지문 확인 한 줄**을 넣는다

**서명 자체를 바꾸지 않는다.** keystore와 alias는 그대로다 —
바꾸면 지금 폰에 있는 앱과 또 안 맞는다.

## 범위

```
android/app/build.gradle       가드 · 지문 출력
GUARD-DEV-LOOP.md              절차에 확인 한 줄  ← Cowork 소유가 아니다. 고쳐도 된다
docs/tickets/T-13-*.md         진단 결과 기록
```

**`android/keystore.properties`를 커밋하지 않는다.** gitignore 대상이다.
**지문을 문서에 적을 때 비밀번호나 키 자체를 적지 않는다** — SHA-256 지문만.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| keystore·alias 교체 | 지금 폰의 앱과 또 안 맞는다. 문제를 옮길 뿐이다 |
| `keystore.properties` 커밋 | 비밀번호가 리포에 들어간다 |
| 진단 없이 build.gradle 수정 | 세 원인 중 어느 것인지 모르면 엉뚱한 곳을 고친다 |
| `-r` 없이 설치하는 절차로 바꾸기 | 그건 문제를 정상으로 만드는 것이다 |

## 읽을 것

- `GUARD-DEV-LOOP.md` §원칙 · §1 — 이 사고를 막으려던 문서
- `android/app/build.gradle` — signingConfig과 가드
- `APP-BUILD.md` 결정 기록 07-28·07-29의 서명 항목 넷 — 그때 무엇을 왜 정했나

## 완료 조건

```
typecheck 통과 · smoke 237(변화 없음) · front 210(변화 없음) · 실패 0
```

**코드 검사는 안 늘어난다.** 진짜 완료 조건은 다음 빌드다:

1. `gradlew assembleRelease` → **빌드 로그에 서명 지문이 찍힌다**
2. 그 지문이 keystore의 것과 같다
3. `adb install -r` 이 **삭제 없이 성공한다**

3번은 지금 폰에 있는 앱(삭제 후 설치한 것)과 비교하는 것이므로
**이번 빌드가 keystore 키로 서명됐다면 성공한다.** 실패하면 진단이 틀린 것이다.

## 확인 절차 (사용자)

```cmd
cd C:\dev\personal-os-worker\worker
npx cap sync android
cd android
gradlew --stop
gradlew assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

```
□ 빌드 로그에 서명 지문이 찍힌다
□ adb install -r 이 삭제 없이 성공한다      ← 이 티켓의 전부
□ 앱을 열고 await G.state() → 권한 넷이 그대로 true (초기화되지 않았다)
```

---

## 보고 (담당이 채운다)

```
티켓: T-13
바꾼 파일: android/app/build.gradle, GUARD-DEV-LOOP.md, docs/tickets/T-13-apk-signing.md
진단 결과: ① APK 지문 = ② keystore 지문 = ③ 설치 앱 지문
           = C1:D8:B9:E6:48:33:E9:A4:60:47:81:28:A2:4C:A5:64:82:76:A9:63:85:2B:FD:2D:E0:46:88:19:11:9C:10:A6 → 같다
           원인 = 현재 상태에서는 1/2/3 모두 아님. ①=②이고 재설치된 ③도 같으므로 현재 release 배선은 정상이다.
                  과거 오류는 삭제 전 설치본이 다른 키였다는 뜻이지만, 그 APK가 이미 삭제되어 생성 경로는 지문으로 더 확정할 수 없다.
                  STATE.md의 07-29 'keystore password was incorrect' 사고 전후에 디버그 키 APK가
                  설치됐을 가능성이 가장 설명력이 높으나 확정할 수 없다.
기준선: typecheck 통과 · smoke 237 → 237 · front 210 → 210 · 실패 0
실기 확인: gradlew assembleRelease 성공 · 빌드 로그 지문 일치 · adb install -r 삭제 없이 Success
설계와 어긋난 점: 없음
막힌 것: 삭제 전 설치본 지문은 복구 불가. 현재 빌드·업데이트 완료 조건에는 막힌 것 없음.
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
진단이 추측이 아니라 지문 비교였는가:
가드가 "파일 존재"가 아니라 "서명 결과"를 보는가:
비밀번호·키가 리포에 들어가지 않았는가:
설계 위반:
판정:
```
