# T-16 — 그날 쓴 memo와 나중에 붙인 memo를 구분한다

**발행** Cowork · 2026-08-03 · **담당** Codex CLI (조건부 · 아래 §위임) · **상태** ⬜ 대기

---

## 목표

날짜 팝업에서 **memo가 언제 쓰였는지** 알 수 있게 한다.

```
그날 쓴 것        14:30  강의 끝나고 바로 정리
나중에 붙인 것    09:00  (8/3에 추가)  그때 왜 미뤘는지 지금 보니
memo 없음         "memo 없음"
```

**왜** — 설계 §1.3에서 memo는 **마감된 날에 붙는 유일한 통로**다.
그래서 과거 날짜의 memo에는 두 종류가 섞인다 — 그날의 기록과 나중의 회고.
**섞이면 §5 분석이 둘을 같은 무게로 읽는다.**

## 스키마 확인 결과 — **마이그레이션 불필요**

```sql
CREATE TABLE memos (
  date       TEXT NOT NULL,   -- 귀속일
  ts         TEXT NOT NULL,   -- 사용자가 고른 표시 시각 (24h)
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL    -- 실제 작성 시각 ("작성 시각과 함께")
);
```

**`ts`와 `created_at`이 원래부터 나뉘어 있다.** 설계가 이 구분을 준비해 뒀는데
화면이 안 쓰고 있었을 뿐이다. 과거 memo도 전부 판별된다 — 소급 손실이 없다.

## 판별은 서버가 한다

```
created_at 의 귀속일 == memos.date  →  그날 쓴 것
                    != memos.date  →  나중에 붙인 것
```

**프런트가 계산하지 않는다.** 귀속일 경계는 사용자 설정(05:00/06:00)이고
`lib/time.attributionOfIso`가 그것을 아는 유일한 자리다. 프런트가 다시 구현하면
**새벽에 쓴 memo가 하루 어긋난다** — T-05의 데드라인 역산을 프런트가 다시 짤 때
서버 식과 갈라질 뻔한 것과 같은 종류다.

응답에 `same_day: boolean`을 얹는다. **저장하지 않는다** — 조회 시 계산이다(아키텍처 원칙 1).

## 위임 — 조건부

`src/db/index.ts`·`src/services/`에 손이 필요하므로 위임 금지에 가깝다.
**T-15와 같은 조건으로 연다** — 판정 기준이 위에 한 줄로 있기 때문이다.

1. **파생값을 저장하지 않는다.** 컬럼을 추가하지 않는다. 응답에만 얹는다
2. **귀속일 계산을 새로 짜지 않는다.** `attributionOfIso`를 쓴다
3. 검토 세션이 위 둘을 확인한다

## 범위

```
src/db/index.ts            memo 조회에 created_at 이 실려 오는지 확인 (이미 실린다)
src/services/daily.ts      same_day 판정을 얹는다
public/app.js              날짜 팝업 memo 표시 · 빈 상태
public/style.css           구분 표시
test/smoke.ts              판정 검사
test/front.mjs             표시 검사
```

## 화면

- **그날 쓴 것**과 **나중에 붙인 것**이 한눈에 갈려야 한다.
  나중 것에는 **언제 붙였는지**를 보여준다 (`(8/3에 추가)`)
- 순서는 `ts`(표시 시각) 기준 그대로 — 작성 순으로 바꾸지 않는다.
  `ts`는 **사용자가 고른 시각**이고 그것이 그 memo의 자리다
- **memo가 없으면 "memo 없음"을 명시한다.** 지금은 아무것도 안 나와서
  "없는 것"과 "안 불러온 것"이 구분되지 않는다
- 새 패턴을 만들지 않는다. 기존 날짜 팝업 구조를 쓴다

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `same_day`를 컬럼으로 저장 | 원칙 1. 파생은 조회 시 계산 |
| 프런트에서 귀속일 계산 | 경계가 사용자 설정이다. 새벽 memo가 하루 어긋난다 |
| `created_at` 문자열의 날짜 부분만 비교 | 같은 이유 — 경계를 무시한다 |
| 정렬을 `created_at` 순으로 | `ts`가 그 memo의 자리다 |
| memo 삭제·수정 경로 추가 | 트리거가 삭제를 막는다(`trg_memos_no_del`). append-only다 |
| 짧고 일반적인 새 클래스명 | 전역 충돌 **세 번**. 접두사(`.memo-origin-…`) |
| 색 리터럴 · `scrollIntoView` | 함정 5 · 1 |

## 읽을 것

