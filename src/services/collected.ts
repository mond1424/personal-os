// T-97 · ADR-050: 수집 원장과 상태 조회는 보존하고 신규 수락 경로는 종료한다.
import * as db from "../db";
import * as uclass from "./uclass";
import { isoNow } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

const RETIRED_MESSAGE = "과제는 Tasks.org에서 관리해요. pOS는 새 과제를 받지 않으며 기존 기록은 남아요.";

// 옛 웹이 배열을 순회하는 계약은 유지한다. 원장 조회·변경은 하지 않는다.
export async function pending(_env: Env, _t: TimeCtx): Promise<never[]> { return []; }
export async function list(_env: Env): Promise<never[]> { return []; }

// URL·토큰을 노출하지 않고 실제 원장 건수와 수집 관측을 반환한다.
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

// 이름 규칙은 기존 이력·순수 함수 검사에 남긴다. 새 기록을 만드는 경로는 없다.
const DEADLINE_SUFFIX = "기한";
export function titleOf(summary: string): string {
  const s = summary.trim();
  if (!s.endsWith(DEADLINE_SUFFIX)) return summary;                 // 끝이 아니면 한 글자도 안 바꾼다
  return s.slice(0, -DEADLINE_SUFFIX.length).trim() || summary;     // 떼면 비는 제목은 원문을 쓴다
}

export async function accept(_env: Env, _t: TimeCtx, _id: string, _choice?: string): Promise<never> {
  throw new ApiError(410, RETIRED_MESSAGE);
}

export async function dismiss(_env: Env, _id: string): Promise<never> {
  throw new ApiError(410, RETIRED_MESSAGE);
}
