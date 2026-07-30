# STATE — 최종 갱신 2026-07-30

## 저장소
- repo: https://github.com/mond1424/personal-os
- branch: main
- 마지막 커밋: `6a82d5e` fix(guard): 기기가 보낸 UTC 시각을 서버에서 정규화. **Guard 서버 계층(0010~0013)·동기화·큐·Life Model P1-a/b 전부 커밋됨.**
  - ✅ **0013까지 로컬·원격 모두 적용 + deploy 완료** (2026-07-29). 폰 APK도 갱신 완료.
  - ⚠️ 2026-07-30 `normalizeIso` 수정은 **커밋됐으나 deploy 대기**(서버 코드 변경 — 사용자).

## 에이전트 체인 (2026-07-30 도입)

**사용자 → Cowork → Claude Code → Codex CLI.** 문서 넷이 한 벌이다:

| 문서 | 무엇 | 주인 |
|---|---|---|
| `AGENT-CHAIN.md` | 층별 권한·파일 소유권·보고 형식 | Cowork |
| `AGENTS.md` | Codex CLI 진입 파일(CLAUDE.md를 원본으로 가리킨다) | Cowork |
| `OPERATIONS.md` | 사용자가 하는 일·붙여넣는 문장 | Cowork |
| `docs/tickets/*.md` | 지시와 보고가 같은 파일에 | Cowork 발행 · Claude Code 배정 |

이 층(Claude Code)이 지는 것: **`STATE.md`·`APP-BUILD.md`·`docs/api-surface.md`·`docs/schema-current.sql`·git의 유일한 편집자**,
`npm run verify`로 **숫자를 만드는 유일한 층**, 위임 금지 영역(트리거·마이그레이션·귀속일·Guard 발동 경로) 직접 구현,
Codex 티켓 분해·락·1차 검토. 설계 문서·`APP-PLAN`·`APP-ADR`은 읽기만 한다.

**락은 `APP-BUILD.md` 맨 위 한 줄.** 락을 쓰는 것은 Claude Code이고, 괄호 안 이름은 보유자다.

### 도입 시점에 발견된 규약 불일치 (Cowork 판단 대기)

1. **함정 번호가 갈라졌다** — `AGENTS.md`의 7번은 '전역 클래스명 충돌'인데 `CLAUDE.md`·`README0722.md`의 7번은
   'wait_extensions FK'다. 티켓이 "함정 7번"이라 쓰면 두 층이 서로 다른 것을 읽는다.
   '전역 클래스명 충돌'은 원래 11개 목록에 없고 이 문서의 '미해결' 절에만 있었다.
2. **push 권한** — `AGENT-CHAIN.md` §2·§9는 "`git push` 최종 승인은 사용자"인데,
   `CLAUDE.md` 세션 종료 규칙과 `OPERATIONS.md` §7은 Claude Code가 세션 끝에 push한다. 2:1로 후자가 맞아 보인다.
3. **티켓 파일 쓰기 권한** — `OPERATIONS.md` §2는 Codex에게 티켓의 '보고' 절을 채우라 하고
   `_TEMPLATE.md`도 "담당이 채운다"인데, `AGENT-CHAIN.md` §3 표는 "Codex는 읽기만"이다.
4. **기준선 숫자가 위층 파일에 하드코딩** — 213이 `CLAUDE.md`·`AGENTS.md`·`_TEMPLATE.md`(전부 Cowork 소유)에 박혀 있다.
   숫자를 만드는 층은 그 파일을 못 고친다 → 예시는 `smoke A → B`로 두고 실수치는 이 문서 §기준선 하나만 보는 게 맞다.
5. `CLAUDE.md`의 "`docs/*`의 유일한 편집자"는 넓다 — `docs/tickets/*`는 Cowork 발행이다.

## ★ 진행 중 — 8월 Guard v1 (APP-PLAN)

**목표: 8/31까지 Guard 탑재 Android 앱, 9/1 실사용 시작.**
계획은 `APP-PLAN.md`, 결정 근거는 `APP-ADR.md`, 진행 상태는 `APP-BUILD.md`, 개발 절차는 `GUARD-DEV-LOOP.md`.

> **S2.6 반영 절차 (2026-07-30)** — 마이그레이션 **없음**. 순서: `npm run verify` → `npm run deploy`(cron의 `ignored` 확정) → **APK 재빌드·설치**(네이티브 변경: `GuardWatch.kt`·`GuardService`·`GuardPlugin`) → GUARD-DEV-LOOP §6으로 감지 발동 확인.

완성의 정의 — 시험 일정 하나를 등록하면 전날 00:00에 보호 모드가 걸리고, 01:30(=일정시각−준비−수면 역산)에
알람 소리로 잠금화면을 점유하는 알림이 뜨고, 해제에 사유 20자 + 60초 대기가 들고, 전부 `guard_events`에 남는다.

### 1주차 (7/29~8/4) — 폰이 허용하는가만 실측. 규칙 코드 0줄.

| 단계 | 상태 |
|---|---|
| S1.1 Capacitor 골격·권한·서명 | ✅ 실기기 6항목 통과 |
| S1.2 알림 채널·FSI·개입 화면·소리/진동 정책 | ✅ 실기기 통과 (일반/진동/무음 3모드) |
| S1.3 알람 예약 + 재부팅 재등록 | 🔄 **① 낮 3분(앱 완전종료) ✅ · ② 재부팅 복구 ✅** · ③ 밤 03:00 미실시 |
| S1.4 포그라운드 서비스 + UsageStats | ✅ |
| S1.5 게이트 화면 + 권한 배너 | ⬜ |

### 2주차 (8/5~8/11) — 기록 구조 + 감지. **서버는 먼저 끝냈다**

| 단계 | 상태 |
|---|---|
| S2.1 `guard_events` 확장 (마이그레이션 0010) | ✅ |
| S2.2 `events` 보호 필드 + 서비스·라우트 | ✅ |
| S2.3 기기측 예약 (`GuardSync.kt`) | ✅ |
| S2.4 로컬 우선 기록 (ADR-023, 마이그레이션 0011) | ✅ |
| S2.5 감지 수집 | ✅ |
| **S2.6 감지 기반 발동** (ADR-025) | ✅ **계획에 없던 추가 단계** |

**S2.6 — 감지가 방아쇠가 됐다(ADR-025).** 발동이 `protect_from` 일정에만 걸려 있으면 루프가 몇 주에 한 번 돌고,
그러면 9~11월에 전례가 쌓이지 않는다 — ADR-014가 말한 실사용 기간의 목적 자체가 무너진다.
- **경로 B 신설**: `GuardWatch.evaluate()`가 `GuardService` 60초 폴링에 얹혀 결정론 규칙을 평가한다.
  취침 창 안 · 화면 켜짐 · **연속** 사용 ≥ N분 → Level 2(1회) → 이후 30분마다 Level 3, 하룻밤 상한 M회.
  기본값 00:30~06:00 / 20분 / 5회 (`GuardSettings`, 기기 저장 — 새벽에 서버가 안 붙어도 판단이 선다).
