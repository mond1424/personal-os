# T-03 — Level 4 AI 검증 (서버측) · `buildCoreContext`

**발행** Cowork · 2026-07-30 · **담당** Claude Code (위임 금지 — Guard 발동 경로) · **상태** ✅ 구현 완료 · deploy 대기

---

## 목표

Level 3 → 4 격상을 판정하는 **서버 엔드포인트**를 만든다. ADR-024의 지출 통제 6겹을 전부 얹는다.
같이 `buildCoreContext()`를 짠다 — 이 검증이 그 함수의 첫 소비처다.

**기기 배선은 이 티켓이 아니다.** 안드로이드가 이 엔드포인트를 부르는 것은 T-04(APK 재빌드 필요).
서버만 먼저 끝내는 이유: **smoke로 검증이 끝나고 폰 없이 배포된다.** 사용자가 원격이다.

## 지금 상태

Level 4가 **검증 없이 발동한다.** `schedule()`이 데드라인 +30분부터 6회를 `fires[]`에 펼치고
기기가 그대로 예약한다. ADR-024가 Accepted인데 구현이 없는 상태다.

## 엔드포인트

```
POST /api/guard/verify
  { client_id, cause, level_candidate: 4, event_id?, risk_snapshot?, foreground_app? }
→ { level: 3 | 4, approved, reason, ai_used, cached, source }
```

`source`는 판정이 어디서 나왔는지: `"ai"` · `"cache"` · `"cap"` · `"timeout"` · `"error"` · `"off"`.
**어떤 경우에도 200으로 답한다** — 기기가 오류 처리를 하게 만들면 새벽에 그 분기가 터진다.
판정 불가는 `level: 3`이지 500이 아니다.

## 지출 통제 — ADR-024 표 그대로, 하나씩 검사한다

| # | 통제 | 구현 |
|---|---|---|
| 1 | 호출 지점 제한 | 이 함수 **하나만** `model_high`를 부른다. 다른 경로에서 호출 금지 |
| 2 | **event당 1회 캐시** | 가장 중요하다 — 없으면 하룻밤 10회 이상 나간다 |
| 3 | 일일 상한 | `guard_modes.ai_daily_cap`(기본 5) vs `db.guardAiCallsOn(env, on_date)` |
| 4 | 타임아웃 8초 | `callModel`엔 타임아웃이 없다. 여기서 씌운다 |
| 5 | 킬 스위치 | `settings`의 `guard_ai_verify`. `'off'`면 **항상 격상**(결정론 복귀, ADR-024 ⑤) |
| 6 | 기록 | `guard_events.ai_used`·`ai_verdict` |

### 캐시 키 — 새 테이블을 만들지 않는다

같은 밤의 같은 데드라인에 대한 판정은 재사용한다. 키:

```
event_id 가 있으면  event_id
없으면(감지 경로)    'watch:' + on_date
```

**저장소는 `guard_events`다.** 같은 키·같은 `on_date`에서 `ai_verdict`가 이미 있는 가장 최근 행을 찾아
그대로 쓴다. 파생을 위한 테이블을 새로 두지 않는다(아키텍처 원칙 1).

## `buildCoreContext()`

계획서 §6.2 그대로.

- **Overview + 활성 Goals + 활성 제약(디데이)** 은 항상 포함한다
- **빈 섹션을 생략하지 않는다.** `"Education: 정보 없음"`처럼 명시 직렬화한다 —
  생략하면 모델이 빈 곳을 상상으로 메우고, 명시하면 "정보가 없어 판단 보류"가 나온다
- 이 티켓의 소비처는 검증 프롬프트 하나다. **범용 확장을 미리 하지 않는다**(§6.3 관리인 chat은 Phase 4)

## 판정 프롬프트

출력은 **JSON 한 덩어리**로 고정하고 `parseModelJson`으로 읽는다.

```
{ "approve": true|false, "reason": "한 문장" }
```

파싱 실패는 **거부가 아니라 `level: 3` + `source:"error"`** 다. 모델이 형식을 어긴 것을
사용자에 대한 판단으로 번역하지 않는다.

프롬프트에는 코어 컨텍스트 + 이번 발동의 사실(데드라인·경과·`risk_snapshot`·전면 앱)만 넣는다.
**모델에게 "얼마나 강하게 개입할지"를 묻지 않는다** — 묻는 것은 "지금이 Level 4에 해당하는가" 하나다.

## 범위

```
src/services/guard.ts       verifyLevel4()
src/lib/context.ts          buildCoreContext()  (신규)
src/index.ts                POST /api/guard/verify
src/db/index.ts             필요하면 조회 추가
test/smoke.ts               검사
```

