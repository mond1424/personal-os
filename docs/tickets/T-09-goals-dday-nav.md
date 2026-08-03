# T-09 — Goals 디데이 + 하단 바 4탭/Me 분리 (P1-c 마무리)

**발행** Cowork · 2026-07-31 · **담당** Codex CLI · **상태** ✅ **닫힘 (2026-08-03)** — 실측 완료

---

## 목표

둘이다. 서로 무관하지만 **P1-c의 마지막 두 조각**이라 함께 닫는다.

1. **Goals 섹션** — Me 탭에 목표 목록. 연결된 기간이 제약(`kind='constraint'`)이면 **디데이**를 보여준다
2. **하단 바** — Me를 나머지 4탭과 시각적으로 분리

**왜** — Phase 1의 나머지가 이것뿐이다. `0012`가 `periods.kind`·`dday_label`을 깔아 뒀는데
**읽는 화면이 없다.** 쓰이지 않는 구조는 빈 채로 남는다(ADR-020과 같은 논리).

---

## 1부 — Goals 섹션 · 디데이

### 쓸 API — 이미 있다

```
Api.lmSchema("goals")   → { fields } — title 포함(T-02)
Api.lmItems("goals")    → 항목 배열 (data는 파싱된 객체)
Api.lmCreate("goals", { title, data })
Api.lmUpdate(id, {...}) · Api.lmDelete(id)
Api.periods()           → 기간 목록 (kind · dday_label · end_date)
```

goals 스키마 v1:

```
required : horizon (enum: long | short)
optional : period_id (string) · metric (string) · note (string)
```

### 화면

**T-01의 Education 섹션과 같은 구조를 쓴다.** 새 패턴을 만들지 않는다 —
`.sec` / `.sec-h` / `.card` + 기존 시트. 폼은 **스키마 응답으로 조립**한다(필드 하드코딩 금지).

디데이:

- `data.period_id`가 가리키는 기간이 `kind === 'constraint'`이고 `dday_label`이 있으면
  **`D-N`과 라벨**을 항목 줄에 보여준다 (예: `입대 D-142`)
- `kind === 'period'`이거나 `dday_label`이 비면 **표시하지 않는다.**
  `0012` 주석대로 라벨이 `NULL`이면 디데이를 쓰지 않는 것이 규칙이다
- **D-N은 저장하지 않는다.** 화면에서 계산한다(아키텍처 원칙 1 — 파생값은 저장하지 않는다)
- 기준일은 **귀속일**이다. 기기 시각의 날짜를 그대로 쓰지 않는다 —
  앱이 이미 쓰는 오늘 날짜(`S`의 현재 날짜)를 쓴다. 없으면 멈춰서 보고한다
- 지났으면 `D+N`. 당일은 `D-DAY`

`period_id` 입력은 **자유 문자열이 아니라 기간 선택**이어야 한다. 스키마가 `string`이지만
사용자가 id를 외워 칠 수는 없다 — `Api.periods()`로 고르게 하고 값은 id를 넣는다.
**이것이 "스키마로 조립한다"의 예외가 아니다**: 타입은 스키마가 정하고, 입력 수단은 화면이 정한다.

---

## 2부 — 하단 바 4탭/Me 분리

`<nav>`의 다섯 버튼 중 **Me만 시각적으로 떨어뜨린다.**

- Me는 4탭(Today·Calendar·Works·Analysis)과 성격이 다르다 — 일상 흐름이 아니라 **설정·프레임**이다
- 구분선이나 간격 하나로 충분하다. **탭 전환 로직·스와이프·`#nav-dot` 인디케이터를 건드리지 않는다**
- `booted` 가드와 트랙 위치 계산(% `transform`)은 **손대지 않는다** — 함정 2·4

**이 조각은 시각 변경뿐이다.** 검사가 잡을 것이 거의 없으므로 **폰 실측 항목으로 남긴다.**

---

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 스키마 필드 하드코딩 | 레지스트리를 둔 목적이 사라진다(T-01·T-02와 같은 규칙) |
| D-N을 저장 | 원칙 1. 파생값은 조회 시 계산 |
| 기기 날짜로 D-N 계산 | 귀속일 경계가 05:00/06:00이다. 새벽에 하루가 어긋난다 |
| `kind='period'`에 디데이 표시 | `0012`가 둘을 나눈 이유가 사라진다 |
| 탭 전환·스와이프·`#nav-dot` 로직 수정 | 함정 2·4. 여기는 시각만 바꾼다 |
| 짧고 일반적인 새 클래스명 | 전역 충돌 **세 번**. 접두사(`.lm-goals-…` · `.nav-me-…`) |
| 색 리터럴 · `scrollIntoView` | 함정 5 · 1 |
| 서버·마이그레이션 수정 | 위임 금지 영역 |