- **경로 A(시각 예약)와 독립**이다. B가 죽어도 A는 예약이 시스템에 있어 그대로 발동한다 — ADR-018이 지키려던 견고성 유지.
- **루프의 닫는 쪽**: 반응 없이 지나간 발동을 30분 cron이 `ignored`로 확정한다(`guard.finalizeIgnored`).
  유예 **36시간** — 기기가 오프라인이면 발동과 반응을 함께 늦게 올리고 재동기화는 하루 한 번이라,
  먼저 박으면 트리거가 진짜 반응을 막고 소급 복구가 불가능하다.
- 확인용 브리지: `G.watchStatus()` / `G.evaluateWatch()` / `G.setWatch({...})` / `G.resetWatchNight()` — 절차는 GUARD-DEV-LOOP §6.
- **`screen_on`을 서비스 시작 시 직접 기록한다.** 화면 on/off는 런타임 등록만 받아, 서비스가 시작된 시점에
  이미 켜져 있으면 아무도 기록해 주지 않는다 → 연속 시간이 다음 off/on 주기까지 0. 재부팅 직후, 즉 하필 밤에 드러난다.

**S2.3** — 기기가 `/api/guard/schedule`을 받아 `fires[]`를 `setAlarmClock`으로 전부 예약한다. 멱등(서버발 예약만 갈아엎음, 테스트 알람은 보존). **재동기화는 `경계 + 10분`** — 경계가 사용자 설정이라 서버가 응답에 `boundary`를 실어 주고 기기가 그걸 따른다(하드코딩했다가 06:00 설정에서 경계 이전에 도는 버그를 잡음). 앱을 안 열어도 하루 1회 갱신.

**S2.4** — 발동 순서를 뒤집었다: **① 로컬 기록 → ② 개입 화면 → ③ 알림 → (온라인이면) 밀어 올리기.** 발동 경로에 서버 왕복이 있으면 새벽에 기록이 통째로 사라지는데, 개입이 실패하는 밤은 대개 상황이 정상이 아닌 밤이라 하필 그날 데이터가 빈다.
- 재시도 멱등을 위해 기기가 `client_id`(UUID)를 만든다. 서버가 UNIQUE로 들고 있어(0011) 응답만 유실된 재전송이 두 행이 되지 않는다.
- `record()`가 upsert처럼 동작 — 발동만 / 발동+반응 동시(오프라인) / 반응 후행, 셋을 한 엔드포인트로 받는다.
- 큐는 400·409를 버리고 넘어간다. 안 그러면 형식 오류 하나로 큐가 영원히 막힌다.

**0010이 한 것** — `guard_events` 재작성(`reaction`에 `ignored` 추가가 CHECK 변경이라 ALTER 불가) + `risk_snapshot`·`mode`·`source`·`foreground_app`·`ai_*` / `events`에 보호 4필드 / `guard_modes`(ADR-019)·`watch_apps`(ADR-022) 선반영 — **3주차·4주차의 마이그레이션 부담을 없앴다.**

**불변성은 '통짜 금지'가 아니라 '한 번만 채울 수 있다'** — 발동 시 행을 만들고 반응·분류·결과는 나중에 온다. 트리거가 `NULL → 값`만 허용한다. 이래야 "발동했지만 아무 반응이 없었다"(= `ignored`)도 행으로 남는다.

**데드라인은 저장하지 않는다** — `guard.schedule`이 조회 시 역산한다(원칙 4). `일정시각 − 준비(90) − 수면(360)` → 09:00 시험이면 01:30(설계 §6.1 예시와 일치).

**①의 통과가 1주차 게이트의 본체다** — 앱을 완전히 종료한 상태에서 시스템이 스스로 깨워 개입 화면을 띄웠다.
8월 계획이 서 있는 가정이 증명됐다.

### 미커밋 (APP-2) — Guard 네이티브 모듈

```
android/app/src/main/java/dev/mond1424/personalos/guard/
  GuardNotifications.kt  채널 4종·발동(알림 ∥ 개입화면 독립)
  GuardAlertActivity.kt  FSI 대상 화면·뒤로가기 차단·소리 주인
  GuardAlarmPlayer.kt    소리·진동 재생(벨소리 모드 반영)
  GuardSettings.kt       sound/vibration/overrideSilentAtL4 + 정책
  GuardAlarms.kt         setAlarmClock 예약·취소·복구 + 예약 원본 저장소
  AlarmReceiver.kt       실제 발동 지점(시스템이 앱을 깨움)
  BootReceiver.kt        재부팅·앱 업데이트 후 복구
  GuardPlugin.kt         웹 브리지
+ res/layout/activity_guard_alert.xml · res/drawable/ic_guard.xml
+ AndroidManifest(권한·Activity·Receiver 2종) · styles.xml(Theme.GuardAlert)
+ build.gradle(Kotlin 2.1.0) · MainActivity.java(registerPlugin)
+ capacitor.config.ts(webContentsDebuggingEnabled) · test/e2e.mjs(CI=true)
+ public/app.js(syncOverlay — 팝업 겹침 깊이)
```

### 1주차에 물린 것 (전부 해결)

- **Android 14+ `setOngoing(true)` 무력화** — 앱이 만드는 '못 지우는 알림'은 없다. 마찰을 화면 + 재발동 주기로 이전
- **targetSdk 35+ 예측형 뒤로가기** — `onBackPressed()` 미호출. `OnBackInvokedDispatcher` 필요
- **`VIBRATE` 권한 미선언** — 진동이 예외 없이 조용히 무시됨
- **채널 설정 불변** — 소리를 설정으로 끄려면 채널이 아니라 화면이 소리의 주인이어야 한다. `guard_high_v1` 폐기 → 조용한 채널 + 폴백 채널
- **디버그/릴리스 서명 혼용** — 삭제 후 재설치를 강제해 권한·예약 원본이 매번 초기화. **릴리스 빌드만 쓴다**(`webContentsDebuggingEnabled: true`)
- **wrangler 4.1x 마이그레이션 프롬프트** — `e2e.mjs`에 `CI=true`(capacitor 설치 시 락파일 갱신 여파)

### 3·4주차 — 개입과 루프. **완성의 정의는 이미 충족됐다**

| 단계 | 상태 |
|---|---|
| S3.1 데드라인 역산 + Level 1~4 결정론 발동 | ✅ (S2.3에 흡수 — 서버가 `fires[]`로 펼치고 기기가 예약) |
| S3.2 Override 마찰 | ✅ |
| S4.1 `risk_snapshot` 수집 | ✅ (감지가 붙어 `screen_on_sec`·`unlocks`·`top_apps`까지) |
| S4.2 outcome 확정 카드 | ✅ **루프가 닫혔다** |
| S4.4 PC 스키마 자리 | ✅ (0010 `watch_apps`) |
| S3.1b Level 4 AI 검증 (ADR-024) | ⬜ |
| S3.3 Level 4 신규 작업 차단 | ⬜ |
| S3.4 모드 UI | ⬜ |
| S4.3 알림함 | ⬜ |
| S1.5 게이트 화면 + 권한 배너 | ⬜ |

