# T-46 — 홈에서 한 번 눌러 할 일을 넣는다

**발행** Cowork · 2026-08-24 · **담당** Claude Code · **보통**
**근거** [ADR-041](../../APP-ADR.md#adr-041) · **APK 필요 · 서버 무변경 · 마이그레이션 없음**

---

## 무엇을 만드나

```
홈 화면 1×1 위젯 "+"  →  탭  →  앱이 열리고 할 일 추가 입력창이 이미 떠 있다
```

**데이터를 그리지 않는다.** 아이콘과 라벨뿐이고, 그래서 **토큰 발급 UI·`/api/widget/*` 규격·
갱신 스케줄이 전부 필요 없다**(ADR-041 §맥락).

## ★ 이 티켓의 상한 — 여기서 멈춘다

```
✅  위젯 등록 · 아이콘 · 탭 → 딥링크 → 입력창
❌  위젯에 오늘 할 일 개수·제목 그리기        ← 그리는 순간 인프라 넷이 든다
❌  위젯에서 바로 입력                        ← RemoteViews 에 EditText 가 없다
❌  일일 점수 위젯                            ← ADR-041 이 명시적으로 기각했다
```

**"나중에 데이터도 그리면 좋겠다"가 이 티켓에서 가장 위험한 생각이다.**
그때 필요한 것은 규격이지 코드가 아니고, **눌리는지 먼저 안 뒤에 짓는다.**

## 할 일

### ① 위젯 — 최소

```
AppWidgetProvider 하나 · 1×1 · RemoteViews 는 아이콘 + 라벨
PendingIntent → 딥링크
```

**색은 CSS 변수가 아니라 Android 리소스다** — 함정 5(색 리터럴 금지)는 웹의 규칙이고
여기는 `values/`·`values-night/`로 짝을 맞춘다. **짝을 안 맞추면 다크에서 안 보인다.**

### ② 딥링크 — 이미 있는 것을 쓴다

**`@capacitor/app`이 이미 설치돼 있다**(T-34가 `backButton`으로 넣었다).
`appUrlOpen`·`getLaunchUrl`이 그 플러그인의 것이므로 **새 플러그인을 추가하지 않는다.**

```
위젯 → VIEW intent (커스텀 스킴) → MainActivity → 웹이 듣고 입력창을 연다
```

⚠️ **찬 시작과 더운 시작 둘 다 된다.** 앱이 꺼져 있으면 `getLaunchUrl`, 떠 있으면
`appUrlOpen` 이벤트다. **둘 중 하나만 하면 절반이 조용히 안 된다** — 이 리포가
반복해서 물린 모양이다.

### ③ ★ 딥링크가 실패해도 앱은 열린다

```
딥링크 해석 실패 · 입력창 열기 실패  →  Today 가 그냥 뜬다
```

**위젯을 눌렀는데 아무 일도 안 일어나면 그 위젯은 죽은 것이다.** 앱이라도 열려야
사용자가 손으로 넣는다. T-33·T-44·T-45가 세운 자리와 같다 — **화면을 인질로 잡지 않는다.**

## 범위

```
android/.../widget/AddTaskWidget.kt        (신규) Provider
android/app/src/main/res/xml/*             위젯 메타
android/app/src/main/res/layout/*          RemoteViews 레이아웃
android/app/src/main/res/values*/          색 짝 (기본 · night)
android/app/src/main/AndroidManifest.xml   receiver + intent-filter
public/app.js                              딥링크를 듣고 입력창을 연다
test/front.mjs                             검사
```

**서버 무변경 · 마이그레이션 없음 · smoke 무변경.**

⚠️ **`GuardPlugin`·`guard/` 아래를 건드리지 않는다.** 위젯은 Guard와 무관하고,
그 디렉터리는 발동 경로다(AGENT-CHAIN §4 위임 금지 영역).

**Codex 위임 가능** — 다만 **`AndroidManifest.xml`과 딥링크 배선은 Claude Code가 직접** 한다.
Manifest는 Guard의 권한·FSI 선언이 함께 있는 파일이고, 거기를 위임하면
**발동 경로를 간접적으로 만지는 것**이 된다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 위젯에 데이터 그리기 | 인프라 넷이 든다. **눌리는지 먼저 안다**(ADR-041) |
| 일일 점수 위젯 | ADR-040을 되돌린다 — 요약을 안 읽고 점수만 매기게 된다 |
| `/api/widget/*` 신설 | 데이터를 안 그리므로 부를 것이 없다 |
| 기기 토큰 발급 UI | 같은 이유. 위젯이 서버를 안 부른다 |
| 새 Capacitor 플러그인 추가 | `@capacitor/app`이 이미 있다(T-34) |
| 찬 시작·더운 시작 중 하나만 | 절반이 **조용히** 안 된다 |
| 딥링크 실패 시 아무것도 안 하기 | 죽은 위젯이 된다. 앱이라도 열린다 |
| `guard/` 아래 손대기 | 발동 경로다. 위젯과 무관하다 |
| 다크모드 색을 한 벌만 | `values-night/` 짝이 없으면 안 보인다(함정 5의 Android판) |

## 완료 조건

```
typecheck 통과 · smoke 359(변화 없음) · front 316 → 320 이상 · 실패 0 · verify exit 0
Kotlin: assembleRelease BUILD SUCCESSFUL · npx cap sync android 성공
```

**검사**

```
1  딥링크가 오면 할 일 추가 입력창이 열린다
2  ★ 딥링크가 없으면 Today 가 그대로 뜬다               ← 1의 짝
3  ★ 딥링크 처리가 던져도 앱이 뜬다                     ← 화면을 인질로 잡지 않는다
4  찬 시작·더운 시작 둘 다 배선돼 있다 (Kotlin·JS 스캐너)
5  ★ 4의 스캐너가 살아 있는가                           ← 주석을 걷어내고 본다
6  values-night 색이 짝으로 있다                        ← 없는 것을 세는 검사
```

**2와 3이 짝이다.** 1·4만 보면 *"딥링크 없으면 흰 화면인 구현"*과
*"딥링크가 죽으면 앱도 죽는 구현"*이 둘 다 통과한다 —
T-33·T-38·T-39·T-41·T-43·T-44·T-45에서 **일곱 번** 물린 자리다.

⚠️ **Kotlin 쪽은 jsdom이 못 본다.** 4·5는 스캐너이고, **진짜 판정은 아래 실측이다**(T-40이 배운 것).

**변이**
- 딥링크 없을 때 Today를 안 그린다 → **2만** 죽는다
- 딥링크 처리에서 `try/catch`를 뗀다 → **3만** 죽는다
- 더운 시작 리스너를 주석 처리한다 → **4만** 죽는다
- 스캐너를 눈멀게 한다 → **4는 초록 · 5만** 죽는다

## 확인 절차 (사용자) — APK 설치 후

무선 adb가 서 있으므로 유선은 필요 없다:

```powershell
adb -s <폰IP>:5555 install -r android\app\build\outputs\apk\release\app-release.apk
```

```
□ 홈 화면 길게 눌러 위젯 목록에 "할 일 추가"가 있다
□ 놓고 한 번 누르면 입력창이 이미 떠 있다        ← 탭 한 번 · 앱 열고 찾아가지 않는다
□ 앱이 이미 떠 있는 상태에서 눌러도 같다          ← 더운 시작
□ 다크모드에서 아이콘이 보인다
```

**★ 그리고 한 주 동안 몇 번 눌렀는지 세어 달라.** 그것이 ADR-041의 재검토 트리거다 —
거의 안 눌렀으면 **접근성이 원인이 아니었다는 뜻이고, 데이터 그리는 위젯도 안 눌린다.**

---

## 보고 (담당이 채운다)

```
티켓: T-46
바꾼 파일:
  android/app/src/main/java/dev/mond1424/personalos/widget/AddTaskWidget.kt   (신규)
  android/app/src/main/res/xml/widget_add_task_info.xml                        (신규)
  android/app/src/main/res/layout/widget_add_task.xml                          (신규)
  android/app/src/main/res/values/widget_colors.xml                            (신규)
  android/app/src/main/res/values-night/widget_colors.xml                      (신규 · 이 리포 첫 values-night)
  android/app/src/main/res/values/strings.xml                                  (문자열 3)
  android/app/src/main/AndroidManifest.xml                                     (receiver + VIEW intent-filter)
  public/app.js                                                                (딥링크 4개 · boot 배선 1줄)
  test/front.mjs                                                               (검사 11)
기준선: typecheck 통과 · smoke 359(변화 없음) · front 316 → 327 · 실패 0 · verify exit 0
       Kotlin assembleRelease BUILD SUCCESSFUL (서명 SHA-256 검증 통과) · npx cap sync android 성공
```

**딥링크 스킴·경로** — `personalos://add-task`.
Capacitor의 `custom_url_scheme`(`dev.mond1424.personalos`)을 쓰지 않았다. 그건 플러그인 콜백용이고,
**위젯이 던지는 것과 섞이면 나중에 무엇이 무엇을 열었는지 못 가린다.**
Manifest의 `<data>`에는 **스킴만** 적고 host를 안 적었다 — 무엇을 여는지의 대장은
`app.js`의 `DEEPLINK_ACTIONS` 하나이고, 그래야 **다음 딥링크에 APK를 다시 깔 일이 없다.**

**찬 시작 / 더운 시작** — 둘 다 `bindDeepLink(capApp)` 한 함수 안이다(`app.js`).
- 더운 시작: `capApp.addListener("appUrlOpen", …)` — Capacitor가 `MainActivity.onNewIntent`를 이 이벤트로 준다.
  `MainActivity`가 `singleTask`라 새 인스턴스가 안 뜬다.
- 찬 시작: `runDeepLink(() => capApp.getLaunchUrl())` — 앱이 꺼져 있었으면 **리스너를 달기 전에
  이벤트가 이미 지나갔다.** Capacitor는 그 URL을 `Bridge.intentUri`에 잡아 두고 이걸로 준다.
- 호출 자리는 **`await loadData()` 뒤**다. 앞에 두면 그 뒤의 `switchTab`·`loadTab`이 방금 연 시트를
  덮어서 *"가끔 안 열리는 위젯"* 이 된다.

**딥링크 실패 시 무엇이 뜨나** — **Today가 그냥 뜬다.** 가드는 `runDeepLink`의 `try/catch` **하나**다.
찬 시작의 `getLaunchUrl()` 호출까지 그 안에 들어가도록 **URL 대신 함수를 받게** 만들었다 —
밖에서 부르면 부팅이 통째로 죽는 경로가 하나 남는다.
확인: 검사 ③이 `getLaunchUrl`이 던지는 셸을 **실제로 새로 띄워** Today가 뜨는 것을 보고,
같은 검사가 *여는 것*이 던질 때와 *묻는 것*이 던질 때 둘 다 `null`로 끝나는 것을 본다.

**values-night 색** — `values/widget_colors.xml` ↔ `values-night/widget_colors.xml`의 **이름을 짝지었다**
(`widget_add_task_bg`·`widget_add_task_ink`, 값은 `style.css`의 paper·ink와 그 다크 짝).
검사 ⑥은 **없는 것을 센다**: 한쪽에만 있는 이름의 개수가 0인지, 그리고 레이아웃이 색 리터럴(`#…`)을
안 쓰는지. APK에서도 확인했다 — `aapt2 dump resources`가 `() #fffbfaf7` / `(night) #ff1a1713`을 함께 보고한다.

**변이 넷** (각각 `npm run front` 실측):

| 변이 | 결과 |
|---|---|
| 딥링크 없을 때 Today를 안 그린다(`if (!action)`에서 셸을 숨김) | **326/1 — ②만** |
| 딥링크 처리에서 `try/catch`를 뗀다 | 325/2 — **③** + `콘솔 오류 없음` |
| 더운 시작 리스너를 주석 처리한다 | 325/2 — **④(JS)** + `같은 부팅에서 appUrlOpen 리스너도 걸렸다` |
| 스캐너를 눈멀게 한다(`t46Bare = s => s`) | **326/1 — ④는 초록 · ⑤만** |

둘째·셋째가 하나가 아니라 둘을 죽인 것은 **검사가 약해서가 아니라 짝이 하나 더 있어서**다:
`try/catch`를 떼면 삼킨 예외가 처리되지 않은 거절로 새어 러너의 `콘솔 오류 없음`에도 잡히고,
더운 시작을 주석 처리하면 **스캐너(정적)와 실제 부팅(동적)이 함께** 빨간불이 된다.
스캐너만 있는 것보다 나은 상태라 그대로 뒀다.

**⚠️ Codex 위임** — **하지 않았다. 전부 직접 했다.**
Manifest·딥링크 배선이 위임 금지였고 나머지(위젯 Provider·레이아웃·색·검사)가 그 배선과
같은 짝이라, 갈라서 넘기면 경계가 `AndroidManifest.xml` 한 파일 안을 지나간다.

### 티켓 범위 밖 / 티켓과 다르게 한 것

- **`res/values/strings.xml`에 문자열 3개**를 넣었다(범위표에 `values*/`가 있어 그 안이지만
  기존 파일이라 적어 둔다). 위젯 라벨·글리프·설명이고 리터럴을 레이아웃에 박지 않기 위해서다.
- **`res/drawable/`을 안 만들었다.** "아이콘"을 벡터 대신 **`+` 글리프 TextView**로 했다 —
  드로어블 두 개(아이콘·둥근 배경)를 범위 밖에 만들지 않으려는 선택이고, Android 12+는
  위젯을 launcher가 알아서 둥글게 자른다.
- **`receiver`를 `exported="true"`로 뒀다.** `APPWIDGET_UPDATE`는 system_server가 보내는 것이라
  보내는 uid가 다르다. `false`면 `onUpdate`가 안 와서 위젯이 `initialLayout` 그대로 뜨고
  **눌러도 아무 일이 없다** — 이 티켓이 답하려는 질문이 통째로 무의미해지는 실패라 걸지 않았다.
- **`BROWSABLE`을 안 넣었다.** 넣으면 아무 웹페이지나 이 앱을 열 수 있다.
  `DEFAULT`만으로 §확인 절차의 `adb ... am start`는 그대로 된다.
- **아직 못 본 것**: 위젯이 홈 목록에 뜨는지 · 실제 탭 · 다크에서 보이는지.
  jsdom은 RemoteViews를 못 본다 — **판정은 아래 §확인 절차다.**

### 물린 것 두 개 (다음에 같은 자리에서 죽지 않도록)

- **XML 주석 안에 하이픈 둘(`--`)을 못 쓴다.** `--paper` 같은 CSS 변수명을 주석에 적었다가
  `mergeReleaseResources`가 거부했다. 접두사를 뺀 이름으로 적었다.
- **Kotlin 블록 주석은 중첩된다.** KDoc 안에 `/api/widget/` + `*`를 적으니 그 자리에서
  주석이 새로 열려 **파일 끝까지 안 닫혔다**(`Syntax error: Unclosed comment`).
  두 함정 모두 `npm run verify`가 못 잡는다 — **`assembleRelease`만이 잡는다.**
