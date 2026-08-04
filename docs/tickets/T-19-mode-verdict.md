# T-19 — 서버가 판정을 응답에 싣는다 (T-08′ 차단 해소)

**발행** Cowork · 2026-08-05 · **담당** Codex CLI (조건부 · 아래 §위임) · **상태** ⬜ 대기 · **선행**

---

## 왜 — T-08′이 여기서 막혔다

```
화면은 PUT 전에 하향인지 알아야 대기를 걸지 말지 정한다
서버의 하향 판정은 PUT 뒤에만 나온다
프런트가 다시 계산하는 것은 ADR-027 위반
```

**셋이 동시에 성립하지 않는다.** T-08′ 티켓이 "서버를 건드리지 않는다"고 쓴 것이 틀렸다 —
없는 계약을 쓰라고 요구했다. Codex가 구현 전에 멈추고 올린 것이 옳다.

보호 구간도 같다. `GET /api/guard/schedule`을 프런트가 받아 "지금 보호 중인가"를 스스로 가르면
**`protectingNow`를 프런트에 다시 구현하는 것**이 된다.

## 방향 — T-16과 같은 패턴

`same_day`를 `memos` 응답에 얹은 것과 정확히 같다.
**저장하지 않는다 · 조회 시 계산한다 · 프런트는 결과만 읽는다.**

```
GET /api/guard/modes
{
  modes:  [ { ...guard_modes 행, downgrade: boolean } ],
  active: { ...행 },
  protecting: { title, start, until } | null
}
```

- `downgrade` — **활성 모드 대비** 그 모드로 가는 것이 하향인가. 활성 모드 자신은 `false`
- `protecting` — 지금 보호 구간이면 그 일정. 아니면 `null`.
  `until`은 **언제 풀리는가**다 — 화면이 "△△ 이후에 다시" 라고 말할 수 있어야 한다

## 새 판정을 만들지 않는다

`isDowngrade`와 `protectingNow`가 **T-10에서 이미 만들어졌다.** 그 둘을 부른다.

**두 벌이 되면 갈라진다.** 특히 `risk_threshold`의 방향(문턱이라 높아지면 약함)은
따로 짜면 다시 틀릴 자리다 — T-10의 변이 검사가 그것을 잡았다.

## 응답은 힌트다 — 강제는 여전히 PUT이 한다

**이 티켓의 덫이 여기 있다.**

응답에 `downgrade`가 실리면 "이미 계산했는데 PUT에서 왜 또 하나"가 자연스러워 보인다.
**PUT의 판정을 없애거나, 요청 본문의 값을 믿으면 안 된다.**

```
응답에 싣는다      서버 → 화면.  화면이 대기를 걸지 결정하는 재료
요청에서 받는다    ✗ 금지.  클라이언트가 "이건 상향이야"라고 말하면 마찰이 사라진다
```

화면이 틀려도 서버가 막아야 한다. **같은 함수를 두 번 부르는 것이지 판정을 옮기는 것이 아니다.**

## 위임 — 조건부

`src/services/guard.ts`에 손이 필요하므로 위임 금지에 가깝다.
**T-15·T-16과 같은 조건으로 연다** — 판정 기준이 이미 코드에 있고 한 줄로 확인된다.

1. **새 판정을 만들지 않는다.** `isDowngrade`·`protectingNow`를 그대로 부른다
2. **파생값을 저장하지 않는다.** `guard_modes`에 컬럼을 추가하지 않는다
3. **PUT의 강제를 약화시키지 않는다.** 요청 본문의 판정을 받지 않는다
4. 검토 세션이 위 셋을 확인한다

## 범위

```
src/services/guard.ts   modes() 에 downgrade · protecting
test/smoke.ts           판정 검사
```

**마이그레이션 없다. 프런트를 건드리지 않는다** — 화면은 T-08′이 받는다.
`setMode`를 고치지 않는다. 이미 옳다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `isDowngrade`·`protectingNow`를 다시 작성 | 두 벌이 되면 갈라진다. `risk_threshold` 방향을 또 틀린다 |
| `guard_modes`에 컬럼 추가 | 원칙 1. 파생은 조회 시 계산 |
| `setMode`에서 판정 제거·간소화 | 강제가 사라진다. **응답은 힌트다** |
| 요청 본문의 `downgrade`를 신뢰 | 클라이언트가 마찰을 끌 수 있게 된다 |
| `protecting` 계산을 `schedule` 밖에서 | T-10이 한 벌로 묶은 것을 푼다 |
| 프런트 수정 | T-08′의 범위다 |

## 읽을 것

- `src/services/guard.ts` — `STRENGTH_DIR`·`isDowngrade`·`protectingNow`·`modes`·`setMode`
- `APP-ADR.md` ADR-027 — 판정 기준과 결정 ③
- `docs/tickets/T-10-mode-downgrade.md` §검토 — 두 함수가 어떻게 확인됐나
- `docs/tickets/T-16-memo-origin.md` — `same_day`를 응답에 얹은 같은 패턴

