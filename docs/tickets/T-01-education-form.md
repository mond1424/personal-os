# T-01 — Me 탭에 Education 섹션·폼 붙이기

**발행** Cowork · 2026-07-30 · **담당** Codex CLI · **상태** ✅ 검토 통과 · deploy 완료 · **폰 실측 미실시**

> **미확인 (2026-07-30)** — deploy는 됐고 코드 검증(213/183)은 끝났으나 **폰에서 눈으로 본 적이 없다.**
> 아래 §확인 절차 5단계가 그대로 남아 있고, 특히 **4번(status 3색 다크모드 가독)** 은
> 검사로 대체할 수 없다 — 색 대비는 렌더 결과를 봐야 안다.
> 후속 티켓이 같은 화면을 건드리므로, 실측에서 문제가 나오면 **어느 변경이 원인인지 가리는 것이 먼저다.**

---

## 목표

Me 탭에 **Education 섹션**을 추가한다. 목록을 보여주고, 항목을 추가·수정·삭제할 수 있게 한다.

**왜** — 서버에는 Life Model API(`/api/lm/*`)와 스키마 레지스트리가 전부 있는데
**프런트가 하나도 안 붙어 있다.** `api.js`에 `lm*` 메서드가 0개다.
쓰이지 않는 구조는 빈 채로 남고, 빈 구조는 9~11월에 데이터를 못 모은다.

## 범위 — 이 파일들만 고친다

```
public/api.js       lm* 메서드 추가
public/index.html   Me 화면에 Education 섹션 자리 · 폼 시트
public/app.js       렌더 · 폼 조립 · CRUD 배선
public/style.css    필요한 만큼만
test/front.mjs      검사 추가
```

**서버는 건드리지 않는다.** `/api/lm/*`는 이미 동작하고 smoke 22건이 지키고 있다.
범위 밖이 필요하면 **고치지 말고 멈춰서 보고한다.**

## 쓸 API — 이미 있다

| 메서드 | 경로 | 반환 |
|---|---|---|
| GET | `/api/lm/education/schema` | `{section, version, schema, fields}` |
| GET | `/api/lm/education` | 항목 배열 (`data`는 파싱된 객체) |
| POST | `/api/lm/education` | `{title, data}` → 201 |
| PATCH | `/api/lm/item/:id` | 부분 수정. `data`를 안 보내면 기존 유지, `null`이면 삭제 |
| DELETE | `/api/lm/item/:id` | |

`api.js`의 `_req`가 토큰 헤더를 붙이므로 그대로 쓴다. `fetch`를 직접 호출하지 않는다.

## Education 스키마 (v1)

```
required : name(string) · status(enum: completed|enrolled|planned)
optional : term(string) · grade(string) · credits(number)
           prerequisites(string[]) · note(string)
```

**필드 목록을 하드코딩하지 않는다.** `GET /api/lm/education/schema`의 `fields`를 읽어
폼을 조립한다 — 스키마가 v2로 오르면 폼이 따라 바뀌어야 하고, 그게 레지스트리를 둔 이유다.
`fields`는 배열이고 각 원소에 `key`·`type`·`enum`·`required`가 있다.

## 화면

- Me 화면(`#scr-me` → `#me-main`)의 **변경 이력 위**에 Education 섹션
- 기존 `.sec` / `.sec-h` / `.card` 구조를 그대로 쓴다 — 새 레이아웃을 만들지 않는다
- 항목 한 줄: 제목 + status 배지 + (있으면) term·grade
- `status`별 시각 구분은 **CSS 변수만** 쓴다
- 추가·수정은 기존 시트(`openSheet`) 방식을 따른다. 새 모달 패턴을 만들지 않는다
- 빈 상태 문구를 반드시 둔다 — 빈칸 허용이 원칙이고, 비어 있는 게 정상이다

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `scrollIntoView` | `.phone`이 `overflow:hidden`이라 셸이 밀린다. 위치는 `scrollTop`만 |
| 짧고 일반적인 새 클래스명(`edu`·`st`·`on`·`tt`) | 전역 충돌로 **세 번 물렸다**. 쓰기 전 `grep`으로 CSS·JS 양쪽 확인 |
| 색 리터럴 | CSS 변수만. 다크 대응은 항상 짝 |
| 서버·마이그레이션 수정 | 위임 금지 영역 |
| 스키마 필드 하드코딩 | 레지스트리를 둔 목적이 사라진다 |
| `boot()` 중복 실행 가드(`booted`) 제거 | 스와이프 한 번에 탭 두 칸 |

