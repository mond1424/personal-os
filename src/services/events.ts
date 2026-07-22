// 일정(event) — 캘린더 전용. 완료율·미루기가 없는 '사건'.
import * as db from "../db";
import { nextId } from "../lib/id";
import { isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

const isTime = (v: unknown) => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function parse(input: any, partial = false) {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined || !partial) {
    if (typeof input.title !== "string" || !input.title.trim()) throw new ApiError(400, "제목이 필요해요");
    if (input.title.length > 200) throw new ApiError(400, "제목은 200자 이내로");
    out.title = input.title.trim();
  }
  if (input.date !== undefined || !partial) {
    if (!isDate(input.date)) throw new ApiError(400, "날짜 형식은 YYYY-MM-DD");
    out.date = input.date;
  }
  if (input.time !== undefined) {
    if (input.time !== null && !isTime(input.time)) throw new ApiError(400, "시각 형식은 HH:MM");
    out.time = input.time;
  }
  if (input.period_id !== undefined) out.period_id = input.period_id || null;
  if (input.note !== undefined) out.note = input.note || null;
  return out;
}

export async function create(env: Env, t: TimeCtx, input: any) {
  const v = parse(input) as { title: string; date: string; time?: string | null };
  const id = await nextId(env, "events", t.compact);
  await db.stInsertEvent(env, id, v.title, v.date,
    (v.time ?? null) as string | null,
    (input.period_id || null), (input.note || null), t.now).run();
  return { id, ...v };
}

export async function update(env: Env, id: string, input: any) {
  const cur = await db.eventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 일정이 없어요");
  const v = parse(input, true);
  const next = { ...cur, ...v };
  await db.stUpdateEvent(env, id, next.title as string, next.date as string,
    (next.time ?? null) as string | null, (next.period_id ?? null) as string | null,
    (next.note ?? null) as string | null).run();
  return { ...next, id };
}

export async function remove(env: Env, id: string) {
  const cur = await db.eventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 일정이 없어요");
  await db.stDeleteEvent(env, id).run();
  return { id, deleted: true };
}
