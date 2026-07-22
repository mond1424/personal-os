# 작업 지시서 — 2026-07-23 (personal-os)

> **Claude Code 실행 규약**
> - 이 문서의 단계를 **위에서 아래로 순차 실행**한다. 단계를 건너뛰거나 병합하지 않는다.
> - **한 단계를 끝내면 반드시 멈추고**, 아래 "정지 프롬프트"를 사용자에게 보여준 뒤 승인을 받는다. 승인 전에는 다음 단계로 넘어가지 않는다.
> - 각 단계 끝의 **검증**을 먼저 통과시킨 뒤 정지한다.
> - 라인 번호는 2026-07-22 스냅샷 기준 참고값이다. 편집 전 해당 함수/문자열을 grep으로 재확인하고, **문자열 매칭으로** 수정한다.
> - GitHub raw가 단일 진실 원본. 이미 읽은 파일은 세션 최신본 우선, 변경 시에만 재다운로드.

## 대상 파일 raw
```
app.js     https://raw.githubusercontent.com/mond1424/personal-os/main/public/app.js
api.js     https://raw.githubusercontent.com/mond1424/personal-os/main/public/api.js
style.css  https://raw.githubusercontent.com/mond1424/personal-os/main/public/style.css
index.html https://raw.githubusercontent.com/mond1424/personal-os/main/public/index.html
memos.ts   https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/memos.ts
tasks.ts   https://raw.githubusercontent.com/mond1424/personal-os/main/src/services/tasks.ts
index.ts   https://raw.githubusercontent.com/mond1424/personal-os/main/src/index.ts
db/index.ts https://raw.githubusercontent.com/mond1424/personal-os/main/src/db/index.ts
```

---

# 1단계 — CSS·상수만 (백엔드 무관, 가벼움)

원래 항목 1·2·3·5. 네 건 모두 프런트 표시/모션 조정이며 서로 독립적이다. 한 번에 처리한다.

## 1-1. 다크모드 "이월 중" 세그 버튼 색 (항목 1)

**증상**: 다크모드에서 Works 탭 "이월 중" 세그를 선택(`.on`)해도 배경이 안 바뀐다.

**원인**: `.wseg.on`(style.css 219행, 명시도 0,2,0)이 다크 오버라이드 `:root[data-theme="dark"] .wseg.hotN`(0,3,0) 및 미디어쿼리 `:root:not([data-theme="light"]) .wseg.hotN`에 명시도로 밀린다. "이월 중"은 이월 건수로 `hot1~3`이 붙는 유일한 세그라 거기서만 증상이 난다.

**수정**: 다크 블록 **두 곳** 각각에, 기존 `.wseg.hotN` 규칙 **뒤에** 선택 상태 오버라이드를 추가한다. `--ink`/`--paper`는 다크에서 이미 반전돼 있으므로 그대로 쓴다.

- 미디어쿼리 블록(style.css 336행, `:root:not([data-theme="light"]) .wseg.hot3{...}` 바로 다음 줄):
```css
  :root:not([data-theme="light"]) .wseg.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
```
- data-theme 블록(style.css 343행, `:root[data-theme="dark"] .wseg.hot3{...}` 바로 다음 줄):
```css
:root[data-theme="dark"] .wseg.on{background:var(--ink);color:var(--paper);border-color:var(--ink)}
```

## 1-2. 탭 간 스와이프 미작동 (항목 2)

**증상**: 탭 좌우 스와이프 제스처가 실제로 동작하지 않는다.

**원인**: `bindSwipe()`는 boot에서 정상 호출(app.js 1916행)되나, 스와이프 호스트인 `.screens`에 `touch-action` 지정이 없다. 모바일 브라우저가 가로 끌기를 네이티브 스크롤로 가져가며 `pointercancel`을 발생시켜 제스처가 무효화된다. (대조: `#cal-rows`는 `touch-action:pan-y`가 있어 캘린더 스와이프는 동작함 — style.css 463행.)

**수정**: style.css 30행 `.screens` 규칙에 `touch-action:pan-y`를 추가한다. (세로 스크롤은 자식 `.screen`이 담당하므로 `pan-y` 허용이 맞다.)
```css
.screens{flex:1; position:relative; overflow:hidden; touch-action:pan-y}
```

**검증 주의**: 이건 실기기(터치) 없이는 확인 불가. 데스크톱 포인터 드래그로는 재현이 안 될 수 있으니, **폰 실측 항목으로 표시**하고 사용자에게 폰 확인을 요청한다.

