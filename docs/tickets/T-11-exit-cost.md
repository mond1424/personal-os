# T-11 — 수락 재확인 + 무음 존중 (ADR-026)

**발행** Cowork · 2026-08-01 · **담당** Codex CLI (아래 §위임 예외) · **상태** ⬜ 대기

---

## 목표

`ADR-026`의 결정 1·2를 구현한다.

1. **수락 재확인** — `[알겠습니다]` 후 5분이 지났는데 화면이 켜진 채면 같은 Level로 한 번 더
2. **무음 존중** — `overrideSilentAtL4`를 폐기한다. 무음 모드를 뚫지 않는다

**왜** — 사용자가 실사용에서 찾았다. `[알겠습니다]`가 사실상 '화면 없애기' 버튼이라
Override의 사유+대기가 장식이 된다. **이미 배포돼서 매일 쓰이는 우회로다.**

---

## 위임 예외 — 이 티켓은 Guard 발동 경로인데도 Codex가 한다

`AGENT-CHAIN.md` §4가 Guard 발동 경로를 위임 금지로 둔 기준은
**"고치는 시간보다 왜 그런지 설명하는 시간이 더 크면 넘기지 않는다"** 였다.

`ADR-026`이 그 설명을 전부 했다 — 결정·근거·기각한 대안·구현 명세까지.
그러므로 이 티켓에 한해 조건부로 위임한다. **조건 넷을 전부 지킨다:**

1. **`ADR-026` 전문을 먼저 읽는다.** 요약이 아니라 원문. 특히 §기각한 대안
2. **명세 밖으로 나가지 않는다.** ADR §구현 명세의 다섯 항목이 범위의 전부다.
   "이렇게 하는 게 나을 것 같다"가 떠오르면 **하지 말고 §Cowork 대기에 적는다**
3. **검토 세션이 ADR과 한 줄씩 대조한다**(HANDOFF-0731 §2)
4. **사용자 실측 없이 닫지 않는다.** Kotlin에 검사 러너가 없다

---

## 범위

```
android/.../guard/GuardRecheck.kt        (신규)
android/.../guard/GuardAlertActivity.kt  수락 직후 arm
android/.../guard/GuardService.kt        폴링에 evaluate 추가 · 화면 꺼짐에 disarm
android/.../guard/GuardSettings.kt       overrideSilentAtL4 제거 (게터·세터·키)
android/.../guard/GuardPlugin.kt         설정에서 그 필드 제거 · recheckStatus() 추가
```

**서버·마이그레이션·프런트는 건드리지 않는다.** `guard_events`는 그대로 쓴다 —
재확인은 `cause = "recheck:accepted"`인 **평범한 발동 한 건**이다.

## 구현 — ADR-026 §구현 명세 그대로

```
① GuardAlertActivity
   finishWith("accepted", …) 직후 GuardRecheck.arm(ctx, level)

② GuardRecheck (신규 object)
   arm(ctx, level)     수락 시각 · level · 귀속일 키를 prefs("guard")에 저장
   evaluate(ctx)       GuardService 60초 폴링이 부른다. 넷을 전부 만족하면 발동
                         · armed
                         · 수락 후 5분 경과
                         · 화면이 켜져 있다
                         · 오늘 재확인 횟수 < 2
                       fire(ctx, level, …, cause = "recheck:accepted") 후 disarm
   disarm(ctx)         화면이 꺼지면 부른다 — 잤다는 뜻이다
   status(ctx)         확인용 JSON

③ GuardAlertPolicy.plan — level >= 4 && overrideSilentAtL4 분기 제거
④ GuardSettings — overrideSilentAtL4 게터·세터·K_L4_SILENT 제거
⑤ GuardPlugin — getSettings/setSettings에서 그 필드 제거 · recheckStatus() 추가
```

**`GuardWatch.kt`를 참고 구조로 삼는다.** 같은 자리(폴링에 얹힌 평가)에 같은 방식
(prefs 상태 · 밤당 상한 · `runCatching`으로 절대 던지지 않음)으로 붙는다.

### 귀속일 키 — `GuardWatch`와 다르다

