// 수집한 것을 제안으로 꺼낸다 (T-42 · ADR-030 본체 · ADR-037).
//
// T-41이 `collected_items`에 쌓는다. 여기는 **그중 곧 닥치는 것만 물어** 1탭으로 `events`에 넣는다.
//
// ★ **"마감"이라고 쓰지 않는다.** `DTSTART`가 마감 시각인지 아직 모른다(ADR-037 §실측의 ❌ 셋째) —
//   T-41이 칼럼을 `starts_at`이라 지은 것과 같은 이유다. `summary` 원문을 **다듬지 않고**
//   그대로 보여주고 그대로 `events.title`에 넣는다. 다듬는 순간 그것이 해석이고, 개강 첫날 틀린다.
import * as db from "../db";
import * as events from "./events";
import * as uclass from "./uclass";
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
 * 수집이 돌았는지 사람이 볼 수 있게 한다 (T-43).
 *
 * ★ **T-33의 §금지와 충돌하지 않는다 — 구별이 여기 있다.**
 *   T-33이 실패를 숨기라 한 근거는 *"사용자가 할 수 있는 일이 없다"*였다(Guard 조회 실패).
 *   **수집 실패는 할 일이 있다** — 토큰이 만료됐으면 다시 넣어야 한다.
 *   **행동이 가능한 실패는 보인다.** 이 문단이 없으면 다음 사람이 T-33을 근거로 이 화면을 지운다.
 *
 * ⚠️ **URL·토큰을 싣지 않는다.** 그 값 자체가 열쇠다(ADR-037 §근거 ④) — 상태만이다.
 *   `configured`는 **있다/없다**만 말한다.
 *
 * `pending`에 섞지 않고 엔드포인트를 가른 이유: `pending`은 7일 창이고 이것은 원장 전체다.
 * 한 응답에 두 시야를 담으면 **읽는 쪽이 어느 쪽 0인지 모른다** — 그게 이 티켓의 증상이었다.
 */
export async function status(env: Env, t: TimeCtx) {
  const s = Object.fromEntries(
    (await db.settingsAll(env)).results.map((r) => [r.key, r.value]),
  );
  const lastAt = s[uclass.K_LAST] || null;

  // T-41이 `${시각} ${사유}` 한 줄로 남긴다. 시각에 공백이 없으므로 첫 공백이 경계다.
  const err = (s[uclass.K_ERROR] ?? "").trim();
  const cut = err.indexOf(" ");
  const errAt = err && cut > 0 ? err.slice(0, cut) : null;
  const reason = err ? (cut > 0 ? err.slice(cut + 1) : err) : null;

  // ★ **`last_seen_count`가 이 티켓의 본체다.** 없으면(한 번도 안 돌았으면) `null`이지 0이 아니다 —
  //   0은 *"목록이 비어 있었다"*이고 그것은 방학의 정상이다.
  const seenRaw = s[uclass.K_SEEN];
  const seen = seenRaw != null && seenRaw !== "" && Number.isFinite(Number(seenRaw))
    ? Number(seenRaw) : null;

  const counts = { new: 0, accepted: 0, dismissed: 0 };
  for (const row of (await db.collectedCountsByState(env)).results) {
    if (row.state in counts) counts[row.state as keyof typeof counts] = row.n;
  }

  const lastMs = Date.parse(lastAt ?? "");
  return {
    configured: !!env.UCLASS_ICAL_URL?.trim(),
    last_collect_at: lastAt,
    // 한 번도 안 돌았으면 `null`. 마지막 시도가 실패였으면 그 사유(성공하면 T-41이 지운다).
    last_result: reason ?? (lastAt ? "ok" : null),
    last_error_at: errAt,
    last_seen_count: seen,
    counts,
    next_earliest_at: Number.isFinite(lastMs)
      ? isoNow(lastMs + uclass.COLLECT_INTERVAL_MS, t.offsetMin) : null,
  };
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
