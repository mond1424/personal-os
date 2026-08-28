# T-52 — 캘린더가 보낼 곳을 만든다

**발행** Cowork · 2026-08-28 · **담당** Claude Code · **보통**
**근거** [ADR-029](../../APP-ADR.md#adr-029) · `APP-PLAN` §Phase 7 · **마이그레이션 하나 · 서버 · APK 무관**

---

## 무엇을 만드나

**기기가 읽어 보낼 자리.** 화면에는 아직 아무것도 안 보인다 — **그건 T-53이다.**

```
POST /api/cal/sync   →  멱등 upsert. 기기가 창 범위를 통째로 보낸다
```

⚠️ **이 티켓만으로는 사용자가 아무것도 못 본다.** 둘을 연달아 돌린다.

## 왜 이것부터인가

**"앱을 열어도 볼 게 없다"가 지금의 병목이다.** 8/19~22 나흘 연속 `daily` 없음·`logs 0`,
오늘 할 일 하나. **위젯 셋으로 도착은 쉬워졌는데 도착지가 비어 있다.**

**넣지 않아도 채워지는 유일한 길이 외부 일정이고**, ADR-028이 *"입력의 무게중심을 시스템으로"*라
적은 자리가 여기다.

## 할 일

### ① 마이그레이션 — ADR-029가 이미 적어 둔 그대로

```sql
ALTER TABLE events ADD COLUMN ext_src TEXT;      -- 'devcal' | NULL(앱 생성)
ALTER TABLE events ADD COLUMN ext_uid TEXT;      -- 반복은 '<id>:<날짜>'
ALTER TABLE events ADD COLUMN ext_updated TEXT;  -- LWW 기준
CREATE UNIQUE INDEX idx_events_ext
  ON events(ext_src, ext_uid) WHERE ext_src IS NOT NULL;
```

⚠️ **`test/smoke.ts`의 스키마 목록에 파일명을 넣는다.**

### ② `POST /api/cal/sync` — 멱등 upsert

기기가 **창 범위의 일정 전부**를 한 번에 보낸다. 서버는 그것을 `events`에 맞춘다.

```
입력   { items: [{ ext_uid, title, date, time?, all_day?, ext_updated }], window: { from, to } }
출력   { upserted, skipped_closed, skipped_stale, deleted, protected_kept }
```

⚠️ **응답이 "무엇을 안 했는지"를 세어 돌려준다.** T-43이 `last_seen_count`로 세운 자리와 같다 —
**0건과 실패가 구별되지 않으면 다음에 조용히 깨진다.**

### ③ ★ 마감된 날은 건너뛴다 — 실패가 아니라 결정이다

**마감된 날에는 `events` 추가가 막히지 않는다**(함정 6 — `events`엔 `_ins` 트리거가 없다).
**하지만 ADR-029는 마감된 날을 동기화에서 영구 이탈시킨다:**

> 열린 날은 캘린더와 공유하는 현재, 마감된 날은 personal-os만의 과거

```
마감된 날의 항목  →  건너뛴다 · skipped_closed 를 센다
```

⚠️ **트리거에 걸려서 건너뛰는 게 아니라, 서버가 먼저 판단해서 건너뛴다.**
DB가 안 막아 주므로 **여기가 유일한 방어선**이다 — 안 막으면 지난 날이 캘린더로 덮인다.

### ④ ★ 삭제 — 유령을 남기지 않되 이력은 지킨다

캘린더에서 지운 일정이 앱에 남으면 **화면이 거짓말을 한다.**

```
창 안 · devcal 소스 · 이번에 안 온 것  →  지운다
그 중 guard 이력이 참조하는 것         →  지우지 않고 protect 해제 + 보존
```

⚠️ **`ext_src IS NULL`(앱이 만든 일정)은 절대 안 지운다.** 창 범위 안이어도 마찬가지다 —
**동기화가 사용자의 것을 지우면 신뢰가 끝난다.**

### ⑤ LWW — 구갱신은 무시

`ext_updated`가 저장된 것보다 **오래됐으면** 무시하고 `skipped_stale`을 센다.
해소 UI는 없다(ADR-029).

## 범위

```
migrations/00NN_cal_sync.sql   (신규)
src/index.ts                   POST /api/cal/sync 한 줄
src/services/                  동기화 로직 (새 파일 또는 events 쪽)
src/db/index.ts                upsert · 창 조회 · 삭제 SQL
test/smoke.ts                  스키마 목록 + 검사
docs/api-surface.md            재생성
```

**프런트 무변경 · APK 무관 · 화면 변화 없음.**

⚠️ **`protect_*`를 캘린더에서 받지 않는다.** 앱 전용이다(ADR-029).
⚠️ **귀속일을 재계산하지 않는다** — 캘린더의 벽시계 날짜 그대로.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| 쓰기 방향(앱 → 캘린더) | **9월이다.** 8월은 읽기만 — 갈라짐을 물리적으로 차단 |
| 보호 제안 카드 | ADR-030. 별개이고 T-53 뒤다 |
| `ext_src IS NULL` 삭제 | **사용자가 만든 일정이다.** 동기화가 지우면 안 된다 |
| 마감된 날에 쓰기 | ADR-029가 영구 이탈시킨다. **DB가 안 막으니 서버가 막는다** |
| 귀속일 재계산 | 일정·보호 판정은 벽시계의 것 |
| 충돌 해소 UI | LWW 하나다(ADR-029) |
| 위치·참석자·알림 필드 | 제목·날짜·시각/종일만 |

## 완료 조건

```
typecheck 통과 · smoke 377 → 385 이상 · front 363(변화 없음) · 실패 0 · verify exit 0
```

**검사**

```
1  같은 것을 두 번 보내면 한 행이다 (멱등)
2  ★ 마감된 날의 항목은 안 들어가고 skipped_closed 가 센다
3  ★ 2가 조용하지 않다 — 응답의 수와 실제 행 수가 맞는다      ← 2의 짝
4  구갱신(ext_updated 가 옛것)은 무시되고 skipped_stale 이 센다
5  창 안에서 안 온 devcal 일정은 지워진다
6  ★ guard 이력이 참조하면 안 지우고 protect 만 푼다
7  ★ ext_src IS NULL 인 일정은 창 안이어도 안 지워진다        ← 5의 짝. 가장 위험한 자리
8  반복 인스턴스가 '<id>:<날짜>' 로 개별 행이 된다
```

**5와 7이 짝이다.** 5만 보면 *"창 안의 것을 전부 지우는 구현"*이 통과하고,
**그것은 사용자가 앱에서 만든 일정을 동기화가 삭제하는 모양이다.**
T-33·T-38·T-39·T-41·T-43·T-44·T-45·T-46·T-47·T-49에서 **열 번** 물린 자리의 가장 비싼 판이다.

**2와 3도 짝이다.** 2만 보면 *"조용히 건너뛰는 구현"*이 통과한다 — 그러면
**동기화가 절반만 도는 밤에 아무도 모른다.**

**변이**
- 마감 판정을 뺀다 → **2만** 죽는다
- `skipped_closed` 를 안 센다 → **3만** 죽는다
- 삭제에서 `ext_src` 조건을 뺀다 → **7만** 죽는다
- LWW 비교를 뒤집는다 → **4만** 죽는다
- guard 참조 확인을 뺀다 → **6만** 죽는다
- 반복 인스턴스를 id 로만 키잉한다 → **8만** 죽는다

## 확인 절차 (사용자)

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

**화면에 보이는 변화는 없다.** 다음 티켓(T-53)이 기기에서 읽어 보내면 그때 보인다.

---

## 보고 (담당이 채운다)

```
티켓: T-52
바꾼 파일:
기준선: typecheck · smoke 377 → ? · front 363(변화 없음) · verify exit 0
마이그레이션 파일명 (smoke 목록에 넣었는가):
마감된 날을 어디서 막았나 (DB 가 아니라 서버라는 것을 어떻게 보장했나):
삭제의 ext_src 조건을 어디에 뒀나 · 검사 7이 실제로 앱 생성 일정을 만드는가:
응답의 skipped_* 가 실제 수와 맞는 것을 어떻게 쟀나:
변이 여섯이 각각 하나씩만 죽였는가:
```
