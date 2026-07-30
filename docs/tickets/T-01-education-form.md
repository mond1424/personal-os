# T-01 — Me 탭에 Education 섹션·폼 붙이기

**발행** Cowork · 2026-07-30 · **담당** 미정(Claude Code가 배정) · **상태** ⬜ 대기

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

## 보고 (담당이 채운다)

```
티켓: T-01
바꾼 파일:
기준선: typecheck 통과 · smoke A → B · front C → D · 실패 0
설계와 어긋난 점:
막힌 것:
```