## 완료 조건

```
typecheck 통과 · smoke 260 → 267 이상 · front 223(변화 없음) · 실패 0
```

검사:

1. `GET /api/guard/modes`의 각 모드에 `downgrade`가 실린다
2. 활성 모드 자신은 `downgrade: false`
3. **`risk_threshold`만 높은 모드가 `downgrade: true`** — 같은 함수를 쓴다는 증거
4. 보호 구간 중이면 `protecting`에 일정 이름과 `until`이 있다
5. 보호 구간 밖이면 `protecting: null`
6. **요청 본문에 `downgrade: false`를 실어도 하향이 막힌다** (409 또는 400)
7. `guard_modes`에 컬럼이 늘지 않았다

**6번이 이 티켓의 덫이다.** 응답과 요청을 혼동한 구현에서 1~5·7은 전부 통과하고,
**마찰은 클라이언트 한 줄로 꺼진다.**

3번은 `isDowngrade` 재사용의 증거다 — 따로 짜면 문턱 방향에서 어긋난다.

## 확인 절차 (사용자)

deploy 후. **화면은 아직 안 바뀐다** — T-08′이 붙어야 보인다.

```
□ 없음. 서버 계약만이다
```

---

## 보고 (담당이 채운다)

```
티켓: T-19
바꾼 파일: src/services/guard.ts, test/smoke.ts
기준선: typecheck 통과 · smoke 260 → 267 · front 223 → 223 · 실패 0 · verify exit 0
설계와 어긋난 점: 없음. modes()는 기존 isDowngrade·protectingNow를 호출해 조회 응답만
  조립한다. protecting.start는 schedule의 protect_from, until은 실제 차단 종료인 start다.
  guard_modes·마이그레이션·setMode·src/index.ts·public/*는 최종 무변경이다.
막힌 것: 없음.

검사 6번 변이: 라우트가 요청의 downgrade를 setMode에 넘기고, setMode가 그 값을 서버 판정보다
  우선하도록 잠시 바꾸자 smoke 267/0 → 266/1. 실패는
  "요청의 downgrade=false를 믿지 않고 하향 차단" 한 건뿐이었다. 변이 뒤 세 파일을 변이 전
  SHA-256으로 복원했다(src/index.ts E728BB…BD739 · guard.ts 679863…F47DA · smoke.ts D1C7DC…71551).
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
검사 6번이 "요청 본문을 믿는" 구현에서 빨간불이 되는가:
  ✅ 검토 세션에서 보고를 믿지 않고 직접 재현했다. 라우트가 요청의 downgrade를 넘기고
  setMode가 그 boolean을 서버 계산보다 우선하도록 바꾸자 smoke 267/0 → 266/1.
  유일한 실패는 "요청의 downgrade=false를 믿지 않고 하향 차단"이고 응답은
  {active:"secretary",downgrade:false,reason:null}이었다. 변이 전 SHA-256으로 원복했다.
isDowngrade·protectingNow 를 재사용했는가 (사본이 늘지 않았는가):
  ✅ modes()는 isDowngrade(active, mode)와 protectingNow(env, loadTime(env))를 직접 부른다.
  리포 전수 검색에서 STRENGTH_DIR·isDowngrade 정의와 [protect_from,start] 구간 비교는
  guard.ts 한 곳뿐이다. 실제 API 값도 확인했다: schedule.protect_from=
  2026-08-04T15:00:00.000Z(KST 8/5 00:00), schedule.start=2026-08-07T00:00:00.000Z
  (KST 8/7 09:00)이고, protecting.start는 전자 · protecting.until은 후자와 정확히 같았다.
guard_modes 에 컬럼이 늘지 않았는가:
  ✅ PRAGMA 검사는 기존 10컬럼(key·label·max_level·risk_threshold·friction_mult·use_fsi·
  use_overlay·ai_daily_cap·sort·active)만 확인한다. migrations·schema-current.sql·db/index.ts
  diff가 모두 0이고 최신 마이그레이션도 0015 그대로다. downgrade·protecting은 조회 응답뿐이다.
setMode 의 강제가 그대로인가:
  ✅ setMode diff는 0이다. down을 요청이 아니라 isDowngrade로 계산하고, if(down) 안에서
  protectingNow가 참이면 먼저 409, 그 밖에서 빈 사유면 400이다. 라우트 본문 타입도
  {key, reason?}뿐이라 downgrade를 서비스에 전달하지 않는다.
설계 위반 · 함정 재발:
  없음. 파생 저장·마이그레이션·프런트 변경이 없고, 응답 힌트와 PUT 강제가 같은 기존 함수를
  각각 호출한다. protecting의 교차 이름(start=보호 진입, until=일정 시각)은 실제 값으로 확인했다.
판정:
  ✅ 통과. 정상 구현에서 typecheck 통과 · smoke 260 → 267 · front 223 → 223 · 실패 0 ·
  verify exit 0을 독립 재현했고, 핵심 검사 6이 금지된 구현을 266/1로 검출함을 확인했다.
```