## 1-3. 경계 스트레치 모션 — 너무 작고 빠름 (항목 3)

**증상**: 화면 최상단/최하단에서 당길 때 나오는 러버밴드 감이 약하고 스냅백이 급하다.

**현재값**: app.js 1753행 `STRETCH_MAX=48, STRETCH_K=0.3`. 스냅백 트랜지션은 탭 전환과 공유하는 `TRACK_MS=300ms` / `TRACK_EASE`(app.js 135행)를 그대로 씀(app.js 1782행 부근 `release()`).

**수정**: 진폭을 키우고 스냅백을 **전용 시간·이징으로 분리**한다(탭 전환 곡선을 건드리지 않기 위해).

- app.js 1753행:
```js
const STRETCH_MAX = 90, STRETCH_K = 0.42;
```
- `release()` 내부에서 스냅백 트랜지션을 전용 상수로 교체. 파일 상단(예: 1753행 근처)에 상수 추가:
```js
const STRETCH_BACK_MS = 460, STRETCH_BACK_EASE = "cubic-bezier(.22,1,.36,1)";
```
  그리고 `release()`의 `sc.style.transition = \`transform ${TRACK_MS}ms ${TRACK_EASE}\`;`를
```js
        sc.style.transition = `transform ${STRETCH_BACK_MS}ms ${STRETCH_BACK_EASE}`;
```
  로 바꾼다.

**주의**: A-6 기존 주석(“기기 실측 필요 / bindEdgeStretch() 한 줄 지우면 꺼짐”)은 유지한다. 값은 폰 실측 후 미세조정 대상.

## 1-4. today 대기 행 가로 65% (항목 5)

**증상**: Today 탭에서 "일정/todo/대기" 중 **대기**가 다른 둘과 같은 전폭이라 시각적으로 동급으로 보인다. 대기는 급하지 않으므로 좁힌다.

**수정**: `#today-wait`의 인라인 `width:100%`(index.html 34행)를 `65%`로 바꾼다. 왼쪽 정렬 유지(카드가 줄어들어 오른쪽에 여백이 생기는 형태).
```
width:65%
```
카드가 왼쪽으로 붙는지 확인하고, 필요 시 `margin-right:auto`로 좌측 고정.

## 1단계 검증
- `npx tsc --noEmit` 통과 (사실상 TS 무변경이라 영향 없음)
- 브라우저에서 라이트/다크 토글하며: 다크 "이월 중" 선택 시 배경 반전 확인 / 대기 행 65% 확인 / 데스크톱에서 상하 당김 모션이 더 크고 부드러운지 확인
- 스와이프(1-2)는 **폰 실측 대기**로 명시

## 1단계 정지 프롬프트
```
[1단계 완료] 항목 1·2·3·5 (다크 세그색 / 스와이프 touch-action / 스트레치 모션 / 대기 행 65%)
- 데스크톱에서 확인 가능한 항목은 반영됐습니다.
- 스와이프(1-2)와 스트레치 감(1-3)은 폰 실측이 필요합니다.
2단계(완료율 화면 제거 + 미루기 사유)로 진행할까요?
```

---

# 2단계 — 완료율 화면 제거 + 미루기 사유 추가 (중간)

원래 항목 4. 두 작업은 **독립적이지만 같은 미루기 시트를 건드리므로 함께** 처리한다.
- **4-a**: 완료율을 **화면에서만** 제거. **DB 컬럼 `rate`·완료 로직은 그대로 둔다**(되돌리기 쉽게, 그리고 `rate=100`이 완료 신호로 계속 쓰이므로 `completeTask` 무변경).
- **4-b**: `migration 0007`로 `defer_reason` 추가 → 미루기 시트에서 (제거된) 완료율 자리에 사유 입력.

> ⚠️ **개념 결정 반영**: "완료율 개념을 화면에서 없앤다". 단 DB·완료로직에서의 물리적 소거(컬럼 DROP, setRate/rateSet/rbar 함수 삭제)는 **이번에 하지 않는다**. 그건 별도 정리 작업(향후). 지금은 **표시 제거 + 사유 추가**까지만.

## 2-a. 완료율 화면 제거