## 읽을 것

- `me-reinforcement-plan.md` §2.1·§2.2 — `lm_item`과 스키마 레지스트리를 왜 이렇게 뒀나
- `migrations/0012_life_model.sql` 104~108행 — v1 스키마 원문
- `src/services/lifemodel.ts` — 검증이 무엇을 거부하는가(400의 종류)
- `CLAUDE.md` 함정 1·5·7, `STATE.md`의 전역 클래스명 충돌 3건

## 완료 조건

```
typecheck 통과 · smoke 213 (변화 없음) · front 167 → 170 이상 · 실패 0
```

front 검사에 최소한 이것들이 들어간다:

1. Education 섹션이 목록을 렌더한다 (항목 0개일 때 빈 상태 문구)
2. 폼이 **스키마 응답으로** 조립된다 (필드 하드코딩이 아님을 보이는 검사)
3. 필수 필드가 비면 저장이 막힌다 (서버 400 이전에 프런트에서)

**숫자만 늘고 잘못된 동작을 지키는 검사는 없느니만 못하다.**

## 확인 절차 (사용자)

deploy 후 폰에서:

1. Me 탭 → Education 섹션이 보이고, 비어 있으면 안내 문구가 뜬다
2. 과목 하나 추가 (`name`·`status`만) → 목록에 뜬다
3. 같은 항목 수정 → 값이 바뀌고 목록이 갱신된다
4. `status`를 셋 다 만들어 보고 시각 구분이 다크모드에서도 읽히는지
5. 삭제 → 목록에서 사라진다

APK 재빌드는 필요 없다 — 프런트만 바뀐다.

---

## 분해 (Claude Code · 07-30 10:51)

**배정: Codex CLI.** 범위가 `public/*` + `test/front.mjs`뿐이고 서버·마이그레이션·트리거·귀속일·Guard
발동 경로 어디에도 닿지 않는다. 설계는 0012가 스키마 레지스트리로 이미 확정했다 — 남은 것은 배선이다
(`AGENT-CHAIN.md` §4가 든 예: "UI 폼, 테스트 추가"). 락은 `APP-BUILD.md`에 걸었다.

티켓 확인 결과 **경로·ID·API 모양은 전부 사실이다**: `/api/lm/:section/schema`는 `src/index.ts:228`에
`:section`보다 앞에 있고, `#scr-me`/`#me-main`은 `index.html:178~179`, `openSheet`는 `app.js:275`,
`api.js`의 `lm*` 메서드는 실제로 0개다.

### 티켓에 빠진 것 하나 — `itemType`

`fields` 원소는 `key`·`type`·`required`·`enum` **넷이 아니라 다섯**이다. `src/lib/schema.ts:82`의
`fieldsOf`가 배열 필드에 `itemType`을 함께 실어 준다.

```
{ key, type, required, enum?, itemType? }
```

`prerequisites`가 `string[]`이라 **이 필드의 폼을 조립하려면 `itemType`이 필요하다.**
`type === "array"`인 원소를 만나면 `itemType`을 보고 입력칸을 만든다(한 줄 입력 + 쉼표/줄바꿈 분리로
충분하다 — 새 컴포넌트를 만들지 않는다). 모르고 지나가면 배열 필드가 조용히 빠지는데,
그건 "스키마로 조립한다"는 이 티켓의 목적이 반쯤 깨진 상태다.

