# T-10 — 모드 하향에 마찰을 붙인다 (ADR-019 부수 규칙 1·2)

**발행** Cowork · 2026-08-05 · **담당** Claude Code (**위임 금지**) · **상태** ✅ 닫힘 (검토 합격 2026-08-05)

---

## 무엇이 빠져 있나

`src/services/guard.ts`의 `setMode`가 지금 하는 일 전부:

```ts
존재하는 키인가 → batch로 교체 → { active: key }
```

**ADR-019 부수 규칙 1도 2도 구현되어 있지 않다.** 마찰이 하나도 없다.

그래서 지금은 **새벽 01:30에 coach → secretary로 내리면 Guard가 통째로 조용해진다.**
ADR-019가 *"모드 전환은 Override의 완벽한 우회로다"*라고 쓴 그 구멍이 열려 있다.

## 판정 기준은 ADR-027이 준다

**티켓이 정의를 만들지 않는다.** `APP-ADR.md` ADR-027을 읽고 그대로 구현한다.
요약만 옮기면:

```
max_level        낮아지면      약함
risk_threshold   높아지면      약함    ← 방향이 반대다
friction_mult    낮아지면      약함
use_fsi          1 → 0         약함
use_overlay      1 → 0         약함
ai_daily_cap     제외 — 지출 통제다 (ADR-024)
sort             제외 — 표시 순서다
```

**다섯 중 하나라도 약해지면 하향.**

## 위임 금지인 이유

트리거·마이그레이션·**Guard 발동 경로의 전제 조건**에 해당한다.
하향 판정이 틀리면 Guard 전체가 조용히 무력해지고, **그 실패는 아무 오류도 내지 않는다** —
알림이 안 오는 것으로만 드러나고, 그때는 이미 그 밤이 지났다.

## 마이그레이션 — `0015`

```sql
ALTER TABLE me_history ADD COLUMN reason TEXT;
```

사유를 적을 자리가 없다. `me_history`는 주석이 이미 "변경 궤적을 분석 입력으로 쓴다(§3)"고 말한다 —
모드 변경도 설정 변경이므로 여기 들어간다. **새 테이블을 만들지 않는다**(ADR-027 §구현 명세).

- **`test/smoke.ts`의 스키마 목록(하드코딩)에 파일명을 넣는다.** `e2e.mjs`는 디렉터리 전체라 자동
- `--local` → `--remote` 순서. **배포는 사용자가 한다**

## 구현

```
setMode(env, t, key, reason?)
  ① 존재 확인                                    (지금 있는 것)
  ② 하향인가 — 다섯 파라미터 비교
  ③ 하향 + 보호 구간 중        → 409  "보호 중에는 내릴 수 없어요"
  ④ 하향 + 사유 없음/공백      → 400  "왜 내리는지 적어주세요"
  ⑤ 교체 + me_history 기록 (field="guard_mode", reason)
  상향·동일은 ②에서 갈려 나간다 — 지금과 똑같이 동작한다
```

`PUT /api/guard/modes/active`의 본문에 `reason`이 붙는다. **상향에는 필요 없다.**

### 보호 구간 판정을 새로 짜지 않는다

`schedule(env, t)`가 이미 각 보호 일정의 `from`(보호 진입)과 `start`(일정 시각)를 계산한다.
그 구간에 `now`가 들어 있으면 보호 중이다.

**데드라인 역산식을 두 벌 두지 않는다** — T-16에서 귀속일을 `attributionOfIso` 하나에 맡긴 것과 같다.
`schedule`이 무거우면 그 안의 구간 계산을 **꺼내서 공유**하되, 식은 하나로 남는다.

## 범위

```
migrations/0015_me_history_reason.sql   (신규)
src/services/guard.ts                   setMode 개정 · 하향 판정
src/db/index.ts                          me_history INSERT에 reason
src/index.ts                             본문에 reason
test/smoke.ts                            스키마 목록 + 판정 검사
docs/schema-current.sql                  재덤프
```