완료율이 **화면에 출력되는 지점만** 제거/치환한다. 함수 정의(`rbar`, `rateSet`, `rateOf`, `setRate`)와 db 문장은 **삭제하지 않는다** — 사유 입력이 자리 잡을 때까지 완료 로직이 안전하게 돌아가야 한다.

**제거·치환 지점 (app.js):**
1. **리스트 pct 배지** — 306행:
   ```js
   ${t.rate ? `<span class="ratepct">${t.rate}%</span>` : ""}
   ```
   → 이 조각 삭제(빈 문자열로). 이월 표시(`!` warn)는 유지.
2. **리스트 pct 배지(재배정/다른 목록)** — 915행 동형 `${r.rate ? ... }%` 삭제.
3. **날짜 시트 tag** — 461행:
   ```js
   : t.class === "done" ? "완료" : t.deferred_to ? `→ ${md(t.deferred_to)}` : `${t.rate ?? 0}%`;
   ```
   맨 끝 `` `${t.rate ?? 0}%` ``를 `""`로. (완료/미룸 태그는 유지, 그 외에는 태그 없음.)
4. **날짜 시트 inner의 rate 관련 mono 칸** — 463행: `${t.rate != null && day.relation !== "past" ? "" : "—"}` 는 rate 유무로 분기하는데, 이제 항상 `—` 자리표시가 자연스럽다. `<span class="ts mono">—</span>` 로 단순화(또는 빈 칸). 레이아웃 확인 후 결정.

**미루기 시트에서 완료율 바 제거** — 아래 2-b와 함께 진행(시트 본문을 사유 입력으로 교체하므로).

**CSS**: `.ratepct` 규칙은 남겨둬도 무해(미사용). 굳이 지우지 않는다.

**주의 — 삭제하면 안 되는 것:**
- `completeTask`(tasks.ts 135행) — `rate=100` 완료 신호 유지
- `rateSet`/`rateOf`(app.js 654/652행), `setRate`(tasks.ts 190행), `/tasks/:id/rate` 라우터(index.ts 140행), `Api.setRate`(api.js 53행), db의 `stSetRate`/`stRate100At`/`liveEntry` — 전부 유지
- `Api.works`의 `rate: e ? (e.rate ?? 0) : 0`(app.js 870행) — 유지(데이터 흐름 보존)

## 2-b. 미루기 사유 (`defer_reason`)

### DB — migration 0007
`migrations/0007_defer_reason.sql` 신규:
```sql
-- 미루기 사유: 도착지 항목(새 예정)에 남긴다.
-- 원 항목은 마감된 날이면 트리거가 수정을 막으므로, 열린 날/재배정 두 갈래 모두
-- '새로 만들어지는 도착지 항목'에 사유를 붙여 균일하게 보존한다.
ALTER TABLE task_entries ADD COLUMN defer_reason TEXT;
```
- `docs/schema-current.sql`의 `task_entries` 정의에 `defer_reason TEXT` 추가.
- `test/smoke.ts` 스키마 목록에 `0007_defer_reason` 추가.
- **STATE.md**: 최신 마이그레이션을 0007로 갱신, "0006 미적용" 경고 유지 + 0007도 `--local`→`--remote` apply 필요 명시.

### db 문장 (src/db/index.ts)
- `stInsertEntry`가 도착지 항목을 만들 때 `defer_reason`을 받도록 확장하거나, 별도 `stSetDeferReason(env, id, date, reason)`를 추가. **권장**: 새 예정 insert 직후 도착지(`to`)에 사유를 UPDATE하는 `stSetDeferReason` 추가 — insert 시그니처를 건드리지 않아 다른 호출부(createTask 등) 영향 없음.
  - grep로 `stInsertEntry` 정의·호출부 먼저 확인 후 방식 확정.

### 서비스 (tasks.ts `deferTask`, 79~103행)
- 시그니처에 `reason?: string` 추가:
  ```ts
  export async function deferTask(
    env: Env, t: TimeCtx, id: string, from: string, to: string, rate?: number, reason?: string,
  ) {
  ```
- batch에 도착지 사유 저장을 추가(있을 때만):
  ```ts
  await env.DB.batch([
    ...(setRate ? [db.stSetRate(env, id, from, rate!)] : []),
    ...(frozen ? [] : [db.stMarkDeferred(env, id, from, to, t.now)]),
    db.stInsertEntry(env, id, to, t.now),
    ...(reason?.trim() ? [db.stSetDeferReason(env, id, to, reason.trim())] : []),
  ]);
  ```
  반환값에 `reason` 포함 선택.