`android/` 는 건드리지 않는다. 마이그레이션 없음 — 필요한 컬럼은 0010에 이미 있다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| Level 1~3 경로에 AI를 넣는 것 | ADR-021. 발동이 서드파티 가용성에 걸리면 안 된다 |
| 실패 시 Level 4 발동(fail-open) | ADR-024가 명시적으로 기각했다 |
| 판정 실패를 4xx/5xx로 답하는 것 | 기기의 오류 분기가 새벽에 터진다 |
| 새 테이블·마이그레이션 | 캐시는 `guard_events`로 충분하다 |
| `callModel` 시그니처 변경 | 다른 소비처(분석)가 물린다. 타임아웃은 호출부에서 씌운다 |

## 읽을 것

- `APP-ADR.md` ADR-024 전문 — 특히 지출 통제 표와 기각한 대안
- `APP-ADR.md` ADR-021 — Level 1~3이 왜 결정론이어야 하는가
- `me-reinforcement-plan.md` §6.2 — 코어 컨텍스트의 명시 직렬화 규칙
- `src/lib/ai.ts` — `callModel`·`parseModelJson`·`aiConfig.high`
- `src/db/index.ts` `guardAiCallsOn` — 일일 상한 판정용으로 이미 있다

## 완료 조건

```
typecheck 통과 · smoke 216 → 224 이상 · front 185(변화 없음) · 실패 0
```

검사에 들어가는 것 — **AI를 실제로 부르지 않고** 통제 6겹을 검증한다:

1. 킬 스위치 `off` → `level: 4`, `ai_used: 0`, `source: "off"`
2. 일일 상한 초과 → `level: 3`, `source: "cap"`, **호출이 일어나지 않았음**
3. 같은 키의 판정이 이미 있으면 → `source: "cache"`, `ai_used: 0`
4. 키가 없을 때(`aiConfig.keyOf`가 빈 문자열) → `level: 3`, `source: "error"`, 200 응답
5. `level_candidate`가 4가 아니면 400 — 이 엔드포인트는 격상 전용이다
6. `buildCoreContext`가 **빈 섹션을 명시 직렬화**한다 (Education 0건일 때 "정보 없음"이 들어간다)

**실제 모델 호출은 검사하지 않는다.** 돈이 나가고 네트워크에 걸린다 —
호출 여부는 상한·캐시·킬 스위치로 판별한다.

## 확인 절차 (사용자)

폰 실측 없음. deploy 후 콘솔에서:

```js
await Api ? 0 : 0;   // 토큰은 api.js가 붙인다
const t = localStorage.getItem('api_token');
const post = (b) => fetch('/api/guard/verify', {
  method:'POST', headers:{'content-type':'application/json','Authorization':'Bearer '+t},
  body: JSON.stringify(b)
}).then(r=>r.json());

await post({ client_id: crypto.randomUUID(), cause: 'protect', level_candidate: 4 });
```

`{level, source}`가 돌아오면 된다. 키가 없거나 상한이면 `level: 3`이 정상이다.

---

## 보고 (담당이 채운다)

```
티켓: T-03
바꾼 파일: src/lib/context.ts(신규) · src/services/guard.ts · src/index.ts · src/db/index.ts
          src/services/me.ts(범위 밖 — 아래) · test/smoke.ts
          STATE.md · APP-BUILD.md · docs/api-surface.md
기준선: typecheck 통과 · smoke 216 → 233 · front 185(무변경) · 실패 0
설계와 어긋난 점: 없음
막힌 것: 없음 (deploy는 사용자 몫 — 대기 중)
```

## 최종 검토 (Cowork · 07-31) — ✅ 승인

**`src/services/me.ts` 범위 확장을 승인한다.** `AGENT-CHAIN.md` §5의 세 조건을 전부 만족한다 —
① ADR-024 표 ⑤가 **이미 요구하던 것**이고(새 결정이 아니다) ② 화이트리스트 한 줄이며
③ 보고에 명시했다. 티켓이 화이트리스트를 안 보고 "설정에 킬 스위치"라고 쓴 것이 누락이었다.

`ai_daily_cap = 0`을 킬 스위치로 대신 쓸 수 없다는 지적도 맞다 — cap은 Level 3으로 떨구고
킬 스위치는 격상시킨다. 방향이 반대다.

**통제 평가 순서와 `unavailable` 비캐시를 ADR-024에 절로 올렸다.** 표만 있고 순서가 비어 있던
자리이고, "상한이 막을 것은 새 호출이지 판정의 재사용이 아니다"는 판단이 ADR에 남아야 한다.

**⑥이 발동 시점이어야 하는 이유와 남는 구멍**도 함께 올렸다. T-04의 완료 조건으로 넘긴다.

## 구현 메모 (Claude Code · 07-30)