**프런트를 건드리지 않는다.** 화면은 T-08′이 따로 받는다 —
서버 계약이 먼저 서야 프런트가 무엇을 보여줄지 정해진다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 하향 정의를 티켓·코드에서 새로 만들기 | ADR-027이 정한다. 어긋나면 **ADR을 고치자고 올린다** |
| `sort`나 `max_level` 하나로 판정 | ADR-027이 둘 다 기각했다. `friction_mult` 우회로가 남는다 |
| `ai_daily_cap`을 강도로 세기 | 지출 통제다(ADR-024). 예산 절감이 마찰을 부른다 |
| 보호 구간 판정식을 새로 작성 | `schedule`과 갈라진다. 어느 쪽이 옳은지 알 수 없게 된다 |
| 상향에 사유·대기 요구 | 부수 규칙 1이 "상향은 자유"라고 명시 |
| 서버에서 60초 대기 강제 | ADR-027 결정 ③. 대기는 클라이언트, 사유는 서버 |
| 새 테이블 신설 | 자기 보정이 읽을 곳이 둘로 갈린다 |
| `wrangler deploy` 실행 | 사용자가 한다 |

## 읽을 것

- **`APP-ADR.md` ADR-027 전문** — 판정 기준·근거·기각한 대안
- `APP-ADR.md` ADR-019 §결정 부수 규칙 1·2·3과 §감수하는 비용
- `src/services/guard.ts` `setMode`(39~45) · `schedule`(54~) — `from`과 `start`
- `src/db/index.ts` 463~481 — `me_history` 스키마와 주석
- `CLAUDE.md` §마이그레이션·배포 · 아키텍처 원칙

**ADR-019 §감수하는 비용을 반드시 읽는다.** T-08이 물린 자리다 —
당시 티켓이 "확인만 붙이고 막지 않는다"라고 써서 부수 규칙 1·2를 정면으로 어겼다.
**티켓이 ADR과 어긋나면 티켓이 틀린 것이다.**

## 완료 조건

```
typecheck 통과 · smoke 244 → 250 이상 · front 223(변화 없음) · 실패 0
```

검사에 들어가는 것:

1. 보호 구간 중 하향 → **409**
2. 보호 구간 밖 하향 + 사유 없음 → **400**
3. 보호 구간 밖 하향 + 사유 → 성공하고 `me_history`에 사유가 남는다
4. 상향은 사유 없이 성공한다 (보호 구간 중에도)
5. **`risk_threshold`만 높은 모드로 바꾸면 하향으로 잡힌다**
6. `ai_daily_cap`만 낮은 모드로 바꾸면 **하향이 아니다**

**5번이 이 티켓의 덫이다.** 다섯 파라미터를 전부 "낮아지면 약함"으로 짜면
1·2·3·4·6은 통과하고 5만 빨간불이 된다. `risk_threshold`는 **문턱**이라 방향이 반대다.

검사용 모드 행이 필요하면 만들되, **`coach`·`secretary` 두 행을 고치지 않는다** — 실사용 중이다.

## 확인 절차 (사용자)

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

```
□ Me에서 모드를 올리는 것은 그대로 된다
□ 보호 일정이 없는 시간에 내리면 사유를 묻는다
□ 보호 구간 중(시험 전날 밤 등)에 내리면 거부된다
```

세 번째는 **보호 일정이 실제로 잡혀 있어야** 확인된다. 없으면 시험 일정을 하나 만들어 본다.

---

## 보고 (담당이 채운다)

