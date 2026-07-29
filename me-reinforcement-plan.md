# Me Reinforcement Plan

Me 탭을 "Life Model"로 개편하기 위한 구현 기준 문서. 전제: Cloudflare Worker + D1 백엔드.

---

## 0. 목적

AI 판단(Guard, 계획 생성 등)이 제대로 작동하려면 장기 맥락이 입력에 있어야 한다.
예: "물리학과 3학년, 5학기 수강, 양자역학1 성적, 다음 학기 양자역학2 예정, 방학 기간, 디데이 제약"
→ "방학 우선순위: 선형대수 복습 → 양자역학1 재학습 → 양자역학2 예습"

이를 위해 Me를 천천히 변하는 상태(state) 저장소인 **Life Model**로 확장한다.
이벤트 스트림(일정·일기·요약)과는 데이터 성격이 다르므로 내비게이션 위계도 분리한다.

핵심 원칙:

1. **데이터 + AI 해석 공존** — 모든 해석은 analysis 객체를 앵커 일반화해 구현한다
2. **빈칸 허용** — 초기 정보가 비어 있어도 동작하고, 누적 로그에서 AI 제안 → 사용자 승인으로 채워진다
3. **저마찰 유지** — 자동 수집이 기본, 직접 입력은 선택지
4. **lazy 재생성 + 확실한 stale 표시** — 자동 재생성 없음, 낡은 해석은 반드시 표시
5. **AI의 쓰기는 게이트를 경유한다** — 대상의 성격에 따라 게이트 강도를 달리한다 (6.4)
6. **자유 형식 JSON 금지** — 저장·제안·실행되는 모든 구조화 데이터는 스키마 검증을 통과한다 (2.2)

---

## 1. 내비게이션

- 구조: **(나머지 4탭 / Me)** 상위 분리
- 하단 바: Me 선택 시 [me] 박스 확대, 나머지 4개 박스는 왼쪽으로 쏠리며 축소 (애니메이션 필수)
  → "다른 섹션에 들어왔다"는 시각적 명시
- Me 홈: 섹션 리스트 + 관리인 chat 진입점. 만들지 않은 섹션은 빈 껍데기로 노출하지 않고 [+ 섹션 추가]로만 접근

### 섹션 구성

```
Me
 ├── Overview        AI가 이해한 현재의 나                          ← Phase 1
 ├── Goals           장기/단기 목표, '기간' 개념과 연동             ← Phase 1
 ├── Education       학교/학기/성적/수강 이력/선수과목/추천 공부     ← Phase 1
 ├── AI Memory       제안 큐 열람, 승인/거부                        ← Phase 2
 ├── (관리인 chat)   pOS 전체 조회 + 실행 가능한 대화 에이전트      ← Phase 4
 ├── Projects        }
 ├── Knowledge       }
 ├── Career          }  필요해질 때 추가. 미리 만들지 않는다.
 ├── Habits          }
 ├── Health          }
 └── Relationships   }
```

"군입대까지 N개월" 같은 제약은 별도 구조를 만들지 않고 **'기간'에 constraint/디데이 속성**을 추가해 Goals와 연동한다.

---

## 2. 데이터 모델 (D1)

### 2.1 lm_item — Life Model 공통 항목

```sql
CREATE TABLE lm_item (
  id              INTEGER PRIMARY KEY,
  section         TEXT NOT NULL,              -- 'overview' | 'goals' | 'education' | ...
  title           TEXT NOT NULL,
  body            TEXT,                       -- 서술형 md
  data            TEXT,                       -- 섹션 스키마를 따르는 JSON
  schema_version  INTEGER NOT NULL DEFAULT 1, -- data가 준수한 스키마 버전
  source          TEXT NOT NULL,              -- 'manual' | 'ai_approved'
  version         INTEGER NOT NULL DEFAULT 1, -- 수정 시 +1 (stale 판정 기준)
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
```

- Overview/Knowledge처럼 서술형 → body 위주, data는 비어도 된다
- Education처럼 정형 → data 위주
- `source='manual'` 항목은 AI가 update 제안을 기본적으로 내지 않는다 (명시 플래그 있을 때만)
- `data`는 섹션 스키마 검증을 통과해야만 저장된다

### 2.2 섹션 스키마 레지스트리

