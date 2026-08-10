# APP-PLAN — Personal OS 앱화 · Guard v1 우선

최종 갱신 2026-08-10 · 기준 STATE.md(로컬 최신, 마이그레이션 `0015_me_history_reason`) · 설계문서 v0.9 · 반영: **BRIEF-AGENCY-0810 v2** (ADR-028~034)
설계 근거·기각한 대안은 **[APP-ADR.md](./APP-ADR.md)**. 이 문서는 **무엇을 어떤 순서로 만드는가**만 다룬다.

---

## 1. 목표

**1순위 — 8월 안에 Guard v1 완성, 9~11월 실사용.** 학기는 다시 오지 않는다. 이 날짜가 나머지 순서를 전부 결정한다.
**2순위 — 감각 계층(Phase 8) · 입력 이관(Phase 7). 위젯은 10월.** 캘린더 읽기만 8월 W5, Phase 8은 9월 1주 착수, 위젯·FCM·인증은 10월. (2026-08-10 우선순위 교체: "알아서 돌아가는 구조"가 목적인 만큼 감각기관 > 표시 표면)
**그 밖 — PWA·오프라인·성능.** 우선순위 최하. 네이티브 전환 시 폐기될 수 있다(§7).

앱화 자체는 목적이 아니라 Guard가 도달하기 위한 수단이다. (2026-08-10 추가) 두 번째 목적이 명시됐다 — **입력의 무게중심을 시스템으로**(ADR-028): 앱은 감각·개입의 소켓이고, 일상 접점은 캘린더·알림·공유시트로 이동한다.

---

## 2. 현재 상태 (2026-07-28)

| 영역 | 상태 |
|---|---|
| 백엔드 | Cloudflare Worker + D1. 마이그레이션 **`0009_cancel_reason`**. cron `*/30 * * * *`(`autoClose`) |
| 인증 | `env.API_TOKEN` 단일 시크릿 + `localStorage.api_token` Bearer |
| 프런트 | **무빌드** — `public/`을 `[assets]`로 직접 서빙 |
| Guard | `guard_events` 테이블 · `guard.events()` 조회만 · `guardEventCount()`가 task 삭제를 막는 데 사용 중 |
| 설계 미확정 | **§9 #1~#3** — 보호 규칙 문법 · Override 마찰 수위 · Level 4 실행 형태 · outcome 판정 · 위험도 계산식 · 대기 재노출 강도 |
| PWA | manifest·theme-color·apple 메타 있음 / **Service Worker 없음** / 아이콘 SVG 1장 |
| 기준선 | typecheck 통과 · **smoke 154 · front 167** · 실패 0 |

---

## 3. 실행 순서

**Phase 번호는 정체성이고 순서가 아니다** (ADR-014). 실행 순서는 이 절이 정한다.

### 완성의 정의

8/31까지 아래 한 문장이 참이 되면 완성이다. 이 문장에 없는 것은 8월 범위가 아니다.

> 시험 일정을 하나 등록하면 전날 00:00에 보호 모드가 걸리고,
> 01:30에 알람 소리로 잠금화면을 점유하는 알림이 뜨고,
> 해제하려면 사유를 적고 60초를 기다려야 하고,
> 그 전부가 `guard_events`에 남는다.

```
8월 ─ Guard v1
  1주 7/29~8/4   폰이 허용하는가만 실측 — 규칙 코드 0줄  (Phase 4)
  2주 8/5~8/11   기록 구조 + 감지 수집                  (Phase 6)
  3주 8/12~8/18  개입 — 결정론 발동 · Override · 모드   (Phase 6)
  4주 8/19~8/25  루프 닫기 — outcome                    (Phase 6)
  5주 8/26~8/31  캘린더 읽기 (Phase 7 전반, 게이트 조건부) + 버퍼
       ↓
9/1 ─ 실사용 시작
       ↓
9~11월 ─ 실사용. 병렬 우선순위:
  ① Phase 8 감각 계층 — 9월 1주 착수. HC → 공지 → 메신저, 하나씩
  ② Phase 7 잔여 — 캘린더 write-back · 기록 경로 3종
  ③ Guard v1 잔여 — 규칙 반복 수정(본체) · 오버레이(9월 초) · PC 에이전트
  ④ 10월: 위젯 (Phase 5) · FCM (Phase 4 잔여) · 인증 골격 (Phase 0)
  ⑤ Compose 스파이크 (캘린더 1화면) — 여유 시
       ↓
10월 ─ 위험도 가중치를 실제 스냅샷에서 유도
12월 ─ 네이티브 전환 결정 (ADR-017)
       ↓
보류 ─ PWA·오프라인·성능 (Phase 1·2)
```

> 위젯 시점은 ADR-010·구판(7/29)의 "9월"과 상충한다 — **이 표가 우선한다** (감각 계층 > 표시 표면, 2026-08-10 사용자 확정).

### 8월 밖으로 보낸 것

FCM · 오버레이 · AI 발동 판단 · 자기 보정 로직 · PC 에이전트 · 위젯 · 인증 · PWA/오프라인 · **캘린더 쓰기 방향 · share-target · 알림 액션 · RemoteInput 마감 (Phase 7)** · **Health Connect · 공지 수집기 · 메신저 캡처 (Phase 8)**.

**FCM이 빠진 것이 이번 계획의 가장 큰 변화다.** v1의 발동 조건은 전부 시각 기반이거나 기기 로컬 이벤트라 **서버만 아는 발동 조건이 없다.** 기기가 `AlarmManager`로 예약하고 발동하며, 메시지 문구만 발동 시점에 best-effort로 받아온다(실패 시 캐시 문구). 결과적으로 Guard는 네트워크와 무관하게 항상 발동한다 — ADR-021.

ADR-007(Capacitor + FCM)은 **폐기가 아니라 시점 분리**다. 위젯에는 여전히 FCM이 필요하다.

---

## 4. 설계 불변식