- 설계 §1.3 — memo가 마감된 날의 유일한 추가 통로인 이유
- `STATE.md` §설계와 어긋난 지점 — "memo 개념 확장(3단계, 2026-07-23)"
- `src/lib/time.ts` `attributionOfIso` — 귀속일 계산의 유일한 자리
- `docs/schema-current.sql` 147행 — `ts`와 `created_at`의 주석
- `CLAUDE.md` 함정 1·5·7 · 아키텍처 원칙 1

## 완료 조건

```
typecheck 통과 · smoke 241 → 244 이상 · front 210 → 213 이상 · 실패 0
```

검사에 들어가는 것:

1. **귀속일 경계를 넘는 memo가 올바로 판별된다** — 05:00 경계라면
   `date=8/2`인 memo를 `created_at=8/3 03:00`으로 만들었을 때 **`same_day: true`**
   (03:00은 아직 8/2다). 날짜 문자열만 비교하는 구현은 여기서 빨간불이 된다
2. 나중에 붙인 memo는 `same_day: false`
3. **memo 0건일 때 "memo 없음"이 뜬다**
4. 화면에서 둘이 구별된다

**1번이 이 티켓의 덫이다.** 문자열 비교로도 2·3·4는 통과한다.

## 확인 절차 (사용자)

deploy 후. APK 재빌드 불필요.

```
□ 과거 날짜 팝업 → 그날 쓴 memo와 나중에 붙인 memo가 구별된다
□ 나중 것에 언제 붙였는지 보인다
□ memo 없는 날 → "memo 없음"
□ 새벽(05:00 이전)에 memo를 쓰고 그날 팝업을 열면 '그날 쓴 것'으로 나온다
```

---

## 보고 (담당이 채운다)

```
티켓: T-16
바꾼 파일: src/services/daily.ts, public/app.js, public/style.css, test/smoke.ts, test/front.mjs
기준선: typecheck 통과 · smoke 241 → 244 · front 210 → 213 · 실패 0 · verify exit 0
설계와 어긋난 점: 없음
막힌 것: 없음
```

---

## 검토 (검토 세션이 채운다 · HANDOFF-0731 §2)

```
파생값을 저장하지 않았는가 (컬럼 추가가 없는가): 통과. same_day는 assembleDay 응답을
  조립할 때만 계산한다. migrations와 docs/schema-current.sql 변경이 없고, memosAt이 원래
  조회하던 created_at을 그대로 쓴다. 현재 src/db/index.ts diff는 T-15의 state 필터 변경이며
  T-16 컬럼·SQL 추가가 아니다.
귀속일 계산을 attributionOfIso 로 했는가 (프런트가 다시 짜지 않았는가): 통과.
  daily.ts가 attributionOfIso(m.created_at, t.boundary) === k로 판정한다. 프런트는 서버의
  m.same_day boolean으로 표시만 나누며, md(created_at)는 "언제 추가"의 월/일 표기일 뿐
  귀속일이나 05:00/06:00 경계를 계산하지 않는다.
검사 1번이 문자열 비교 구현에서 빨간불이 되는가: 통과. smoke는 date=D인 memo에 다음
  달력날 N1의 03:00+09:00 created_at을 직접 넣는다. 이는 예시의 8/2 → 8/3 03:00과 같은
  05:00 경계 사례이며 정상 구현에서 same_day=true다. 검토 중 판정을 의도적으로
  m.created_at.slice(0, 10) === k로 바꾸자 smoke 244/0이 243/1이 되었고, 실패는
  "귀속일 경계를 넘은 03:00 memo도 그날 쓴 것으로 판정" 한 건뿐이었다. 나중 memo=false와
  ts 정렬 검사는 계속 통과했다. 이후 daily.ts는 원래 SHA-256
  913660324C50EE5BACDE09069274023620870860C05A4BAFD63300CB9B2A4C76으로 복원했다.
정렬을 ts 그대로 뒀는가: 통과. db.memosAt의 ORDER BY ts는 변경되지 않았고 프런트도
  day.memos 순서를 다시 정렬하지 않는다. smoke에서 09:00,14:30 순서를 직접 확인한다.
설계 위반 · 함정 재발: 발견 없음. 파생값 저장·마이그레이션·트리거 우회·프런트 귀속일
  재구현이 없다. 새 전역 클래스는 모두 memo-origin-* 접두사이고 색은 CSS 변수만 쓰며,
  scrollIntoView와 booted 가드를 건드리지 않았다. 작업 트리의 T-15 변경은 분리해 판정했다.
판정: 통과. 정상 구현으로 typecheck 통과 · smoke 244/0 · front 213/0 · verify exit 0을
  독립 재현했고, 핵심 경계 검사가 금지된 문자열 비교 구현을 실제로 검출함을 확인했다.
```