`GuardWatch.nightKey`는 **취침 창 기준**이다. 재확인은 **취침 창 밖에서도** 일어나므로
귀속일(경계 05:00/06:00)을 쓴다. 경계는 `GuardSync`가 서버에서 받아 저장해 둔 값이 있다 —
**하드코딩하지 않는다.** 못 찾으면 멈춰서 보고한다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `[알겠습니다]`에 사유·대기를 붙이는 것 | ADR-026이 기각했다. 수락이 벌이 되면 §6.5의 신호가 오염된다 |
| Override에 횟수 상한 | ADR-026 결정 3. **급한 일은 언제든 생긴다** |
| 재확인 상한을 2회보다 크게 | 오발동 반복 = 도구 이탈(§6.3) |
| 화면이 꺼졌는데 재확인 | 잤다는 뜻이다. 그게 수락이 지켜진 것 |
| 재확인 간격을 5분 아닌 값으로 | ADR-026 §기각한 대안이 30분을 기각했다. 바꾸려면 ADR을 고쳐야 한다 |
| 새 컬럼·마이그레이션·FK | `cause` 문자열로 충분하다(ADR-026 결정 1) |
| `GuardRecheck.evaluate`가 예외를 던지는 것 | 서비스가 죽으면 감지도 재확인도 멈춘다 |
| 서버·프런트 수정 | 범위 밖. 필요하면 멈춰서 보고한다 |

## 읽을 것

- **`APP-ADR.md` ADR-026 전문** — 이 티켓의 근거 전부
- `APP-ADR.md` ADR-025 — `GuardWatch`가 같은 자리에 붙은 방식
- `android/.../guard/GuardWatch.kt` — 참고 구조
- `AGENTS.md` · `CLAUDE.md` 함정 목록

## 완료 조건

```
typecheck 통과 · smoke 237(변화 없음) · front 193(변화 없음) · 실패 0
```

**서버·프런트 검사는 안 늘어난다** — 기기 코드다.
최소한 컴파일은 통과시킨다: `cd android && gradlew :app:compileReleaseKotlin`

`GuardSettings`에서 필드를 지우므로 **`GuardPlugin`·`GuardAlertPolicy`가 함께 안 고쳐지면 컴파일이 깨진다.**
그게 이 티켓의 유일한 자동 안전망이다.

## 확인 절차 (사용자) — APK 재빌드 필요

```js
const G = Capacitor.Plugins.Guard;
await G.testNotify({ level: 3 });
```

```
□ [알겠습니다] → 화면이 닫힌다
□ 폰을 계속 쓴다 → 5분 뒤 같은 Level이 다시 뜬다        ← 이 티켓의 전부
□ 두 번째도 [알겠습니다] → 5분 뒤 또 온다 (2회째)
□ 세 번째는 오지 않는다 (밤당 상한)
□ [알겠습니다] 후 화면을 끄고 5분 → 오지 않는다
□ 무음 모드에서 Level 4 → 소리·진동 없이 화면만 뜬다
□ Me › 설정에 'overrideSilentAtL4'가 없다
□ (await Api.guardEvents())[0] 에 cause: "recheck:accepted"
```

**둘째와 여섯째가 이 티켓의 진짜 완료 조건이다.**
`await G.recheckStatus()`로 무엇이 막고 있는지 볼 수 있다.

---

## 보고 (담당이 채운다)

```
티켓: T-11
바꾼 파일: android/app/src/main/java/dev/mond1424/personalos/guard/GuardRecheck.kt,
           GuardAlertActivity.kt, GuardService.kt, GuardSettings.kt, GuardPlugin.kt,
           docs/tickets/T-11-exit-cost.md
기준선: typecheck 통과 · smoke 237 → 237 · front 210 → 210 · 실패 0
        Kotlin: compileReleaseKotlin BUILD SUCCESSFUL
설계와 어긋난 점: 없음
막힌 것: APK 재빌드 후 티켓 §확인 절차의 사용자 실측이 남아 있다.
```

---

## Cowork 판정 (08-03) — 보류 유지. 검토 세션이 옳다

**① KDoc 정정 — 승인.** `GuardAlertActivity` 상단의 "사유 20자 + 대기"는 **S3.2에서 폐기된 규칙**이고
ADR-026의 "길이 하한 없음"과 정면으로 어긋난다. 같은 파일 안이고 주석이며, **틀린 주석은 다음 사람을
오도한다** — `docs/api-surface.md`가 같은 문구를 달고 있어 T-03에서 이미 한 번 고쳤다. "사유 + 대기"로.

**② 자동 검사 부재 — 결함이 아니라 알려진 한계다.** 티켓 §완료 조건이 이미
"Kotlin에 검사 러너가 없으므로 완료 판정이 사용자 실측에 걸린다"고 못 박았다.
그러니 **보류 판정이 맞다** — 실측 전에 승인·커밋을 요청하지 않는 것이 이 티켓의 설계다.

다만 검토 세션이 짚은 위험은 진짜고 **누적되고 있다.** `GuardWatch`·`GuardVerify`·`GuardRecheck`가
전부 실측에만 의존한다. 셋의 핵심 로직(시간 계산·상한·창 판정)은 **Android 의존이 없는 순수 함수**라
JVM 단위 검사를 붙일 수 있다. 지금 하지 않는다 — 실측 대기가 넷 쌓인 상태에서 검사 인프라를 새로
까는 것은 순서가 아니다. **Cowork 대기로 올린다.**