1. **오늘 = 서버 귀속일(경계 05:00).** 알림 `on_date`·Guard 발동 판정·위젯 표시 전부 서버가 준 `d`. 클라이언트 재계산 금지 (설계 원칙 7)
2. **과거에 귀속된 기록은 수정할 수 없다.** guard 이벤트 로그도 대상 (설계 §1.3)
3. **상태 판정은 `v_task_stats.state`만.** `status` 직접 참조 금지
4. **오프라인 쓰기 없음 — 단 `guard_events`는 예외** (ADR-023). Guard는 네트워크와 무관하게 발동하므로 기록도 그래야 한다. append-only라 충돌이 없다(설계 §9 #5의 "Log·memo는 append-only라 비교적 안전"에 해당). 기기에 먼저 쓰고 온라인 시 밀어올린다
5. **Override는 금지가 아니라 마찰.** 절대 잠금은 도구 이탈로 귀결 (설계 §6.3)
6. **outcome은 Guard가 판단하지 않는다.** task·period의 실제 결과와 연결해 사후 확정 (설계 §6.5)

---

## 5. 8월 실행 계획

각 주는 **한 검증 사이클**. 끝에 `typecheck / smoke / front 실패 0`이고 배포 가능해야 한다.

### 1주 (7/29~8/4) — 폰이 허용하는가만 실측. **규칙 코드 0줄.**

Guard 로직을 한 줄도 쓰지 않는다. 이 주의 유일한 목적은 **폰이 우리가 필요한 일을 하게 두는지 확인**하는 것이다.

- Capacitor + **서명 APK** (디버그 빌드로 확인하면 안 된다 — 배터리 정책이 다르게 걸릴 수 있다)
- 알림 채널 3종 (`guard_low` · `guard_high` FSI · `guard_ongoing`)
- FSI 권한 유도
- 포그라운드 서비스 + UsageStats 권한
- `setExactAndAllowWhileIdle` **및 `setAlarmClock`** 둘 다 시험 (아래 함정)

**게이트 — 새벽에 직접 확인한다. 다음 주로 넘어가는 조건.**

| # | 확인 | 결과 | 날짜 |
|---|---|---|---|
| 1 | 잠긴 화면을 **알람 소리와 함께** 점유하는가 | | |
| 2 | 03:00 예약 알람이 **실제로 03:00에** 뜨는가 (앱 종료·Doze 상태에서) | | |
| 3 | 포그라운드 서비스가 밤새 살아 있는가 | | |
| 4 | UsageStats가 값을 돌려주는가 | | |

> ⚠️ **삼성이면 배터리 최적화 예외 + "절전 시 사용 중지 앱" 제외 둘 다** 필요하다. 하나만 해서는 새벽에 죽는다.

**게이트 실패 시 대안** — 순서대로 시도한다. 1주 안에 결론을 낸다.

1. `setAlarmClock`으로 교체 — Doze에서도 정확히 발동하고 시스템 "다음 알람" UI에 표시된다. **Guard가 알람 앱으로 취급되므로 Android 14의 FSI 기본 권한 조건(알람·통화 앱)에도 부합한다.** 사실상 이쪽이 정공법이다
2. 포그라운드 서비스 자체 타이머 — 배터리를 쓰지만 확실하다
3. 둘 다 실패하면 **Guard v1의 정의를 다시 쓴다.** 도달하지 못하는 개입은 없는 것과 같다

### 2주 (8/5~8/11) — 기록 구조 + 감지 수집

- 감지: foreground app + 화면 on/off → 로컬 버퍼
- `guard_events` 확장 (마이그레이션 0010) + **로컬 우선 기록**(ADR-023)
- `events`에 `protect_*` 필드
- 하루 1회 보호 일정 pull → 알람 예약

**기준: 데이터가 쌓이기 시작한다.** 발동은 아직 없어도 된다.

### 3주 (8/12~8/18) — 개입 (설계 §9 #1 확정) ★가장 불확실

- **결정론 규칙으로 Level 1~4 발동** (발동 규칙 명세는 Phase 6 참조)
- Override 마찰 — L3 60초 / L4 180초
- Level 4 신규 작업 차단 = 기존 `#stale` 팝업 패턴 재사용
- 모드 2종 (coach / secretary)

**기준: 발동하고, 해제에 비용이 들고, 전부 기록된다.**

### 4주 (8/19~8/25) — 루프 닫기

- outcome 수동 확정 카드
- 위험도 항 **기록만** (게이트 아님 — ADR-021)
- 알림함 최소

**기준: 루프가 한 바퀴 돈다.**

### 5주 (8/26~8/31) — 캘린더 읽기 (Phase 7 전반) + 버퍼

**선행 조건: 4주 종료 시점에 Guard 루프가 닫혀 있을 것.** 아니면 이 주 전체가 Guard 버퍼로 환원되고 캘린더는 9월로 — 감축 0순위.

**"닫혔다"에 밤 발동이 포함된다.** 낮에 테스트하면 루프가 전부 돈다 — 화면이 켜져 있으니 알람이 정상으로 뜬다.
그러나 Guard가 일하는 시간은 **01:30~05:00이고 그때 폰은 Doze에 있다.**
낮 확인만으로 이 게이트를 통과시키면, 캘린더 읽기가 **밤에 침묵하는 Guard 위에** 얹힌다.

위 §완성의 정의에서 03:00 알람 항목이 **7월 말부터 빈칸**이다. 그것을 채우기 전에는 W5로 넘어가지 않는다 —
절차는 `docs/FIELD-TEST-NIGHT.md`이고 **자기 전 10분이면 준비된다.**

- 마이그레이션 **0016_cal_sync** (Phase 7 참조) + `POST /api/cal/sync` 멱등 upsert
- 기기: READ_CALENDAR 권한 + 대상 캘린더 선택 + Instances 창 조회 → diff push
- devcal-소스 event 읽기 전용 표시
- 보호 키워드 제안 카드 (ADR-030, outcome 카드 패턴 재사용)
- 기존 수동 입력분 병합: (날짜, 제목) 일치 시 연결

**기준: 폰 캘린더에 시험을 넣으면, 앱에 나타나고, 보호 제안 카드가 뜨고, 1탭으로 서약되어 알람이 예약된다.**

### 감축 순서

일정이 밀리면 이 순서로 줄인다.

0. **캘린더 읽기 전체 (Phase 7 전반)** — 9월로. Guard가 4주 안에 안 닫히면 자동 발동
1. 알림함 UI (앱 내 목록은 9월에 만들어도 된다)
2. **모드 2종** — 완성의 정의에 없다. secretary 없이 coach 단일로 시작 가능
3. 위험도 항 개수 (전부 빼지는 않는다)

**줄이지 않는 것**: `guard_events` 기록 구조 · outcome 연결 · 감지 수집.
데이터는 소급해서 만들 수 없다. 이것이 빠지면 9~11월이 통째로 낭비된다.

---

## Phase 6 — Guard v1 ★ 8월의 본체

### 범위 확정

**Guard의 정체성은 적응형이다.** 설계 §6.5·§6.7이 "규칙만 적용하는 시스템이 아니라 과거 개입의 결과를 기억하는 시스템", "실패를 줄이는 방향으로 스스로 보정되는 시스템"이라고 정의한다. 위험도 계산·AI 판단·자기 보정을 빼면 남는 것은 알림 앱이지 Guard가 아니다.

| v1에 넣는 것 | v1에서 줄이는 것 (빼지 않음) |
|---|---|
| Level 1~4 (§6.1) | — |
| 보호 규칙 (§6.2) | 문법을 최소로. 반복·복합 조건은 나중 |
| Override 마찰 (§6.3) | — |
| **위험도 계산식** (§6.6) | 항 개수를 적게. 가중치는 실사용으로 조정 |
| **AI 판단** (`model_high`, §8) | 호출 위치를 좁게 — 전 발동이 아니라 Level 3~4 후보만 |
| **Guard Memory 기록 구조** (§6.5) | — |
| **자기 보정** (§6.5) | 로직은 전례 N건 이상에서 발화. **기록·집계 경로는 전부 v1에** |
| **사용 감지** (UsageStats) | 폴링 주기를 성기게 |
| **오버레이 개입** (Level 4) | W5로. 9월 초 |
| **모드** (coach / secretary) | 2종으로 시작, 확장 가능한 구조 |
| outcome 연결 | v1은 수동 확정. 자동 조인은 §9 #1 미확정 |

**줄이는 것과 빼는 것을 구분한다.** 정교함은 실사용으로 올릴 수 있지만, 기록되지 않은 데이터는 나중에 만들 수 없다.

### 왜 적응형 3요소를 v1에서 뺄 수 없는가

일정 압박이 오면 가장 먼저 빼고 싶어지는 것들이라, 이유를 미리 적어 둔다.

**자기 보정** — 보정 *로직*은 전례가 없으면 발화하지 않는다. 하지만 보정이 읽을 **기록 구조와 집계 경로는 v1에 있어야 한다.** 없으면 9~11월 데이터가 안 쌓이고, 12월에 뒤늦게 넣으면 학기 전체가 낭비된다. 데이터는 소급해서 만들 수 없다.

**위험도 계산식** — 결정론적 규칙만으로는 "발동 시점에 무엇을 보고 판단했는가"가 기록되지 않는다. 사후에 "이 규칙이 과도했나"를 평가하려면 **판단 시점의 입력 스냅샷**이 필요한데, 규칙은 입력이 빈약해 평가 재료가 안 된다. 자기 보정의 입력이 위험도 항들이다.

**AI 판단** — §8이 이미 `model_high`를 "analysis 2-pass, **이후 Guard 판단**"으로 예약해 뒀다. 설계에 있는 것이다. 비용 문제는 **호출 위치를 좁혀서** 푼다(아래).

### 발동 규칙 (설계 §9 #1 확정안) — 3주의 본체

> **이것이 8월에서 가장 덜 정의된 부분이다.** 완성의 정의에 "01:30에 알림이 뜬다"가 있는데, **01:30이 어디서 나오는지**가 정해져 있지 않았다. 여기서 정한다.

설계 §6.1 Level 3의 예시가 답을 준다 — "현재 01:30. 지금 계속하면 **예상 수면이 4시간 이하**". 즉 01:30은 임의 시각이 아니라 **일정 시각에서 역산한 취침 데드라인**이다.

```
events 확장:
  protect_from      TEXT     -- '-1d 00:00' 보호 모드 진입
  protect_level     INTEGER  -- 활성화할 최대 Level
  protect_sleep_min INTEGER  -- 필요 수면(분). 기본 360
  protect_prep_min  INTEGER  -- 기상~출발 준비(분). 기본 90

파생:
  취침 데드라인 = event.시각 − protect_prep_min − protect_sleep_min
  예) 시험 09:00 − 90분 − 360분 = 01:30
```

**Level 결정 — 전부 결정론적. 위험도 점수도 AI도 게이트로 쓰지 않는다** (ADR-021).

| Level | 발동 조건 | 채널 |
|---|---|---|
| 1 알림 | 보호 모드 진입 시 1회 | `guard_low` |
| 2 맥락 경고 | 데드라인 −2h · −1h | `guard_low` |
| 3 위험 판단 | **데드라인 도달** | `guard_high` (FSI + 알람 소리) |
| 4 적극 개입 | 데드라인 +30m 이후, 30분 간격 | `guard_high` + 신규 작업 차단 |

전부 **시각으로 예측 가능하므로 보호 모드 진입 시 알람을 한꺼번에 예약한다.** 서버도 네트워크도 필요 없다.

기본값(수면 360분·준비 90분)은 `settings`에 두고 event별로 덮어쓴다. 초기값의 정확도보다 **조정 가능한 구조**가 중요하다.

### 위험도 (§6.6) — 기록하되 발동에 쓰지 않는다

항은 전부 계산해 `guard_events.risk_snapshot`에 저장한다. **그러나 점수 임계로 발동을 결정하지 않는다.**

```
발동      ← 결정론적 규칙 (위 표)
risk_snapshot ← 같은 순간의 항 값 전부 (기록 전용)
```

| 항 | 출처 |
|---|---|
| 현재 시각 · 데드라인까지 남은 시간 | 파생 |
| 보호 모드 여부 · 대상 event | `events` |
| 최근 Log 활동 (각성 신호) | `logsRange` |
| 수면 추정 (Log 첫/마지막 시각, §1.2) | `logsRange` |
| 최근 Feelings · Score 추세 | `feelingsRange` · `dailyRange` |
| **foreground app** (감지되면) | UsageStats |

**왜 기록은 하되 게이트로 쓰지 않는가.** 근거 없는 가중치로 만든 임계는 오발동을 낳고, 오발동은 §6.3이 경고한 도구 이탈로 이어진다. 이탈하면 데이터도 안 쌓여서 **가중치를 유도할 기회 자체가 사라진다.** 순서를 뒤집는다 — 먼저 안전한 규칙으로 발동시켜 스냅샷을 모으고, **10월에 실제 스냅샷에서 가중치를 유도한다.**

기록은 소급이 불가능하므로 v1 필수다. 이것이 ADR-020의 "줄이되 빼지 않는다"가 여기서 취하는 형태다.

### AI — 발동 경로 밖에서만

`model_high`를 발동 판단에 쓰지 않는다. **발동이 서드파티 가용성에 걸리면 안 된다** — STATE의 Gemini `-latest` 404 전례(A-2)가 그 이유다. 새벽 1시 30분에 모델이 404를 뱉으면 개입이 통째로 사라진다.

| 쓰는 곳 | 모델 | 실패 시 |
|---|---|---|
| 알림 문구 생성 (발동 시점 best-effort) | `model_high` | **캐시 문구로 폴백** |
| Override 사유 분류 (회피형/정당형) | `model_low` | 사후 재시도 |
| 자기 보정 집계 해석 (9월 이후) | `model_high` | — |

문구는 보호 모드 진입 시 미리 생성해 알람과 함께 저장해 둔다. 발동 시점의 호출은 있으면 좋은 것이지 필요한 것이 아니다.

### 통제 계층

설계 v0.9 §6.4는 "소프트웨어 개입 상한 = 앱 내 마찰 + 알림"이라고 못박았고 근거는 **PWA의 제약**이었다. 네이티브로 가면서 전제가 사라졌다 → 설계문서 §6.4를 v1.0에서 갱신해야 한다 (ADR-018).

| 단계 | 수단 | 권한 | 시점 |
|---|---|---|---|
| 알림 | **FSI + 알람 채널** | `USE_FULL_SCREEN_INTENT` | **1주 — 하중 지지 요소** |
| 앱 내 차단 | 신규 작업 차단 (`#stale` 패턴) | 없음 | 3주 |
| 감지 | `UsageStatsManager.queryEvents` | `PACKAGE_USAGE_STATS` | 2주 — **보조 입력** |
| 화면 가림 | `SYSTEM_ALERT_WINDOW` 오버레이 | 오버레이 권한 | **9월 이후** |

**FSI가 하중을 진다.** 실패 사례 #1의 상황은 PC 앞에서의 몰입이었고, **PC 몰입 중에는 폰 화면을 가려도 보이지 않는다.** 도달하는 것은 소리 나는 알림뿐이다. 오버레이는 폰 몰입에만 듣는 수단이라 우선순위가 낮다.

**감지는 방아쇠가 아니라 보조 입력이다.** 발동은 사전 서약(`protect_from`)에서 시각으로 예측되므로, UsageStats가 제조사 정책에서 실패해도 Guard는 그대로 돌아간다. 감지가 하는 일은 `risk_snapshot`을 풍부하게 만드는 것이다 — 있으면 10월 가중치 유도가 훨씬 쉬워지고, 없어도 v1은 성립한다. (단 ADR-025의 감지 기반 발동 경로 B는 별도 — 독립 경로라 B가 죽어도 A는 산다.)

이 배치의 효과는 **단일 실패점이 하나뿐**이라는 것이다. 알람 예약과 FSI만 살아 있으면 Guard는 작동한다. 그래서 1주 게이트가 그 둘만 본다.

### Guard 모드 (ADR-019)

모드는 **규칙이 아니라 파라미터 프로파일**이다. 규칙 집합은 하나고, 모드가 그 강도를 스케일링한다. 그래야 모드 추가가 행 하나로 끝난다.

```sql
CREATE TABLE guard_modes (
  key           TEXT PRIMARY KEY,   -- 'coach' | 'secretary' | ...
  label         TEXT NOT NULL,
  max_level     INTEGER NOT NULL,   -- 활성화할 최대 Level
  risk_threshold INTEGER NOT NULL,  -- 발동 임계 (위험도 점수)
  friction_mult REAL NOT NULL,      -- Override 대기 시간 배수
  use_fsi       INTEGER NOT NULL,   -- FSI 알림 채널 사용
  use_overlay   INTEGER NOT NULL,   -- 화면 가림 사용
  ai_daily_cap  INTEGER NOT NULL    -- model_high 호출 상한
);
```

| | secretary | coach |
|---|---|---|
| 성격 | 알려주고 기록한다 | 개입한다 |
| max_level | 2 | 4 |
| risk_threshold | 높음 (확실할 때만) | 낮음 (의심되면) |
| friction_mult | 0 (마찰 없음) | 1.0 |
| FSI · 오버레이 | 끔 | 켬 |

**모드 전환 자체가 Override의 우회로가 된다.** 새벽에 coach → secretary로 내려버리면 마찰이 전부 사라진다. 설계 §6.2의 사전 서약 원칙이 무너지므로:

- **보호 모드 중에는 모드 하향 금지.** 상향은 자유
- 하향에도 마찰 적용 (사유 + 대기)
- 모드 전환은 `guard_events`에 기록 — 잦은 하향 자체가 신호다

**자기 보정은 모드별로 분리한다.** coach에서 학습한 것과 secretary에서 학습한 것을 섞으면 안 된다. 같은 규칙이 모드에 따라 다른 결과를 내므로 `guard_events.mode`를 기록하고 보정 집계를 모드로 나눈다.

### 기대 조정 — v1의 성공은 무엇인가

설계 §6.5의 설득력은 **전례**에서 나온다.

> "지난 컴활 시험에서도 같은 사유로 Override를 선택했고, 결국 시험에 응시하지 못했습니다."

**첫 학기에는 전례가 0이다.** 자기 보정도 기록은 쌓이지만 발화는 나중이다.
§6.7의 성공 지표(실패 간격의 증가)도 한 학기로는 측정되지 않는다.

**v1의 성공 = 루프가 한 바퀴 도는 것.**

```
감지·위험도 → 발동 → 반응(수용·Override) → 사유·스냅샷 기록 → outcome 사후 연결
```

9~11월은 이 루프를 돌려 **보정이 발화할 만큼 전례를 쌓는 기간**이다.
이 기대치를 미리 정해 두지 않으면 9월에 "Guard가 아직 멍청하다"고 판단하고 접게 된다 — 그런데 그건 설계대로 동작하고 있는 것이다.

### 3주 — Override · Level 4 · outcome 확정안

발동 규칙은 위에서 정했다. 나머지 §9 #1 항목을 **가장 좁은 형태로** 확정한다.

**Override 마찰** (§6.3)

| Level | 마찰 |
|---|---|
| 1~2 | 없음 (알림·경고만) |
| 3 | 사유(비어 있지 않으면 됨) + 60초 대기 |
| 4 | 사유 한 문장 + 180초 대기 |

사유·시각·level은 전부 `guard_events`로.

**Level 4 실행 형태** — "신규 작업 차단"

설계 §6.2가 정한 대로 보호 모드 중 **task 생성·일정 추가를 차단**한다. 다른 앱을 건드리지 않는다.
**기존 `#stale` 차단 팝업 패턴을 재사용한다** — 대기 21일 초과 팝업이 이미 같은 구조(차단 → 선택 강제 → 진행 불가)다. 새로 설계하지 않는다.

**outcome 판정** — v1은 수동

보호 규칙이 걸린 event가 지나가면 Today에 1회 카드: "7/15 정보처리기사 — 어떻게 됐나요? [성공 / 실패]".
자동 조인(§9 #1)은 판정 규칙이 미확정이므로 v1에서 하지 않는다.

### guard_events 스키마 (마이그레이션 **0010**)

> 번호 주의 (2026-08-10 실사 정정) — 리포의 최신은 `0015_me_history_reason`이다. Guard는 **0010**을 썼고 **0011은 `guard_sync`가 소비**했다(계획명 0011_notify와 불일치).
> 캘린더 동기화는 **0016_cal_sync**, notify 아웃박스·인증은 착수 시 배정. 새 마이그레이션을 추가하면
> **`test/smoke.ts`의 하드코딩 스키마 목록에도 파일명을 넣는다**(CLAUDE.md 규칙).

설계 §6.5가 요구하는 필드를 그대로 옮긴다.

```sql
-- 기존 guard_events를 확장 (guardEventCount의 task 참조는 유지)
ALTER TABLE guard_events ADD COLUMN level INTEGER;
ALTER TABLE guard_events ADD COLUMN mode TEXT;              -- 발동 시점의 모드 (보정 집계를 모드로 분리)
ALTER TABLE guard_events ADD COLUMN risk_score INTEGER;     -- 1단계 결정론적 점수
ALTER TABLE guard_events ADD COLUMN risk_snapshot TEXT;     -- JSON. 판단 시점의 항 값 전부 ★자기 보정의 원재료
ALTER TABLE guard_events ADD COLUMN ai_used INTEGER;        -- model_high 호출 여부
ALTER TABLE guard_events ADD COLUMN source TEXT;            -- 'android' | 'pc'  ★PC 확장 자리 (ADR-022)
ALTER TABLE guard_events ADD COLUMN foreground_app TEXT;    -- 발동 시점에 쓰던 앱/프로세스
ALTER TABLE guard_events ADD COLUMN reaction TEXT;          -- 'accepted'|'overridden'|'ignored'
ALTER TABLE guard_events ADD COLUMN override_reason TEXT;   -- §6.3에서 타이핑한 문장
ALTER TABLE guard_events ADD COLUMN override_class TEXT;    -- model_low 분류: 'avoidant'|'legitimate'
ALTER TABLE guard_events ADD COLUMN period_id TEXT REFERENCES periods(id);
ALTER TABLE guard_events ADD COLUMN event_id TEXT REFERENCES events(id);
ALTER TABLE guard_events ADD COLUMN outcome TEXT;           -- 'success'|'fail'|NULL
ALTER TABLE guard_events ADD COLUMN outcome_at TEXT;
```

**`risk_snapshot`이 이 테이블에서 가장 중요한 컬럼이다.** 10월에 가중치를 유도할 원재료이고, 나중에 소급해서 만들 수 없다.

**PC 확장 자리** (ADR-022) — 지금 필요한 것은 폰 전용으로 스키마를 굳히지 않는 것뿐이다.

```
guard_events:  source TEXT ('android'|'pc') · foreground_app TEXT
POST /api/guard/activity  { source, device_id, app, at }
watch_apps(source, identifier)
```

`watch_apps`와 라우트만 8월에 만든다. PC 에이전트 자체는 9월 이후.

기존 컬럼 구성은 `docs/schema-current.sql`에서 확인 후 확정한다. **불변성 대상**이므로(설계 §1.3) 수정 금지 트리거를 함께 건다 — `outcome`·`outcome_at`·`override_class`만 사후 확정이라 예외.

### 로컬 우선 기록 (ADR-023)

Guard는 네트워크 없이 발동한다. **그렇다면 기록도 네트워크 없이 되어야 한다.** 새벽에 서버에 못 붙어서 발동 기록이 사라지면 완성의 정의 마지막 절이 깨진다.

```
발동/Override → 기기 로컬에 즉시 기록 → 온라인 시 POST로 밀어올림
```

`guard_events`는 append-only라 충돌 해소가 필요 없다 — 설계 §9 #5가 "Log·memo는 append-only라 비교적 안전"이라 한 것과 같은 이유다. 이것이 §4 불변식 4번(오프라인 쓰기 없음)의 유일한 예외이며, local-first(ADR-015)의 두 번째 조각이다.

### 파일
`migrations/0010_guard.sql` · `src/services/guard.ts`(evaluate·override·outcome) · `src/services/events.ts`(보호 필드) · `src/db/index.ts` · `src/index.ts` · `public/{app.js,api.js,index.html,style.css}` · `docs/*`

### 검증
- smoke +12 내외 — 보호 모드 진입/이탈 · Level별 발동 · Override 기록 · 사유 없이 Override 거부 · Level 4 신규 작업 차단 · outcome 연결 · guard_events 수정 거부(outcome 제외)
- front +6 — 차단 모달 · 사유 입력 · 대기 타이머 · outcome 카드

### 함정
- **Override를 너무 어렵게 만들면 도구를 떠난다** (§6.3). 60초/180초는 초기값이고 실사용에서 조정한다
- **`guard_events`는 불변**이다. outcome·override_class만 예외 — 트리거를 그렇게 짜야 한다
- 보호 모드 판정은 **귀속일이 아니라 실제 시각** 기준이다. "전날 00:00 이후"는 벽시계 자정이다. 05:00 경계와 섞지 말 것 — Guard는 새벽에 발동하는 시스템이라 여기가 정확히 위험 구간이다
- Level 4 차단이 **Guard 자신의 Override UI까지 막지 않도록** 예외 경로 확인
- **모드 하향이 Override 우회로가 되지 않게** — 보호 모드 중 하향 금지, 하향에도 마찰
- **사용 감지에는 포그라운드 서비스가 필요하다.** 상시 알림이 하나 더 붙고 배터리를 쓴다. 감지가 죽어도 Guard는 돌아가야 한다 — 감지를 발동 조건에 넣지 말 것
- **알람은 재부팅 시 사라진다.** `BOOT_COMPLETED` 재등록 필수. 시험 전날 재시작이 개입을 통째로 지우는 실패 모드다
- 알림 문구 생성이 실패해도 **발동은 되어야 한다.** 문구는 보호 모드 진입 시 미리 만들어 두고, 발동 시점 호출은 best-effort
- `guard_events`는 **기기에 먼저 쓴다**(ADR-023). 서버 왕복을 발동 경로에 넣으면 새벽에 기록이 사라진다

---

## Phase 4 — Capacitor + 네이티브 알림 (1주) · FCM (10월)

### 목적
Guard가 폰에 도달하게 한다. **8월 첫 작업**이다 — 리스크가 가장 크고, 실패하면 나머지가 무의미하다.

### 1주 — Capacitor + 알람 + 알림 채널 (8월)

```
npx cap init / cap add android
capacitor.config: server.url = https://<현재 배포 URL>
→ 서명 빌드 → 폰 설치
```

**서명 APK로 확인한다.** 디버그 빌드는 배터리 정책이 다르게 걸릴 수 있어 게이트의 근거가 되지 못한다.

- **알림 채널 3종을 네이티브 Kotlin 모듈로** — 기존 Capacitor 플러그인으로는 FSI 제어가 안 된다
  - `guard_low` (Level 1~2): 일반 알림
  - `guard_high` (Level 3~4): **FSI + 알람 수준 소리·진동**
  - `guard_ongoing`: 보호 모드 중 상시 표시(dismiss 불가)
- FSI 권한 유도: `NotificationManager.canUseFullScreenIntent` → 없으면 `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`
- **알람 예약**: `setExactAndAllowWhileIdle`과 `setAlarmClock` 둘 다 시험
- 포그라운드 서비스 + UsageStats 권한
- 배터리 최적화 예외 요청 (삼성은 "절전 시 사용 중지 앱" 제외도)

게이트는 §5 1주 표를 따른다.

### `setAlarmClock`이 사실상 정공법이다

| | `setExactAndAllowWhileIdle` | `setAlarmClock` |
|---|---|---|
| Doze에서 정확 발동 | 제한적 (창 있음) | **보장** |
| 시스템 "다음 알람" UI | 표시 안 함 | **표시** |
| 부수 효과 | — | **앱이 알람 앱으로 취급 → Android 14 FSI 기본 권한 조건에 부합** |

Android 14는 FSI 기본 부여를 "알람·통화 기능이 있는 앱"으로 제한한다. `setAlarmClock`으로 실제 알람을 예약하면 그 조건을 만족한다. 즉 **알람 정확도와 FSI 권한이라는 두 문제가 한 API로 같이 풀린다.**

단점은 시스템 알람 UI에 Guard 예약이 노출되는 것인데, 개인용이므로 문제되지 않는다.

### FCM은 10월로 (ADR-021 · 위젯과 동행)

v1의 발동 조건에 **서버만 아는 것이 없다.** 전부 시각 기반(보호 규칙에서 역산)이거나 기기 로컬 이벤트(foreground app)다. 그러므로 8월에 FCM이 필요 없다. 수요처인 위젯이 10월로 가면서(§3) FCM도 함께 10월이다.

10월에 붙일 때 필요한 것: Firebase 프로젝트 · `google-services.json` · 서버 발송기(FCM HTTP v1, 서비스 계정 JWT를 WebCrypto로 서명) · `POST /api/push/subscriptions`.
용도는 **위젯 갱신 푸시**와 서버발 알림이다. Guard 발동은 계속 기기가 한다.

### 이 Kotlin 모듈은 버려지지 않는다

알림 채널·FSI·알람 예약·권한 유도는 **네이티브 전환을 하더라도 그대로 살아남는다.**
8월 구조는 "웹을 감싼 wrapper"가 아니라 **네이티브 앱 + 웹 화면 + 네이티브 Guard**다.
Capacitor는 전환의 장애물이 아니라 다리다 — Guard(네이티브) → 캘린더 동기화·감각 계층(네이티브) → 위젯(네이티브) → 화면을 하나씩 Compose로.

### 함정
- **서명 키(`.jks`)와 비밀번호를 리포 밖에 백업.** 잃으면 업데이트 설치가 불가능하다 — 이 계획에서 유일하게 복구 불가능한 실수
- **삼성은 배터리 최적화 예외 + "절전 시 사용 중지 앱" 제외가 둘 다** 필요하다. 하나만 하면 새벽에 죽는다
- 사이드로드 앱은 Android 13+에서 제한된 설정에 묶인다. 앱 정보 → 우상단 → "제한된 설정 허용" 1회 (UsageStats·오버레이·알림 접근이 해당)
- 알람 예약은 **재부팅 시 사라진다.** `BOOT_COMPLETED` 리시버로 재등록해야 한다 — 시험 전날 폰을 재시작하면 개입이 통째로 사라지는 실패 모드다

---

## Phase 3 — 규칙 엔진 + 아웃박스 (2·4주, 축소)

### 목적
Guard 이벤트와 일반 리마인더가 **같은 기록 구조**를 쓰게 한다.

> **8월 범위 축소** — Guard 발동은 기기가 하므로(ADR-021) 서버 실행기는 **리마인더 전용**으로 줄어든다. `push_subscriptions`와 FCM 발송기는 10월. 8월에 필요한 것은 `notifications` 테이블과 **하루 1회 보호 일정 pull**뿐이다.

### 마이그레이션 `notify` — 번호는 착수 시 배정 (0011은 `guard_sync`가 소비)

```sql
CREATE TABLE notification_rules (
  key TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
  at_time TEXT, params TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  on_date TEXT NOT NULL,          -- 귀속일 (lib/time.ts)
  level INTEGER,                  -- Guard 규칙이면 1~4, 리마인더면 NULL
  title TEXT NOT NULL, body TEXT NOT NULL,
  deeplink TEXT,
  created_at TEXT NOT NULL, read_at TEXT, sent_at TEXT,
  UNIQUE (rule_key, on_date)      -- 30분 cron 멱등성
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY, transport TEXT NOT NULL DEFAULT 'fcm',
  device_token TEXT, created_at TEXT NOT NULL,
  last_ok_at TEXT, fail_count INTEGER NOT NULL DEFAULT 0
);
```

`UNIQUE (rule_key, on_date)`가 30분 cron의 멱등성을 보장한다 — `autoClose`와 같은 방식.
**단 Guard Level 3~4는 하루 한 번 제약을 받으면 안 된다.** `rule_key`에 발동 회차를 넣거나(`guard:exam-20260815:1`) 별도 처리한다.

### 규칙

| 구분 | 규칙 | 데이터 출처 |
|---|---|---|
| Guard | 보호 모드 진입·유지·위반 | `events`(보호 필드) + 현재 시각 |
| 리마인더 | 오늘 일정 | `eventsAt(env, d)` |
| 리마인더 | 하루 마감 | `getDaily(env, d)` |
| 리마인더 | 대기 21일 | `waitingList(env)` |
| 리마인더 | Period D-Day | `periodCards(env)` |
| 리마인더 | 미룬 일 | `worksDeferring(env)` |

전부 `state`(`v_task_stats`) 기준. 취소된 task가 알림에 뜨면 안 된다.

### 실행기
```ts
// src/services/notify.ts (신규)
evaluate(env, t): Promise<{created: number}>
```
기존 cron `*/30 * * * *`에 태운다. **새 cron 추가 금지.** 리마인더 전용이므로 30분 해상도로 충분하다.

> **Guard는 이 실행기를 쓰지 않는다.** 30분 해상도로는 §6.1의 "현재 01:30" 정밀도가 안 나오고, 무엇보다 네트워크에 걸린다.
> Guard 발동은 **하루 1회 보호 일정 pull → 기기가 `setAlarmClock`으로 전부 예약 → 기기가 발동**한다. 서버는 예약 재료만 준다 (ADR-021).

### 알림함
```
GET  /api/notifications?unread=1
POST /api/notifications/:id/read
GET/PUT /api/notifications/rules
```
Today 상단 배지 + Me › 설정의 규칙 토글. 일정이 밀리면 **여기를 줄인다.**

### 검증
smoke +10 내외 — 규칙별 생성 · 재평가 시 중복 0 · 비활성 규칙 0 · 취소된 task 제외 · Guard 다회 발동 허용 · 읽음 처리

---

## Phase 7 — 입력 이관 (8월 W5 읽기 · 9월 쓰기 + 기록 경로) — 2026-08-10 신설

**정체성: 기존 입력 노동의 이동·소멸.** 근거 = ADR-028(원칙) · 029(캘린더) · 030(보호 제안) · 031(기록 경로). 상세 논거는 BRIEF-AGENCY-0810 v2.

### 캘린더 양방향 동기화 (ADR-029)

- **동기화 창 = 열린 날(오늘)~미래 N일(기본 60, settings).** 마감된 날은 동기화 영구 이탈 — "열린 날은 캘린더와 공유하는 현재, 마감된 날은 personal-os만의 과거". 귀속일 마감이 동기화 경계를 겸한다
- 필드: 제목·날짜·시각/종일만. protect_*는 앱 전용(캘린더로 안 나감). 위치·참석자·알림 동기화 안 함
- 식별: `ext_src('devcal')`·`ext_uid`(반복은 `<eventId>:<날짜>` 인스턴스 단위, `CalendarContract.Instances`로 창 범위만 전개). 충돌은 갱신 시각 LWW, 해소 UI 없음
- 날짜 귀속: 캘린더 벽시계 날짜 그대로. **귀속일 재계산 금지** — 일정·보호 판정은 벽시계의 것
- 삭제(캘린더→앱): 열린 날 mirror 삭제. guard 이력 참조 시 삭제 대신 protect 해제+보존(개입 이력 불변)
- 실행 주체는 **기기**(CalendarContract는 기기만 본다). 서버는 `POST /api/cal/sync` 멱등 upsert만
- 시점: 앱 열 때 + **하루 1회 보호 일정 pull 직전** + 수동 새로고침. 대상 캘린더는 사용자 선택(settings)
- **8월 = 읽기 방향만.** devcal-소스 event는 앱에서 읽기 전용(수정은 캘린더에서) — 쓰기 방향(9월)이 붙기 전까지 갈라짐을 물리적으로 차단

### 마이그레이션 `0016_cal_sync`

```sql
ALTER TABLE events ADD COLUMN ext_src TEXT;      -- 'devcal' | NULL(앱 생성)
ALTER TABLE events ADD COLUMN ext_uid TEXT;      -- CalendarContract event id, 반복은 '<id>:<날짜>'
ALTER TABLE events ADD COLUMN ext_updated TEXT;  -- 마지막 반영한 캘린더 측 갱신 시각 (LWW)
CREATE UNIQUE INDEX idx_events_ext
  ON events(ext_src, ext_uid) WHERE ext_src IS NOT NULL;
```

`test/smoke.ts` 스키마 목록에 파일명 등록 (CLAUDE.md 규칙).

### 보호 제안 (ADR-030)

가져온 일정 제목 ⊇ 키워드(settings `guard_kw`, 기본: 시험·마감·면접·발표·접수) → Today 제안 카드: "8/21 정보처리기사 — 보호 걸까요? [보호 설정 / 안 함]". [보호 설정] = protect_* 기본값 부여 + 알람 예약 경로 진입. outcome 카드 패턴 재사용, 재노출은 열림당 1회, 응답은 기록. **자동 부착 금지** — 사전 서약(§6.2) 보존.

### 기록 경로 3종 (ADR-031, 9월)

| 표면 | 동작 | 서버 |
|---|---|---|
| share-target | 아무 앱에서 공유 → [memo / 할 일] → 저장 | `addMemo`·기존 task 생성. 신규 없음 |
| 알림 액션 | 리마인더에 [완료]·[미루기] 버튼 | `complete`·`defer`. 409는 앱 열기 폴백 |
| RemoteInput 마감 | 하루 마감 알림에서 score·한 줄 → 마감 | 기존 close 경로 |

전부 기존 엔드포인트 재사용(ADR-012 준용). 식사 기록의 상한 경로도 share-target(ADR-032 참조).

### 검증 (8월 분량)
- smoke +8 내외 — upsert 멱등 · 마감된 날 skip · LWW(구갱신 무시) · 반복 인스턴스 개별 upsert · 삭제→mirror 제거 · guard 참조 시 protect 해제+보존 · 키워드 제안 생성 · 비매칭 무제안
- front +3 내외 — devcal event 읽기 전용 · 제안 카드 · 재노출 열림당 1회

### 함정
- **동기화는 pull 직전에.** 순서가 뒤집히면 캘린더의 시험이 그날 알람 예약을 놓친다
- 새벽(00~05시) 일정의 날짜는 캘린더 벽시계 그대로 — 귀속일 재계산 금지. Guard 벽시계 함정과 같은 구간
- 여러 캘린더 계정(구글 다중·삼성) — **대상 선택이 선행.** 전체 동기화는 잡동사니
- 멀티데이 종일 일정은 시작일 1건으로 축약 (v1)
- 재설치 시 기기 매핑 소실 — 서버 유니크 인덱스가 중복 삽입은 막지만, 재연결 로직 전까지 수동 확인

---

## Phase 8 — 감각 계층 (9월 1주 착수 · 8월 작업 0) — 2026-08-10 신설

**정체성: 새 입력원 증설 — "알아서 돌아가는 구조"의 감각기관.** 근거 = ADR-032·033·034. Guard 경로와 접점이 없는 독립 모듈이라 실사용 시작과 병행 가능. **착수는 불확실성 오름차순으로 하나씩** — 앞 모듈이 실사용에서 자리 잡은 뒤 다음 모듈.

| 순서 | 모듈 | 형태 | 비고 |
|---|---|---|---|
| 1 | **Health Connect** (ADR-032) | 기기 로컬 읽기 — 수면 세션·걸음·심박 | Fit4 도착 시점과 정합. 1차는 화면 on/off 수면 추정(§6.6, W2 재료), HC 실측 오면 우선. 출처 표기(`estimated`/`hc`). **식사는 자동화 불가** — share-target 수동이 상한 |
| 2 | **공지 수집기** (ADR-033) | 기존 cron: fetch → diff → 제목 키워드 → 제안 | **공개 게시판만.** 로그인 벽(포털·LMS)은 v2 재검토. 파서는 소모품으로 취급 |
| 3 | **메신저 캡처** (ADR-034) | `NotificationListenerService` → 기기 필터(방·키워드) → model_low 추출 → 제안 | **비매칭 원문 미저장.** 무음 방·미리보기 꺼짐은 구조적 사각 — 기대치 낮게 |

**공통 형태: 수집 로컬·결정론 → 필터 → (필요시 model_low) → 제안 카드 1탭.** 발동·확정 경로에 AI·네트워크 금지(ADR-021·030 준용). 마이그레이션은 모듈 착수 시 배정(0014~).

### 함정
- Fit 시리즈는 Wear OS가 아니라 Samsung Health 경유로만 데이터가 나온다 — **Fit4 구매 전, Samsung Health→Health Connect 동기화에 수면 세션이 실제로 도착하는지 확인** (ADR-032의 전제)
- 표면이 3개 늘어나는 일이다. 동시 착수 금지 — 하나씩
- **모듈이 붙는 날짜를 `APP-BUILD.md` 결정 기록에 남긴다.** 9~11월은 §6.5의 전례를 쌓는 기간인데(ADR-014),
  그 사이에 감각기관이 붙으면 **`risk_snapshot`에 들어가는 항목이 중간에 는다.**
  판정 규칙은 안 바뀌므로 전례 자체는 유효하지만, **9월 전 것과 10월 후 것이 서로 다른 항목을 갖는다.**
  12월에 그것을 읽을 때 *"9월엔 무시했고 11월엔 수락했다"*가 **사람이 변한 것인지 재료가 는 것인지**
  가르려면 그 경계가 날짜와 함께 있어야 한다 — 소급해서 만들 수 없는 종류다.

---

## Phase 5 — Widget (10월)

Phase 4 완료가 선행 조건. 시점은 §3 우선순위표(감각 계층·입력 이관 뒤).

첫 위젯이 일회성 인프라 비용을 전부 떠안는다 — AppWidgetProvider 등록 · 토큰 · `/api/widget/*` 규격 · 다크모드 색 · 갱신 스케줄.

> **열린 항목**: ADR-010은 복잡도 순서(Calendar → Tasks → Daily)를 정했으나, 위젯의 목적이 "**빈번한 기록**"으로 확정되면서 전제가 달라졌다. 기록이 목적이면 Daily가 본체다.
> 10월 착수 시 이 순서를 재검토한다 — 인프라를 Calendar로 먼저 깔지, 바로 Daily로 갈지. **RemoteInput 마감(ADR-031, 9월)이 자리 잡으면 Daily 위젯의 존재 이유가 좁아진다는 점도 판단 입력.**

### API
```
GET /api/widget/calendar   → { d, month, days:[{k, n_event, n_task}] }
GET /api/widget/tasks      → { d, todo:[{id,title,done}], deferred_n, waiting_n, updated_at }
GET /api/widget/daily      → { d, score, feelings:{...}, memo_n, closed }
```
- **`d`(서버 귀속일)를 모든 응답에.** 기기 날짜로 "오늘"을 계산하면 새벽 3시에 틀린다
- 2KB 이하 · `ETag`+`304` · **쓰기용 신규 엔드포인트 금지**(기존 재사용)

### 구현 메모
- Calendar: 42셀 정적 레이아웃 → `RemoteViewsService` 불필요
- Tasks: 체크 완료 시 **409 처리 필수**(취소된 task면 `{suggest:"cancel"}`)
- Daily: RemoteViews에 텍스트 입력 위젯이 없다 → **알림 `RemoteInput`**(다이렉트 리플라이) 또는 투명 Activity
- `updatePeriodMillis` 최소 30분 = 기존 cron과 일치. 즉시 반영은 FCM data 메시지로

---

## Phase 0 — 인증 골격 (10월, 마이그레이션은 착수 시 배정)

8월에는 하지 않는다. FCM 구독은 단일 사용자이므로 기존 `API_TOKEN` 뒤에 1행으로 충분하다.
위젯이 붙는 시점에 기기별 토큰이 필요해지므로 그때 한다.

`principals`(누가) / `credentials`(무엇으로) / `sessions`(어떻게 전달) 3계층. 로그인 UI는 만들지 않고 계층만 세운다.

| 표면 | 방식 |
|---|---|
| 웹 · PWA · Service Worker | `Cookie: pos_sess` (HttpOnly; Secure; SameSite=Lax) |
| Android 위젯 · 네이티브 | `Authorization: Bearer <기기 토큰>` |
| 부트스트랩 · 로컬 개발 | `Authorization: Bearer <env.API_TOKEN>` |

스키마·라우트 상세는 이 문서의 이전 판(git 이력) 또는 착수 시점에 재작성한다.
**profile 레이어**(AI 설정·시간대·귀속일 경계·테마)는 새 테이블이 아니라 `settings + principal_id`로 확장한다 — ADR-003.

---

## Phase 1·2 — PWA / 오프라인 (보류)

**네이티브 전환 결정(12월) 이후에 판단한다.** Compose로 가면 대부분 폐기된다.

보류 중에도 유효한 것 하나: 아이콘이 SVG 1장에 `purpose: "any maskable"` 결합이라 마스크 품질이 나쁘다. PNG 192/512/maskable-512 분리는 **30분 작업**이므로 아무 때나 끼워 넣어도 된다.

---

## 6. 9~11월 — 실사용 기간

**본체는 Guard 규칙의 반복 수정이다.** 나머지는 §3 병렬 우선순위를 따른다 (① 감각 계층 ② 입력 이관 잔여 ③ Guard 잔여 ④ 10월: 위젯·FCM·인증 ⑤ Compose 스파이크).

| 관찰 | 조정 대상 |
|---|---|
| 발동이 하루 몇 회인가, 유용한 비율 | 규칙 임계값 · 무용한 규칙 삭제 |
| Override 비율과 사유 패턴 | 마찰 수위(60초/180초) |
| Level 4 차단이 도구 이탈을 부르는가 | §6.3 재검토 — 이탈하면 실패다 |
| outcome이 실제로 연결되는가 | 자동 조인 도입 여부(§9 #1) |
| 기록 빈도 | 위젯 우선순위 · Daily 위젯 필요성 |
| 제안 카드 수락률 (보호·공지·메신저) | 제안 임계·키워드 목록 · ADR-030 자동화 수위 |
| 수면 추정치 vs HC 실측(도입 시) 정합 | §6.6 수면 항 가중치 · 워치 도입 판단 |

### 보류 (2026-08-10 명시적 결정)

- **Guard 구조 개선** — 사용자 이해 회복 선행. 개선 논의는 그 뒤. 8월 계획(W3~4)은 현행대로
- **설계문서 v1.0 재구성** — 사용자가 직접 작성. 축 = **감각 계층**(입력원을 "사용자 손"에서 "센서들"로). 입력 = §6.4 갱신(ADR-018) + ADR-028~034. Guard §6은 이 작업에서 사용자가 재유도하며 이해를 복구한다
- **Kotlin 전환** — 12월 유지(ADR-017). Phase 7·8이 네이티브 모듈 비중을 키우므로 재검토 트리거("네이티브 > 웹") 조기 발화 가능 — 발화해도 경로 동일(아래는 이식, 위는 재설계)

### Compose 스파이크 (전환 비용 실측)

"코드 변환 1주일"은 검증 가능한 가설이다. **캘린더 화면 하나만** Compose로 만들어 본다.

캘린더를 고르는 이유는 가장 어렵기 때문이다 — 배경 밴드 경계선 모델(§2.2), 셀 동적 공간 예산, 3-pane 슬라이드, 날짜 팝업. 여기가 되면 나머지는 쉽다.

| 결과 | 해석 |
|---|---|
| 2~3일에 동작 | 1주일 추정이 신뢰할 만하다. 12월 전환 진행 |
| 1주 이상 | 추정이 4~6배 틀렸다. 전환 재검토 |

**측정 대상은 코드 작성이 아니라 튜닝 재현이다.** `AXIS_LOCK 20 · 축비 1.9 · TRACK_RATIO 0.35 · FLICK 0.5 · CAL_GAP 20 · STRETCH_MAX 90 · STRETCH_K 0.42 · STRETCH_BACK_MS 460` — 이 숫자들이 제품이고, Compose는 제스처 시스템이 달라(`pointerInput`/`Animatable`/`nestedScroll`) 값이 넘어가지 않는다. 다시 유도해야 한다.

---

## 7. 12월 — 네이티브 전환 결정

판단 입력: Compose 스파이크 결과 · 9~11월에 실제로 매일 쓴 화면 · 네이티브 모듈이 차지하는 비중 · local-first 필요성(오프라인 발동·위젯 응답성).

전환한다면 층별로 다르게 다룬다 (ADR-017).

| 층 | 방식 |
|---|---|
| 스키마 + 트리거 | **이식** — SQLite → SQLite, 거의 복사 |
| services 도메인 규칙 | **번역** — `deferTask` 순서, `completeTask`의 rate 100, cancel의 열린 날 처리는 하드-원 지식이다. 재설계하면 이미 고친 버그를 다시 만든다 |
| smoke 154건 | **먼저 이식** — 도메인 규칙의 실행 가능한 명세. 번역 검증이 자동화된다 |
| UI | **재설계** — 웹 관용구(sheet·backdrop·track slide)를 흉내내지 않는다. 단 정보 구조(5탭, 캘린더 셀 내용)는 유지 |

---

## 부록 A. 배포 체크리스트

```
[ ] npx wrangler d1 migrations apply personal-os --local
[ ] npx wrangler d1 migrations apply personal-os --remote
[ ] typecheck / smoke / front 실패 0
[ ] deploy
[ ] 폰에서 확인 (1주 이후: 알람 발동 · FSI 점유 · guard_events 기록)
[ ] (W5 이후) 캘린더 권한·대상 캘린더 선택 확인 · 폰 캘린더 일정 → 앱 반영 확인
[ ] STATE.md 갱신
```

## 부록 B. 참고

- [Android 14+ full-screen intent 제한 — 알람·통화 앱만 기본 부여](https://source.android.com/docs/core/permissions/fsi-limits)
- [FSI 동작 변경과 대응 (canUseFullScreenIntent · ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)](https://developer.android.com/about/versions/14/behavior-changes-14)
- [Android 13+ 사이드로드 앱의 제한된 설정](https://www.esper.io/blog/android-13-sideloading-restriction-harder-malware-abuse-accessibility-apis)
- [Android WebView의 Web Push 미지원 / FCM 우회](https://code2native.com/blog/webview-push-notifications-android)
- [Chrome PWA 설치 요건 — 192·512 아이콘](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest)
