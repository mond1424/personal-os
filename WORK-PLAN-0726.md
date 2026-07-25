# WORK-PLAN-0726 (rev.2) — 분석 출력량 · 공용 모달 · 마감 시 상태 서술 · 취소 사유

작성: 2026-07-26 (Claude Chat) · rev.2에서 S3 폐기 / S5 삭제 / S4 append-only 반영
검증 기준선: **typecheck 통과 · smoke 145 · front 157 · 실패 0**

## 리포 실제 상태 (2026-07-26 raw 재확인)

- `docs/schema-current.sql` 헤더: `…0007_defer_reason · 0008_cancel_task` / 생성일 2026-07-23
- **`cancel_reason`·`cancelled_by` 컬럼 없음. `migrations/0009_*.sql` 파일 없음.**
- 0008은 **원격 적용 + `deploy` 완료**(사용자 확인). 라이브 = 최신.
- 따라서 **0009는 이번 세션에서 새로 작성**한다.

## rev.1에서 바뀐 것

| | rev.1 | rev.2 |
|---|---|---|
| S3 | 날짜 시트에 상태 서술 입력 추가 | **폐기** → S3′ 마감 시 유도 (프런트만, 백엔드 변경 없음) |
| S4 | uncancel 시 `cancel_reason` NULL | **NULL로 지우지 않음** + `cancelled_by` 추가 |
| S5 | event 취소 상태 (0010) | **삭제** — memo로 대체, STATE에 재검토 조건만 기록 |

---

## 0. 작업 원칙 (Claude Code)

- **단계(S1~S4) 단위로만 진행한다.** 한 단계가 끝나면 멈추고 검증 결과를 보고한 뒤 사용자 승인을 기다린다.
- 각 단계 종료 시 `npx tsc --noEmit` + smoke + front를 돌리고 **기준선 대비 증감**을 보고한다.
- 커밋은 단계별로 나눈다. **push · deploy · 원격 마이그레이션은 사용자가 직접** 한다. 로컬 마이그레이션(`--local`)까지만 적용하고 보고한다.
- 문서에 없는 파일을 임의로 열어 넓게 탐색하지 않는다. 지시된 파일·함수만 읽고, 추가 확인이 필요하면 이유를 밝히고 물어본다.
- 기존 함수·경로를 **삭제하지 말고 확장**한다.

### 단계와 순서

| 단계 | 내용 | 난이도 | 마이그레이션 | 선행 |
|---|---|---|---|---|
| S1 | 분석 출력량 3단계 조절 | 간단 | 없음 | — |
| S2 | 공용 모달 레이아웃 수정 | 간단 | 없음 | — |
| S3′ | 마감 시 상태 서술 유도 | 간단 | 없음 | **S2** |
| S4 | 할 일 취소 사유 | 복잡 | **0009** | **S2** |

> **S2가 S3′·S4보다 먼저인 이유**: 둘 다 확인 박스(`confirmAsk`) 안에 textarea를 넣는다. 박스가 깨진 상태에서 내용을 추가하면 원인 분리가 불가능하다.

---

# S1 — 분석 출력량 3단계 조절 (간단 · 마이그레이션 없음)

## 목표

분석 실행 시 **보통 / 자세히 / 매우 자세히** 중 하나를 골라 출력 분량을 조절한다.
현재 고정 출력은 '자세히'와 '매우 자세히'의 중간이므로 **기본값은 `detailed`(자세히)**, 현재보다 아주 약간 짧아진다.

선택값은 `analyses.context_meta`(이미 JSON TEXT)에 저장한다 → **신규 컬럼·마이그레이션 없음.**

| key | 라벨 | 문단 지시 | pass1 | pass2 |
|---|---|---|---|---|
| `normal` | 보통 | 2~3문단, 핵심만 | 900 | 600 |
| `detailed` | 자세히 (기본) | 3~5문단 | 1300 | 900 |
| `deep` | 매우 자세히 | 6문단 이상, 날짜·수치 근거 충분히 | 2600 | 1800 |

> 변경 전 현재값: `"소제목·불릿 없이 2~5문단"` + pass1 1400 / pass2 1000.

## S1-a. `src/services/analysis.ts`

1. `SYS_BASE` 바로 위에 상수 추가.

