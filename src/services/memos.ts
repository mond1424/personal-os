// memo (1.3) — 마감 후 유일하게 열린 추가 통로. 수정·삭제 없음(트리거).
// 추가 시 그 날짜를 덮는 summary는 stale → lazy 재생성 (4장).
import * as db from "../db";
import { nextId } from "../lib/id";
import { isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

export async function addMemo(
  env: Env, t: TimeCtx,
  input: { date: string; ts?: string; text: string },
) {
  if (!isDate(input.date)) throw new ApiError(400, "date 형식은 YYYY-MM-DD");
  if (!input.text?.trim()) throw new ApiError(400, "text가 비어 있어요");
  if (!(await db.getDaily(env, input.date)))
    throw new ApiError(404, "그 날의 일기가 없어요 — memo는 기존 기록에만 붙어요");

  const id = await nextId(env, "memos", t.compact);
  await env.DB.batch([
    db.stInsertMemo(env, id, input.date, input.ts ?? t.now, input.text.trim(), t.now),
    db.stStaleSummary(env, "daily", input.date),
    // weekly·monthly stale 연쇄는 키 규약과 함께 구현 2에서 (4장)
  ]);
  return { id, date: input.date };
}