lm_item이 모든 섹션을 담는 범용 테이블이므로, `data`의 형태는 섹션별 스키마 문서가 규정한다.
스키마는 코드가 아니라 **데이터로 저장소에 둔다** (`/schemas/<section>.v<N>.json`).

소비처가 셋이고, 셋 다 같은 파일을 읽는다.

| 소비처 | 역할 |
|---|---|
| 쓰기 검증 | lm_item·lm_proposal·agent_action의 payload를 저장 전 검증. 실패 시 거부 |
| 프롬프트 주입 | 추출·분석·chat 프롬프트에 해당 섹션 스키마를 함께 전달해 형식이 맞는 출력을 유도 |
| UI 폼 생성 | 수동 입력 폼과 diff 표시를 스키마에서 파생 |

설계 규칙:

- 초기 스키마는 **필수 필드를 최소로** 둔다. 빈칸 허용 원칙과 충돌하지 않아야 한다
- 필드 추가·변경 시 스키마 버전을 올린다. 기존 행은 마이그레이션하지 않고 `schema_version`으로 구분해 읽는다
- 검증기는 Worker에서 도는 경량 구현으로 충분하다. 스키마 표현식은 필요한 키워드(type, required, enum, items, properties)로 제한한다
- 자주 조회하는 필드(예: 과목 상태·학기)는 JSON 안에 두되, 조회가 느려지면 generated column + 인덱스로 승격한다

Education 스키마 예:

```json
{
  "section": "education",
  "version": 1,
  "type": "object",
  "required": ["name", "status"],
  "properties": {
    "name":          { "type": "string" },
    "status":        { "type": "string", "enum": ["completed", "enrolled", "planned"] },
    "term":          { "type": "string" },
    "grade":         { "type": "string" },
    "credits":       { "type": "number" },
    "prerequisites": { "type": "array", "items": { "type": "string" } },
    "note":          { "type": "string" }
  }
}
```

### 2.3 analysis 앵커 일반화 (마이그레이션 Phase 1, UI Phase 3)

analysis(prompt, result 쌍)에 컬럼을 추가한다.

```sql
ALTER: anchor_type      TEXT,   -- 'date' | 'entity'
       anchor_id        TEXT,   -- 날짜 또는 lm_item.id
       model_tier       TEXT,   -- 'high' | 'medium' | 'low'
       source_versions  TEXT    -- JSON: [{table, id, version}, ...] 생성 시점 입력 스냅샷
```

- 기존 행은 `anchor_type='date'`로 backfill
- 스키마를 Phase 1에서 먼저 확장하는 이유: 비용은 컬럼 추가 + backfill 수준으로 작은 반면,
  이후 생성되는 모든 analysis가 처음부터 anchor·source_versions를 갖게 되어 Phase 3의 stale 판정이 소급 적용된다.
  Life Model 분석·과목 분석·프로젝트 분석이 전부 이 구조를 재사용한다.
- "양자역학2 준비 분석" = anchor_type='entity'인 analysis. 별도 객체를 만들지 않는다.

### 2.4 lm_proposal — Life Model 제안 큐

```sql
CREATE TABLE lm_proposal (
  id            INTEGER PRIMARY KEY,
  section       TEXT NOT NULL,
  action        TEXT NOT NULL,            -- 'add' | 'update'
  target_id     INTEGER,                  -- update일 때 lm_item.id
  payload       TEXT NOT NULL,            -- 섹션 스키마를 따르는 JSON
  evidence      TEXT,                     -- 근거 JSON: [{date, excerpt}, ...]
  content_hash  TEXT NOT NULL,            -- 재제안 방지용 정규화 해시
  origin        TEXT NOT NULL DEFAULT 'weekly_batch',  -- 'weekly_batch' | 'caretaker_chat'
  status        TEXT NOT NULL,            -- 'pending' | 'approved' | 'rejected'
  created_at    TEXT NOT NULL,
  decided_at    TEXT
);
```

payload는 큐에 들어가기 전 섹션 스키마로 검증한다. 형식이 깨진 출력이 승인 화면까지 도달하지 않는다.

### 2.5 agent_action — 실행 로그

```sql
CREATE TABLE agent_action (
  id           INTEGER PRIMARY KEY,
  type         TEXT NOT NULL,     -- 화이트리스트된 액션 타입 (6.4)
  params       TEXT NOT NULL,     -- 액션 스키마를 따르는 JSON
  session_id   INTEGER,           -- 유발한 chat 세션
  message_id   INTEGER,           -- 유발한 메시지
  status       TEXT NOT NULL,     -- 'proposed' | 'executed' | 'cancelled' | 'undone'
  undo_data    TEXT,              -- 되돌리기에 필요한 이전 상태 JSON
  created_at   TEXT NOT NULL,
  executed_at  TEXT
);
```