```ts
/** 5.3 출력 분량 — 요청 시 사용자가 고른다. 기본 detailed(기존 고정 출력에 가장 가깝다). */
const DEPTH = {
  normal:   { label: "보통",        para: "2~3문단으로 핵심만 간결히 쓴다.",                          p1: 900,  p2: 600  },
  detailed: { label: "자세히",      para: "3~5문단으로 쓴다.",                                        p1: 1300, p2: 900  },
  deep:     { label: "매우 자세히", para: "6문단 이상으로, 근거가 되는 날짜·수치를 충분히 인용한다.", p1: 2600, p2: 1800 },
} as const;
type Depth = keyof typeof DEPTH;
```

2. `SYS_BASE` 끝의 **`" 소제목·불릿 없이 2~5문단."` → `" 소제목·불릿 없이 한국어 산문으로 쓴다."`**. 분량 지시는 depth가 담당한다.

3. `create(env, t, prompt, depth?)` 로 확장하고 `prompt` 검증 **직후** 정규화.

```ts
const dk: Depth = (typeof depth === "string" && depth in DEPTH) ? (depth as Depth) : "detailed";
const D = DEPTH[dk];
```

> 잘못된 값·누락은 **400이 아니라 `detailed` fallback**(기존 클라이언트 호환).

4. pass1 / pass2:
   - `maxTokens: 1400` → `D.p1`, `maxTokens: 1000` → `D.p2`
   - 두 호출의 `system` 문자열 **맨 끝에 `" " + D.para` 를 덧붙인다.** 기존 문구는 그대로 두고 뒤에 붙이기만 한다.

5. `const fullMeta = { ...meta, models: m, depth: dk };`

## S1-b. `src/index.ts`

`app.post("/api/analyses", ...)`(대략 192~195행): `analysis.create(c.env, c.get("t"), b.prompt)` → **`(…, b.prompt, b.depth)`**. body 파싱 방식은 건드리지 않는다. 타입 에러 시 body 타입에 `depth?: unknown` 만 추가.

## S1-c. `public/api.js` (73행)

```js
runAnalysis: (prompt, depth) => _req("POST", "/analyses", { prompt, depth }),
```

## S1-d. `public/index.html` — `#scr-anal` (대략 143~151행)

