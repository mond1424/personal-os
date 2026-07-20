// Log · Feelings · score · 마감은 전부 daily 생명주기 하나의
// 트랜잭션 질서(기록 → 물화 → close) 안에 있다 — 그래서 한 서비스다.
import * as db from "../db";
import { ApiError, type Env, type TimeCtx } from "../types";
import { attributionOfIso, diffDays } from "../lib/time";
import { callClaude, parseModelJson } from "../lib/ai";

const WAIT_LIMIT = 21; // 1.4 대기 최대 체류

/** Today 탭 한 화면의 조인 조립 (7장) — 파생은 전부 여기서 계산, 저장 없음. */
export async function assembleToday(env: Env, t: TimeCtx) {
  const [todo, done, reassign, waiting, daily, feelings, logs, periods] = await Promise.all([
    db.todayTodo(env, t.d),
    db.todayDone(env, t.d),
    db.reassignQueue(env, t.d),
    db.waitingList(env),
    db.getDaily(env, t.d),
    db.feelingsAt(env, t.d),
    db.logsAt(env, t.d),
    db.periodsAt(env, t.d), // 오늘을 포함하는 활성 기간 → 헤더 칩
  ]);
  // 대기 일수 = 귀속일 기준 경과 + 1 ("n일째"). 경계 이전의 새벽 연장도 어긋나지 않는다.
  const waitRows = waiting.results
    .map((w) => ({ ...w, age: diffDays(t.d, attributionOfIso(w.wait_anchor_at, t.boundary)) + 1 }))
    .sort((a, b) => b.age - a.age);
  const overdue = waitRows.filter((w) => w.age > WAIT_LIMIT);
  return {
    date: t.d,
    boundary: t.boundary,
    daily: daily ?? null, // null = 아직 첫 입력 없음 (행 없음 = 건너뛴 날)
    periods: periods.results.map((p) => ({
      ...p,
      d_start: diffDays(p.start_date, t.d), // 음수 = 시작 후 경과
      d_end: diffDays(p.end_date, t.d),
    })),
    todo: todo.results,
    done: done.results,
    reassign: reassign.results, // 재배정 대기 — Todo 아래 행 (1.2)
    waiting: {
      n: waitRows.length,
      max_age: waitRows[0]?.age ?? null,
      top: waitRows[0] ?? null, // 상시 행: "대기 n — 최장 항목 n일째"
      limit: WAIT_LIMIT,
    },
    overdue, // 21일 초과 → 차단 팝업 대상 (최장 순)
    feelings: feelings.results,
    logs: logs.results,
  };
}

/** 그날 첫 입력 직전의 하루 열기(C) — 쓰기 batch 맨 앞에 끼워 넣는다. */
const opened = (env: Env, t: TimeCtx) => db.stOpenDaily(env, t.d, t.now);

export async function addLog(env: Env, t: TimeCtx, text: string, ts?: string) {
  if (!text?.trim()) throw new ApiError(400, "text가 비어 있어요");
  await env.DB.batch([opened(env, t), db.stInsertLog(env, t.d, ts ?? t.now, text.trim(), t.now)]);
  return { date: t.d };
}

/** 타임스탬프·내용 수정 — 마감 전만 (마감 후엔 트리거가 409로 거부). */
export async function editLog(env: Env, id: number, patch: { ts?: string; text?: string }) {
  const row = await db.getLog(env, id);
  if (!row) throw new ApiError(404, "해당 Log가 없어요");
  const ts = patch.ts ?? row.ts;
  const text = (patch.text ?? row.text).trim();
  if (!text) throw new ApiError(400, "text가 비어 있어요");
  await db.stUpdateLog(env, id, ts, text).run();
  return { id, date: row.date };
}

export async function setFeelings(env: Env, t: TimeCtx, values: Record<string, number>) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) throw new ApiError(400, "values가 비어 있어요");
  for (const [f, v] of entries) {
    if (typeof v !== "number" || v < 1 || v > 10) throw new ApiError(400, `${f}: 1~10 범위여야 해요`);
  }
  await env.DB.batch([
    opened(env, t),
    ...entries.map(([f, v]) => db.stUpsertFeeling(env, t.d, f, v, "scale")),
  ]);
  return { date: t.d, fields: entries.map(([f]) => f) };
}

export async function setFeelingsText(env: Env, t: TimeCtx, text: string) {
  await env.DB.batch([opened(env, t), db.stSetFeelingsText(env, t.d, text ?? "")]);
  return { date: t.d }; // 분류 결과의 원본 편입은 마감 시 확정 (1.5)
}

/**
 * 1.5 manual 모드 분류 — 소형 모델(low). 서술 → 필드 점수.
 * 마감 시 자동 호출되며(확정), 사용자가 미리 보고 싶으면 수동 호출도 가능하다.
 * 분류 결과는 source='ai'로 들어가 눈금 입력(scale)과 구분된다.
 */
