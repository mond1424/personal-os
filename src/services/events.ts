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

/**
 * 보호 규칙 부착·해제 (설계 §6.2 사전 서약).
 *
 * 일정 본문 수정과 **분리한다** — `stUpdateEvent`를 타면 마감된 날 트리거에 걸린다.
 * 보호 규칙은 '기록'이 아니라 '계획'이므로 마감과 무관하게 붙일 수 있어야 한다.
 * 데드라인은 저장하지 않는다 — 조회 시 역산한다(원칙 4, guard.schedule).
 */
export async function setProtect(env: Env, id: string, input: any) {
  const cur = await db.eventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 일정이 없어요");

  if (input?.protect === false || input?.protect_from === null) {
    await db.stSetProtect(env, id, null, null, null, null).run();
    return { id, protected: false };
  }

  const from = input?.protect_from ?? "-1d 00:00";
  if (typeof from !== "string" || !/^([+-]?\d+)d\s+([01]\d|2[0-3]):([0-5]\d)$/.test(from.trim())) {
    throw new ApiError(400, "protect_from 형식은 '-1d 00:00' (일정 기준 상대)");
  }
  const level = input?.protect_level === undefined ? 4 : Number(input.protect_level);
  if (!Number.isInteger(level) || level < 1 || level > 4) {
    throw new ApiError(400, "protect_level은 1~4");
  }
  const num = (v: unknown, name: string) => {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 24 * 60) throw new ApiError(400, `${name}은 0~1440분`);
    return n;
  };
  const sleep = num(input?.protect_sleep_min, "protect_sleep_min");
  const prep = num(input?.protect_prep_min, "protect_prep_min");

  await db.stSetProtect(env, id, from.trim(), level, sleep, prep).run();
  return {
    id, protected: true,
    protect_from: from.trim(), protect_level: level,
    protect_sleep_min: sleep, protect_prep_min: prep,
  };
}

export async function remove(env: Env, id: string) {
  const cur = await db.eventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 일정이 없어요");
  await db.stDeleteEvent(env, id).run();
  return { id, deleted: true };
}
