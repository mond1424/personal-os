// 수집한 것을 제안으로 꺼낸다 (T-42 · ADR-030 본체 · ADR-037).
//
// T-41이 `collected_items`에 쌓는다. 여기는 **그중 곧 닥치는 것만 물어** 1탭으로 `events`에 넣는다.
//
// ★ **"마감"이라고 쓰지 않는다.** `DTSTART`가 마감 시각인지 아직 모른다(ADR-037 §실측의 ❌ 셋째) —
//   T-41이 칼럼을 `starts_at`이라 지은 것과 같은 이유다. `summary` 원문을 **다듬지 않고**
//   그대로 보여주고 그대로 `events.title`에 넣는다. 다듬는 순간 그것이 해석이고, 개강 첫날 틀린다.
import * as db from "../db";
import * as events from "./events";
import { isoNow } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/**
 * 앞으로 며칠 것까지 물을지 — **v1의 값이고 설계가 아니다**(T-42 결정 ①).
 *
 * 개강 첫 수집에 학기 전체가 들어온다(4월 실측이 주당 3~5건 · 창이 `+365일`). 넓히면
 * 첫 화면이 60건이 된다. **넓히는 것은 실사용이 요구할 때**이고, 2주 뒤 발표처럼
 * 미리 알아야 하는 것은 보호 규칙 제안(ADR-030의 나머지 절반)이 다룰 일이다.
 */
const WINDOW_DAYS = 7;

/**
 * 물어볼 것 — `state='new'`이고 `starts_at`이 `[지금, +7일]`인 것.
 *
 * **시계를 다시 읽지 않는다**(T-23·T-26). 창의 양 끝을 넘겨받은 `t.now`에서 만든다 —
 * 서비스가 자기 시계를 읽으면 `/api/admin/*`로 들어온 요청과 cron이 다른 '지금'을 본다.
 *
 * `starts_at`은 T-41이 **로컬 오프셋 표기로 정규화**해 둔 값이라 같은 오프셋끼리는
 * 문자열 비교가 시각 비교와 같다(`fired_at` 비교가 같은 성질에 기대고 있다).
 */
export async function pending(env: Env, t: TimeCtx) {
  const to = isoNow(Date.parse(t.now) + WINDOW_DAYS * 86400_000, t.offsetMin);
  const rows = await db.collectedPending(env, t.now, to);
  // 화면이 쓰는 것만 준다. **`description`은 안 보낸다** — 카드가 원문 한 줄만 쓴다.
  return rows.results.map((r) => ({
    id: r.id, source: r.source, summary: r.summary, starts_at: r.starts_at,
  }));
}

/**
 * 받아들인다 — `events` 행 하나를 만들고 그 id를 잇는다.
 *
 * ⚠️ **멱등이다.** 이미 `accepted`면 **`events`를 또 만들지 않고** 있던 것을 돌려준다.
 * 느린 네트워크에서 두 번 눌리는 것이 이 카드의 기본 조건이다(T-42 §할 일 ①).
 *
 * **보호 규칙은 붙이지 않는다** — 별개의 결정이고 ADR-030의 나머지 절반이다.
 */
export async function accept(env: Env, t: TimeCtx, id: string) {
  const row = await db.collectedGet(env, id);
  if (!row) throw new ApiError(404, "해당 항목이 없어요");

  if (row.state === "accepted" && row.event_id) {
    return { id: row.id, event_id: row.event_id, state: "accepted", duplicate: true };
  }
  if (!row.starts_at) throw new ApiError(400, "시각이 없어 일정으로 만들 수 없어요");

  // `2026-09-03T23:00:00+09:00` → date `2026-09-03` · time `23:00`.
  // **원문을 다듬지 않는다** — `title`은 `summary` 그대로다(결정 ②).
  const date = row.starts_at.slice(0, 10);
  const time = row.starts_at.slice(11, 16);
  const ev = await events.create(env, t, { title: row.summary, date, time });
  await db.stAcceptCollected(env, id, ev.id).run();
  return { id: row.id, event_id: ev.id, state: "accepted", duplicate: false };
}

/**
 * 거절한다. **다시 묻지 않는다** — `last_modified`가 바뀌어도 그대로다
 * (T-41의 `stTouchCollected`가 `state`를 안 건드린다). **거절한 것을 또 묻는 것이 잔소리다.**
 */
export async function dismiss(env: Env, id: string) {
  const row = await db.collectedGet(env, id);
  if (!row) throw new ApiError(404, "해당 항목이 없어요");
  await db.stDismissCollected(env, id).run();
  return { id, state: "dismissed" };
}