**루프 전체가 돈다**: `감지·데드라인 역산 → 발동(FSI+알람) → 반응(마찰) → 로컬 기록 → 서버 → outcome 확정`

**S3.2 — Override 마찰.** 마찰을 처음부터 보여주지 않는다([알겠습니다] / [그래도 계속하기]를 나란히 두면 대등한 선택지로 읽힌다). 대기는 사유 입력과 **동시에** 흐른다(순차면 짜증이 된다). 배수를 서버에서 못 받으면 1.0 — 통신 실패가 마찰을 없애면 그게 우회로다.
- **사유 길이 하한(20자)은 폐기했다.** 실사용에서 마찰이 아니라 강제로 읽혔다. §6.3은 "비용을 치르게 한다"이지 "분량을 채우게 한다"가 아니다. 비어 있지만 않으면 통과.
- 마찰 화면 진입 즉시 소리·진동을 끈다. 울리는 채로는 사유를 쓸 수 없다.

**S4.2 — outcome.** 한 번에 하나만 묻는다. 여러 개를 늘어놓으면 대충 눌러 치우고, 그렇게 들어온 outcome은 **없는 것보다 나쁘다**(보정을 틀린 방향으로 끈다). `style.css`의 미사용 `.guardbar`가 설계 §6을 위해 미리 있던 자리였고 그대로 썼다.

### 물린 것 — front가 잡은 실제 결함 (2026-07-29)

"짧은 가로 이동은 무시(임계값)"가 실패했다. **플레이크가 아니라 검사의 결함이었다.**
- `loadGuardOutcome` 추가로 이벤트 루프가 조금 느려지자 `dt`가 `VEL_MIN_DT`(16)를 넘겨, 40px 이동이 `2.5 px/ms`로 계산돼 `FLICK_V`(0.5)를 넘었다.
- **앱 코드는 맞다** — 16ms에 40px는 실제로 빠른 손짓이다. 검사가 이벤트를 동기로 쏘면서 "속도 0"을 가정한 것이 틀렸다. **시간을 안 흘리면서 시간의 함수를 검사했다.**
- 조치: `swipe`에 실제 간격(120ms)을 넣었다. `VEL_WIN(90) < 120 < VEL_STALE(130)`이라 구간별 속도가 재지고, 루프가 밀리면 속도가 더 낮아져 **지연이 통과 방향으로만 작용**한다. 검사 이름도 "짧고 **느린** 가로 이동"으로 정정.

### 병행 트랙 — Me Reinforcement Plan (Phase 1)

계획서 `me-reinforcement-plan.md`. **§9 오픈 이슈는 닫혔다** — 안드로이드 앱이 기존 Worker + D1을 그대로 쓴다(Capacitor 원격 로드, 네이티브는 Guard 전용 계층뿐). 백엔드 재작성 없음.

Guard v1이 1순위라는 건 안 바뀐다. Phase 1을 셋으로 쪼개 **UI를 맨 뒤에** 뒀다 — 밀리면 뒤쪽만 잘라낸다.

| 조각 | 내용 | 상태 |
|---|---|---|
| **P1-a** | 마이그레이션 0012 — analysis 앵커 4컬럼+backfill · 기간 `kind`/`dday_label` · `lm_item`(version 트리거) · `lm_schema` 레지스트리 | ✅ |
| **P1-b** | 경량 스키마 검증기 · `lm_item` CRUD API · Me→Overview 이관 · analysis가 앵커·`source_versions` 실제 기록 | ✅ |
| **P1-c** | 하단 바 (4탭/Me) 분리·애니메이션 · Education 폼 · Goals 디데이 표시 | ⬜ **Guard 3주차 이후.** 8/25에 Guard 4주차가 안 끝났으면 9월로 미룬다 |

**P1-a를 8월로 당긴 이유** — 계획서 §2.3: `source_versions`는 생성 시점의 입력 스냅샷이라 나중에 만들 수 없다. 9~11월 analysis가 앵커 없이 쌓이면 그 구간은 영영 stale 판정(§5) 밖이다. `guard_events.risk_snapshot`과 같은 논리(ADR-020).

**`buildCoreContext()`는 아직 만들지 않았다.** 현재 Guard에는 AI 판단부가 없다(ADR-021로 발동이 결정론). 유일한 소비처가 S3.1b(Level 4 AI 검증, 3주차)이므로 그때 함께 짠다 — 지금 만들면 소비처 없는 껍데기다.

### 다음 마이그레이션 번호

`0013_analysis_backfill`이 최신(디렉터리 확인 2026-07-30). **알림 아웃박스=0014 · 인증(9월)=0015.**
추가 시 `test/smoke.ts`의 하드코딩 스키마 목록에도 파일명을 넣는다.

## raw 링크 (Chat이 직접 읽는 주소)
- 설계문서(권위) https://raw.githubusercontent.com/mond1424/personal-os/main/personal-agent-design_v0.9.md
- APP-PLAN      https://raw.githubusercontent.com/mond1424/personal-os/main/APP-PLAN.md
- APP-ADR       https://raw.githubusercontent.com/mond1424/personal-os/main/APP-ADR.md
- APP-BUILD     https://raw.githubusercontent.com/mond1424/personal-os/main/APP-BUILD.md
- GUARD-DEV-LOOP https://raw.githubusercontent.com/mond1424/personal-os/main/GUARD-DEV-LOOP.md
- CLAUDE.md      https://raw.githubusercontent.com/mond1424/personal-os/main/CLAUDE.md
- README0722     https://raw.githubusercontent.com/mond1424/personal-os/main/README0722.md
- 사용설명서0722 https://raw.githubusercontent.com/mond1424/personal-os/main/사용설명서0722.md
- REFACTOR-PLAN  https://raw.githubusercontent.com/mond1424/personal-os/main/REFACTOR-PLAN.md
- WORK-PLAN-0726 https://raw.githubusercontent.com/mond1424/personal-os/main/WORK-PLAN-0726.md
- STATE.md       https://raw.githubusercontent.com/mond1424/personal-os/main/STATE.md
- api-surface    https://raw.githubusercontent.com/mond1424/personal-os/main/docs/api-surface.md
- schema         https://raw.githubusercontent.com/mond1424/personal-os/main/docs/schema-current.sql
- 라우터         https://raw.githubusercontent.com/mond1424/personal-os/main/src/index.ts
- types          https://raw.githubusercontent.com/mond1424/personal-os/main/src/types.ts
- db/index.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/db/index.ts
- daily.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/daily.ts
- tasks.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/tasks.ts
- periods.ts     https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/periods.ts
- events.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/events.ts
- memos.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/memos.ts
- me.ts          https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/me.ts
- analysis.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/analysis.ts
- guard.ts       https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/guard.ts
- scheduled.ts   https://raw.githubusercontent.com/mond1424/personal-os/main/src/scheduled.ts
- lib/time.ts    https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/time.ts
- lib/id.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/id.ts
- lib/ai.ts      https://raw.githubusercontent.com/mond1424/personal-os/main/src/lib/ai.ts
- app.js         https://raw.githubusercontent.com/mond1424/personal-os/main/public/app.js
- api.js         https://raw.githubusercontent.com/mond1424/personal-os/main/public/api.js
- index.html     https://raw.githubusercontent.com/mond1424/personal-os/main/public/index.html
- style.css      https://raw.githubusercontent.com/mond1424/personal-os/main/public/style.css

