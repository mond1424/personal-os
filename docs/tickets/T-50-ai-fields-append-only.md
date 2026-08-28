# T-50 — AI 판정도 한 번만 채워진다

**발행** Cowork · 2026-08-28 · **담당** Claude Code · **작음**
**근거** 설계 §1.3 불변성 · 아키텍처 원칙 2 · **마이그레이션 하나 · 서버 무변경 · APK 무관**

---

## 무엇이 어긋났나

`trg_guard_event_immutable`이 스스로 원칙을 적어 놓았다:

> 발동 시점에 행을 만들고 반응·분류·결과는 나중에 온다. 그래서 통짜 금지가 아니라
> **NULL → 값은 되고, 값 → 다른 값은 안 된다**는 append-only 의미로 건다.

**그 보호를 받는 사후 필드가 넷이다:**

```
reaction · override_reason · override_class · outcome     ✅ (OLD IS NOT NULL AND 바뀌면) 차단
ai_used · ai_verdict · ai_reason                          ❌ WHEN 절에 아예 없다
```

**`ai_*`는 아무 값으로나, 몇 번이고 덮어쓸 수 있다.** `0010`이 만든 트리거에 `ai_used`·`ai_verdict`가
빠져 있었고, `0017`이 `ai_reason`을 추가할 때도 트리거를 안 고쳤다.

⚠️ **T-40이 고친 것은 기기 쪽 경쟁(`flush` lost-update)이지 DB 강제가 아니다.**
이 리포의 원칙은 *"불변성은 API가 아니라 DB 트리거가 최종 강제"*이고,
**그 마지막 방벽이 AI 판정에는 없다.**

## ★ `level`은 구멍이 아니다 — 건드리지 마라

`OR OLD.level != NEW.level`이 무조건 차단인 것을 격상(ADR-024)과 충돌로 읽기 쉽다. **아니다.**

```
POST /api/guard/verify  →  { level: 3|4, approved, … }   ← 판정만 돌려준다
기기가 그 level 로 발동한다                                ← 행은 이 뒤에 생긴다
```

**격상은 행이 생기기 전에 끝난다.** 발동 시점의 `level`은 사실이고 바뀔 경로가 없다.
⚠️ **이 줄을 완화하면 보호가 약해지기만 한다.**

## 할 일 — 마이그레이션 하나

`DROP TRIGGER` → `CREATE TRIGGER`로 **`ai_*` 셋을 다른 사후 필드와 같은 모양으로** 넣는다.

```sql
OR (OLD.ai_used    IS NOT NULL AND IFNULL(NEW.ai_used,-1)   != OLD.ai_used)
OR (OLD.ai_verdict IS NOT NULL AND IFNULL(NEW.ai_verdict,'') != OLD.ai_verdict)
OR (OLD.ai_reason  IS NOT NULL AND IFNULL(NEW.ai_reason,'')  != OLD.ai_reason)
```

⚠️ **센티넬은 컬럼 타입에 맞춘다** — `ai_used`가 INTEGER면 `-1`, TEXT면 `''`.
**기존 줄들이 이미 타입별로 다르게 쓰고 있으니 그것을 그대로 따른다**(`risk_score`는 `-1`, 나머지는 `''`).

⚠️ **`0010`의 SQL을 고치지 않는다.** 적용된 마이그레이션은 한 글자도 안 건드린다 — **새 파일**이다.

⚠️ **`test/smoke.ts`의 스키마 목록(하드코딩)에 새 파일명을 넣는다**(CLAUDE.md §마이그레이션).

## 범위

```
migrations/00NN_guard_ai_immutable.sql   (신규)
test/smoke.ts                            스키마 목록 + 검사
docs/schema-current.sql                  재덤프 (세션 종료 규칙)
```

**서버 코드 무변경 · 프런트 무변경 · APK 무관.**

⚠️ **`amendFire`가 지금 하는 일이 막히면 안 된다** — 그것은 `NULL → 값`이라 새 트리거에 안 걸린다.
**걸린다면 그쪽이 원칙을 어기고 있었다는 뜻이고, 그때는 멈추고 보고하라.**

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `OLD.level != NEW.level` 완화 | **구멍이 아니다.** 격상은 행이 생기기 전에 끝난다 |
| `0010`의 SQL 수정 | 적용된 마이그레이션은 불변. 새 파일이다 |
| `translateDbError` 손대기 | 이미 트리거 거부를 409로 번역한다 |
| 서버 코드로 막기 | **DB 가 최종 강제다**(원칙 2). API 검증을 늘리는 게 아니다 |
| 기존 `ai_*` 값 정리 | 기록은 사실의 기록이다 |

## 완료 조건

```
typecheck 통과 · smoke 370 → 375 이상 · front 357(변화 없음) · 실패 0 · verify exit 0
```

**검사**