- **완료율 파라미터는 유지**하되(로직 안전), 프런트에서 더는 사용자 입력으로 넘기지 않는다(아래).

### 라우터 (src/index.ts 127~130행)
```ts
app.post("/api/tasks/:id/defer", async (c) => {
  const b = await body<{ from: string; to: string; rate?: number; reason?: string }>(c);
  return c.json(await tasks.deferTask(c.env, c.get("t"), c.req.param("id"), b.from, b.to, b.rate, b.reason));
});
```

### 프런트 api (public/api.js 46행)
```js
defer: (id, from, to, reason) => _req("POST", `/tasks/${id}/defer`, { from, to, reason }),
```
> rate는 더 이상 사용자 입력으로 보내지 않는다. (백엔드는 rate 없으면 기존 값 유지 — deferTask의 `rate === undefined` 분기가 이미 그렇게 동작.)

### 미루기 시트 UI (index.html + app.js)
- **index.html** `#sh-defer`(331~) 내부: `어디까지 했어요?` 키커 + `#dfx-rate`(완료율 바)를 **사유 입력으로 교체**:
  ```html
  <div class="kicker" style="margin-top:16px;font-size:10px">왜 미루나요? (선택)</div>
  <textarea id="dfx-reason" rows="2" placeholder="사유를 적어두면 나중에 분석에서 볼 수 있어요"
            style="width:100%;margin-top:8px"></textarea>
  ```
  (`#dfx-what`, `#dfx-note`, 취소/확인 버튼은 유지.)
- **app.js** 미루기 시트 열기/확정 로직:
  - `openDeferSheet`(또는 `dfxCtx` 세팅부, 684~697행 부근)에서 `#dfx-rate` 렌더(`rbar(...)`)와 `dfxRate()`/`rateOf` 호출을 **제거**. 대신 `#dfx-reason` 값 초기화(빈 값).
  - `bindDeferSheet`의 `#dfx-ok`(702~710행)에서:
    ```js
    const reason = $("#dfx-reason").value;
    await Api.defer(c.id, c.from, c.to, reason);
    ```
    기존 `c.frozen ? undefined : c.rate` 인자는 제거.
  - `dfxCtx`에서 `rate`/`frozen`이 rate 표시 용도로만 쓰였다면 정리. (`frozen`이 다른 안내문에 쓰이면 유지.)
- **textarea 최소 CSS**(style.css, 없으면 추가): 폰트/보더를 앱 톤에 맞춤. 기존 input 스타일 재사용 가능하면 클래스만 부여.

### 분석 노출(선택, 이번 범위 밖 가능)
- `defer_reason`을 분석 화면에 실제로 보여주는 건 별도. 이번 단계는 **저장 경로 확립까지**. md에 "분석 표시는 향후"로 남긴다.

## 2단계 검증
- `npx tsc --noEmit` 통과
- 로컬 D1에 0007 적용(`wrangler d1 migrations apply --local`) 후 smoke 실행 — 스키마 목록 0007 포함 통과
- 브라우저: 완료율 배지/바가 어디에도 안 보이는지(리스트·날짜시트·미루기시트) / 미루기 시트에 사유 textarea가 뜨고, 사유 적고 미루기 → 도착지 날짜 시트나 DB에서 `defer_reason` 저장 확인
- **완료 동작 회귀 확인**: 리스트에서 완료 처리·미루기 후 완료 등 기존 완료 흐름이 그대로 되는지(내부 rate=100 경로 유지 확인)

## 2단계 정지 프롬프트
```
[2단계 완료] 완료율 화면 제거 + 미루기 사유(defer_reason, migration 0007)
- 완료율은 화면에서 사라졌고 DB 컬럼·완료 로직은 유지했습니다(rate=100 완료 신호).
- 미루기 시트에 사유 입력이 생겼고 도착지 항목에 저장됩니다.
- ⚠️ 0006·0007 마이그레이션 remote apply + deploy는 직접 하셔야 합니다.
- (사유의 분석 화면 노출은 향후 작업으로 남겼습니다.)
3단계(memo 통합 — 아무 날짜 + 날짜 시트 통합 폼)로 진행할까요?
```

---

# 3단계 — memo 통합: 아무 날짜 + 날짜 시트 통합 폼 (무거움)