## 범위

```
public/index.html   Goals 섹션 자리 · 폼 시트 · nav 구조
public/app.js       Goals 렌더·폼·CRUD · 디데이 계산 · 기간 선택
public/style.css    Goals · nav 분리
test/front.mjs      검사
```

`api.js`는 손댈 필요가 없다. 필요해지면 멈춰서 보고한다.

## 읽을 것

- `me-reinforcement-plan.md` §2.1·§2.2 — `lm_item`과 스키마 레지스트리
- `migrations/0012_life_model.sql` 42~48행 — `periods.kind`·`dday_label`의 의도
- `docs/tickets/T-01-education-form.md` — 같은 구조를 이미 만들었다. **그것을 따른다**
- `CLAUDE.md` 함정 1·2·4·5·7 · 아키텍처 원칙 1

## 완료 조건

```
typecheck 통과 · smoke 237(변화 없음) · front 193 → 199 이상 · 실패 0
```

검사에 들어가는 것:

1. Goals 폼이 **스키마 응답으로** 조립된다 — 응답에 없는 필드를 끼우면 폼이 늘고,
   빼면 사라진다 (고정 목록 비교는 하드코딩과 구별되지 않는다)
2. **디데이가 계산이다** — 기간의 `end_date`를 바꾸면 표시된 D-N이 그만큼 움직인다.
   고정 문자열 확인은 계산과 구별되지 않는다
3. `kind='period'`이거나 `dday_label`이 비면 **디데이가 안 뜬다**
4. 항목 0개일 때 빈 상태 문구

**2번과 3번이 이 티켓의 핵심이다.**

## 확인 절차 (사용자)

deploy 후 폰에서. APK 재빌드 불필요.

1. Me › Goals → 빈 상태 문구
2. 목표 하나 추가(`horizon`만) → 목록에 뜬다
3. `kind='constraint'` + `dday_label` 있는 기간에 연결 → **디데이가 뜬다**
4. `kind='period'` 기간에 연결 → 디데이가 **안 뜬다**
5. **하단 바에서 Me가 4탭과 구분되어 보이는지** ← 검사로 대체 불가
6. 탭 스와이프가 그대로인지 — 한 번에 두 칸 넘어가지 않는지 (함정 4)

---

## 보고 (담당이 채운다)

```
티켓: T-09
바꾼 파일: public/index.html, public/app.js, public/style.css, test/front.mjs
기준선: typecheck 통과 · smoke 237 → 237 · front 193 → 210(T-09 단독) · 실패 0
설계와 어긋난 점: 없음
막힌 것: 없음
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
설계 위반: 없음. D-N은 저장하지 않고 `goalDday()`가 조회된 기간의 `end_date`와 서버가 준 `S.today.date`로 매 렌더마다 계산한다. `kind === 'constraint'`와 비어 있지 않은 `dday_label`도 함께 요구한다. SQL·서버·마이그레이션·트리거 변경은 없고, 탭 전환·스와이프·`#nav-dot` 로직도 건드리지 않았다.
함정 재발: 없음. 새 전역 클래스는 `.lm-goals-*`와 `.nav-me-tab` 접두사로 한정되고 기존 CSS·JS 사용처와 충돌하지 않는다. 새 색은 CSS 변수만 사용했다. `scrollIntoView`, 트랙의 `% transform`, `booted` 가드, jsdom 제스처 생성 코드는 변경하지 않았다.
검사가 하드코딩과 구별되는가: 예. 스키마에 필드를 넣고 빼 폼이 따라가는지 보므로 고정 필드 폼은 실패한다. 같은 목표의 `end_date`를 D-10→D-13으로 바꿔 고정 디데이 문자열을 잡고, `S.today.date`를 실행 기기 날짜와 다른 `2001-01-15`로 바꾼 센티널은 `new Date()` 등 기기 날짜 사용을 실패시킨다. 일반 기간·빈 라벨 비표시, D-DAY·D+N, 빈 상태와 CRUD도 실제 경로를 탄다. nav는 티켓대로 Me 전용 클래스 훅을 자동 확인하고 시각 결과는 폰 실측에 남겼다.
판정: 통과. T-09 단독 트리 독립 재검증 결과 typecheck 통과 · smoke 237/실패 0 · front 210/실패 0. 자동화로 대체할 수 없는 Me 구분선과 스와이프 실측만 사용자 확인 절차에 남는다.
```