```
1  ai_verdict 가 NULL 일 때 값을 채울 수 있다              ← amendFire 가 하는 일
2  ★ 채운 뒤 다른 값으로 바꾸면 거부된다 (409)              ← 1의 짝. 이 티켓의 핵심
3  ★ 같은 값으로 다시 쓰는 것은 통과한다                    ← 재시도가 막히면 안 된다
4  ai_used · ai_reason 도 같다 (셋 다)                     ← 하나만 고치지 않았나
5  ★ reaction · outcome 의 기존 보호가 그대로다             ← 트리거를 다시 쓰면서 잃지 않았나
6  ★ level 은 여전히 무조건 차단이다                        ← 완화하지 않았나
```

**2와 3이 짝이다.** 2만 보면 *"값이 있으면 무조건 거부하는 구현"*이 통과하고,
그러면 **오프라인 재전송이 막힌다**(ADR-023에서 기기가 같은 것을 다시 올릴 수 있다).

**5와 6이 이 티켓의 회귀 검사다.** `DROP`/`CREATE`로 트리거를 통째로 다시 쓰므로
**한 줄을 빠뜨리면 조용히 보호가 사라진다** — 그게 이 작업의 유일한 위험이다.

**변이**
- `ai_verdict` 줄만 넣고 `ai_used`·`ai_reason` 을 뺀다 → **4만** 죽는다
- `IS NOT NULL` 을 빼고 무조건 비교한다 → **1·3** 죽는다 (첫 기입과 재시도가 막힌다)
- `reaction` 줄을 빠뜨린다 → **5만** 죽는다
- `level` 줄을 빠뜨린다 → **6만** 죽는다

## 확인 절차 (사용자)

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

**화면에서 보이는 변화는 없다.** 이 티켓은 **다음에 무언가 잘못될 때 그것이 조용하지 않게** 만든다.

---

## 보고 (담당이 채운다)

```
티켓: T-50 · 2026-08-28 · Claude Code
바꾼 파일: migrations/0019_guard_ai_immutable.sql (신규) · test/smoke.ts · docs/schema-current.sql
기준선: typecheck 통과 · smoke 370 → 377 · front 357(변화 없음) · 실패 0 · verify exit 0
마이그레이션 파일명: 0019_guard_ai_immutable.sql — smoke.ts 의 스키마 목록에 넣었다
```

### ⚠️ 구멍이 셋이 아니라 넷이었다

`ai_unavailable_reason`(0016)도 같은 자리에 있었다. **`amendFire`가 같은 호출에서 쓰는 사후
필드**이고 트리거 밖인 것도 똑같다 — 0016이 컬럼을 더하면서 트리거를 안 고쳤고, 0017도 안 고쳤다.

**smoke.ts 자신이 그것을 적어 두고 있었다**(T-39 절):

> ⚠️ 여기가 **유일한 방어선**이다: `trg_guard_event_immutable`은 ai_* **넷**을 아예 안 본다.

셋만 고치면 그 주석이 반만 참이 되고, 넷째는 다음 티켓까지 남는다. **넷 다 넣었다.**
검사도 ④(셋)와 ④'(넷째)로 나눠 뒀다 — 티켓의 변이표가 셋 기준이라 매핑을 안 흐리려고.

### 센티넬을 컬럼 타입에 어떻게 맞췄나 — ★ `ai_used`만 모양이 다르다

```
ai_verdict · ai_unavailable_reason · ai_reason   TEXT NULL
  → 이웃과 같은 모양. OLD IS NOT NULL 이면 못 바꾼다 · NEW 는 IFNULL(...,'') 로 '지우기'도 잡는다

ai_used                                          INTEGER NOT NULL DEFAULT 0
  → OLD.ai_used != 0 AND NEW.ai_used != OLD.ai_used
```

**티켓이 준 예시 SQL(`OLD.ai_used IS NOT NULL AND …`)은 이 컬럼에 못 쓴다.**
NOT NULL이라 그 조건이 **항상 참**이고, 그러면 첫 기입(`0 → 1`)까지 막힌다.
이 컬럼은 "아직 안 채워짐"이 NULL이 아니라 **0**이다.

⚠️ **티켓이 "걸리면 멈추고 보고하라"고 한 그 경우는 아니다.** `amendFire`가 원칙을 어기는 게
아니라, **NOT NULL DEFAULT 0이 "NULL → 값"을 표현할 수 없을 뿐**이다. 티켓 자신이 바로
다음 줄에서 *"센티넬은 컬럼 타입에 맞춘다"*고 했으므로 그대로 맞췄다.

**그리고 실측이 그 판단을 뒷받침한다** — 변이 B(가드를 빼고 무조건 비교)가 **다섯을 죽였다**.
검사 하나가 아니라 T-39가 되찾은 경로까지 통째로 죽는다.

### amendFire 가 여전히 도는가 — 검사 ①이 그 경로다