원래 항목 6. "대안 B — 하나로 통합": memo를 **어느 날짜에든 붙는 짧은 노트**로 만들고, 마감된 날엔 불변(기존 트리거 그대로). 기존 "과거기록추가"와 새 "가벼운 노트"를 **한 개념으로** 합쳐 이름 충돌을 제거한다.

> ⚠️ **설계 변경 지점**: 설계 1.3의 "memo = 마감 후 유일한 추가 통로"를 "memo = 어느 날짜에든 붙는 짧은 노트(마감된 날은 불변)"로 **확장**. STATE.md '설계와 어긋난 지점'에 명시적 결정으로 기록.

## 3-a. 백엔드 — daily 존재 요구 완화 (memos.ts `addMemo`)

**현재 제약**(memos.ts): daily 행이 없으면 404(`"그 날의 일기가 없어요 — memo는 기존 기록에만 붙어요"`). 이 때문에 미래/기록 없는 날에 memo 불가.

**변경**: daily가 없으면 **자동으로 최소 daily 행을 보장(ensure)**한 뒤 memo를 붙인다. 마감(closed) 여부는 건드리지 않는다 — 마감된 날의 불변은 기존 트리거가 계속 담당.

- db에 `stEnsureDaily(env, date, now)` 같은 문장이 있는지 grep. 없으면 `INSERT OR IGNORE INTO daily(date, status, created_at) VALUES(?, 'open', ?)` 형태 추가. (스키마의 daily 필수 컬럼·기본값 확인 후 확정.)
- `addMemo`에서 404 던지던 자리를 ensure 호출로 교체:
  ```ts
  // daily가 없으면 빈 open 행을 만들어 붙인다 — memo는 어느 날짜에든 남길 수 있다.
  // 마감된 날의 불변은 트리거가 계속 지킨다.
  await db.stEnsureDaily(env, input.date, t.now).run();
  ```
  (batch 앞이나 별도 실행. summary stale 연쇄는 기존대로.)
- **주의**: 이렇게 생성된 "빈 daily"가 캘린더/통계에서 "기록 있는 날"로 오인되지 않는지 확인. 오인되면, memo 존재 여부로 표시하도록 렌더 조건을 조정(예: daily가 있어도 logs/feelings/tasks/memos가 전부 비면 '빈 날'로 취급). 이건 **확인 후 필요 시** 처리 — grep로 캘린더 렌더의 daily 사용처(`day.daily` 조건) 점검.

## 3-b. 프런트 — 날짜 시트 통합 입력 폼

