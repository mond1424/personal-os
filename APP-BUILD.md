# APP-BUILD — Guard v1 실행 체크포인트

[APP-PLAN.md](./APP-PLAN.md)의 8월 계획을 실행 단위로 쪼갠 것. **이 문서가 진행 상태의 단일 진실이다.**

---

## 재개 방법

대화가 끊기거나 새 세션에서 이어갈 때 **"continue"** 만 입력한다.

```
"continue"
  → 이 문서의 '현재 위치'를 읽는다
  → 다음 단계의 산출물·검증 방법을 제안한다
  → 승인을 받는다
  → 실행하고 산출물을 outputs에 만든다
  → 이 문서의 체크포인트를 갱신한다
```

**승인 없이 다음 단계로 넘어가지 않는다.** 각 단계 끝에서 멈춘다.

---

## 현재 위치

> **S1.1 ✅ · S1.2 ✅ 완료** (2026-07-29)
> **S1.3 산출 완료 — 실측 대기** ← **1주차의 진짜 게이트**
>   ① 낮 3분 테스트(앱 완전 종료 상태) → ② 재부팅 복구 → ③ 밤 03:00
> **다음 실행: S1.4 — 포그라운드 서비스 + UsageStats** (게이트 통과 후)
> 최종 갱신: 2026-07-29

---

## 진행표

범례 — ⬜ 대기 · 🔄 진행 · ✅ 완료 · ⏸️ 보류

### 1주 (7/29~8/4) — 폰이 허용하는가만 실측. 규칙 코드 0줄.

| 단계 | 내용 | 산출물 | 상태 |
|---|---|---|---|
| **S1.1** | Capacitor 골격 + 권한 선언 + 서명 설정 | `capacitor.config.ts` · `S1.1-AndroidManifest-additions.xml` · `S1.1-build-gradle-signing.gradle` · `S1.1-gitignore-additions.txt` · `S1.1-README.md` | ✅ |

| **S1.2** | 알림 채널 + FSI + 개입 화면 + 소리/진동 정책 | `GuardNotifications.kt` · `GuardAlertActivity.kt` · `GuardPlugin.kt` · `GuardSettings.kt` · `GuardAlarmPlayer.kt` · 레이아웃·아이콘·매니페스트 | ✅ |

**S1.2 실측 결과 (2026-07-29)**

| 확인 | 결과 |
|---|---|
| 깨어 있는 화면 전체 점유 | ✅ (`SYSTEM_ALERT_WINDOW` 필요) |
| 잠긴 화면 점유 (FSI) | ✅ |
| 뒤로가기 차단 | ✅ (`OnBackInvokedDispatcher`) |
| 일반 모드 → 소리+진동 | ✅ |
| 진동 모드 → 진동만 | ✅ |
| 무음 모드 → 화면만 | ✅ |
| 설정 토글(sound/vibration) | ✅ |

**중간에 물린 것** — `VIBRATE` 권한 미선언(진동이 예외 없이 무시됨) · 재설치가 `SYSTEM_ALERT_WINDOW`·`POST_NOTIFICATIONS`를 초기화 · `setOngoing` 무력화(Android 14+) · `onBackPressed` 미호출(targetSdk 35+)
| **S1.3** | 알람 예약 + 재부팅 재등록 | `GuardAlarms.kt`(+`GuardAlarmStore`) · `AlarmReceiver.kt` · `BootReceiver.kt` · 매니페스트 리시버 2종 · `S1.3-README.md` | 🔄 산출 완료, 3단계 실측 대기 |
| **S1.4** | 포그라운드 서비스 + UsageStats | `GuardService.kt` · `UsageProbe.kt` | ⬜ |
| **S1.5** | 게이트 테스트 화면 + 실측 절차 | `guard-test.html` · 새벽 실측 체크리스트 | ⬜ |

**S1.1 실측 결과 (2026-07-29)**

| # | 확인 | 결과 |
|---|---|---|
| 1 | 홈 화면 아이콘 | ✅ |
| 2 | Today 탭이 뜬다 | ✅ |
| 3 | 하단 nav가 제스처 바에 안 가림 | ✅ |
| 4 | **토큰 유지** (완전 종료 후 재실행) | ✅ — WebView가 localStorage를 보존한다. ADR-023의 로컬 기록 설계 유효 |
| 5 | 스와이프·드래그 동작 | ✅ **웹보다 낫다** — 탭·캘린더 전환의 끊김이 사라짐 |
| 6 | 릴리스 서명 | ✅ `CN=jihoon`, 만료 2056, SHA-256 지문 keystore와 일치 |