**돈다.** ①은 `POST /api/guard/events`(중복 client_id) → `stAmendGuardAi`를 실제로 태우고,
그 UPDATE가 `ai_used 0 → 1`을 포함한다. 트리거가 그걸 막으면 여기서 죽는다.

그리고 **`stAmendGuardAi`는 원래부터 append-only였다**:

```sql
ai_used = MAX(ai_used, ?)   ·   나머지 셋 = COALESCE(기존, ?)
```

그래서 새 트리거에 절대 안 걸린다 — 서버는 값을 바꾸는 UPDATE를 아예 만들지 않는다.
**이 티켓이 채운 것은 "서버가 안 그런다"가 아니라 "DB가 못 하게 한다"의 차이다**(원칙 2).

⚠️ **그 차이 때문에 검사를 서버 경로로 짤 수 없었다.** T-39 절의 기존 검사들은 API를 거치므로
`MAX`·`COALESCE`가 먼저 일하고 **트리거는 한 번도 안 불린다** — 즉 **트리거가 통째로 없어도
그 검사들은 전부 초록이다.** 그래서 T-50 절은 `raw.prepare`로 **UPDATE를 DB에 직접 쏜다.**

### 5·6 이 실제로 옛 보호를 지키는가 · 변이로 확인했는가

**지킨다. 변이 D(`reaction` 줄 삭제) → ⑤만, 변이 E(`level` 줄 삭제) → ⑥만 죽었다.**

⚠️ **처음엔 ⑤·⑥이 거짓 초록이 될 자리에 있었다.** 둘을 ai_* 가 채워진 같은 행에서 쟀는데,
ai 규칙이 망가지면 **그 행에 대한 모든 UPDATE가 막혀서** ⑤·⑥이 *"reaction 보호가 살아서"*가
아니라 *"ai 규칙이 다 막아서"* 통과한다. **옛 보호를 재는 검사는 옛 필드만 있는 행에서 재야 한다** —
`t50-legacy` 행을 따로 만들어 옮겼다. 채우는 것 자체가 통과하는지도 함께 센다(`t50Filled`).

### 변이 — 여섯 (티켓의 넷 + 둘)

**기준선 377.** 티켓의 변이표에는 ②와 ③을 죽이는 변이가 없어서 둘을 더 만들었다.

| 변이 | 통과 | 죽은 검사 |
|---|---|---|
| A `ai_verdict`만 남기고 `ai_used`·`ai_reason`을 뺀다 | 376 | ④ |
| B `ai_used`의 `!= 0` 가드를 빼고 무조건 비교 | **372** | ①②③④ + T-39 본체 |
| C 값이 있으면 무조건 거부(값 비교 제거) | 375 | ③ · ④' |
| D `reaction` 줄을 빠뜨린다 | 376 | ⑤ |
| E `level` 줄을 빠뜨린다 | 376 | ⑥ |
| F `ai_verdict` 줄을 빠뜨린다 | 376 | ② |

- **B가 다섯을 죽인 것이 이 티켓의 가장 중요한 실측이다.** 티켓이 준 SQL의 모양이고,
  그대로 썼으면 배포한 뒤 *"판정이 뒤늦게 오는 밤에만"* 조용히 깨졌을 것이다.
- **C가 ③·④'를 함께 죽인 것은 교차오염이 아니다** — 둘 다 *"같은 값 재기입이 통과하는가"*를
  재는 검사이고, C는 정확히 그 성질을 깬다. 같은 결함을 두 컬럼에서 잡은 것이다.
- ⚠️ **C가 처음엔 smoke를 통째로 죽였다** — ⑤의 준비용 UPDATE가 `try` 밖이라 던졌고
  요약 줄까지 잃었다. **"검사 하나가 죽는다"와 "검사가 안 돈다"는 다르다**(T-49 ③과 같은 자리).
  준비용 UPDATE도 전부 `t50Blocked`로 감쌌다.

### 범위 밖 — 안 고치고 올린다

**같은 모양의 사후 필드가 더 있다.** 트리거의 WHEN 절에 없는 컬럼:

```
reacted_at · outcome_at        반응·결과의 시각. reaction·outcome 은 보호되는데 그 짝은 아니다
foreground_app                 발동 시점의 사실인데 사후 필드처럼 덮인다
task_id · period_id · event_id 발동이 무엇에 붙었는가
```

**이 티켓의 범위가 아니고, 지금 이것을 덮는 코드 경로도 없다.** 다만 `reaction`은 막고
`reacted_at`은 안 막는 것은 같은 종류의 빠짐이다 — **판단은 위층 몫이라 고치지 않고 적는다.**

### 확인 절차 — 사용자

마이그레이션이 있으므로 `--local` → `--remote` 순서다(§확인 절차 그대로).
**서버 코드는 안 바뀌었지만 `deploy`는 해도 무해하다** — 이 티켓이 배포에 얹는 것은 없다.