### 검사 2번의 합격 기준

"폼이 스키마 응답으로 조립된다"는 검사는 **필드를 하드코딩해도 통과하면 실패로 본다.**
스키마 응답에 없는 필드를 넣거나 있는 필드를 빼서 **폼이 따라 바뀌는 것**을 보여야 한다.
현재 필드 목록과 같은 값을 확인하는 검사는 하드코딩과 구별되지 않는다.

### 클래스명 — 쓰기 전에 grep

`edu`·`st`·`on`·`tt`·`ok`·`warn`·`cur` 같은 2~5자 일반명은 **세 번 물렸다**(`.tt`·`.wseg`·`.warn`).
`style.css`의 CSS 규칙과 `app.js`의 JS 선택자(`$$(".x")`) **양쪽**을 본다.
`status` 배지에 새 이름이 필요하면 접두사를 붙인다(`.lm-…` 꼴).

### 멈춰서 보고할 지점

- 범위 밖 파일을 고쳐야 한다(특히 `src/` — 서버가 400을 내는 모양이 예상과 다를 때)
- `fields`가 위 다섯 키로 설명되지 않는 원소를 돌려준다
- front 숫자가 안 맞고 원인을 못 찾겠다 — **플레이크로 넘기지 않는다**(2026-07-29에 플레이크로 보였던 것이
  검사의 결함이었다: `STATE.md` '물린 것 — front가 잡은 실제 결함')

---

## 보고 (담당이 채운다)

```
티켓: T-01
바꾼 파일: public/api.js, public/index.html, public/app.js, public/style.css, test/front.mjs
기준선: typecheck 통과 · smoke 213 → 213 · front 실행은 Wrangler 로그 파일 EPERM으로 시간 초과(수치 미확인)
설계와 어긋난 점: 없음
막힌 것: npm run front가 C:\Users\LG\AppData\Roaming\xdg.config\.wrangler\logs 로그 파일 쓰기 권한 오류로 60초 후 종료됨
```

---

## 1차 검토 (Claude Code · 07-30)

```
기준선: typecheck 통과 · smoke 213 → 213(무변경) · front 167 → 183 · 실패 0
```

**front의 EPERM은 재현되지 않았다.** 이 층에서 그대로 돌려서 수치를 냈다 — Codex 셸의
`XDG_CONFIG_HOME` 환경 문제로 보이고 코드와 무관하다. **다만 숫자 없이 보고를 닫으면 안 된다**
(`AGENTS.md` 보고 형식). 막혔으면 막힌 것만 쓰고 멈추는 게 맞았고, 그건 지켰다.

### 통과 — 설계·함정

- 설계 위반 없음: 파생값 저장 없음 · SQL 없음 · 서버 무변경 · `_req` 경유(직접 `fetch` 없음)
- 함정 1(`scrollIntoView`) 없음 · 함정 5(색) CSS 변수 + 다크 짝 양쪽(`@media` · `[data-theme]`) 충족
- 함정 7(전역 클래스명): 신규 클래스 전부 `.lm-education-*` 접두사. **지시를 지켰다**
- `toast(msg,"warn")`는 helper가 `t-` 접두사를 붙이므로 맞다(`app.js:201`)
- `booted` 가드 미접촉 · 기존 `.sec`/`.sec-h`/`.card`/`openSheet` 재사용 · 빈 상태 문구 있음
- `itemType` 처리됨 — 배열 분리·숫자 강제까지. 분해 절이 전달됐다

### 검사를 보강했다 — 숫자는 맞았지만 목적을 못 지켰다

`AGENT-CHAIN.md` §8의 세 번째 항목(숫자의 의미)에서 걸렸다. 원래 검사 6건 중:

1. **"폼이 스키마로 조립된다"가 하드코딩과 구별되지 않았다** — 렌더된 입력 개수를
   `S.educationSchema.fields.length`와 비교했는데, **필드 7개를 박아 넣어도 통과한다.**
   분해 절이 합격 기준을 명시했는데("스키마 응답에 없는 필드를 넣거나 빼서 폼이 따라 바뀌는 것")
   반영되지 않았다 → 활성 스키마에 `front_probe`를 끼워 넣고 폼이 늘어나는지, `note`를 빼면
   사라지는지를 보는 검사로 교체. 흔든 스키마는 `refreshEducation()`으로 원복한다
2. **완료 조건 3번(필수 필드가 비면 프런트가 막는다) 검사가 아예 없었다.** 코드엔 있는데
   검사가 없으면 다음 사람이 지운다 → `status`만 채우고 저장을 눌러 시트가 열린 채 남고
   `S.education`이 0인 것 + 토스트가 이유를 말하는 것까지 확인
3. **완료 조건 1번의 "항목 0개일 때 빈 상태 문구"가 미검사** — 항목을 만든 뒤만 봤다 → 앞에 추가
4. **삭제 경로 미검사**(확인 절차 5번) → `#cf-yes`까지 눌러 빈 상태로 돌아오는 것 확인
5. 추가·수정을 `Api.lmCreate` 직접 호출로 하고 있었다 → **폼을 거쳐** 돌게 바꿨다.
   API를 직접 부르면 폼 조립·수집 경로가 검사에서 빠진다

검사 6건 → 16건. 이름도 주변과 같은 한국어로 맞췄다.

### 코드 2건을 고쳤다 — 지금은 안 터지는 잠재 결함

1. **`renderMe()`의 `Promise.all`이 Me 탭을 인질로 잡았다.** `Api.lmSchema("education")`이
   활성 행이 없으면 404를 던지는데(`lifemodel.ts:33`), 거절되면 **Me 본문이 통째로 안 그려진다.**
   호출부 5곳 중 어디도 `renderMe()`를 await하지 않아 unhandled rejection으로 조용히 죽는다.
   지금은 0012가 education v1을 등록해 놨으니 안 터지지만, **레지스트리는 버전을 올리려고 둔 것**이라
   `active` 전환이 예정된 동작이다. → 두 lm 호출에 `.catch`. 덧붙은 섹션이 기존 화면을 죽이지 않는다
   (`finalizeIgnored`의 `.catch`와 같은 논리)
2. **제목 추론이 스키마 순서에 의존했다.** `fields.find(f => f.type==="string" && f.required)`인데
   `status`도 `{"type":"string","enum":[…]}`다. 0012의 properties가 `name`→`status` 순서라
   **순서 덕에** 맞았고, v2에서 뒤집히면 항목 제목이 `"enrolled"`가 된다 → enum 필드를 후보에서 제외
3. (부수) 저장 핸들러가 `closeAll()` **뒤에** `educationCtx`를 읽어 토스트 문구를 정했다.
   `closeAll`은 주석대로 진행 중 컨텍스트를 버리는 함수고(`evxCtx`·`dfxCtx`), 나중에 누가
   `educationCtx`를 그 목록에 넣으면 "추가했어요"가 조용히 거짓말을 한다 → 앞에서 `editing`으로 잡아 둠

### 남은 것 — 사용자 판단

- **필드 라벨이 영문 raw다**(`name`·`term`·`credits`·`prerequisites`). 나머지 UI는 한국어인데
  폼만 영어다. 라벨 매핑을 두면 "스키마 필드 하드코딩 금지"와 부딪히므로 **판단이 필요하다**:
  (a) 그대로 둔다 (b) `lm_schema`의 body에 `title`/`label`을 넣어 서버가 라벨을 준다(스키마 변경 = Cowork)
  (b)가 레지스트리 취지에 맞지만 마이그레이션이 붙는다
- 폰 실측은 티켓 §확인 절차 그대로. 특히 4번(status 3색 다크모드 가독)
