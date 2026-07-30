# T-02 — 스키마가 필드 라벨을 준다

**발행** Cowork · 2026-07-30 · **담당** Claude Code (위임 금지 — 마이그레이션) · **상태** ✅ 구현 완료 · 원격 적용·deploy 대기

---

## 목표

`lm_schema`의 각 필드에 **`title`**(표시 라벨)을 넣고, 폼이 그것을 쓴다.
지금 폼은 `name`·`term`·`credits`·`prerequisites`처럼 영문 키를 그대로 보여준다.

**왜 프런트에 매핑을 두지 않는가** — §2.2가 레지스트리를 둔 근거는
"검증·프롬프트·폼이 **같은 것**을 읽는다"다. 라벨만 프런트에 두면 스키마가 v2로 오를 때
새 필드가 영문 키로 남고, 그 어긋남은 조용히 생긴다. 폼 필드 목록은 서버에서 오는데
라벨만 프런트에 있으면 **레지스트리를 반만 쓰는 것**이다.

## 결정 — 버전을 올리지 않고 `body`를 제자리에서 고친다

`version`은 §5 stale 판정의 기준이다. **라벨은 검증 의미를 바꾸지 않으므로**
버전을 올리면 기존 항목 전부에 거짓 stale 신호가 나간다.

대가: v1 본문이 사후 수정된다. 검증 규칙이 동일하므로 "v1으로 검증됐다"는 기록은 그대로 참이다.
`lm_schema`에는 불변성 트리거가 없다(0012 확인) — 이 UPDATE는 허용된다.

## 범위

```
migrations/0014_schema_titles.sql   세 섹션 body UPDATE
src/lib/schema.ts                   fieldsOf가 title을 실어 보낸다
test/smoke.ts                       스키마 목록에 0014 등록 + 검사
public/app.js                       라벨을 title ?? key로
test/front.mjs                      검사
```

**`0014`를 쓰면 `STATE.md`의 "다음 번호"가 밀린다** — 알림 아웃박스 0015 · 인증 0016.
`STATE.md` 갱신도 이 티켓에 포함된다.

## 라벨

```
education   name 과목명 · status 상태 · term 학기 · grade 성적
            credits 학점 · prerequisites 선수과목 · note 메모
goals       horizon 기간 · period_id 연결 기간 · metric 지표 · note 메모
overview    summary 요약
```

`status`의 enum 값(`completed`·`enrolled`·`planned`)은 **이번 범위가 아니다.**
값 라벨은 `enum`과 표시명을 짝지어야 하는 별개 문제고, 스키마 부분집합에 새 키워드가 붙는다.
필요해지면 별도 티켓으로 판단한다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `version` 증가 | §5 stale 판정에 거짓 신호 |
| 검증기(`validate`)에 `title` 해석 추가 | 라벨은 검증과 무관하다. 부분집합을 넓히지 않는다 |
| 프런트에 라벨 매핑 | 이 티켓이 없애려는 것 |
| `lm_item` 데이터 변경 | 스키마만 고친다 |

## 읽을 것

- `me-reinforcement-plan.md` §2.2 — 소비처 셋이 같은 것을 읽는다
- `migrations/0012_life_model.sql` 92~108행 — 레지스트리 정의와 v1 본문
- `src/lib/schema.ts` — `parseSchema`는 모르는 키를 그대로 통과시킨다(`title`이 안전한 근거)
- `STATE.md` — "로컬 통과, 원격 실패" 사고: **트리거가 걸린 테이블에 UPDATE를 넣을 때
  로컬 검증이 원격을 보장하지 못한다.** `lm_schema`엔 트리거가 없지만 같은 종류의 확인을 한다

## 완료 조건

```
typecheck 통과 · smoke 213 → 215 이상 · front 183 → 185 이상 · 실패 0
```

검사에 들어가는 것:

1. `GET /api/lm/education/schema`의 `fields`에 `title`이 실린다
2. **`title`이 없는 필드는 `key`로 폴백한다** — 스키마가 늘 완전하다고 가정하지 않는다
3. 폼 라벨이 `title`을 쓴다. **`title`을 지우면 라벨이 `key`로 바뀌는 것**까지 확인한다
   (현재 라벨과 같은 값을 확인하는 검사는 하드코딩과 구별되지 않는다)

## 확인 절차 (사용자)

`--local` → `--remote` 마이그레이션 → deploy 후 폰에서:

1. Me › Education › 추가 → 라벨이 한국어인지
2. **T-01의 미실시 항목을 함께 본다** — 목록 렌더 · 추가 · 수정 · 삭제 ·
   status 3색 다크모드 가독

---

## 보고 (담당이 채운다)

```
티켓: T-02
바꾼 파일: migrations/0014_schema_titles.sql(신규) · src/lib/schema.ts · public/app.js
          test/smoke.ts · test/front.mjs · STATE.md · docs/{api-surface.md,schema-current.sql}
기준선: typecheck 통과 · smoke 213 → 216 · front 183 → 185 · 실패 0
설계와 어긋난 점: 없음
막힌 것: 없음 (원격 적용·deploy는 사용자 몫 — 대기 중)
```

## 구현 메모 (Claude Code · 07-30)

**`json_set`을 썼다 — body 전체 치환이 아니다.** 티켓은 "세 섹션 body UPDATE"만 지정했는데,
전체 치환은 **원격 body가 조금이라도 갈라져 있으면 그걸 조용히 되돌린다.** `json_set`은 지정 경로에만
얹으므로 다른 키를 건드리지 않고, 재실행해도 같은 결과다(멱등). `node:sqlite` 셰임·D1 양쪽에서 JSON1을 쓸 수
있는지 먼저 확인했다.

**0013의 교훈은 이 경로에 걸리지 않는다.** 확인한 것 둘:
① `lm_schema`에 트리거가 없다 — 0012의 유일한 트리거는 `trg_lm_item_version`(대상은 `lm_item`).
② 대상 3행은 0012가 직접 INSERT한 것이라 **모든 환경에 반드시 존재한다.** 트리거 발화가 데이터 유무에
갈리던 그 경로가 아니다. 그래도 `--local` 적용 후 body 3건을 실제로 꺼내 봤다 — `version`은 1 그대로,
`required`·`enum`·`items` 전부 온전하고 `title`만 얹혔다.

**폴백을 서버에서 끝냈다.** `fieldsOf`가 `title ?? key`를 항상 실어 보낸다. 소비처가 셋인데(검증·프롬프트·폼)
각자 폴백을 짜면 **거기가 어긋나는 자리**다. 프런트에도 폴백을 남겨 뒀는데 이건 중복이 아니라
**옛 배포 대비**다 — 마이그레이션이 원격에 아직 안 올라간 동안 `title` 없는 응답이 온다.

**`validate`는 손대지 않았다** — `title`을 해석하지 않는다. 부분집합을 넓히지 않았고,
`parseSchema`가 모르는 키를 통과시키므로 읽기 경로도 안전하다(티켓 §금지 2번).

### 검사 — 하드코딩과 구별되는 쪽으로

- smoke(+3): `title`이 실린다 · **라벨이 검증을 안 바꾼다**(`required`·`enum`·`itemType` 그대로) ·
  `title` 없는 섹션을 임시로 넣어 **`key` 폴백** 확인(넣은 행은 지운다)
- front(+2): 라벨이 `title`이다 · **`title`을 지우면 라벨이 `key`로 돌아간다**

### 절차상 한 가지

락을 걸지 않았다. 한 층에서 한 번에 끝냈고 다른 실행 에이전트가 붙지 않아 실질 위험은 없었으나,
`AGENT-CHAIN.md` §3은 `migrations/`·`src/`를 "티켓 락 보유자"의 것으로 둔다 —
**직접 할 때도 걸어야 하는지**가 규약에 명시돼 있지 않다. Cowork 판단이 필요하다.