**추가 발견 (전부 웹 수정 — deploy로 해결)**

| 증상 | 원인 | 조치 |
|---|---|---|
| 튜토리얼이 제스처 바에 가림 | `.tut`에 bottom safe-area 없음 | `style.css` 수정 |
| 앱 상단이 상태바에 가림 | `.phone`에 top safe-area 없음. 브라우저는 주소창이 위를 먹어 안 드러났다 | `style.css` 수정 |
| (예방) 시트도 같은 문제 | `.sheet` bottom:0에 safe-area 없음 | 함께 수정 |
| 캘린더 로딩 지연 | 웹과 동일 — 앱 때문이 아니다 | 조치 없음. Phase 2-b(측정 먼저) 대상 |

**🚧 게이트 — S1.5 이후 실측 통과해야 2주로 넘어간다.**
잠긴 화면을 알람 소리로 점유하는가 · 03:00 예약이 실제 03:00에 뜨는가 · 서비스가 밤새 사는가 · UsageStats가 값을 주는가

### 2주 (8/5~8/11) — 기록 구조 + 감지 수집

| 단계 | 내용 | 산출물 | 상태 |
|---|---|---|---|
| **S2.1** | `guard_events` 확장 | `migrations/0010_guard.sql` · `db/index.ts` 조각 | ⬜ |
| **S2.2** | `events` 보호 필드 + 서비스 | `0010` 후반 · `services/events.ts` · 라우터 | ⬜ |
| **S2.3** | 보호 일정 pull API + 기기측 예약 | `GET /api/guard/schedule` · `GuardSync.kt` | ⬜ |
| **S2.4** | 로컬 우선 기록 (ADR-023) | `GuardStore.kt`(로컬 SQLite) · `POST /api/guard/events` · 밀어올리기 | ⬜ |
| **S2.5** | 감지 수집 | `UsageProbe` 확장 · 화면 on/off 리시버 | ⬜ |

### 3주 (8/12~8/18) — 개입 ★가장 불확실

| 단계 | 내용 | 산출물 | 상태 |
|---|---|---|---|
| **S3.1** | 데드라인 역산 + Level 1~3 결정론 발동 | `GuardRules.kt` · 예약 생성 로직 | ⬜ |
| **S3.1b** | Level 4 AI 검증 게이트 (ADR-024) | `POST /api/guard/verify` · event당 캐시 · 일일 상한 · 8초 타임아웃 · 킬 스위치 | ⬜ |
| **S3.2** | Override 마찰 UI + 기록 | 사유 입력·대기 타이머 화면 · `guard_events` 기록 | ⬜ |
| **S3.3** | Level 4 신규 작업 차단 | `app.js` — `#stale` 패턴 재사용 | ⬜ |
| **S3.4** | 모드 2종 (coach / secretary) | `guard_modes` · 설정 UI · 하향 금지 | ⬜ |

### 4주 (8/19~8/25) — 루프 닫기

| 단계 | 내용 | 산출물 | 상태 |
|---|---|---|---|
| **S4.1** | `risk_snapshot` 수집 | 항 계산 · 발동 시 저장 | ⬜ |
| **S4.2** | outcome 확정 카드 | Today 카드 · `POST /api/guard/events/:id/outcome` | ⬜ |
| **S4.3** | 알림함 최소 | 목록 · 읽음 | ⬜ |
| **S4.4** | PC 스키마 자리 (ADR-022) | `watch_apps` · `POST /api/guard/activity` | ⬜ |

### 5주 (8/26~8/31) — 버퍼 · 9/1 실사용 진입

감축 순서: 알림함 UI → 모드 2종 → 위험도 항 개수
**줄이지 않는 것**: `guard_events` 기록 구조 · outcome 연결 · 감지 수집

---

## 단계별 공통 절차

각 단계는 이렇게 끝난다.

```
1. 산출물을 outputs에 만든다
2. 리포에 넣을 위치를 명시한다 (신규 파일 / 기존 파일의 어느 지점)
3. 검증 방법을 준다 (typecheck · smoke · front · 실기기 확인)
4. 이 문서의 체크포인트를 갱신한다
5. 멈춘다 — 다음 단계는 승인 후
```

**서버 코드가 들어가는 단계**(S2.1·S2.2·S4.x)는 기존 검증을 통과해야 한다 — 기준선 typecheck 통과 · smoke 154 · front 167 · 실패 0.

