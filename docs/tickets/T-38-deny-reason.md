# T-38 — 모델이 왜 거부했는지 남긴다

**발행** Cowork · 2026-08-19 · **담당** Claude Code · **작음**
**마이그레이션 있음 · APK 필요**

---

## 무엇이 어긋났나

**Level 4 격상 판정 22건 중 `approve`가 0이다. `deny`가 11이다.**

```
deny                  11    8/08 · 8/11 새벽
unavailable/timeout    3    8/18 밤
unavailable/(없음)     6    8/11 밤 (0016 이전)
unavailable/cap        2    secretary 의 ai_daily_cap=0
approve                0
```

**`deny` 열한 번은 네트워크 문제가 아니다.** 모델이 닿았고, 판단했고, 거부했다.
`ai_used=1`로 기록된 것도 둘 있다 — 왕복이 정상이었다는 뜻이다.

**그런데 왜 거부했는지가 어디에도 없다.**

서버는 이유를 만들어 보낸다(`VerifyResult.reason`) → 기기가 파싱까지 한다
(`GuardVerify.kt` `Verdict.reason = o.optString("reason", "")`) → **그리고 버린다.**
`GuardEventQueue.amendFire`가 나르는 것은 `level · ai_used · ai_verdict · unavailable_reason`
넷뿐이고 **`reason`은 그 목록에 없다.**

## 왜 이것이 조용한 실패인가

**`deny`는 정상 동작처럼 보인다.** fail-closed가 일하는 것으로 읽히고 아무 오류도 안 난다.
그런데 11:0이면 둘 중 하나다:

```
① 프롬프트가 실제로 격상할 만한 상황을 안 만든다     → VERIFY_SYSTEM 을 고칠 일
② 그 밤들이 정말로 격상할 상황이 아니었다            → 아무것도 안 고칠 일
```

**지금 데이터로는 못 가른다.** 그리고 9~11월이 §6.5의 전례를 쌓는 기간인데
**세 달 내내 Level 4가 0회면 12월에 읽을 것이 "개입했다"의 절반뿐**이다 —
T-33이 outcome에서 막았던 그 모양이 판정 쪽에서 반복된다.

**이 티켓은 ①·②를 가르지 않는다. 가를 수 있게만 만든다.**

## 할 일

### ① 이유를 나른다

```
서버 VerifyResult.reason  →  기기 Verdict.reason  →  amendFire  →  guard_events
                              (이미 있다)            (여기가 끊겼다)
```

**새로 만들 것은 운반과 저장뿐이다.** 판정도 프롬프트도 건드리지 않는다.

### ② 마이그레이션 0017 — 칼럼 하나

`ai_reason TEXT`. **`ai_unavailable_reason`과 합치지 않는다** — 뜻이 다르다:

```
ai_unavailable_reason   왜 못 물어봤나      (닫힌 CHECK — 기계가 읽는다)
ai_reason               왜 그렇게 답했나    (자유 문자열 — 사람이 읽는다)
```

⚠️ **`ai_verdict`의 CHECK를 넓히지 않는다.** T-31이 그렇게 하려다 잡혔다 —
0010의 CHECK에 걸려 400이 되고 `flush()`가 그 발동 행을 통째로 버린다.
**관측하려던 밤의 기록이 사라진다.**

⚠️ **새 마이그레이션을 추가하면 `test/smoke.ts`의 스키마 목록(하드코딩)에도 파일명을 넣는다.**

### ③ `approve`일 때도 남긴다

**`deny`만 남기면 대조군이 없다.** 승인 이유와 거부 이유를 나란히 놓아야
프롬프트가 무엇을 보고 가르는지 읽힌다. 지금 `approve`가 0이라 **당장은 한쪽만 쌓이지만,**
첫 승인이 났을 때 그 한 건이 가장 값진 기록이 된다.

## 범위

```
migrations/0017_ai_reason.sql       ALTER TABLE guard_events ADD COLUMN ai_reason TEXT
src/db/index.ts                     insert 목록에 한 칸
src/services/guard.ts               record() 가 input.ai_reason 을 받는다
android/.../guard/GuardEventQueue.kt  amendFire 에 인자 하나
android/.../guard/GuardNotifications.kt  v?.reason 을 넘긴다
test/smoke.ts                       스키마 목록 + 검사
```

**프롬프트(`VERIFY_SYSTEM`)·판정 로직 무변경.** 이 티켓은 기록만 늘린다.

## 금지

| 하지 말 것 | 왜 |
|---|---|
| `VERIFY_SYSTEM` 손대기 | **무엇을 고쳐야 하는지 아직 모른다.** 그걸 알려고 이 티켓을 판다 |
| `ai_verdict`의 CHECK 넓히기 | 400 → `flush()`가 행을 버린다. T-31이 잡힌 자리 |
| `ai_unavailable_reason`에 합치기 | 하나는 닫힌 집합, 하나는 자유 문자열. 합치면 기계가 읽던 쪽이 깨진다 |
| 이유를 화면에 보이기 | 사용자가 할 수 있는 일이 없다(T-33 §금지와 같다). 늘리는 것은 기록뿐 |
| `deny`일 때만 남기기 | 대조군이 없다. §할 일 ③ |

## 완료 조건

```
typecheck 통과 · smoke 306 → 309 이상 · front 291(변화 없음) · 실패 0 · verify exit 0
Kotlin: assembleRelease BUILD SUCCESSFUL
npx wrangler d1 migrations apply personal-os --local 성공
```