### 2.6 chat_session / chat_message — 관리인 chat

다회전 대화이므로 analysis와 분리 저장한다.

- session(id, started_at)
- message(id, session_id, role, content, tool_calls JSON, created_at)

---

## 3. AI 호출 계층 (tier)

### 3.1 배분 원칙

기준은 **난이도 × 호출 빈도**. 고빈도 잡일이 low의 존재 이유이고, 저빈도 배치는 tier 간 비용 차이가 사실상 없으므로 상위 tier를 써도 된다.

| tier | 용도 | 예시 작업 |
|---|---|---|
| low | 고빈도·저난이도 | 감정분석, 일기 자연어→필드 분류, 해시태그 추출 |
| medium | 중난이도 또는 저빈도 배치 | daily/weekly/monthly summary, Analysis 탭 분석, 주간 Life Model 추출, 관리인 chat 기본 턴 |
| high | 저빈도·고난이도 | Me 탭 계획 생성(방학 계획 등), 과목 준비 분석, Guard 판단, 관리인 chat의 심층 분석/계획 요청 |

### 3.2 구현

```js
// config 한 곳에서만 모델 ID 관리. 호출부는 tier만 지정.
const MODEL_TIERS = { high: '<model-id>', medium: '<model-id>', low: '<model-id>' };

callAI(tier, task, input, tools?)  // 단일 디스패처. tools는 관리인 chat에서 사용
```

- **escalation**: 출력 검증 실패(스키마 위반, JSON 파싱 실패, 빈 응답 등) 시 한 단계 위 tier로 1회 자동 재시도
- 모든 호출은 디스패처를 통과. 모델 교체 시 config만 수정

---

## 4. 주간 추출 파이프라인 (Life Model 자동 채움)

트리거: 주간 summary 생성 직후 (매주 일요일 배치)

```
1. 입력 조립
   - 이번 주 weekly summary (재사용 → 토큰 절약)
   - 현재 Life Model 스냅샷 (빈 섹션은 "정보 없음"으로 명시)
   - 대상 섹션들의 JSON Schema
   - 최근 rejected 제안 요약 (재제안 방지)
2. callAI(medium, 'lm_extract', input)
3. 출력: proposal JSON 배열 [{section, action, target_id?, payload, evidence}]
4. 검증: 섹션 스키마 검증. 실패 시 escalation 1회, 재실패 시 해당 항목 폐기
5. 중복 제거: content_hash가 기존 pending/rejected와 일치하면 버림
6. lm_proposal에 status='pending'으로 삽입
7. pending이 1개 이상이면 알림 1건: "Life Model 개선 추천이 있습니다"
   (항목별 개별 알림 금지 — 주 1회 묶음)
```

### 승인 UI (AI Memory 섹션)

- diff 형식: 어느 섹션에 무엇을 추가/수정하는지 before/after로 표시 (스키마 기반 필드 단위 diff)
- evidence의 로그 날짜를 탭하면 해당 daily로 이동
- 승인 → lm_item 반영(source='ai_approved', version 갱신), 거절 → status='rejected' 기록
- 사용자를 크게 흔들 수 있는 급진적 제안에는 경고 문구를 병기한다

---

## 5. stale / lazy 재생성

- **판정**: 렌더링 시 analysis.source_versions의 각 (table, id, version)을 현재 값과 비교.
  하나라도 불일치하면 stale 배지 표시. 별도 무효화 트리거 없이 조회 몇 번으로 처리된다
- **전파**: daily 수정 → weekly summary 재생성 시 version 변경 → 이를 입력으로 쓴 analysis가 비교에서 stale로 걸린다 (체인)
- **재생성은 lazy**: stale 배지 + [재생성] 버튼. 자동 재생성 없음
- Life Model 항목 수정도 동일 — 그 항목을 anchor로 하거나 입력으로 쓴 분석이 stale 처리된다

---

## 6. 컨텍스트·도구 계층

Guard, 관리인 chat, 엔티티 분석이 공유하는 기반.

### 6.1 read-only 도구