```
티켓: T-10
바꾼 파일:
  migrations/0015_me_history_reason.sql   (신규)  me_history에 reason TEXT
  src/services/guard.ts                   STRENGTH_DIR · isDowngrade · protectingNow · setMode 개정
  src/db/index.ts                         stMeHistory에 reason (선택 인자 — 기존 호출부 무변경)
  src/index.ts                            PUT /api/guard/modes/active 본문에 reason · t 전달
  test/smoke.ts                           스키마 목록에 0015 · (3b) 판정 검사 16건 · (3) 기존 1줄 수정
  docs/schema-current.sql                 재덤프 (migrations 15개 → sqlite_master)
  docs/api-surface.md                     setMode 시그니처·하향 규칙·stMeHistory 인자
  STATE.md                                T-10 절 · 기준선 · 마이그레이션 · 다음 번호
기준선: typecheck 통과 · smoke 244 → 260 · front 223 → 223(무변경) · 실패 0 · verify exit 0
마이그레이션: 0015 · --local 적용 완료(2026-08-05) · smoke 스키마 목록 반영 완료
             --remote·deploy는 사용자 몫으로 남겼다 (STATE §마이그레이션에 대기로 기록)
설계와 어긋난 점: 없다. 판정 기준은 ADR-027을 그대로 옮겼고 새로 만들지 않았다.
  다만 ADR이 한쪽으로 못 박지 않은 지점이 하나 있어 **판단한 근거를 남긴다** —
  **상향에도 me_history를 남길 것인가.** ADR-027 ⑤가 "교체 + me_history 기록"을 한 단계로 묶었고
  교체는 상향에서도 일어나므로, ⑤ 전체가 상향에서 건너뛰어질 수는 없다고 읽었다.
  ②에서 갈려 나가는 것은 ③④(보호 구간·사유)이지 기록이 아니다. 그래서 **방향과 무관하게 기록하고
  사유는 하향에만 붙인다.** 하향만 남기면 "내렸다 올렸다"의 앞뒤가 안 보여 §6.5의 입력으로 약해진다.
  (티켓 §구현의 "상향·동일은 지금과 똑같이 동작한다"를 '기록도 없다'로 읽으면 이와 갈린다.
   Cowork가 후자를 의도했다면 한 줄이면 되돌아간다 — `setMode`의 batch에서 `stMeHistory`를 뺀다.)
막힌 것: 없다.
```

### 덫(검사 5번)을 변이로 확인했다

"구현을 잘못했다면 이 검사가 빨간불이 되는가"를 **실제로 돌려서** 봤다.

| 변이 | 결과 |
|---|---|
| `risk_threshold`의 방향을 `+1`로 (= 다섯을 전부 "낮아지면 약함") | **5번 빨간불** · 260 → 통과 250 / 실패 10 |
| `ai_daily_cap: 1`을 판정에 추가 (= 지출을 강도로 셈) | **6번만 빨간불** · 260 → 통과 259 / 실패 1 |

`sort`는 별도 변이를 돌리지 않았다 — 검사용 모드 행의 `sort`가 `coach`보다 크므로
`sort`를 판정에 넣으면 "문턱을 되내리는 것은 상향" 줄이 즉시 빨간불이 된다.

첫 변이에서 **실패가 이 블록 밖으로 번졌다**(활성 모드가 엉뚱한 곳에 멈춘 채 다음 블록으로 넘어가
무관한 `ai_daily_cap` 검사 5건이 함께 빨간불). 정리를 **검사 결과와 무관하게** 되돌리도록 고쳐
실패를 블록 안에 가뒀다 — 원인이 흐려지면 다음 회귀 때 진단이 두 배로 든다.

### 옛 동작을 검사하던 줄

기존 `(3) 모드` 블록의 `PUT {key:"secretary"}`는 **이제 하향이라 400**이다.
그 자리는 'Level 2 상한'을 보는 곳이므로 사유를 실어 통과시켰고, 마찰 자체는 새 `(3b)`가 본다.
검사를 고쳤다는 사실을 여기 적는다(§기준선 보고 규칙).

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
검사 5번이 "전부 낮아지면 약함" 구현에서 빨간불이 되는가:
  ✅ 검토 세션이 직접 재현했다(보고 수치를 믿지 않고 변이를 다시 넣어 돌렸다).
     `STRENGTH_DIR.risk_threshold`를 -1 → +1로 바꾸니 260 → 통과 250 / 실패 10이고,
     **첫 실패가 5번**("risk_threshold만 높은 모드로 바꾸면 하향 — 사유 없으면 400")이다.
     실패 10건은 전부 (3b) 블록 안이고 뒤 블록으로 번지지 않았다 — 정리를 검사 결과와
     무관하게 되돌리도록 짜 둔 것이 실제로 일했다.

판정이 ADR-027의 다섯 파라미터와 정확히 일치하는가 (ai_daily_cap·sort 제외):
  ✅ `STRENGTH_DIR`이 `max_level·risk_threshold·friction_mult·use_fsi·use_overlay` 다섯뿐이고
     `risk_threshold`만 -1이다(guard.ts:51~57). `ai_daily_cap`·`sort`는 키 자체가 없다.
     비교는 `(to - from) * dir < 0` 하나로 다섯에 균일하게 적용된다 — 컬럼별 분기가 없어
     한 컬럼만 규칙이 갈라질 자리가 없다.
     제외가 형식이 아닌 것도 확인했다: `ai_daily_cap: 1`을 넣는 변이는 **6번만** 빨간불(259/1).
     `sort`는 검사용 행의 값이 coach보다 커서, 판정에 들어가는 순간
     "문턱을 되내리는 것은 상향" 줄이 즉시 빨간불이 된다 — 별도 변이가 필요 없다.