검사:

```
1  approve 판정에 ai_reason 이 실린다
2  deny 판정에 ai_reason 이 실린다
3  unavailable 이면 ai_reason 은 비고 ai_unavailable_reason 만 찬다   ← 3이 짝이다
4  ★ ai_reason 이 없는 판정을 올려도 행이 버려지지 않는다 (NULL 허용)
```

**4가 T-31의 교훈이다.** 새 칼럼을 필수로 만들면 옛 기기가 올리는 행이 400이 되고,
그 밤의 기록이 통째로 사라진다 — **관측을 늘리려다 관측을 잃는다.**

**변이**: `amendFire`에서 `reason`을 다시 버리면 1·2가 죽고 3은 산다.
셋이 다 죽으면 셋이 같은 것을 보고 있다는 뜻이다.

## 확인 절차 (사용자) — APK 설치 후

```powershell
npx wrangler d1 migrations apply personal-os --local
npx wrangler d1 migrations apply personal-os --remote
npm run deploy
```

```
□ 낮에 testNotify({level:4}) → guardEvents 의 ai_reason 에 문장이 들어 있다
□ 그 문장이 "왜 격상 안 했는지"를 실제로 말하는가   ← 여기서 ①·②가 갈리기 시작한다
```

---

## 보고 (담당이 채운다)

```
티켓: T-38
바꾼 파일: migrations/0017_ai_reason.sql (신규)
           src/db/index.ts              GuardEventRow.ai_reason · stInsertGuardEvent 한 칸
           src/services/guard.ts        aiReason() 헬퍼 · record()
           android/guard/GuardVerify.kt        Verdict.aiReason (ai·cache일 때만)
           android/guard/GuardEventQueue.kt    amendFire 인자 하나 + 큐에 담는다
           android/guard/GuardNotifications.kt v?.aiReason 을 넘긴다
           test/smoke.ts                스키마 목록 + 검사 7
           docs/api-surface.md          POST /api/guard/events 본문
기준선: typecheck 통과 · smoke 306 → 313 · front 291(변화 없음) · 실패 0 · verify exit 0
        Kotlin assembleRelease BUILD SUCCESSFUL (2m 16s) · [signing] release SHA-256 확인
        npx wrangler d1 migrations apply personal-os --local ✅
0017 이름 / smoke 스키마 목록: `0017_ai_reason.sql` · 넣었다(smoke.ts:19).
옛 기기 호환(4번): 검사 4가 ai_reason 없이 POST → 201 + 행 존재 + NULL.
        구조로도 막아 뒀다 — 칼럼에 NOT NULL도 CHECK도 없다(0017). 반대 방향(새 APK +
        옛 서버)도 안전하다: 옛 서버는 모르는 키를 그냥 무시한다(T-31이 이미 그 길로 갔다).
```

**검사가 넷이 아니라 일곱이다. 티켓의 변이 예상이 어긋나서다.**

티켓은 *"`amendFire`에서 `reason`을 다시 버리면 1·2가 죽는다"*고 적었는데 **1·2는 산다** —
그 셋은 서버로 직접 POST하므로 **기기가 무엇을 하든 초록이다.** 그런데 이 티켓이 고치는
결함이 정확히 그 자리다(서버는 보냈고 `GuardVerify`는 파싱했는데 `amendFire`가 안 날랐다).
**티켓이 정한 넷만으로는 같은 결함이 재발해도 아무것도 안 죽는다** — T-01의 교훈 그대로다.

그래서 **끊기는 자리를 직접 보는 검사**와 그 짝을 넣었다. 언어가 달라 타입이 이어 주지 않으므로
`0016`의 대장 검사(TS·SQL·Kotlin 셋 비교)와 같은 종류다.

⚠️ **스캐너는 주석을 걷어내고 본다.** 처음엔 안 그랬는데, 그러면 배선을 끊는 **가장 쉬운 방법**
(`// aiReason = ...`)이 검사를 그대로 통과한다.

**변이 셋을 실제로 돌렸다.**

| 변이 | 결과 |
|---|---|
| MUT-1 기기가 다시 버린다 (`aiReason = v?.aiReason` 주석) | **313 → 312/1.** 배선 검사만 죽고 `notif=false`로 **어느 쪽이 끊겼는지 말한다.** 1·2·3은 산다 — 이것이 검사를 일곱으로 늘린 이유다 |
| MUT-2 서버가 판정 없을 때도 싣는다 | **312/1** — 3번(`unavailable`이면 빈다)만 죽는다 |
| MUT-3 서버가 다시 버린다 (`ai_reason: null`) | **310/3** — 1·2·5가 죽고 **부재를 주장하는 3·4는 산다**(맞는 동작이다) |

**길이는 거부하지 않고 자른다(500자).** 모델이 쓴 문장이라 상한이 없고 개입 이력은 영구
보존인데, 400을 던지면 `flush()`가 **발동 행을 버린다** — 0016 주석이 말한 그 경로다.
검사 5가 700자를 넣어 500으로 잘리되 **행이 사는 것**을 본다.

**§할 일 ③(approve도 남긴다)은 검사 1이 지킨다.** 다만 실물에서는 `approve`가 아직 0이라
**대조군은 첫 승인이 나야 생긴다.** 그때 그 한 건이 가장 값진 기록이 된다는 티켓의 말 그대로다.