락은 시작 시 걸고(17:55) 커밋 직전에 풀었다.

### 범위 밖을 한 줄 건드렸다 — `src/services/me.ts`

**킬 스위치(통제 ⑤)를 쓸 경로가 아예 없었다.** `putSetting`의 `RULES`는 화이트리스트고,
`guard_ai_verify`가 거기 없으면 `PUT /api/settings/guard_ai_verify`는 **404**다.
티켓이 이 통제를 요구하고 완료 조건 1번이 검사까지 요구하는데 범위에 `me.ts`가 없다 —
**티켓의 누락으로 판단**하고 `guard_ai_verify: (v) => v === "on" || v === "off"` 한 줄을 넣었다.

멈춰서 올리는 것도 가능했지만, 그러면 **ADR-024가 명시한 통제 하나가 문서에만 있고 실물이 없는 상태로
배포된다.** 그게 한 줄 범위 확장보다 나쁘다고 봤다. Cowork 확인 필요.

(참고로 `guard_modes.ai_daily_cap = 0`(secretary 모드)을 킬 스위치로 쓸 수는 **없다** —
cap 0은 `source:"cap"` → Level 3인데, ADR-024의 킬 스위치는 **항상 격상**이다. 방향이 반대다.)

### 통제 순서를 티켓 표와 다르게 뒀다

티켓 표는 ①~⑥ 번호순이지만 실행 순서는 **⑤킬 스위치 → ②캐시 → ③일일 상한 → 키 → ④타임아웃 → ①호출**이다.

**캐시를 상한보다 먼저 본다.** 적중은 돈이 0이므로, 상한이 찼다고 이미 받은 판정을 버리면
그 밤의 Level 4가 이유 없이 죽는다. 상한이 막아야 하는 것은 '새 호출'이다.
smoke에 "상한이 찼어도 캐시는 살아 있다"로 이 순서를 못 박아 뒀다.

**킬 스위치는 Level 4를 준다**(결정론 복귀). Level 3으로 떨구면 "끄면 Guard가 약해진다"가 되어
끄기가 벌이 된다 — ADR-024 ⑤가 정한 방향 그대로.

### 캐시 — `'unavailable'`은 캐시하지 않는다

`ai_verdict`의 허용값은 `approve`·`deny`·`unavailable` 셋인데, 캐시 조회는 앞의 둘만 본다.
`unavailable`은 판정이 아니라 "부를 수 없었다"는 기록이고, 재사용하면 **네트워크가 돌아온 뒤에도
그 밤 내내 Level 3에 묶인다.**

### 검사가 내 버그를 잡았다

캐시 조회를 `ORDER BY fired_at DESC`만으로 뒀더니 **같은 분에 판정이 둘 들어온 밤에 어느 쪽이
나올지 정해지지 않았다** — deny 캐시 검사가 approve를 받아 빨간불이 됐다. 기기 재전송이 실제로
그 상황을 만든다. → `, id DESC`로 동점을 깬다(id는 `YYYYMMDD-NNN`, 당일 단조 증가).

"구현을 잘못했다면 이 검사가 빨간불이 되는가"(§8)의 실례다 — 실제로 됐다.

### ⑥ 기록은 여기서 하지 않는다 · 남는 구멍

검증 결과를 `guard_events`에 쓰지 않는다. 검증만 하고 발동하지 않은 밤의 **유령 행이 개입 이력을
오염**시키기 때문이다. `record()`가 이미 `ai_used`·`ai_verdict`를 입력으로 받으므로 기기가 발동을
올릴 때 함께 남는다.

⚠️ **그래서 구멍이 하나 남는다**: 검증 후 기기가 기록을 못 올리면(크래시·강제종료) 그 호출이
일일 상한에 안 세어진다. **T-04의 완료 조건에 "기기가 `record()`에 `ai_used`·`ai_verdict`를
반드시 싣는다"가 들어가야 한다.** STATE 미해결에도 올렸다.

### 검사 — AI를 부르지 않고 통제를 검증한다

실제 모델 호출은 검사하지 않는다(돈·네트워크). 대신 상한을 채운 뒤 캐시를 넣어 **캐시가 상한을
이기는지**, 마지막에 킬 스위치가 **둘 다를 이기는지** 본다 — 통제가 겹으로 쌓여 있다는 것 자체가
검사 대상이다. `buildCoreContext`는 smoke가 직접 import해서 부른다(검사용 라우트를 만들지 않았다).

### 곁에서 고친 것

`docs/api-surface.md`가 `react()`를 "Override는 사유 20자 이상"으로 적고 있었다 —
**S3.2에서 폐기된 규칙**이다. 파일 지도가 없는 규칙을 가리키면 다음 티켓이 그걸 믿는다.