보호 구간 판정식이 schedule 과 한 벌인가:
  ✅ `protectingNow`(guard.ts:74~79)는 `schedule(env, t)`를 부르고 그 결과의
     `protect_from`·`start`만 읽는다. 자기 산술이 한 줄도 없다.
     리포 전수 확인: `start − (prep + sleep)`도 `parseRelative`도 `DEFAULT_SLEEP_MIN`·
     `DEFAULT_PREP_MIN`도 **`schedule()` 안(guard.ts:131·132·138·141)에만** 있다.
     `events.ts`는 값을 검증·저장만 하고 역산하지 않는다.
     ⚠️ 프런트 미리보기 `protectionDeadline`(public/app.js:694)이 같은 식을 갖고 있으나
     **T-05가 남긴 기존 사본**이고 T-10이 늘린 것이 아니다(이 티켓은 프런트 무변경).
     서버 간격은 `smoke.ts`가 450분으로 못 박고 있어 갈라지면 빨간불이 된다.

상향에 마찰이 붙지 않았는가:
  ✅ 409·400은 `if (down)` 블록 안에만 있다(guard.ts:98~104). 그 밖에 서버 대기(sleep·지연)는
     어디에도 없다 — ADR-027 ③대로 대기는 클라이언트 몫이다.
     라우터도 `reason`을 그대로 넘길 뿐 상향을 따로 막지 않는다(index.ts:274~277).
     검사로도 확인된다: "보호 구간 중 상향은 사유 없이 200" · "문턱을 되내리는 것은 상향 —
     사유 없이 통과" 둘 다 통과하고, 변이를 넣으면 이 둘이 먼저 무너진다(빈 검사가 아니다).

0015 가 smoke 스키마 목록에 들어갔는가:
  ✅ `test/smoke.ts:18` 하드코딩 배열 끝에 `"0015_me_history_reason.sql"`이 있다.
     `docs/schema-current.sql`도 손질이 아니라 진짜 재덤프다 — migrations 15개를 인메모리
     sqlite에 다시 적용해 독립 생성한 결과가 리포 파일과 **바이트 동일**했다(`me_history`에
     `, reason TEXT)`가 ALTER 자리 그대로 붙어 있다).

설계 위반 · 함정 재발:
  없다.
  - ⑤ 무방향 기록은 Cowork 승인 + ADR-027 §구현 명세 개정("⑤는 방향과 무관하게 실행된다")과
    일치한다. 구현은 `reason`만 하향에 붙이고 기록 자체는 방향과 무관하다 — 개정문 그대로다.
  - 파생 저장 없음(원칙 4): 하향 여부·보호 구간 모두 조회 시 계산이고 컬럼이 늘지 않았다.
  - 0015는 `ALTER ... ADD COLUMN` 한 문장이고 `me_history`엔 트리거가 없다 —
    0013의 "로컬 통과, 원격 실패"(트리거 발화가 데이터 유무에 갈리는) 경로가 아니다.
  - 함정 재발 없음: `public/` 자산만 유지 · 색·프런트 무변경 · 새 테이블 없음.
  - 사소한 문서 어긋남 하나(구현 결함 아님): ADR-027 의사코드는 `setMode(env, key, reason?)`인데
    실제 시그니처는 `setMode(env, t, key, reason?)`다. 보호 구간 판정에 `t`가 필요해서이고
    `t`는 이 리포의 공통 인자다(api-surface 머리말). **ADR 쪽 표기 문제라 여기서 고치지 않는다.**

판정:
  ✅ 합격. typecheck 통과 · smoke 244 → 260 · front 223(무변경) · 실패 0 · verify exit 0.
     완료 조건 여섯 항목이 모두 검사로 덮이고, 그중 5·6번은 변이로 "구현을 잘못했다면
     빨간불이 되는가"까지 확인했다. 마이그레이션 0015는 --local 적용 완료 · --remote·deploy 대기.
```