현재 날짜 시트(app.js `openDay`, 438~)에는 추가 UI가 **제각각**이다:
- 일정: `+ 일정 추가` 버튼 → `openEventSheet`
- 할 일: `addrow`(#day-add) → `addTaskOn` (relation !== past 일 때만)
- memo: `memobox`(#memo-input) → `sendMemo` (relation === past && daily 일 때만)

**목표 UI**: 셀(날짜) 클릭 시 하단에 **하나의 통합 추가 영역**.
```
[ 일정 | 할 일 | memo ]   ← 세그(탭) 선택
[시간] [내용] [추가]        ← 선택에 따라 필드 구성
```
- **세그 상태**에 따라 필드/동작 분기:
  - **일정**: 시간 입력 노출(선택, 종일 허용) + 내용 + 추가 → 기존 이벤트 추가 경로 재사용. (마감된 날도 추가 가능하나 경고문 유지 — 기존 규칙.)
  - **할 일**: 시간 필드 숨김 + 내용 + 추가 → `addTaskOn`(그 날짜에 task 생성). **과거(past)엔 할 일 추가 불가** — 세그에서 '할 일' 비활성 또는 숨김.
  - **memo**: 시간은 자동(현재 시각) 기본, 필드 숨김(또는 읽기 표시만) + 내용 + 추가 → `Api.memo(k, isoNowLocal(), v)`. **모든 relation에서 허용**(3-a 덕분에 과거·오늘·미래 전부).

- **relation별 가용 세그**:
  - `past`(마감/기록된 과거): memo만? → 아니다. 일정은 과거에도 추가 가능(경고). 할 일은 불가. **→ [일정 | memo]**
  - `today`: [일정 | 할 일 | memo] 전부
  - `future`: [일정 | 할 일 | memo] 전부 (미래 memo가 이번 변경의 핵심)
  - 규칙표를 코드 상단 주석으로 명시.

- **구현 방식**:
  - `openDay` 하단의 분기된 3개 UI 블록을 제거하고, 공통 `renderAddZone(k, relation, closed)` 함수로 통합.
  - 세그 클릭 핸들러가 활성 모드를 `dfx`처럼 로컬 상태(예: `S.addMode` 또는 시트 dataset)에 저장하고, 필드 노출/placeholder/추가 콜백을 스왑.
  - 추가 성공 후 `openDay(k)` 재호출로 갱신(기존 패턴 유지).
  - 기존 함수 재사용: `addTaskOn`, `openEventSheet`(또는 인라인 이벤트 추가), `sendMemo` 로직. **가능하면 기존 함수를 얇게 감싸** 새 폼에서 호출 — 삭제보다 재사용.

- **기존 memobox / addrow / 일정버튼**은 통합 폼으로 대체되며 제거. 단 **오늘 마감 후 하단 입력줄이 memo가 되는 경로**(app.js 1869행, `#log-input`/`#log-send`)는 Today 탭 쪽 별개 UI다 — 이번 통합은 **날짜 시트(openDay)** 범위. Today 탭 입력줄은 건드리지 않되, memo 개념 확장과 모순 없는지만 확인.

- **문구 정리**: "과거기록추가"류 안내를 memo 통합 개념에 맞게 수정. `sendMemo`의 toast, `#close-cap`(340행), placeholder(342행) 등에서 "memo만 추가/마감됨" 문구는 마감된 날에 한해 유지, 그 외에는 일반 memo로.

## 3-c. CSS
- 통합 세그(`[일정|할일|memo]`)는 기존 `.seg`/`.seg-mini` 스타일 재사용 검토. 시간 입력·내용·추가 버튼의 한 줄 레이아웃(`addrow` 확장 또는 신규 `.addzone`). 다크모드 색 짝 확인.

## 3단계 검증
- `npx tsc --noEmit` 통과
- 로컬 smoke — memo 관련 테스트가 daily 자동생성 후에도 통과. **미래 날짜 memo 추가** 케이스 수동/테스트 확인.
- 브라우저:
  - 미래 날짜 셀 클릭 → memo 세그 → 내용 추가 → 저장·표시 확인
  - 오늘/과거 각각에서 세그 가용성(과거엔 할 일 세그 없음) 확인
  - 마감된 과거에 memo 추가 시 불변 규칙(수정·삭제 없음) 유지 확인
  - "빈 daily 자동생성"이 캘린더에서 오탐 표시 안 하는지 확인
- README0722·사용설명서0722의 memo 설명 갱신, STATE.md 설계변경 기록

## 3단계 정지 프롬프트
```
[3단계 완료] memo 통합 — 어느 날짜에든 memo 가능 + 날짜 시트 통합 입력 폼
- memo가 과거·오늘·미래 어디든 붙습니다(마감된 날은 불변 유지).
- 날짜 시트 하단이 [일정|할 일|memo] 통합 폼으로 바뀌었습니다.
- ⚠️ 관련 마이그레이션/배포가 있으면 직접 apply·deploy 하셔야 합니다.
- 설계 1.3 확장을 STATE.md에 기록했습니다.
모든 단계가 끝났습니다. 폰 실측 후 미세조정(스와이프·스트레치 감·색 짝)이 남았습니다. 추가로 진행할 것이 있나요?
```

---

## 전 단계 공통 마무리
- 각 단계 커밋 메시지 예:
  - 1단계: `fix(ui): 다크 세그색·스와이프 touch-action·스트레치 모션·대기행 폭`
  - 2단계: `feat(defer): 완료율 화면 제거 + 미루기 사유 defer_reason (0007)`
  - 3단계: `feat(memo): 어느 날짜에든 memo + 날짜 시트 통합 입력 폼`
- STATE.md의 "최근 세션에서 바뀐 것 / 미해결 / 설계와 어긋난 지점"을 단계마다 갱신.
- 마이그레이션 remote apply + deploy는 **사용자 직접**(0006 미적용 경고 계속 유효).

## 이번 범위에서 명시적으로 **제외**한 것
- 완료율 개념의 **물리적 소거**(컬럼 DROP, `setRate`/`rateSet`/`rbar`/`stSetRate` 등 삭제) — 화면 제거로 충분, 향후 별도.
- `defer_reason`의 **분석 화면 노출** — 저장 경로만 확립.
- Today 탭 하단 입력줄(마감 후 memo) 리디자인 — 날짜 시트 통합과 별개.