**네이티브 코드가 들어가는 단계**(S1.x·S2.3~5·S3.1~2)는 자동 검증이 없다. 실기기 확인이 유일한 검증이므로 매 단계 산출물에 **무엇을 눌러서 무엇을 확인하는지**를 함께 적는다.

---

## 결정 기록 (실행 중 확정된 것)

실행하다 보면 계획에 없던 선택이 나온다. 골자가 바뀌면 APP-ADR로, 세부는 여기에.

| 날짜 | 단계 | 결정 | 근거 |
|---|---|---|---|
| 07-28 | S1.1 | 웹은 **원격 URL 로드**(`server.url`) | 8월에 프런트를 자주 고친다. deploy만으로 앱에 반영 → APK 재빌드 없음. 오프라인 화면은 포기하되 Guard 발동은 네이티브라 무관 |
| 07-28 | S1.1 | `appId = dev.mond1424.personalos` | 영구. 바꾸면 다른 앱이 되고 keystore 연결이 끊긴다 |
| 07-28 | S1.1 | keystore는 `~/keys`, 비밀번호는 **환경변수만** | 리포에 커밋될 경로를 아예 만들지 않는다 |
| 07-28 | S1.1 | 서명 환경변수 없으면 **빌드 중단** | 없으면 gradle이 조용히 디버그 키로 서명하고, 그 APK는 릴리스 키로 업데이트 불가. 조용한 실패를 막는다 |
| 07-28 | S1.1 | `minifyEnabled false` | 난독화가 리시버·서비스 클래스명을 바꾸면 매니페스트 참조가 깨지는데, 그 실패는 새벽 알람에서만 드러난다 |
| 07-28 | S1.1 | 8월치 권한을 **한 번에 선언** | 매니페스트를 매주 고치지 않기 위해. 선언만으로는 아무 일도 안 일어난다 |
| 07-28 | S1.1 | 개발 환경 = **Windows / cmd**. 절차를 Windows용으로 재작성 | `setx`·`gradlew.bat`·Android Studio 번들 JDK 경로 |
| 07-28 | S1.1 | 리포를 `C:\dev\`로 옮기기 **권장** | 기존 경로에 한글(`새 폴더`)·공백·깊은 중첩이 겹침. Android 빌드는 MAX_PATH·비ASCII에 취약하다 (Worker만 빌드할 땐 드러나지 않던 문제) |
| 07-29 | S1.1 | 서명 자격증명을 `android/keystore.properties` 우선 + 환경변수 폴백 | Windows `setx`가 `& ^ % !`를 깨뜨린다. properties 파일은 cmd를 안 거친다 |
| 07-29 | — | `e2e.mjs`에 `CI=true` | wrangler 4.1x부터 `--local` 마이그레이션에도 프롬프트가 붙어 검사가 멈췄다. capacitor 설치 시 락파일 갱신으로 wrangler가 올라간 여파 |
| 07-29 | — | **기준선 정정 — smoke 154 · front 167** (145/157 아님) | 대화 초기에 raw로 받은 STATE가 7/23 스냅샷이었다. 로컬 STATE.md가 진실. 마이그레이션도 0009까지 있어 계획서 번호를 0010~0012로 밀었다 |
| 07-29 | S1.2 | 알림 채널 ID에 `_v1` 접미사 | 채널 설정은 생성 뒤 코드로 못 바꾼다. 소리·중요도를 고치려면 ID를 올리는 수밖에 없다 |
| 07-29 | S1.2 | 방해금지는 **`USAGE_ALARM`으로만** 통과 (setBypassDnd 안 씀) | 알림 정책 접근 권한이 따로 필요하고, 알람 카테고리가 방해금지의 '알람 허용'(기본 켬)을 이미 탄다. 취침 모드에 막히면 새벽 게이트에서 드러난다 |
| 07-29 | S1.2 | Kotlin 툴체인 도입 (Capacitor 템플릿은 Java 전용) | Guard 네이티브 코드 전부가 Kotlin이고, ADR-017 전환 시 그대로 살아남는다. 여유 있는 1주차에 깔아 둔다 |
| 07-29 | S1.2 | `MainActivity`는 Java로 두고 한 줄만 추가 | Capacitor 생성 파일이라 변경을 최소화. Kotlin 클래스는 Java에서 그대로 호출된다 |
| 07-29 | S1.2 | **"밀어서 못 지우는 알림"을 포기.** 마찰은 **화면 + 재발동 주기**가 진다 | Android 14부터 `setOngoing(true)`이 무력화됐다. 앱이 만드는 못 지우는 알림은 존재하지 않는다(시스템·기기정책만). 실기기 sdk 36에서 확인. **설계 §6.3의 마찰을 알림이 아니라 `GuardAlertActivity`와 Level 4 재발동(30분)이 지도록 재배치** |
| 07-29 | S1.2 | 알림 dismiss를 **`reaction='ignored'` 신호로 기록**(S2.4에서) | 못 막는다면 대신 센다. 밀어서 지운 것 자체가 Guard Memory의 데이터다 |
| 07-29 | S1.2 | 뒤로가기 차단은 `OnBackInvokedDispatcher`로 | targetSdk 36 → Android 15부터 예측형 뒤로가기가 기본 활성이라 `onBackPressed()`가 호출되지 않는다. 구버전용으로 둘 다 둔다 |
| 07-29 | S1.2 | `testNotify`에 `delayMs` | FSI는 **발동 시점에** 화면이 잠겨 있어야 Activity를 띄운다. 콘솔 실행 후 잠그면 이미 늦다 |
| 07-29 | S1.2 | **'알람 앱 위장' 편법 불필요** — FSI·USE_EXACT_ALARM은 이미 부여됨 | Android 14의 FSI 제한은 **Play Store가 설치 시 회수**하는 방식이다. 사이드로드는 그 경로를 안 탄다. 실기기 `state()`가 `fullScreenIntent: true` 반환 |
| 07-29 | S1.2 | **소리의 주인을 알림 채널 → 개입 화면으로 이전** | 채널로는 요구 셋을 못 맞춘다: 생성 후 변경 불가(설정 토글 불가) · 알람 카테고리라 벨소리 모드 무시 · 소리가 POST_NOTIFICATIONS에 묶임. `guard_high_v1` 폐기, 조용한 채널 + 폴백 채널로 분리 |
| 07-29 | S1.2 | 벨소리 모드 존중 — 무음=화면만 / 진동=진동만 / 일반=설정대로 | 사용자 요구. **대가: 무음 모드가 0마찰 우회로가 된다**(§6.3의 '비용 없는 Override'). `overrideSilentAtL4`로 Level 4만 뚫는 절충을 남김 |
| 07-29 | S1.2 | 알림 권한 없어도 **개입 화면은 뜬다** | 원래 `fire()`가 `!canPost`에서 조기 반환해, 오버레이가 멀쩡해도 Guard가 통째로 침묵했다. 두 경로를 독립시킴 |
| 07-29 | S3.1b | **Level 4만 AI 검증**, 실패 시 Level 3 강등 (ADR-024) | Level 4 오발동이 이탈을 부른다. 실패 방향을 강등으로 잡아 ADR-021의 '개입이 사라지지 않는다'를 유지 |
| 07-29 | S1.3 | **릴리스 빌드 하나만 쓴다.** `npx cap run android`(디버그) 금지 | 서명이 달라 덮어쓰기가 안 되고 Android가 삭제 후 재설치를 강제한다 → 권한·`GuardAlarmStore`가 매번 초기화. 재부팅 복구 테스트 실패의 원인. `webContentsDebuggingEnabled: true`로 릴리스도 `chrome://inspect` 가능 |
| 07-29 | S1.2 | **깨어 있는 화면 개입 = `SYSTEM_ALERT_WINDOW`** (오버레이를 8월로 당김) | FSI는 화면이 잠겼을 때만 Activity를 띄우는 게 계약이다. 깨어 있는 화면을 덮으려면 백그라운드 액티비티 시작이 필요하고, Android 10+는 이를 막되 '다른 앱 위에 표시' 보유 시 예외를 준다. `fire()`가 Level 3+에서 알림과 **별개로** `startActivity`. **ADR-018의 오버레이 시점(9월)이 앞당겨짐** — 다만 '화면 일부 가림 UI'가 아니라 '항상 전체 화면 개입'이라 비용은 20줄 |

---

## 막힌 것 / 미해결

| 발견 | 단계 | 상태 |
|---|---|---|
| 리포 경로에 한글·공백 (`Desktop\새 폴더\Pos\...`) | S1.1 | 이동 권장. 안 옮기고 진행 가능하나 aapt2·MAX_PATH 오류 시 1순위 의심 대상 |