export async function classifyFeelings(env: Env, t: TimeCtx, date?: string) {
  const d = date ?? t.d;
  const daily = await db.getDaily(env, d);
  const text = daily?.feelings_text?.trim();
  if (!text) throw new ApiError(400, "분류할 서술이 없어요");

  const settings = Object.fromEntries((await db.settingsAll(env)).results.map((r) => [r.key, r.value]));
  let fields: string[] = [];
  try { fields = JSON.parse(settings.feelings_fields ?? "[]"); } catch { fields = []; }
  if (!fields.length) fields = ["energy", "stress", "focus"];
  const model = settings.model_low ?? "claude-haiku-4-5-20251001";

  const out = await callClaude(env, {
    model, maxTokens: 300,
    system:
      "너는 짧은 한국어 상태 서술을 심리 척도 점수로 변환하는 분류기다. " +
      `필드: ${fields.join(", ")}. 각 필드를 1~10 정수로 매긴다(1=매우 낮음, 10=매우 높음). ` +
      "서술에 근거가 없는 필드는 5로 둔다. JSON 객체만 출력하고 다른 말은 하지 않는다.",
    user: text,
  });
  const parsed = parseModelJson<Record<string, number>>(out);
  if (!parsed) throw new ApiError(502, "분류 결과를 해석하지 못했어요");

  const values: Record<string, number> = {};
  for (const f of fields) {
    const v = Number(parsed[f]);
    if (Number.isFinite(v)) values[f] = Math.min(10, Math.max(1, Math.round(v)));
  }
  if (!Object.keys(values).length) throw new ApiError(502, "분류 결과가 비어 있어요");

  await env.DB.batch(Object.entries(values).map(([f, v]) => db.stUpsertFeeling(env, d, f, v, "ai")));
  return { date: d, values, model };
}

export async function setScore(env: Env, t: TimeCtx, score: number) {
  if (!Number.isInteger(score) || score < 1 || score > 10)
    throw new ApiError(400, "score는 1~10 정수예요");
  await env.DB.batch([opened(env, t), db.stSetScore(env, t.d, score)]);
  return { date: t.d, score };
}

/**
 * 하루 마감 (G) — 순서 고정: 기록은 이미 끝 → mech 물화 → close.
 * close 이후 그날의 모든 원본이 트리거로 동결된다.
 * 마감 순간 남은 todo는 missed로 확정된다 (1.2).
 */
export async function closeDay(env: Env, t: TimeCtx, kind: "manual" | "brief" | "auto", date?: string) {
  const d = date ?? t.d;
  const existing = await db.getDaily(env, d);
  if (existing?.status === "closed") throw new ApiError(409, `${d}는 이미 마감됐어요`);

  // 1.5 — manual 서술은 마감 시 분류가 확정되어 원본에 편입된다.
  // 실패(키 없음·모델 오류)해도 마감 자체를 막지는 않는다: 기록의 봉인이 우선.
  if (existing?.feelings_text?.trim()) {
    const already = await db.feelingsAt(env, d);
    if (!already.results.length) {
      try { await classifyFeelings(env, t, d); } catch { /* 분류 실패 — 마감은 계속 */ }
    }
  }

  const mech = await buildMech(env, d, existing);
  await env.DB.batch([
    db.stOpenDaily(env, d, t.now),               // 행이 없던 날(간략 마감 등)도 안전하게
    db.stUpsertMech(env, "daily", d, mech, t.now),
    db.stCloseDaily(env, d, kind, t.now),
  ]);
  return { date: d, kind };
}

/** 마감 시점 파생 섹션 + 필드값의 물화 (4장 daily summary의 기계적 층위). */
async function buildMech(env: Env, d: string, daily: db.DailyRow | null | undefined) {
  const [cls, feelings] = await Promise.all([db.classifyAt(env, d), db.feelingsAt(env, d)]);
  const pick = (c: string) =>
    cls.results.filter((r) => r.class === c).map((r) => ({ id: r.id, title: r.title, rate: r.rate }));
  return JSON.stringify({
    date: d,
    score: daily?.score ?? null,
    feelings: Object.fromEntries(feelings.results.map((f) => [f.field, f.value])),
    sections: {
      done: pick("done"),
      // 마감이 확정하는 파생: 아직 열린 날의 'todo'가 이 물화에서 missed가 된다
      missed: [...pick("missed"), ...pick("todo")],
      deferred: cls.results
        .filter((r) => r.class === "deferred")
        .map((r) => ({ id: r.id, title: r.title, rate: r.rate, to: r.deferred_to })),
    },
  });
}

/** 날짜 팝업 (E) — 조인 조립, 하드코딩 금지 (2.2). */
export async function assembleDay(env: Env, t: TimeCtx, k: string) {
  const [periods, cls, daily, feelings, logs, memos] = await Promise.all([
    db.periodsAt(env, k),
    db.classifyAt(env, k),
    db.getDaily(env, k),
    db.feelingsAt(env, k),
    db.logsAt(env, k),
    db.memosAt(env, k),
  ]);
  return {
    date: k,
    relation: k === t.d ? "today" : k > t.d ? "future" : "past",
    periods: periods.results,
    tasks: cls.results,
    daily: daily ?? null,
    feelings: feelings.results,
    logs: logs.results,
    memos: memos.results,
    // 보호 규칙 표시는 구현 3 (Guard)
  };
}

export async function calendar(env: Env, start: string, end: string) {
  const [periods, entries, diary] = await Promise.all([
    db.calPeriods(env, start, end),
    db.calEntries(env, start, end),
    db.calDiaryDates(env, start, end),
  ]);
  return { periods: periods.results, entries: entries.results, diary: diary.results };
}

export async function diaryFeed(env: Env, t: TimeCtx, limit = 30) {
  const rows = await db.diaryList(env, t.d, Math.min(limit, 90));
  return rows.results;
}