## 기준선
typecheck 통과 / **smoke 213** / front 167 / 실패 0
(S2.6 `ignored` 확정: 207→211 — 유예 넘김·cron 보고·유예 안쪽 NULL 유지·재실행 멱등 4건.
 UTC 시각 정규화: 211→213 — 귀속일·저장 표기 2건.)

### 물린 것 — 기기가 UTC로 보낸다 (2026-07-30, 실기기 덤프에서 발견)

`GuardEventQueue.nowIso()`가 `2026-07-29T20:09:15Z`(UTC)로 보내는데, `attributionOfIso`와
`fired_at` 문자열 비교는 **표기된 시각 자리를 로컬로 읽는다.**
- 밤 발동(00:30~06:00 KST = UTC 15:30~21:00)은 경계 위라 안 드러났다. **낮 발동에서 물린다** —
  UTC 00~06시(= KST 09~15시)가 경계(06:00) 아래로 떨어져 **전날로 귀속**된다.
- `finalizeIgnored`의 36시간 유예도 같은 이유로 실효 27시간이 됐다.
- 조치: `lib/time.ts`에 `normalizeIso` — 오프셋이 붙은 표기만 로컬 표기로 변환(오프셋 없으면 이미 로컬로 본다).
  `record()`의 `fired_at`·`applyReaction()`의 `reacted_at`이 통과한다.
- **기기가 아니라 서버에서 흡수했다.** APK 재빌드가 필요 없고, 9월 PC 에이전트가 같은 실수를 해도 한 번 더 안 물린다.
- 기존 14행은 `Z` 표기로 남아 있다(귀속일은 우연히 전부 맞았다). 소급 수정하지 않는다 — 개입 이력은 고치지 않는다.
(S3.2에서 사유 길이 하한을 걷어내며 빈 사유 검사 1건 추가.)
(0010 Guard 서버: 154→180 — 보호 규칙·데드라인 역산·모드·발동 기록·불변성·watch_apps 26건.
 0011 client_id 멱등: 180→184 — 재전송·발동+반응 동시·반응 후행 4건.
 0012 Life Model: 184→206 — 스키마 레지스트리·검증기·CRUD·version 트리거·Me 이관 22건.)
(WORK-PLAN-0726: smoke 148→154 취소 사유 6건, front 164→167 취소 사유 3건.
 그 앞 S1 분석 depth·S3′ 마감 유도 포함 누적치 — smoke 145→154, front 157→167.)

## 마이그레이션
최신: **`0013_analysis_backfill`** — ✅ **로컬·원격 적용 완료** (2026-07-29). ⚠️ deploy 대기
- `0013_analysis_backfill` — 기존 analysis에 날짜 앵커 backfill. **트리거를 내렸다 원문 그대로 복원**한다(아래 사고 참조)
- `0010_guard` — Guard v1: guard_events 재작성(`reaction`에 `ignored` 추가가 CHECK 변경이라 ALTER 불가) · `events` 보호 4필드 · `guard_modes`(ADR-019) · `watch_apps`(ADR-022)
- `0011_guard_sync` — `guard_events.client_id` + 부분 UNIQUE 인덱스(NULL 제외). 로컬 우선 기록의 재시도 멱등 키(ADR-023)
- `test/smoke.ts`의 하드코딩 스키마 목록에 둘 다 등록 완료.
- `0012_life_model` — analysis 앵커(anchor_type/anchor_id/model_tier/source_versions) + 기존 행 backfill · `periods.kind`/`dday_label` · `lm_item`(version 트리거) · `lm_schema` 레지스트리(overview·goals·education v1)
- **다음 번호: 알림 아웃박스=0014 · 인증(9월)=0015.**

### ⚠️ 물린 것 — 로컬 통과, 원격 실패 (2026-07-29)

0012에 `UPDATE analyses ... backfill`을 넣었더니 **로컬은 통과하고 원격만 터졌다**(`SQLITE_CONSTRAINT_TRIGGER`).

- 원인: `trg_analyses_no_upd`가 analyses의 모든 UPDATE를 막는다(설계 §5.4 영구 보존).
- **로컬 `analyses`가 0행이라 UPDATE가 no-op이 되어 트리거가 깨어나지 않았다.** 실제 분석이 쌓인 원격에서만 발화.
- 원격은 전부 롤백됐고(`d1_migrations` 최신이 0011로 남음) 부분 적용은 없었다.
- 조치: backfill을 `0013`으로 분리하고 `DROP TRIGGER → UPDATE → CREATE TRIGGER`(원문 그대로)로 감쌌다. 불변성은 완화하지 않았다.

**교훈 — 트리거가 걸린 테이블에 backfill을 넣을 때는 로컬 검증이 원격을 보장하지 못한다.**
트리거 발화가 데이터 유무에 갈리기 때문이다. 인메모리 sqlite에 **행을 넣은 상태**로 재현해서 확인한다.

직전: `0009_cancel_reason` (…0007_defer_reason · 0008_cancel_task · 0009_cancel_reason)
- **0009_cancel_reason**: `tasks`에 `cancel_reason`(자유 텍스트)·`cancelled_by`(`'user'`/`'guard'`) 추가 + 뷰 재생성(`v_task_stats`에 두 컬럼 노출, 0008의 `state` CASE·`is_waiting`·`v_period_achievement` 조건은 그대로 보존). 트리거 `trg_task_cancel_excl` 미접촉. smoke 스키마 목록에도 등록.
  - ✅ **로컬 적용 완료.** ⚠️ **원격 미적용 — 사용자가 `npx wrangler d1 migrations apply personal-os --remote` 실행 필요**(배포보다 먼저, `--local`→`--remote` 순서).
- **0008_cancel_task**: `tasks`에 `cancelled_at`/`cancelled_on` + 트리거 `trg_task_cancel_excl`(완료·취소 상호배제) + 뷰 재생성(`v_task_stats.state` 추가, `v_period_achievement`·`is_waiting` 취소 제외).
  - ✅ 로컬·원격 모두 적용 완료 + deploy 완료 (2026-07-26 확인).
- ✅ 0007까지는 로컬·원격 모두 적용 완료 (2026-07-23 확인).
- `0007_defer_reason`: `schedule_entries`에 `defer_reason TEXT` 추가(미루기 사유). **WORK-PLAN의 `task_entries` 표기는 오기** — 실제 테이블은 `schedule_entries`(예정 항목·rate가 있는 곳).