`<textarea id="anal-q">` 와 `<div class="ctxbox">` **사이**에 삽입. 기존 `.wsegs`/`.wseg` 재사용(다크모드 선택색은 WORK-PLAN-0723 1단계 [#1]에서 해결됨 — `style.css`의 `.wseg.on` 다크 오버라이드 2곳 → **신규 CSS 불필요**).

```html
<div class="wsegs" id="anal-depth" style="margin-top:10px">
  <button class="wseg" data-d="normal">보통</button>
  <button class="wseg on" data-d="detailed">자세히</button>
  <button class="wseg" data-d="deep">매우 자세히</button>
</div>
```

## S1-e. `public/app.js`

1. `runAnalysis()`(대략 1648행):

```js
const d = ($("#anal-depth .wseg.on")?.dataset.d) || "detailed";
...
const a = await Api.runAnalysis(q, d);
```

   `$("#anal-q").value = ""` 는 유지하되 **세그 선택은 초기화하지 않는다.**

2. `boot()`에 세그 클릭 바인딩. **works 탭 `.wsegs` 바인딩 코드를 먼저 찾아 같은 패턴으로 작성한다**(새 방식 창작 금지). 클릭한 버튼에만 `.on`을 남기며 **분석을 자동 실행하지 않는다.**

3. `#btn-run-anal` 스피너 문구 `"분석 중 — 2-pass"` 유지.

## S1-f. 테스트

- `test/smoke.ts` — `depth:"normal"`/`"deep"` 각각 200 + `context_meta.depth` 일치 / 누락·`"garbage"` → 200 + `"detailed"`
- `test/front.mjs` — `#anal-depth` 에 `.wseg` 3개, 기본 `.on` 은 `detailed` / `보통` 클릭 시 `.on` 이동

## S1 체크포인트 — 정지

예상 smoke 145→147+, front 157→159+, 실패 0.
3단계 실제 출력 길이 비교는 AI 실호출이 필요하므로 **사용자가 폰에서 확인**한다.

---

# S2 — 공용 모달 레이아웃 수정 (간단 · CSS 3줄 · 향후 전 모달이 상속)

## 증상

확인 박스가 가로로 넓어지지 않고 내용이 없는 것처럼 짧게 뜬다. 본문 텍스트는 허용 가로폭이 0인 것처럼 **박스 밖으로 빠져나와 세로로 길게 나열**된다.

## 진단 (취소 전용 버그가 아니다)

관련 CSS는 `public/style.css` 64~66행 3줄이 전부이며 `#confirm` 전용 규칙은 없다.

```css
.modal{position:absolute;inset:0;z-index:10;display:none;place-items:center;background:rgba(30,26,20,.45);padding:26px}
.modal.on{display:grid}
.mbox{...;width:100%;max-width:330px}
```

`display:grid` + `place-items:center` 는 `justify-items:center` 를 포함하므로 **`.mbox` 는 트랙에 stretch 되지 않는 그리드 아이템**이 된다. 이 상태에서 `width:100%` 는 컨테이너가 아니라 **auto 로 사이징된 트랙**을 기준으로 해석된다. 퍼센트 너비 아이템의 트랙 기여도는 `auto` 로 취급되므로 트랙이 min-content(한국어에서 사실상 한두 글자 폭)로 접힐 수 있고, 박스가 좁아지며 본문이 넘친다. 모바일 WebKit에서 특히 잘 드러난다.

## 범위 (과대평가 주의)

현재 `.modal`/`.mbox` 사용처는 `public/index.html` 의 **`#stale`(365행)·`#confirm`(376행) 둘뿐**이다. 설정·분석은 시트(`sh-*`), 튜토리얼은 `.tut`, Guard는 `.guard` 로 각자 다른 클래스를 쓴다.

**이것은 CSS 3줄 교체이지 컴포넌트 리팩토링이 아니다.** 모달 추상화 계층을 새로 만들지 말 것. 다만 앞으로 추가될 모달은 전부 이 규칙을 상속하므로 지금 바로잡는다.

## S2-a. `public/style.css` (64~66행)

그리드를 **flex 로 교체**한다. flex 아이템의 `width:100%` 는 컨테이너 content box 기준으로 해석되어 모호성이 사라진다.

```css
.modal{position:absolute;inset:0;z-index:10;display:none;background:rgba(30,26,20,.45);padding:26px}
.modal.on{display:flex;align-items:center;justify-content:center}
.mbox{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:20px;
  width:100%;max-width:330px;min-width:0;box-sizing:border-box;max-height:100%;overflow-y:auto}
```

- `place-items:center` 제거 → `.modal.on` 의 flex 중앙 정렬로 대체
- `min-width:0` — flex 아이템 기본 `min-width:auto` 로 인한 축소 불가 방지
- `box-sizing:border-box` — `padding:20px` 가 330px 상한을 넘기지 않도록
- `max-height:100%;overflow-y:auto` — 본문이 길어져도(S3′·S4에서 textarea 추가) 버튼이 화면 밖으로 밀리지 않도록

## S2-b. `public/index.html` (379행)

```html
<p class="abody" style="color:var(--sub);overflow-wrap:anywhere" id="cf-text"></p>
```

> `word-break:break-all` 이 아니라 `overflow-wrap:anywhere`. 평소엔 단어 단위, 넘칠 때만 강제로 끊는다.

## S2-c. 검증 방식

- **S2-a 만 적용하고 폰에서 먼저 확인.** 해결되면 S2-b 는 방어용으로 함께 두고 다른 변경은 추가하지 않는다.
- **S2-a 이후에도 증상이 남으면 거기서 멈추고 보고한다.** 추가 CSS를 추측으로 덧붙이지 말 것. 그 경우 `#confirm` 의 실제 부모가 `.phone` 인지, `.phone` 의 `position`(style.css 18행 · 381행 반응형 분기)이 무엇인지 확인해 `position:absolute` 의 기준 박스를 다시 따진다.
- **`#stale` 과 `#confirm` 을 둘 다 육안 확인한다.**
- `test/front.mjs` — 얕은 검사 1건만: `.modal.on` 의 `display` 가 `flex`, `.mbox` 에 `min-width:0`. **레이아웃 실측은 jsdom 에서 불가하므로 무리하지 않는다.**

## S2 체크포인트 — 정지 (사용자 폰 실측 필수)

---

# S3′ — 마감 시 상태 서술 유도 (간단 · 프런트만 · 선행 S2)

## 왜 rev.1의 S3를 폐기했는가

`src/scheduled.ts`:

```ts
const open = await db.openDatesBefore(env, t.d);
for (const { date } of open.results) await closeDay(env, t, "auto", date);
```

Cron이 **30분마다** 오늘 이전의 열린 날을 **전부** auto 마감한다. 즉 '과거의 열린 날'은 최대 30분만 존재하므로, 날짜 시트에 상태 서술 입력을 열어도 거의 항상 마감 가드에 걸린다 — **실효가 없다.**

**확정 정책: 상태 서술(`feelings_text`)은 "기록"이다. 그날 안에만 쓰고, 마감 후에는 어떤 경로로도 수정·추가되지 않는다.** (`daily.setFeelingsText` 에 `date` 파라미터를 추가하지 않는다.)

공백 문제는 **입력 경로가 아니라 수집 시점** 문제다. 상태 서술을 실제로 받을 수 있는 유일한 창은 **수동 마감 직전**이다.
(auto 마감된 날은 애초에 앱을 안 켠 날이라 받을 수 없다 — 그런 날의 정성 기록은 **memo** 가 담당한다. memo는 마감된 날에 붙는 유일한 통로이고 `analysis.ts:124` 가 이미 분석 컨텍스트에 넣는다.)

## S3′-a. `public/app.js` — `askClose`(대략 1975~1986행)

`#btn-close`(manual) · `#btn-close-brief`(brief) 두 경로가 공유하는 `askClose(kind)` 를 확장한다.

1. 확인 박스를 띄우기 전에 현재 상태 서술이 비어 있는지 본다.

```js
const cur = ((S.today.daily && S.today.daily.feelings_text) || "").trim();
```

2. **비어 있을 때만** 기존 body 문자열 뒤에 textarea 를 덧붙인다. 채워져 있으면 박스는 지금과 완전히 동일해야 한다.

```js
const extra = cur ? "" :
  `<textarea id="cf-feel" rows="2" style="margin-top:10px;width:100%;box-sizing:border-box"
     placeholder="오늘 상태를 한 줄로 (선택) — 마감 후엔 못 써요"></textarea>`;
```

   placeholder 는 Today 탭 `#feel-text` 와 **같은 성격의 문구**를 쓴다(다른 필드로 오인되면 안 된다).

3. 확인 후 **`closeDay` 보다 먼저** 저장한다. 순서가 뒤집히면 마감 트리거에 막힌다.

```js
if (!okd) return;
const ft = ($("#cf-feel")?.value || "").trim();
if (ft) await Api.feelingsText(ft);   // ← closeDay 이전
await Api.closeDay(kind);
```

   - `#cf-feel` 값은 `confirmAsk` 가 resolve 된 **직후**, 모달이 아직 DOM 에 남아 있을 때 읽는다. `confirmAsk` 는 `.on` 클래스만 제거하므로 요소는 남아 있다.
   - 비어 있으면 아무것도 호출하지 않는다. **강제하지 않는다** — 유도일 뿐이다.
   - `Api.feelingsText` 는 **1인자 그대로** 쓴다(오늘 기준). 시그니처를 바꾸지 않는다.

4. 토스트 문구는 그대로 둔다.

## S3′-b. 백엔드

**변경 없음.** `daily.setFeelingsText` · 라우터 · `api.js` 모두 손대지 않는다.

## S3′-c. 테스트

- `test/front.mjs` — 2건
  - `feelings_text` 가 빈 상태에서 마감 확인 박스에 `#cf-feel` 이 존재
  - 이미 채워진 상태에서는 `#cf-feel` 이 **없다**
- smoke 변화 없음(백엔드 무변경).

## S3′ 체크포인트 — 정지

---

# S4 — 할 일 취소 사유 (복잡 · 마이그레이션 0009 · 선행 S2)

## 현재 상태

- 0008이 넣은 `tasks.cancelled_at`/`cancelled_on` 은 있으나 **`cancel_reason`·`cancelled_by` 는 없다.**
- 취소 경로: `public/app.js` `#tk-cancel`(1101행) → `confirmAsk(…)` → `execCancel(t)`(1150행) → `Api.cancelTask(t.id)`.
- 선례: 미루기 사유 `defer_reason`(0007)은 **도착지 엔트리**에 저장한다. 취소는 도착지가 없으므로 **`tasks` 행에 직접** 저장한다.

## 확정 정책 — 취소 사유는 append-only

- `cancel_reason` 은 **취소 시점에 한 번 쓰고, 취소 상태인 동안 수정하지 않는다.**
- **취소 해제 시에도 NULL 로 지우지 않고 남긴다.** 다음 취소가 덮어쓴다. (Guard가 '어떤 이유로 취소했는가' 패턴을 읽을 수 있어야 한다.)
- `cancelled_by`(`'user'`/`'guard'`)를 함께 넣는다. 현재는 항상 `'user'` 지만 Guard 개입 4단계가 오면 필수이고 지금 넣는 비용은 0이다.
- 진짜 이력이 필요해지면 `wait_extensions`(`trg_wait_ext_no_del`/`no_upd` 로 불변 강제)와 동형의 `task_cancellations` 테이블로 승격한다. **이번엔 컬럼으로 시작한다** — Guard 스켈레톤이 아직 없다.

## S4-a. `migrations/0009_cancel_reason.sql`

```sql
ALTER TABLE tasks ADD COLUMN cancel_reason TEXT;   -- 취소 사유(자유 텍스트, NULL 허용) (0009)
ALTER TABLE tasks ADD COLUMN cancelled_by  TEXT;   -- 'user' | 'guard' — 취소 주체 (0009)
```

**뷰 재생성 판단**: `docs/schema-current.sql` 의 `v_task_stats` 정의(181~184행 부근)를 먼저 읽는다. 두 컬럼을 `TaskStats` 로 노출하려면 뷰를 재생성해야 한다.

- 재생성 시 **0008이 넣은 `state` CASE 식과 `cancelled_at`/`cancelled_on` 을 한 글자도 바꾸지 말고 보존**한다. 두 컬럼만 추가한다.
- `v_period_achievement` · `is_waiting` 의 취소 제외 조건 유지.
- 트리거 `trg_task_cancel_excl` 은 건드리지 않는다.
- `tasks` 테이블 주석(130~133행 부근)에 append-only 규칙을 한 줄 남긴다.

## S4-b. `src/db/index.ts`

- `stCancelTask` 에 `reason`·`by` 파라미터 추가. `reason` 은 빈 문자열·공백만이면 **NULL 로 정규화**한다(빈 문자열이 남으면 '사유 있음' 판정이 오염된다). `by` 는 기본 `'user'`.
- **`stUncancelTask` 는 `cancel_reason`·`cancelled_by` 를 건드리지 않는다.** `cancelled_at`/`cancelled_on` 만 NULL 로 되돌린다. (append-only 정책 — rev.1의 "NULL 로 되돌린다"는 폐기됨.)

## S4-c. `src/services/tasks.ts`

- `cancelTask(env, t, id, reason?)` — `reason` 선택, **500자 제한**(초과 시 400, 문구는 defer 사유 제한과 같은 톤). `by` 는 지금 단계에선 항상 `'user'`.
- **취소 가드(409) 검사 순서는 절대 바꾸지 않는다.** 0008에서 `deferTask` 의 검사 순서를 고쳐야 했던 회귀 이력이 있다.

## S4-d. `src/index.ts` · `public/api.js` · `src/types.ts`

- 라우터: cancel 엔드포인트 body 에 `reason?` 추가
- `api.js`: `cancelTask: (id, reason) => ...` — **기존 1인자 호출도 계속 동작해야 한다**
- `types.ts`: `TaskStats` 에 `cancel_reason?: string | null` · `cancelled_by?: string | null` 추가

## S4-e. `public/app.js` — 입력과 표시

**입력** — `#tk-cancel`(1101행). `confirmAsk` 는 공용 함수이므로 **시그니처를 바꾸지 말고** body 뒤에 textarea 를 덧붙인다.

```js
const body = (kept ? `…` : `…`) +
  `<textarea id="cf-reason" rows="2" style="margin-top:10px;width:100%;box-sizing:border-box"
     placeholder="취소하는 이유 (선택) — 나중에 고칠 수 없어요"></textarea>`;
if (await confirmAsk("이 일을 취소할까요?", body, "취소하기") === "ok") {
  await execCancel(t, ($("#cf-reason")?.value || "").trim());
}
```

- `#cf-reason` 값은 `confirmAsk` resolve **직후** 읽는다(요소는 DOM 에 남아 있다).
- `execCancel(t, reason)` 로 확장 → `Api.cancelTask(t.id, reason)`.
- **409(삭제 불가 → "대신 취소하기") 경로(1142행)는 사유 없이 그대로 둔다.** 이미 다른 안내문을 담고 있어 맥락이 겹친다.
- placeholder 에 **"나중에 고칠 수 없어요"** 를 반드시 넣는다 — append-only 정책을 사용자가 입력 시점에 알아야 한다.

**표시** — task 상세 시트의 `취소됨 · {날짜}` 배지(1060행) **아래**에 사유 한 줄. 사유가 없으면 아무것도 그리지 않는다. `esc()` 필수.
취소 해제된 task 에는 **사유를 표시하지 않는다**(컬럼엔 남아 있지만 현재 상태가 아니다).

> `#cf-no` 라벨이 "취소"(=닫기)라 새 '취소' 기능과 혼동된다. **이번 단계에서 건드리지 않는다** — 공용 모달이라 다른 확인 박스 문구까지 흔들린다. STATE 미해결에 이미 기록돼 있다.

## S4-f. 테스트

- `test/smoke.ts` — 5건
  - 사유와 함께 취소 → 200, 재조회 시 `cancel_reason` 일치, `cancelled_by === "user"`
  - 사유 없이 취소 → 200, `cancel_reason === null`
  - 빈 문자열/공백만 → `cancel_reason === null`
  - 501자 → 400
  - **취소 해제 후에도 `cancel_reason` 이 남아 있고 `state === "not_finished"`** ← append-only 핵심 검사
- `test/front.mjs` — 취소 확인 박스에 `#cf-reason` 존재 / 취소된 task 상세 시트에 사유 노출 / 취소 해제 상태에선 미노출

## S4 체크포인트 — 정지

로컬 마이그레이션(`--local`)까지만 적용하고 보고한다. **원격 적용·deploy 는 사용자.**

---

# 삭제된 단계 — event 취소 (구 S5, 0010)

**하지 않는다.** 근거:

- "잘못 만든 미래 일정 = 삭제 / 실제로 취소된 과거 일정 = 취소" 라는 의미 구분 자체는 옳다.
- 그런데 **삭제 쪽은 이미 구현돼 있다** — `trg_events_frozen_del` 이 마감된 날 삭제를 막고, 열린 날·미래는 자유다. 추가 작업 0.
- 남는 '과거 취소'는 `trg_events_frozen_upd` 가 막는다. 마감된 날의 event 는 **UPDATE 자체가 ABORT** 되므로 `cancelled_at` 을 쓰는 것도 불가능하다. 하려면 불변성 트리거에 구멍을 뚫어야 하는데, `0005_delete_scope`(`wait_extensions` 삭제 잠금)와 같은 종류의 위험한 변경이다.
- "7/30 MT 우천 취소" 는 **그날 memo 로 이미 기록되고 분석이 읽는다**(스키마·트리거 변경 0).

**재검토 트리거**: 캘린더 셀에서 취소된 일정에 취소선이 안 그어지는 게 실사용에서 거슬릴 때. 그때 0010을 다시 꺼낸다.

---

## 세션 종료 규칙 (전 단계 완료 후)

1. `STATE.md` 갱신 — 이번 세션 절, 기준선 수치, 마이그레이션 절에 **0009의 로컬/원격 적용 상태 명시**
2. `docs/api-surface.md` 재생성 (analyses `depth`, cancel `reason`)
3. `docs/schema-current.sql` 재덤프 (0009)
4. `## 설계 정책` 절 확인 — 이번 세션 결정(상태 서술 / 취소 사유 append-only / event 취소 보류)은 **Chat이 이미 기록해 두었다.** 구현 결과와 어긋나면 그때 정정한다.
5. commit & push (push 는 사용자 확인 후)