pOS 전체 조회용 함수 집합. 컨텍스트를 미리 채우는 대신 모델이 필요한 데이터를 도구로 당겨온다 (토큰 절약 + 조회 정확성).

```
get_daily(date)                 특정 날짜 로그
get_summary(scope, key)         weekly/monthly summary
search_logs(keyword, range)     키워드 검색
get_lm_section(section)         Life Model 섹션
list_courses(filter?)           수강 이력/예정
get_periods(active_only?)       기간·디데이 제약
get_analysis(anchor)            기존 분석 조회
```

### 6.2 고정 코어 컨텍스트

- Overview + 활성 Goals + 활성 제약(디데이)은 항상 프롬프트에 포함한다. 가볍고 모든 판단에 필요하다
- 빈 섹션은 생략하지 말고 `"Education: 정보 없음"`처럼 **명시 직렬화**한다. 생략하면 모델이 빈 곳을 상상으로 메우고, 명시하면 "수강 이력이 없어 판단 보류"가 나온다

### 6.3 관리인 AI chat

pOS 전부를 조회하고 실행까지 할 수 있는 '관리인' 대화 에이전트. Me 탭에서 진입한다.

턴 구조:

```
Read      6.1 도구를 tool use로 호출해 필요한 데이터를 수집
  ↓
Think     수집한 데이터 + 고정 코어 컨텍스트로 판단
  ↓
├── Proposal   Life Model 변경 → lm_proposal(origin='caretaker_chat') → AI Memory에서 승인
└── Action     Task/Event 조작 → 인라인 확인 카드 → 실행 (6.4)
```

- 한 턴의 출력은 `{ reply, proposals[], actions[] }` 봉투로 고정한다. proposals·actions는 비어 있을 수 있다
- **tier**: 기본 medium (도구 루프가 호출 수를 늘리므로), 사용자가 심층 분석/계획을 명시 요청하면 high
- **세션**: chat_session/chat_message에 저장 (2.6)
- **Guard와의 관계**: Guard는 같은 도구·코어 컨텍스트 위에서 고정 프롬프트로 도는 비대화형 특수 호출이다.
  도구 계층을 공유하므로 추후 병합이 자연스럽다. 병합 여부는 Phase 4 이후 판단

### 6.4 Action 규약

Proposal과 Action은 대상의 성격이 다르므로 게이트 강도를 비대칭으로 둔다.

| | Proposal | Action |
|---|---|---|
| 대상 | Life Model (자기 상태에 대한 해석) | Task / Event (이벤트 스트림) |
| 성격 | 느리게 변하고, 틀리면 이후 모든 판단을 오염시킴 | 구체적이고 즉시 되돌릴 수 있음 |
| 게이트 | AI Memory 승인 큐 (비동기, 근거 필수) | 인라인 확인 카드 (동기, 즉시) |

실행 규칙:

- **화이트리스트만 허용**. 자유 형식 명령 실행 금지. 초기 집합:
  `create_task` / `reschedule_task` / `cancel_task` / `create_event` / `update_event` / `create_period`
- 각 액션 타입은 **액션 스키마**를 가지며, params는 2.2와 같은 방식으로 검증된다
- 실행은 UI 조작과 **동일한 서버 코드 경로**를 탄다. 그래야 기존 불변식이 자동으로 지켜진다
  (과거 일기 수정 불가·memo만 추가, 취소와 삭제 분리, 미루기 이력 기록 방식 등)
- 삭제·과거 기록 변경은 초기 화이트리스트에서 제외한다. 되돌리기 어려운 조작은 사용자가 직접 한다
- 한 턴에 여러 액션이 나오면 확인 카드 하나에 목록으로 묶어 표시하고, 일괄 승인/개별 해제를 지원한다
- 모든 액션은 agent_action에 로그를 남기고, undo_data가 있는 항목은 [되돌리기]를 제공한다

---

## 7. 프롬프트 공통 규칙

1. 빈 섹션 "정보 없음" 명시 (6.2)
2. 구조화 출력을 요구할 때는 해당 스키마를 프롬프트에 함께 전달한다 (2.2)
3. **정량 추정에는 산출 근거 필수** — "예상 준비시간 35시간"만 단독 출력 금지.
   근거(예: 챕터 수 × 챕터당 시간)를 함께 출력하게 강제하고, UI에서는 접힌 상태로 표시