## 이번 세션 (2026-07-26) — WORK-PLAN-0726 S1~S4 구현 완료
산출물은 지시 문서 **`WORK-PLAN-0726.md`(리포 루트, rev.2) 그대로** — 설계 결정은 직전 세션에 이미 확정했고, 이번 세션에 단계별로 구현·검증했다. plan의 "단계 단위로 진행·정지" 원칙대로 S1→S2→S3′→S4 순서, 각 단계 후 typecheck+smoke+front 확인.
- **[S1 분석 출력량]** `analysis.ts`에 `DEPTH` 상수(`normal`/`detailed`/`deep`, 기본 `detailed`) + `create(…, depth?)`. 잘못된 값·누락은 400 아니라 `detailed` fallback. 선택값은 `context_meta.depth`에 보존(신규 컬럼 없음). `#anal-depth` 세그(`.wsegs`/`.wseg` 재사용) + 펼친 분석 카드에 분량 라벨(추가 보강, 사용자 지시).
  - **plan에 없던 보정**: `boot()`·`goInbox()`가 `$$(".wseg")`로 **전역**을 훑고 있어, depth 세그를 works 뷰 전환과 분리하려면 선택자를 `#scr-works .wseg`/`#anal-depth .wseg`로 좁혀야 했다(아래 전역 클래스명 충돌 항목 참조).
- **[S2 공용 모달]** `.modal`/`.mbox` grid→flex(S2-a) + `#cf-text` `overflow-wrap:anywhere`(S2-b). **다만 사용자가 실제로 겪던 증상은 `#confirm`이 아니라 취소 후 뜨는 노란 toast였다** — `toast(msg,"warn")`이 붙이는 무접두사 `warn`이 전역 15px 원형 배지 규칙(`style.css:79`)과 충돌해 27px로 접혀 있었다. `.toast.warn`→`.toast.t-warn`(app.js·style.css)으로 별도 수정. S2-a 자체는 Chrome 390px·데스크톱 양쪽에서 무해·유효함을 측정으로 확인.
- **[S3′ 마감 시 상태 서술 유도]** `askClose(kind)` — `feelings_text`가 빈 날에만 확인 박스에 `#cf-feel` textarea. `closeDay`보다 먼저 저장(순서 뒤집히면 트리거 409). 백엔드 무변경.
- **[S4 취소 사유]** `0009_cancel_reason`(로컬만 적용) + `cancelTask(env,t,id,reason?)`(500자 제한, append-only) + 취소 확인 박스 `#cf-reason` + 상세 시트 사유 표시(해제 상태에선 미노출).
  - **plan에 없던 보정**: 라우터가 `body(c)`(본문 없으면 400)를 그대로 쓰면 무본문 `POST /cancel`이 깨진다 — smoke가 6건 실패로 잡음. 선택적 본문 헬퍼 `bodyOpt` 추가로 해결.
- 세션 종료 문서화: `docs/api-surface.md`(analyses `depth`, cancel `reason`/`cancel_reason` 응답) · `docs/schema-current.sql`(0009 헤더·tasks 컬럼·view) 재생성.
- 검증 누적: typecheck 통과 · smoke 145→148(S1)→154(S4) · front 157→162(S1)→164(S3′)→167(S4) · 실패 0. **로컬 마이그레이션만(0009). 원격 적용·deploy는 사용자.**

## 직전 세션 (2026-07-23) — CANCEL-0723 취소 상태 도입 (마이그레이션 0008)
- **제3의 종결 '취소'** — 삭제가 1.3 불변성(마감/Guard 참조)에 막히는 일을 기록 보존한 채 목록에서 내린다. 삭제는 분리 유지, 409에서 취소 안내.
- **0008**: `tasks.cancelled_at`/`cancelled_on` + 트리거(완료·취소 상호배제). status enum 확장 안 함(CHECK 2개·테이블 재작성 회피). **상태의 유일한 진실 = `v_task_stats.state`**(`not_finished`/`finished`/`cancelled`). `v_period_achievement`·`is_waiting` 취소 제외(달성률 오염·21일 시계 방지).
- **db**: `stCancelTask`/`stUncancelTask`/`stDeleteOpenEntries`(열린 날 예정만 — `NOT EXISTS(closed)`로 미래 예정 포함, 마감 항목은 트리거 ABORT 회피 위해 제외). `worksDeferring`/`worksByPeriod` status→state, `worksDone` UNION으로 취소행(`on_date`/`kind`), `calEntries`·`classifyAt`에 표시용 `is_cancelled`(분류 로직 불변).
- **services/tasks**: `status==='finished'` 판정을 전부 `state`로. defer/schedule/extend/complete에 취소 가드(409). **`deferTask`는 취소 확인을 예정 조회보다 먼저** — 취소 시 열린 예정이 없어 entry 404가 먼저 터지던 것 수정(smoke가 잡음). 신규 `cancelTask`(kept_dates)·`uncancelTask`(예정 복구 없이 대기 복귀). `deleteTask` 409에 `suggest:"cancel"`.
- **types/index**: `ApiError`에 `suggest?` → onError가 `{error, suggest}`. `TaskStats`에 state/cancelled_at/cancelled_on.
- **프런트**: 상세 시트 `[취소]`·`[취소 해제]` 신설, `[삭제]`(=deleteTask)를 '삭제'로 개명(전엔 '취소' 표기라 충돌). 취소된 task는 완료·미루기·연장·취소 숨기고 '취소 해제'+'취소됨' 배지. 삭제 409(suggest) → '대신 취소하기' 원탭. done 세그에 취소 행(흐림+취소선). cancel 확인문구에 kept_dates.
- 검증: typecheck 통과 · smoke 129→145 · front 151→157 · 실패 0.

