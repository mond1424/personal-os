import * as db from "../db";
import { nextId } from "../lib/id";
import { diffDays, isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

const COLOR = /^#[0-9A-Fa-f]{6}$/;

function validate(p: { title?: string; start_date?: string; end_date?: string; color?: string; goals?: unknown }) {
  if (p.title !== undefined && !p.title.trim()) throw new ApiError(400, "title이 비어 있어요");
  for (const k of ["start_date", "end_date"] as const)
    if (p[k] !== undefined && !isDate(p[k])) throw new ApiError(400, `${k} 형식은 YYYY-MM-DD`);
  if (p.color !== undefined && !COLOR.test(p.color)) throw new ApiError(400, "color는 #RRGGBB");
  if (p.goals !== undefined && !(Array.isArray(p.goals) && p.goals.every((g) => typeof g === "string")))
    throw new ApiError(400, "goals는 문자열 배열이에요");
}

/** 목록 = 카드 데이터: 달성률(뷰) + 경과일(파생, 여기서 계산 — 저장 없음). */
export async function listPeriods(env: Env, t: TimeCtx) {
  const rows = await db.periodCards(env);
  return rows.results.map((p) => ({
    ...p,
    goals: JSON.parse(p.goals) as string[],
    total_days: diffDays(p.end_date, p.start_date) + 1,
    elapsed_days: Math.min(
      Math.max(diffDays(t.d, p.start_date) + 1, 0),
      diffDays(p.end_date, p.start_date) + 1,
    ),
    d_start: diffDays(p.start_date, t.d), // 양수 = D-n
  }));
}

export async function createPeriod(
  env: Env, t: TimeCtx,
  input: { title: string; start_date: string; end_date: string; color: string; goals?: string[] },
) {
  validate(input);
  if (!input.title || !input.start_date || !input.end_date || !input.color)
    throw new ApiError(400, "title · start_date · end_date · color는 필수예요");
  if (input.start_date > input.end_date) throw new ApiError(400, "start는 end보다 앞이어야 해요");
  const id = await nextId(env, "periods", t.compact);
  await db.stInsertPeriod(env, {
    id, title: input.title.trim(), start_date: input.start_date, end_date: input.end_date,
    color: input.color, goals: JSON.stringify(input.goals ?? []), created_at: t.now,
  }).run();
  return { id };
}

export async function getPeriodDetail(env: Env, id: string) {
  const p = await db.getPeriod(env, id);
  if (!p) throw new ApiError(404, "해당 기간이 없어요");
  return { ...p, goals: JSON.parse(p.goals) as string[] };
}

/** 기간은 상태(state) — 편집 가능. 기록(daily)과 달리 불변 대상이 아니다. */
export async function updatePeriod(
  env: Env, id: string,
  patch: { title?: string; start_date?: string; end_date?: string; color?: string; goals?: string[] },
) {
  const cur = await db.getPeriod(env, id);
  if (!cur) throw new ApiError(404, "해당 기간이 없어요");
  validate(patch);
  const next = {
    ...cur,
    ...(patch.title !== undefined && { title: patch.title.trim() }),
    ...(patch.start_date !== undefined && { start_date: patch.start_date }),
    ...(patch.end_date !== undefined && { end_date: patch.end_date }),
    ...(patch.color !== undefined && { color: patch.color }),
    ...(patch.goals !== undefined && { goals: JSON.stringify(patch.goals) }),
  };
  if (next.start_date > next.end_date) throw new ApiError(400, "start는 end보다 앞이어야 해요");
  await db.stUpdatePeriod(env, next).run();
  return { id };
}

/** 삭제 — task가 참조 중이면 FK가 거부한다 (그대로 409로 노출). */
export async function deletePeriod(env: Env, id: string) {
  const res = await db.stDeletePeriod(env, id).run();
  if (!res.meta.changes) throw new ApiError(404, "해당 기간이 없어요");
  return { id };
}