4. Life Model 수정 제안에는 evidence(근거 로그 날짜·발췌) 필수 — 관리인 chat 발 제안도 동일

---

## 8. 구현 단계

### Phase 1 — 구조 분리 + 스키마 기반 수동 입력 + 앵커 마이그레이션
- 하단 바 (4탭 / Me) 분리 + 확대/축소 애니메이션
- 스키마 레지스트리 + 검증기, overview·goals·education 세 섹션 스키마 v1 작성
- Overview: 기존 Me 텍스트 이관
- Education: lm_item 기반 과목 CRUD (스키마에서 파생한 수동 입력 폼)
- Goals: 기간에 constraint/디데이 속성 추가, 연동 표시
- analysis 스키마 확장 (2.3) — 컬럼 추가 + 기존 행 backfill. UI 변경 없음
- ✅ 완료 기준: Me 진입 애니메이션 동작 / 기존 Me 내용 Overview 표시 / 스키마 위반 data 저장 거부 / 과목 등록·조회 / 디데이 표시 / 마이그레이션 후 기존 analysis 조회 정상 + 신규 analysis에 anchor·source_versions 기록

### Phase 2 — tier 디스패처 + 자동 채움
- MODEL_TIERS config + callAI 디스패처 + escalation
- 주간 추출 파이프라인 + lm_proposal + 알림
- AI Memory 섹션: 스키마 기반 diff 승인 UI, 거절 이력
- ✅ 완료 기준: 일요일 배치로 proposal 생성 / 스키마 위반 제안이 큐에 들어오지 않음 / 승인 시 lm_item 반영 / 거절 항목 재제안 없음 / 알림 주 1회 묶음

### Phase 3 — 해석 계층 UI
- 과목 상세에서 엔티티 분석 생성 (high tier): 권장 선행학습 체크리스트 + 예상 준비시간(근거 포함)
- stale 비교/배지 + [재생성]
- ✅ 완료 기준: 과목 분석 생성 / 원천 데이터 수정 시 stale 배지 (Phase 1~2 사이 생성된 분석 포함) / 재생성 동작

### Phase 4 — 관리인 AI chat
- 4a: 6.1 read-only 도구 계층, Me 탭 chat UI + 세션 저장, Read → Think → Proposal 경로
- 4b: 액션 화이트리스트 + 액션 스키마 + agent_action 로그, 인라인 확인 카드, 되돌리기
- ✅ 완료 기준: 임의 날짜 로그·과목·기간을 도구로 조회해 답변 / 수정 제안이 proposal로 생성되고 직접 쓰기 없음 / 확인 없이 실행되는 액션 없음 / 화이트리스트 밖 요청은 거부하고 사유 설명 / 실행 로그와 되돌리기 동작 / medium↔high 라우팅 동작

### 이후
- Guard를 도구 계층 위의 비대화형 특수 호출로 통합 검토 (관리인과 병합 여부 포함)
- 액션 화이트리스트 확장 검토 (삭제·과거 기록 변경은 신중히)
- 나머지 섹션(Projects/Knowledge/Career/Habits/Health/Relationships)은 필요가 생길 때 스키마와 함께 추가

---

## 9. 검증 계획 / 오픈 이슈

- **추출 품질 실험**: 초기 4주는 medium으로 기준 품질을 확보한 뒤, 동일 입력을 low로 돌려 비교하고 충분하면 low로 전환한다. 승인 게이트가 오류를 거르고 놓친 후보는 로그 누적으로 다음 주에 재포착되므로 low 실험의 리스크는 낮다
- **스키마 위반율 로깅**: 검증 실패 건수를 tier·task별로 기록한다. 특정 섹션에서 위반이 잦으면 스키마가 과하게 조여 있거나 프롬프트 설명이 부족하다는 신호다
- **관리인 chat 비용 관찰**: 도구 루프의 턴당 호출 수를 로깅해 medium 기본이 적절한지 확인한다
- **액션 오작동 관찰**: agent_action의 cancelled·undone 비율을 본다. 높으면 확인 카드 정보가 부족하거나 의도 해석이 부정확하다는 뜻이다
- **오픈 이슈**: 안드로이드 앱 버전이 기존 Worker + D1 백엔드를 그대로 공유하는지 확정 필요. 본 계획은 백엔드 유지를 전제하며, 백엔드를 재작성하더라도 스키마·파이프라인 구조는 동일하게 적용된다
