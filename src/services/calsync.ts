// 폰 캘린더 → personal-os 미러 (T-52 · ADR-029).
//
// 기기가 **창 범위의 일정 전부**를 한 번에 보내고, 서버가 `events`를 그 상태에 맞춘다.
// 읽기 방향만이다 — 쓰기(앱 → 캘린더)는 9월이고, 그때까지 갈라짐을 물리적으로 차단한다.
import * as db from "../db";
import { nextId } from "../lib/id";
import { isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/** 기기 캘린더 미러의 출처 이름. `events.ext_src`에 그대로 들어간다. */
export const CAL_SRC = "devcal";

const isTime = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

export interface CalItem {
  ext_uid: string;
  title: string;
  date: string;
  time?: string | null;
  all_day?: boolean;
  ext_updated?: string | null;
}

/**
 * 한 항목을 서버가 받아들일 모양으로 만든다.
 *
 * ⚠️ **귀속일을 재계산하지 않는다**(ADR-029). 캘린더의 벽시계 날짜 그대로 쓴다 —
 *    일정과 보호 판정은 벽시계의 것이고, 새벽 경계는 *기록*의 개념이다.
 * ⚠️ **`protect_*`는 받지 않는다.** 앱 전용이라 캘린더가 덮으면 안 된다.
 */
function parseItem(raw: any): CalItem {
  const uid = typeof raw?.ext_uid === "string" ? raw.ext_uid.trim() : "";
  if (!uid) throw new ApiError(400, "ext_uid가 필요해요");
  if (uid.length > 300) throw new ApiError(400, "ext_uid가 너무 길어요");
  if (typeof raw?.title !== "string" || !raw.title.trim()) throw new ApiError(400, `${uid}: 제목이 필요해요`);
  if (!isDate(raw?.date)) throw new ApiError(400, `${uid}: 날짜 형식은 YYYY-MM-DD`);

  // 종일이면 시각이 없다. 둘이 함께 오면 **종일이 이긴다** — 캘린더 쪽이 종일이라 말한 것이 사실이다.
  const time = raw?.all_day === true ? null
    : (raw?.time === undefined || raw?.time === null) ? null
      : isTime(raw.time) ? (raw.time as string)
        : (() => { throw new ApiError(400, `${uid}: 시각 형식은 HH:MM`); })();

  const updated = typeof raw?.ext_updated === "string" && raw.ext_updated.trim()
    ? raw.ext_updated.trim() : null;

  return { ext_uid: uid, title: raw.title.trim().slice(0, 200), date: raw.date, time, ext_updated: updated };
}

/**
 * 창 범위를 통째로 맞춘다 — **멱등**이다. 같은 것을 두 번 보내면 한 행이다.
 *
 * ★ **응답이 "무엇을 안 했는지"를 세어 돌려준다.** 0건과 실패가 구별되지 않으면
 *   동기화가 절반만 도는 밤에 아무도 모른다(T-43이 `last_seen_count`로 세운 자리와 같다).
 */
export async function syncCal(env: Env, t: TimeCtx, input: any) {
  const from = input?.window?.from;
  const to = input?.window?.to;
  if (!isDate(from) || !isDate(to)) throw new ApiError(400, "window.from·to가 필요해요 (YYYY-MM-DD)");
  if (from > to) throw new ApiError(400, "window.from이 to보다 뒤예요");
  if (!Array.isArray(input?.items)) throw new ApiError(400, "items 배열이 필요해요");
  if (input.items.length > 2000) throw new ApiError(400, "한 번에 2000건까지예요");

  const items = (input.items as any[]).map(parseItem);

  // ★ **마감된 날은 동기화에서 영구 이탈한다**(ADR-029: "열린 날은 캘린더와 공유하는 현재,
  //   마감된 날은 personal-os만의 과거"). `events`엔 `_ins` 트리거가 없어(함정 6)
  //   **DB가 안 막아 준다 — 여기가 유일한 방어선이다.**
  //   ⚠️ UPDATE·DELETE는 트리거가 막지만, 그건 409로 배치를 통째로 깨는 모양이라
  //      **어느 쪽이든 서버가 먼저 판단해서 건너뛴다.**
  const closed = new Set(
    (await db.closedDaysIn(env, from, to)).results.map((r) => r.date),
  );

  let upserted = 0, skippedClosed = 0, skippedStale = 0, deleted = 0, protectedKept = 0;
  const seen = new Set<string>();

  for (const it of items) {
    seen.add(it.ext_uid);

    // 창 밖의 항목은 이 요청의 관할이 아니다 — 삭제 판단도 창 안에서만 한다.
    if (it.date < from || it.date > to) continue;
    if (closed.has(it.date)) { skippedClosed++; continue; }

    // **날짜가 아니라 uid로** 찾는다. 캘린더에서 날짜를 옮기면 옛 행이 다른 날에 있다.
    const cur = await db.eventByExt(env, CAL_SRC, it.ext_uid);

    if (!cur) {
      const id = await nextId(env, "events", t.compact);
      await db.stInsertExtEvent(
        env, id, it.title, it.date, it.time ?? null,
        CAL_SRC, it.ext_uid, it.ext_updated ?? null, t.now,
      ).run();
      upserted++;
      continue;
    }

    // 옛 자리가 마감된 날이면 트리거가 UPDATE를 막는다 — 옮겨 오지 않는다.
    if (closed.has(cur.date)) { skippedClosed++; continue; }

    // ★ LWW — 저장된 것보다 **오래된** 갱신은 무시한다. 해소 UI는 없다(ADR-029).
    //   기준이 없던 행(`ext_updated IS NULL`)은 비교할 것이 없으므로 그냥 받는다.
    if (it.ext_updated && cur.ext_updated && it.ext_updated < cur.ext_updated) {
      skippedStale++;
      continue;
    }

    await db.stUpdateExtEvent(
      env, cur.id, it.title, it.date, it.time ?? null, it.ext_updated ?? cur.ext_updated ?? null,
    ).run();
    upserted++;
  }

  // ── 삭제 — 유령을 남기지 않되 이력은 지킨다 ──────────────────
  //
  // ★ **후보 집합이 `ext_src = 'devcal'`로 시작한다**(`extEventsInWindow`).
  //   앱이 만든 일정(`ext_src IS NULL`)은 **여기 아예 안 들어온다** — 창 안이어도 마찬가지다.
  //   조건을 아래 `if`로 두면 그 한 줄을 지우는 순간 사용자의 일정이 지워진다.
  const mirrored = await db.extEventsInWindow(env, CAL_SRC, from, to);
  for (const row of mirrored.results) {
    if (seen.has(row.ext_uid)) continue;              // 이번에도 온 것 — 살아 있다
    if (closed.has(row.date)) { skippedClosed++; continue; }   // 마감된 날은 안 건드린다

    // 개입 이력이 참조하면 **지우지 않는다**(guard_events는 영구 보존이고 FK가 걸려 있다).
    // 대신 보호만 푼다 — 캘린더에서 사라진 일정으로 새 알람이 잡히면 안 된다.
    const refs = await db.guardCountByEvent(env, row.id);
    if ((refs?.n ?? 0) > 0) {
      if (row.protect_from !== null) await db.stSetProtect(env, row.id, null, null, null, null).run();
      protectedKept++;
      continue;
    }

    await db.stDeleteEvent(env, row.id).run();
    deleted++;
  }

  return {
    upserted,
    skipped_closed: skippedClosed,
    skipped_stale: skippedStale,
    deleted,
    protected_kept: protectedKept,
    window: { from, to },
  };
}