## 직전 세션 (2026-07-23) — CAL-PLAN-0723 캘린더 셀 개선 (마이그레이션 없음)
- **1단계** `public/style.css` — 시각 지정 일정 앞 점(`.ev.evt.timed::before`) 제거. 시각 있는/종일 일정의 제목 시작 위치 일치, 제목 1~2자 더 노출. `.timed` 클래스 부여는 향후 훅으로 유지(app.js). 시각은 날짜 팝업에서 '종일/14:30'으로 이미 명확.
- **2단계(진단만·코드 무변경)** 7/24 '포르쉐 바이브 티켓' 미표시 = **분기 B**로 확정. `deferred_to` 없는 살아있는 할 일 2건인데 셀은 할 일을 '항상 1줄 대표'로 압축 → 포르쉐는 대표(created_at 첫)가 아니라 `+1`에만 접힘. 조회 계층 정상·버그 아님 → 3단계 동적 예산으로 해소.
- **선행 A** `public/{app.js,style.css}` — `+n` 배지 잘림(실버그) 수정. 배지가 제목과 같은 `.ev`(overflow:hidden;ellipsis) 안이라 제목이 넘치면 배지까지 잘렸다. 제목을 `.etxt`로 감싸 말줄임 분리, `.ev.tsum` flex화. `.etxt`는 자체 포맷팅 문맥이라 부모 취소선이 안 번져 `text-decoration:inherit`로 완료·이동 취소선 회귀 방지. **처음 `.tt`로 썼다가 전역 `.tt`(14.5px 시트 제목)와 충돌해 셀 글자가 커진 것 발견 → `.etxt`로 개명(`2fad8ad`).**
- **3단계** 셀 memo 노출 + 종류별 보더 인코딩 + 동적 공간 예산 + `.dr` 마커 축소:
  - 3-a `src/db/index.ts` 신규 `calMemos`(날짜별 대표 1건[가장 이른 ts]+개수). `calendar()`(daily.ts) 응답에 **`memos` 추가**. `calDiaryDates`에서 **memo 조건 제거** → `.dr` 마커 = 마감·점수·감정·로그만.
  - 3-b `public/app.js` 셀 공간 예산을 **동적 재배분**(상수 `CELL_MAX_LINES=4, CELL_EV_MAX=2, CELL_TK_MAX=2`): 일정(최대2+초과 '일정 +N')→할 일 1줄→memo 1줄→남으면 할 일 2번째 줄. memo 자리를 먼저 비워 할 일 확장이 memo를 굶기지 않게. 할 일 여러 줄은 살아있는 항목(미완료·미이동) created_at 순 우선, `+n`은 마지막 표시 줄에. memo 줄은 보더 없이 `.etxt`+`+n`.
  - 3-c `public/style.css` `.ev.memo`(border-left transparent로 폭 유지·글자 시작 정렬, `--faint` 500). 3-d 팝업=전문/셀=대표+n 관계 주석.
  - `test/smoke.ts` — memo→diary 마커 검사를 **memo→`memos` 줄 검사**로 교체(마커 축소 반영, 개수 불변).
  - **회귀 잡음 1건**: 셀 memo 변수를 `mm`으로 뒀다가 `rowHtml(row, mm)`의 '월' 파라미터를 셰도잉 → TDZ ReferenceError로 renderCalendar 전체가 던져 셀 0개. **front가 잡아냄** → `mo`로 개명해 해소.
- 검증: typecheck 통과 · smoke 129(무변경, 검사 1건 재타겟) · front 151(무회귀) · 실패 0. **마이그레이션·스키마 무변경.**

