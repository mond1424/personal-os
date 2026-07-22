import * as db from "../db";
import { nextId } from "../lib/id";
import { addDays, attributionOfIso, diffDays, isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

// 미루기 전용 상한: 오늘부터 2주 (7장). 미루기가 '무기한 연기'가 되지 않게 하는 장치이므로
// 신규 일정 지정(생성·대기 확정)에는 적용하지 않는다 — 시험처럼 먼 확정 일정도 넣을 수 있어야 한다.
const DEFER_RANGE = 14;

/** 미루기 대상 날짜 — 오늘~+14일, 그리고 원래 날짜보다 뒤. */
function assertDeferable(t: TimeCtx, date: string, minExclusive?: string) {
  if (!isDate(date)) throw new ApiError(400, "날짜 형식은 YYYY-MM-DD");
  const min = minExclusive && minExclusive >= t.d ? addDays(minExclusive, 1) : t.d;
  const max = addDays(t.d, DEFER_RANGE);
  if (date < min || date > max)
    throw new ApiError(400, `미룰 수 있는 날짜는 ${min} ~ ${max} (2주 이내)예요`);
}

/** 신규 일정 — 상한은 없고, 지나간 날짜만 막는다 (계획은 앞으로만 세운다). */
function assertSchedulable(t: TimeCtx, date: string) {
  if (!isDate(date)) throw new ApiError(400, "날짜 형식은 YYYY-MM-DD");
  if (date < t.d) throw new ApiError(400, "지난 날짜에는 일정을 넣을 수 없어요");
}

/** 빠른 추가: 제목만 → 대기(schedule:[]) · 날짜를 붙이면 첫 항목 (1.4) */
export async function createTask(
  env: Env, t: TimeCtx,
  input: { title?: string; period_id?: string | null; date?: string },
) {
  const title = input.title?.trim();
  if (!title) throw new ApiError(400, "title이 비어 있어요");
  if (input.period_id && !(await db.getPeriod(env, input.period_id)))
    throw new ApiError(404, "해당 기간이 없어요");

  const id = await nextId(env, "tasks", t.compact);
  const stmts = [db.stInsertTask(env, id, title, input.period_id ?? null, t.now)];
  if (input.date !== undefined) {
    assertSchedulable(t, input.date);
    stmts.push(db.stInsertEntry(env, id, input.date, t.now));
  }
  await env.DB.batch(stmts);
  return { id, title, waiting: input.date === undefined };
}

export async function getTask(env: Env, t: TimeCtx, id: string) {
  const stats = await db.taskStats(env, id);
  if (!stats) throw new ApiError(404, "해당 task가 없어요");
  const [entries, extensions] = await Promise.all([
    db.taskEntries(env, id),
    db.waitExtensions(env, id),
  ]);
  const age = stats.is_waiting
    ? diffDays(t.d, attributionOfIso(stats.wait_anchor_at, t.boundary)) + 1
    : null;
  return { ...stats, wait_age: age, entries: entries.results, extensions: extensions.results };
}

export async function updateTaskMeta(
  env: Env, id: string,
  patch: { title?: string; period_id?: string | null },
) {
  const cur = await db.taskStats(env, id);
  if (!cur) throw new ApiError(404, "해당 task가 없어요");
  const title = patch.title !== undefined ? patch.title.trim() : cur.title;
  if (!title) throw new ApiError(400, "title이 비어 있어요");
  const periodId = patch.period_id !== undefined ? patch.period_id : cur.period_id;
  if (periodId && !(await db.getPeriod(env, periodId))) throw new ApiError(404, "해당 기간이 없어요");
  await db.stUpdateTaskMeta(env, id, title, periodId).run();
  return { id, title, period_id: periodId }; // id 불변 — title만 자유 변경 (1.1)
}

/**
 * 미루기 (1.4) — 사용자 제스처는 하나, 저장은 두 갈래:
 *   · from이 아직 열린 날: 원 항목에 deferred_to 기록 + 새 항목 (한 batch)
 *   · from이 마감된 날(재배정 대기): 원 항목은 트리거로 얼어 있고,
 *     deferred_to 없는 채로 남는 것이 곧 Missed 기록의 보존이다 (1.2).
 *     새 항목만 추가한다 — 이월 횟수(항목 수 − 1)는 두 경우 모두 +1.
 */
export async function deferTask(
  env: Env, t: TimeCtx, id: string, from: string, to: string, rate?: number, reason?: string,
) {
  if (!isDate(from)) throw new ApiError(400, "from 형식은 YYYY-MM-DD");
  const entry = await db.taskEntryAt(env, id, from);
  if (!entry) throw new ApiError(404, `${from}에 이 task의 예정이 없어요`);
  if (entry.deferred_to) throw new ApiError(409, `이미 ${entry.deferred_to}로 미뤄졌어요`);
  const stats = await db.taskStats(env, id);
  if (stats?.status === "finished") throw new ApiError(409, "완료된 task는 미룰 수 없어요");
  assertDeferable(t, to, from); // to > from은 DB CHECK로도 이중 보장

  const fromDaily = await db.getDaily(env, from);
  const frozen = fromDaily?.status === "closed";
  // 완료율은 '미루는 순간'에 확정된다 — 그 예정일까지 얼마나 갔는지는 그때 알 수 있다.
  // 마감된 날(재배정)은 트리거가 수정을 막으므로 값이 와도 버린다.
  const setRate = !frozen && rate !== undefined;
  if (rate !== undefined && (!Number.isInteger(rate) || rate < 0 || rate > 100))
    throw new ApiError(400, "rate는 0~100 정수예요");
  const trimmedReason = reason?.trim();
  await env.DB.batch([
    ...(setRate ? [db.stSetRate(env, id, from, rate!)] : []),  // deferred 표시보다 먼저
    ...(frozen ? [] : [db.stMarkDeferred(env, id, from, to, t.now)]),
    db.stInsertEntry(env, id, to, t.now), // 새 예정 — rate는 0에서 시작 (v0.8)
    // 사유는 도착지(새 예정)에 남긴다 — insert 직후라야 그 행이 존재한다.
    ...(trimmedReason ? [db.stSetDeferReason(env, id, to, trimmedReason)] : []),
  ]);
  return { id, from, to, reassigned: frozen, rate: setRate ? rate : entry.rate, reason: trimmedReason || undefined };
}

/** 대기 → 일정 확정: 첫 항목 생성. 예정이 이미 있으면 미루기를 쓴다. */
export async function scheduleTask(env: Env, t: TimeCtx, id: string, date: string) {
  const stats = await db.taskStats(env, id);
  if (!stats) throw new ApiError(404, "해당 task가 없어요");
  if (stats.status === "finished") throw new ApiError(409, "완료된 task예요");
  if (!stats.is_waiting)
    throw new ApiError(409, "이미 예정이 있는 task예요 — 이동은 미루기(defer)로");
  assertSchedulable(t, date);
  await db.stInsertEntry(env, id, date, t.now).run();
  return { id, date };
}

/** 대기 연장 (v0.8): 앵커 = 지금. 이력은 트리거가 wait_extensions에 자동 기록. */
export async function extendWait(env: Env, t: TimeCtx, id: string) {
  const stats = await db.taskStats(env, id);
  if (!stats) throw new ApiError(404, "해당 task가 없어요");
  if (!stats.is_waiting || stats.status === "finished")
    throw new ApiError(409, "대기 중인 task만 연장할 수 있어요");
  await db.stExtendWait(env, id, t.now).run();
  return { id, anchor: t.now, deadline: addDays(t.d, 21) };
}

/**
 * 완료: status·귀속일 확정 + 살아 있는 항목의 다이얼을 100으로.
 *
 * 완료를 누른 날(finished_on = 오늘의 귀속일)과 그 일의 예정일은 다를 수 있다.
 * 예전에는 '오늘 날짜의 항목'만 100으로 올려서, 예정일이 내일 이후거나 이미 미뤄진 경우
 * "완료인데 진행률 0%"라는 모순 상태가 남았다. 이제는 마지막 live 항목에 붙인다.
 * 단 그 날이 이미 마감됐다면 건드리지 않는다 — 지난 기록은 불변(1.3).
 */
export async function completeTask(env: Env, t: TimeCtx, id: string) {
  const stats = await db.taskStats(env, id);
  if (!stats) throw new ApiError(404, "해당 task가 없어요");
  if (stats.status === "finished") throw new ApiError(409, "이미 완료된 task예요");
  const live = await db.liveEntry(env, id);
  const stmts = [db.stFinishTask(env, id, t.now, t.d)];
  if (live && live.day_status !== "closed") stmts.unshift(db.stRate100At(env, id, live.date));
  await env.DB.batch(stmts);
  return {
    id, finished_on: t.d,
    planned_on: live?.date ?? null,
    rate_applied: !!live && live.day_status !== "closed",
  };
}

const shortDate = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;

/**
 * task 삭제 — 계획의 취소. 마감된 날의 항목이 하나라도 있으면 거부한다 (1.3 불변성):
 * 지나간 기록은 지우는 게 아니라 완료/미룸으로 남긴다.
 *
 * 거부할 때는 **무엇이 막는지 이름을 붙여** 돌려준다. "다른 기록이 참조하고 있어요"는
 * 사용자가 손쓸 수 없는 문장이다 — 어느 날의 기록인지 알아야 완료로 남길지 그대로 둘지 고른다.
 *
 * 반대로 막을 이유가 없으면 부속 기록(연장 이력)까지 함께 지운다. 예전에는 이걸 빼먹어
 * FK 제약이 대신 걸리면서, 한 번이라도 연장한 task 는 영영 취소되지 않았다 (0005).
 */
export async function deleteTask(env: Env, id: string) {
  const task = await db.taskStats(env, id);
  if (!task) throw new ApiError(404, "해당 task가 없어요");

  const [closed, guard] = await Promise.all([
    db.closedEntryDates(env, id),
    db.guardEventCount(env, id),
  ]);
  const dates = closed.results.map((r) => r.date);
  if (dates.length) {
    const head = dates.slice(0, 3).map(shortDate).join(" · ");
    const rest = dates.length > 3 ? ` 외 ${dates.length - 3}일` : "";
    throw new ApiError(409,
      `${head}${rest} — 이미 마감된 날의 기록이 이 일을 참조해요. ` +
      `지난 기록은 지울 수 없으니(1.3) 완료로 남기거나 그대로 두세요`);
  }
  if ((guard?.n ?? 0) > 0)
    throw new ApiError(409,
      `Guard 개입 기록 ${guard!.n}건이 이 일을 참조해요 — 개입 이력은 지울 수 없어요`);

  await env.DB.batch([
    db.stDeleteExtensions(env, id), // 대기 연장 이력 — 마감 기록이 없을 때만 트리거가 허용
    db.stDeleteEntries(env, id),
    db.stDeleteTask(env, id),
  ]);
  return { id, deleted: true };
}

export async function setRate(env: Env, id: string, date: string, rate: number) {
  if (!Number.isInteger(rate) || rate < 0 || rate > 100)
    throw new ApiError(400, "rate는 0~100 정수예요");
  const res = await db.stSetRate(env, id, date, rate).run();
  if (!res.meta.changes) throw new ApiError(404, "해당 날짜의 (미이동) 예정이 없어요");
  return { id, date, rate };
}

export async function segment(env: Env, t: TimeCtx, name: string) {
  switch (name) {
    case "scheduled": return (await db.worksScheduled(env, t.d)).results;
    case "waiting":
      return (await db.waitingList(env)).results
        .map((w) => ({ ...w, age: diffDays(t.d, attributionOfIso(w.wait_anchor_at, t.boundary)) + 1 }))
        .sort((a, b) => b.age - a.age);
    case "deferring": return (await db.worksDeferring(env)).results;
    case "periods":   return (await db.worksByPeriod(env)).results;
    case "done":      return (await db.worksDone(env)).results;
    default: throw new ApiError(404, "세그먼트: scheduled | waiting | deferring | periods | done");
  }
}