**③ front 5건 실패 — 이 티켓의 책임이 아니다. 그러나 넘길 수도 없다.**
T-11은 프런트를 건드리지 않았고 5건은 **날짜 경계 검사가 8월 3일에 깨진 것**이다.
T-07 메모가 이미 예고했다: *"날짜를 문자열로 조립하는 검사는 달·윤년에서 조용히 깨진다."*

**기준선이 깨진 채로는 다음 티켓의 숫자가 의미를 잃는다** — "214 중 209"가 새 기준선인지 회귀인지
구분되지 않는다. **T-12로 분리해 먼저 처리한다.** T-11의 커밋은 T-12 이후다.

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

**이 티켓은 ADR과 한 줄씩 대조한다.** 평소 세 항목에 더해:

```
ADR-026 결정 1 (재확인 5분·상한 2·화면 꺼지면 안 함): 코드 대조 통과.
  accepted 직후 수락 시각·같은 level·귀속일을 arm하고, 서비스의 60초 폴링에서
  5분 경과·화면 켜짐·귀속일당 2회 미만을 모두 확인한다. 발동은 같은 level과
  cause="recheck:accepted"를 쓰고 새 guard_event를 만든 뒤 disarm한다. 화면 꺼짐
  브로드캐스트와 화면이 꺼진 채 서비스가 시작된 경우 모두 disarm한다.
  다만 이 동작을 실행한 자동 검사는 없으며 APK 실측은 아직이다.
ADR-026 결정 2 (overrideSilentAtL4 완전 제거): 코드 대조 통과.
  GuardSettings의 게터·세터·키, GuardPlugin의 get/set 필드, GuardAlertPolicy의
  Level 4 무음 우회 분기가 모두 제거됐고 전체 검색에도 이름이나 저장 키가 남지 않았다.
ADR-026 결정 3 (Override에 상한을 만들지 않았는가): 동작은 통과.
  MAX_PER_DAY=2는 재확인에만 적용된다. Override 경로에는 횟수 카운터나 상한이 없고,
  빈칸이 아닌 사유와 Level별 대기만 통과 조건이다. Level 4도 같은 경로가 열려 있다.
  단, GuardAlertActivity 상단 KDoc의 "사유 20자 + 대기"는 실제 코드 및 ADR의
  "길이 하한 없음"과 모순되므로 "사유 + 대기"로 정정해야 한다.
명세 밖으로 나간 곳: T-11 구현 diff에는 없음. recheckStatus는 명세 ⑤이고, 서비스 시작
  시 화면 꺼짐을 disarm하는 처리는 결정 1을 누락 없이 지키는 범위다. 현재 작업 트리의
  APP-ADR·OPERATIONS·STATE 및 프런트 변경은 T-11 보고 파일 목록 밖의 기존 변경으로 분리했다.
설계 위반: 동작상 발견 없음. prefs에는 ADR이 명시한 arm·횟수 상태만 저장하며 파생 결과를
  DB에 저장하지 않는다. SQL·마이그레이션·트리거 변경이 없고, 귀속일은 기기 달력 날짜를
  그대로 쓰지 않고 GuardSync.boundaryHm()의 서버 경계를 적용해 arm 시 확정한다.
함정 재발: 발견 없음. T-11은 프런트를 수정하지 않아 scrollIntoView·전역 클래스명·색 리터럴·
  booted 가드에 닿지 않았다. typecheck 통과, smoke 237/0, Kotlin release 컴파일 통과를 재현했다.
  front는 보고대로 214건 중 209 통과·기존 날짜 경계 5건 실패다.
사용자 직접 테스트 결과: smoke 237/0 · front 214건 중 209 통과/5 실패(80.1초).
  실패 5건은 오늘+14일 달 경계, 말일→다음 달 1일, 다음 달 그리드의 +14일·+15일,
  다음 달 그리드 앞머리 활성 검사다. 실제 dev DB는 불변이며, APK 실측은 한 번에 진행할 예정이다.
판정: 보류. ADR-026과 구현의 코드 대조는 통과했지만 자동 검사는 Kotlin 동작을 실행하지 않아
  5분을 다른 값으로, 상한을 3회로, 화면 꺼짐을 재발동으로 잘못 구현해도 빨간불이 되지 않는다.
  상단 KDoc 정정 뒤, 티켓 §확인의 APK 실측(특히 두 번째 재확인과 guard_event cause)을 마치기
  전에는 사용자 승인·커밋을 요청하지 않는다. front 실패 5건도 완료 조건의 실패 0과 구분해 남긴다.
```