## 직전 세션 (2026-07-23) — 실사용 피드백 4건 (UX, 프런트+문서만)
- **[#1 캘린더 기간]** `public/app.js` renderCalendar — `#p-list`를 범례와 동일한 이번 달 겹침 필터(`start_date≤curTo && end_date≥curFrom`)로 축소. `#p-cnt`도 이번 달 기준. 빈 문구 "이번 달엔 기간이 없어요". 목록·편집(`openPeriod`)·다른 달(달 넘기면 재표시)은 유지 — 전체 나열만 제거.
- **[#2 me 직접입력]** `public/{app.js,index.html}` — 고정 5필드를 값 없어도 항상 노출("아직 없음 — 눌러서 입력해요")로 직접입력 진입 명확화 + 필드별 가이드(`ME_GUIDE`: 시트 상시설명 `#me-guide` + textarea placeholder 예시). 5필드가 다 보여 무의미해진 '+ 필드 추가'(`me-add`)·`addMeField` 제거. **백엔드·마이그레이션 무변경**(`putMeField`는 이미 `/^[a-z_]{1,40}$/` 임의 필드 허용). 설계 §3(고정 필드 프레임)과 정합.
- **[#3 캘린더 모션]** `public/{app.js,index.html,style.css}` — 둥근 카드 chrome(border·radius·bg)과 요일줄(`CAL_WKDAYS`)을 고정 프레임 `.calbox`→각 `.calpane`(월 카드)로 이전. 이제 **카드가 통째로 슬라이드**(고정 창 안 grid만 미끄러지던 '흉내' 해소). ‹/› 화살표도 무모션 즉시교체→`calGo` 슬라이드로 통일. 색은 기존 변수만(다크 자동, 함정 5). 슬라이드 자체는 원래 진짜 3-pane 트랙 — 구조 재설계가 아니라 카드 단위로 격상. front line 216(cal-next)이 이제 `calGo` 경로를 타지만 translateX 문자열 동일→검사 통과.
- **[#4 대기행 폭]** `public/index.html` — `#today-wait` `width:65%`→`fit-content;min-width:60%;max-width:90%`, `#tw-text` `nowrap`+`ellipsis`+`min-width:0`. 내용따라 60~90% 유동·항상 한 줄(초과 시 …).
- **문서**: `CLAUDE.md` 기준선 문구 `smoke124/front145`→`129/151`로 정정(직전 세션에 STATE는 이미 129/151, CLAUDE만 지연됨. stash로 변경 전 코드도 151 확인).
- 검증: typecheck 통과 · smoke 129(무변경) · front 151(무회귀) · 실패 0. **사용자 `deploy` + 폰 실사용 정상 확인 완료.**

## 직전 세션 (2026-07-23) — WORK-PLAN-0723 (1~3단계 완료)
- **1단계 완료** (항목 1·2·3·5, 프런트 표시/모션만, 백엔드 무변경):
  - [#1] `public/style.css` — 다크모드 `.wseg.on` 선택색 오버라이드 2곳 추가(미디어쿼리+data-theme). "이월 중" 세그가 hotN 명시도에 밀려 선택 시 배경이 안 바뀌던 것 수정.
  - [#2] `public/style.css` — `.screens`에 `touch-action:pan-y` 추가. 탭 가로 스와이프가 네이티브 스크롤에 먹혀 무효화되던 것. **폰 실측 대기**.
  - [#3] `public/app.js` — 경계 스트레치 진폭↑(`STRETCH_MAX 48→90`, `STRETCH_K 0.3→0.42`)+스냅백 전용 곡선 분리(`STRETCH_BACK_MS 460`/`cubic-bezier(.22,1,.36,1)`, 탭 전환 `TRACK_MS` 미접촉). **폰 실측 후 미세조정**.
  - [#5] `public/index.html` — `#today-wait` 인라인 `width:100%→65%`+`margin-right:auto`(좌측 고정). 대기 행을 시각적으로 하위로.
  - 검증: typecheck 통과 · smoke 124 · front 145 · 실패 0 (무회귀).
- **2단계 완료** (완료율 화면 제거 + 미루기 사유 `defer_reason`, migration 0007):
  - 2-a 완료율 **화면만 제거**(DB 컬럼·완료 로직·`rate=100` 완료 신호는 유지): `app.js` 리스트 pct 배지 2곳·날짜 시트 tag/모노칸 제거·치환. `rbar`/`rateSet`/`rateOf`/`setRate`/`stSetRate` 등 함수·라우터는 그대로.
  - 2-b `migrations/0007_defer_reason.sql`(`schedule_entries.defer_reason`) + `db.stSetDeferReason` + `tasks.deferTask(reason?)` + 라우터/`api.js` `defer(reason)` + 미루기 시트를 완료율 바→사유 `textarea`(#dfx-reason)로 교체. 사유는 도착지(새 예정) 항목에 저장.
  - **2단계 보강**(사용자 지시): task 상세 시트(`#tk-rates`)의 완료율도 제거 — 헤더 `완료율`→`상태`, 본문 `{n}%`/문구를 상태(완료/대기/예정)로, SCHEDULE 이력의 `완료율 {n}%` 제거, 완료 버튼 `완료 100%`→`완료`, 완료 토스트 `완료 100%`→`완료`, 날짜 시트 '할 일' 부제 `완료율·미루기…`→`예정·미루기 이력`. 이제 리스트·날짜 시트·미루기 시트·상세 시트 **어디에도 % 없음**. `rbar`/`rateSet`/`setRate`/DB·완료(rate=100) 로직은 유지(B-1 재사용 대비).
  - `defer_reason` 분석 화면 노출은 향후.
  - 검증: typecheck 통과 · smoke 124→127 · front 145 · 실패 0.
- **3단계 완료** (memo 통합 — 어느 날짜에든 + 날짜 시트 통합 입력 폼, **신규 마이그레이션 없음**):
  - 3-a `memos.ts addMemo`: daily 없으면 404 대신 `stOpenDaily`(기존 INSERT…ON CONFLICT DO NOTHING)로 open daily ensure 후 memo 붙임. → 과거·오늘·미래 어디든 memo.
  - 3-a `db.calDiaryDates`: 캘린더 `.dr` 마커가 **빈 daily**를 오인하지 않게, `status=closed` 또는 score/feelings/logs/memos가 실제로 있는 날만 반환하도록 변경(빈 자동 daily 제외, memo 있는 날은 포함).
  - 3-b `app.js openDay`: 흩어진 3개 추가 UI(일정 버튼·`#day-add` 할일·`#memo-input` memo)를 **통합 추가영역** `addZoneHtml(k,relation,closed)` + `setAddMode`로 합침. 세그 `[일정|할 일|memo]`, relation별 가용(past=일정·memo / today·future=셋 다). 일정은 기존 `openEventSheet`(시각 드럼·마감 경고) 재사용, 할일·memo는 인라인(`addTaskOn`/`sendMemo` 그대로). memo 표시는 전 relation으로 확장.
  - 검증: typecheck 통과 · smoke 127→129 · front 145→151 · 실패 0.

## 최근 세션에서 바뀐 것 (UX 개선 A-1~A-6)
- A-1 [#3] `public/style.css` — 다크모드 캘린더 색: 다른 달 날짜 `var(--faint)`, 일요일 헤더 다크 오버라이드
- A-2 [#7] `src/lib/ai.ts` — Gemini 모델 `-latest` 별칭(gemini-2.5-* 404 회피, 요청 로직 불변)
- A-3 [#5 Phase1] `public/{app.js,style.css}`·`test/front.mjs` — 완료율 인라인 막대 제거→읽기전용, 편집은 미루기 시트만
- A-4 [#2] `public/{app.js,style.css}`·`test/front.mjs` — 캘린더 달 간격(CAL_GAP=20)+터치 씹힘 완화(dragBlockUntil 200·전환 후 즉시 재중심화·calGen 가드)
- A-5 [#1] `public/app.js` — 스와이프 인접탭 프리렌더(드럼 느낌)+민감도 하향(AXIS_LOCK20·축비1.9·RATIO0.35·FLICK0.5)
- A-6 [#4] `public/app.js` — 경계 스트레치(러버밴드 대체, `bindEdgeStretch` 격리·off 가능)
- **기준선 smoke 124 · front 147→145**(A-3에서 인라인 완료율 검사를 미루기 시트 재탭 검사로 이동·통합). 매 커밋 전 검증, 실패 0

## 미해결 / 다음 할 것
- ✅ **마이그레이션 0006·0007·0008 원격 적용 + 코드 `deploy` 완료**(0008은 2026-07-26 확인). 라이브 = 최신(0009 제외).
- ⚠️ **마이그레이션 0009 원격 적용 + `deploy` 대기 — 사용자**. `npx wrangler d1 migrations apply personal-os --remote` → `npm run deploy` 순서. 로컬은 적용 완료.
- **폰 실측 대기 (WORK-PLAN-0726 결과물)**: S1 분석 세 가지 분량(보통/자세히/매우 자세히)의 실제 출력 길이 차이 · S2 노란 toast가 정상 폭으로 펼쳐지는지 · S3′ 마감 확인 박스 유도 문구 · S4 취소 사유 입력·표시. 코드는 검증 완료(typecheck·smoke·front)이나 실제 렌더는 폰 확인 필요.
- **`#cf-no` 라벨 충돌**: 공용 확인 모달의 부정 버튼 라벨이 "취소"(=닫기)라 0008의 새 '취소' 기능과 혼동된다. 공용 모달이라 문구를 바꾸면 모든 확인 박스가 흔들리므로 **별도 항목으로 보류**.
- **★ 전역 클래스명 충돌 — 세 번째다. 새 컴포넌트에 짧고 일반적인 클래스명을 쓰기 전 반드시 `grep`으로 기존 사용처를 확인한다.**
  - `.tt` (CAL-PLAN, 2026-07-23) — 캘린더 셀 제목에 썼다가 전역 `.tt`(14.5px 시트 제목)와 충돌해 셀 글자가 커졌다 → `.etxt`로 개명.
  - `.wseg` (S1, 2026-07-26) — 분석 depth 세그에 재사용했더니 `boot()`·`goInbox()`의 **전역 `$$(".wseg")`** 가 works 뷰까지 훑었다 → 선택자를 `#scr-works .wseg`/`#anal-depth .wseg`로 한정.
  - `.warn` (toast, 2026-07-26) — `toast(msg,"warn")`이 붙이는 무접두사 `warn`이 `style.css:79`의 15×15 원형 경고 배지 규칙(`width:15px;inline-grid;border-radius:50%`)을 뒤집어써 노란 알림이 **27px로 접혔다** → 종류 클래스에 `t-` 접두사(`.toast.t-warn`).
  - 위험군: `ok`·`err`·`warn`·`info`·`tt`·`wseg`·`on`·`cur` 같은 2~5자 일반명. **CSS 규칙과 JS 선택자 양쪽을 본다** — `.tt`·`.warn`은 CSS 충돌, `.wseg`는 JS 선택자 충돌이었다.
- **event 취소(0010) 재검토 트리거**: 캘린더 셀에서 취소된 일정에 취소선이 안 그어지는 게 실사용에서 거슬릴 때. 그전까지는 memo로 대체(아래 '설계 정책').
- **폰 실측 후 미세조정**(코드 주석에도 표시): 스와이프 민감도 상수(AXIS_LOCK·축비·TRACK_RATIO·FLICK_V) · 캘린더 gap(20px) · 경계 스트레치 on/off(boot의 `bindEdgeStretch()`) · 다크모드 색(다른달·일요일) · 세로선 농도
- **다음 세션 구현 대기 (B, 미착수)**: B-1[#5 Phase2] 미완료 전환/수동 마감 시 완료율 입력 · B-2[#6] light task 플래그(신호 오염 금지) · B-3[#8] 튜토리얼 상세화(step3 전 필수) · B-4[#4] 러버밴드 원안 보류 기록 → REFACTOR-PLAN "재구상/보류" 정리 예정
- 최종 정리(리포 밖 상위 `Pos/`): 스캐폴딩 중복·대용량 백업

## 설계 정책 (2026-07-26 확정)
- **상태 서술(`feelings_text`) = 기록 — 과거 수정 불가.** 7/25 분석이 지적한 '상태 서술 공백'을 고치려고 날짜 시트에 입력 경로를 여는 안(S3)을 검토했으나 **폐기**했다. `src/scheduled.ts`의 autoClose가 30분마다 `openDatesBefore(env, t.d)`로 오늘 이전의 열린 날을 전부 auto 마감하므로, **'과거의 열린 날'은 최대 30분만 존재한다.** 즉 과거 입력을 열어도 거의 항상 마감 가드에 걸려 실효가 없다. memo와 달리 `feelings_text`는 PUT 덮어쓰기라 성격도 append-only가 아니다.
  - → **정책**: 상태 서술은 그날 안에만 쓴다. 마감 후에는 어떤 경로로도 수정·추가되지 않는다.
  - → 공백 문제는 **입력 경로가 아니라 수집 시점 문제**로 재정의한다. 해법 (a) `closeDay(kind:"manual")`에서 비어 있으면 한 줄 유도, (b) auto 마감된 날은 memo로 사후 보완 — memo는 마감된 날에 붙는 유일한 통로이고 `analysis.ts:124`가 이미 분석 컨텍스트에 넣고 있으므로 정성 채널은 이미 존재한다.
- **취소 사유는 append-only.** `cancel_reason`은 취소 시점에 한 번 쓰고, 취소 상태인 동안 수정하지 않는다. 취소 해제 시에도 NULL로 지우지 않고 남긴다(다음 취소가 덮어쓴다). Guard가 '어떤 이유로 취소했는가' 패턴을 읽을 수 있어야 하기 때문이다. `cancelled_by`(`'user'`/`'guard'`)를 함께 넣는다 — 현재는 항상 `'user'`지만 Guard 개입 4단계가 오면 필수이고 지금 넣는 비용은 0이다. 진짜 이력이 필요해지면 `wait_extensions`(`trg_wait_ext_no_del`/`no_upd`로 불변 강제)와 동형의 `task_cancellations` 테이블로 승격한다. **Guard 스켈레톤 전까지는 컬럼으로 시작한다.**
- **event 취소(0010) 보류 — memo로 대체.** "잘못 만든 미래 일정 = 삭제 / 실제로 취소된 과거 일정 = 취소"라는 의미 구분 자체는 옳다. 그런데 **삭제 쪽은 이미 구현돼 있다** — `trg_events_frozen_del`이 마감된 날 삭제를 막고 열린 날·미래는 자유다. 남는 '과거 취소'는 `trg_events_frozen_upd`가 막는다 — 마감된 날의 event는 UPDATE 자체가 ABORT되므로 `cancelled_at`을 쓰는 것도 불가능하다. 하려면 **불변성 트리거에 구멍을 뚫어야** 하는데, 이는 `0005_delete_scope`(wait_extensions 삭제 잠금)와 같은 종류의 위험한 변경이다. 그리고 "7/30 MT 우천 취소"는 그날 memo로 이미 기록되고 분석이 읽는다(스키마·트리거 변경 0). 따라서 **0010은 하지 않는다.** memo로 안 되는 것은 하나뿐 — 캘린더 셀에서 취소된 일정에 취소선이 안 그어진다. 그게 실사용에서 거슬릴 때가 0010을 재검토할 시점이다.

## 설계와 어긋난 지점
- **완료율 100%** — 지난 세션에 "인라인 100%=즉시 완료"로 이탈했으나, **A-3(#5 Phase1)에서 인라인 막대를 제거하며 폐기 → 완료는 완료 버튼 전용으로 설계 §1.4 재정합**(이제 설계와 일치). 완료율 편집은 미루기 시트에서만.
- **events 마감일 추가** — 마감된 날에도 일정 추가 허용(1.3 "과거엔 추가만 가능"과 정합, 경고문 표시). 설계 위반 아님, 명시적 결정.
- **완료율 화면 제거(2단계+보강, 2026-07-23)** — 완료율 개념을 **화면에서 전면 제거**(리스트·날짜 시트·미루기 시트·**task 상세 시트**). DB `rate` 컬럼·`completeTask`의 `rate=100` 완료 신호·`setRate`/`rbar` 경로는 **물리적으로 유지**(되돌리기 쉽게, 완료 로직 안전, B-1 재사용 대비). 물리적 소거는 향후 별도.
- **미루기 사유 도착지 보존** — 사유(`defer_reason`)는 원 항목이 아니라 **도착지(새 예정) 항목**에 남긴다. 마감된 날의 원 항목은 트리거가 수정을 막으므로, 열린 날/재배정 두 갈래 모두 균일하게 도착지에 붙여 보존.
- **memo 개념 확장(3단계, 2026-07-23)** — 설계 §1.3 "memo = 마감 후 유일한 추가 통로"를 **"memo = 어느 날짜에든 붙는 짧은 노트(마감된 날은 여전히 불변)"**로 확장. daily 없으면 자동으로 빈 open daily를 만들어 붙인다(마감된 날의 불변은 트리거가 계속 강제). 빈 daily가 캘린더 '기록 있는 날' 마커로 오인되지 않도록 `calDiaryDates`를 내용 기준으로 조정. **문서 v1.0 갱신은 사용자 지시로 연기 중이나, 이 확장은 명시적 결정으로 여기 기록.**
  - **(2026-07-23 CAL-PLAN 3단계 갱신)** memo는 이제 캘린더 **셀 본문에 직접** 노출되므로 `calDiaryDates`의 `.dr` 마커 조건에서 **memo를 다시 제외**했다. 마커 = '마감·점수·감정·로그'만 의미(선명해짐). 빈 daily 오인 방지 취지는 그대로 유지.
- **취소 상태 도입(0008, 2026-07-23)** — 설계 §1.4의 종결은 완료·미루기 둘뿐이었으나, 삭제가 1.3 불변성에 막히는 일에 **제3의 종결 '취소'**를 추가했다. `status` enum이 아니라 `cancelled_at`/`cancelled_on` 컬럼으로 저장하고(CHECK 2개·테이블 재작성 회피), **상태 판정은 `v_task_stats.state`(`not_finished`/`finished`/`cancelled`) 하나로 통일**했다. `status='not_finished'` + `cancelled_at IS NOT NULL` = 취소라는 물리적 사실은 schema-current.sql의 tasks 주석에만 남기고, 코드는 `state`만 읽는다. 취소는 **열린 날 예정만 비우고 마감된 날 항목은 보존**(defer의 두 갈래와 동형), 해제 시 예정은 복구되지 않고 대기로 돌아간다. 삭제는 분리 유지, 409에서 취소를 안내. `cancel_reason`은 도입하지 않음 → **2026-07-26 S4에서 `0009_cancel_reason`으로 도입 결정**(위 '설계 정책' 참조). 프런트에서 기존 '삭제=취소 라벨'을 '삭제'로 바로잡아 새 '취소'와 분리.
