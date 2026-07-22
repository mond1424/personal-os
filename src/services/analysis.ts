// Analysis (5장) — 구현 2: 5.2 컨텍스트 조립 + 5.3 2-pass 생성.
// 자동 생성 없음 — 사용자 요청 시에만 (토큰 통제, 5.1).
import * as db from "../db";
import { aiConfig, callModel } from "../lib/ai";
import { nextId } from "../lib/id";
import { addDays, attributionOfIso, diffDays, mondayOf } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

export const list = async (env: Env) => (await db.analysesList(env)).results;

export async function get(env: Env, id: string) {
  const row = await db.analysisGet(env, id);
  if (!row) throw new ApiError(404, "해당 분석이 없어요");
  return { ...row, context_meta: row.context_meta ? JSON.parse(row.context_meta) : null };
}

/** 모델 이원화 (8장) — 제공자·키와 함께 설정에서 읽는다. */
export async function models(env: Env) {
  const c = await aiConfig(env);
  return { low: c.low, high: c.high }; // 값에 제공자가 포함된다 ('provider/model')
}

/**
 * 5.2 윈도우 규칙 (확정)
 *   이번 주 경과 >= 4일 -> 이번 주 raw만 (4~7일)
 *   경과 <= 3일         -> 지난주 raw 포함 (8~10일)
 *   + 그 앞 완결 주 weekly summary (7일)  => 총 11~17일
 */
function windowSpec(t: TimeCtx) {
  const thisMonday = mondayOf(t.d);
  const elapsed = diffDays(t.d, thisMonday) + 1; // 월=1 … 일=7
  const rawStart = elapsed >= 4 ? thisMonday : addDays(thisMonday, -7);
  return {
    rawStart,
    rawDays: diffDays(t.d, rawStart) + 1,
    weeklyStart: addDays(rawStart, -7),
    weeklyEnd: addDays(rawStart, -1),
  };
}

export async function contextPreview(env: Env, t: TimeCtx) {
  const w = windowSpec(t);
  const weekly = await db.weeklySummaryGet(env, w.weeklyStart);
  return {
    me: "장기 맥락 프레임",
    raw: { start: w.rawStart, end: t.d, days: w.rawDays },
    weekly_summary: {
      start: w.weeklyStart, end: w.weeklyEnd, days: 7,
      status: weekly ? (weekly.stale ? "stale" : "ready") : "미생성 — 기계적 요약으로 대체",
    },
    today: "Today 상태",
    total_days: w.rawDays + 7,
  };
}

/**
 * 입력 조립 (5.2): [ Me ] + [ 요약/원본 윈도우 ] + [ Today ] + (호출부에서 prompt).
 * weekly summary가 없거나 stale이면 그 주는 기계적 daily summary(mech)로 대체하고
 * meta에 기록한다 — cache는 없어도 원본에서 항상 복원 가능해야 한다 (원칙 4).
 */
export async function assembleContext(env: Env, t: TimeCtx) {
  const w = windowSpec(t);
  const [me, periods, weekly, dailyRows, logs, feelings, memos, waiting] = await Promise.all([
    db.meAll(env),
    db.periodCards(env),
    db.weeklySummaryFull(env, w.weeklyStart),
    db.dailyRange(env, w.rawStart, t.d),
    db.logsRange(env, w.rawStart, t.d),
    db.feelingsRange(env, w.rawStart, t.d),
    db.memosRange(env, w.rawStart, t.d),
    db.waitingList(env),
  ]);
  const L: string[] = [];

  L.push("[Me — 장기 맥락]");
  if (me.results.length) for (const f of me.results) L.push(`- ${f.field}: ${f.value}`);
  else L.push("- (아직 작성 전)");

  L.push("", `[기간 — 중기 목표] (오늘 ${t.d})`);
  if (periods.results.length)
    for (const p of periods.results) {
      const goals = (JSON.parse(p.goals) as string[]).join(", ");
      L.push(`- ${p.title} ${p.start_date}~${p.end_date}${goals ? ` · 목표: ${goals}` : ""}${p.achievement != null ? ` · 달성률 ${p.achievement}%` : ""}`);
    }
  else L.push("- (없음)");

  // 그 앞 완결 주
  L.push("", `[지난 주 ${w.weeklyStart}~${w.weeklyEnd}]`);
  let weeklySource: "ai" | "mech" = "mech";
  if (weekly?.ai_text && !weekly.stale) {
    weeklySource = "ai";
    L.push(weekly.ai_text);
  } else {
    for (let d = w.weeklyStart; d <= w.weeklyEnd; d = addDays(d, 1)) {
      const mech = await db.mechDaily(env, d);
      if (!mech?.mech) { L.push(`- ${d}: 기록 없음`); continue; }
      const m = JSON.parse(mech.mech) as {
        score: number | null;
        feelings: Record<string, number>;
        sections: { done: unknown[]; missed: unknown[]; deferred: unknown[] };
      };
      const fl = Object.entries(m.feelings).map(([k, v]) => `${k}${v}`).join(" ");
      L.push(`- ${d}: score ${m.score ?? "—"} · done ${m.sections.done.length} · missed ${m.sections.missed.length} · 미룸 ${m.sections.deferred.length}${fl ? " · " + fl : ""}`);
    }
  }

  // raw 윈도우 — 과정(Log)이 핵심 원본이다 (1.2)
  L.push("", `[최근 raw ${w.rawStart}~${t.d}]`);
  const dailyBy = Object.fromEntries(dailyRows.results.map((r) => [r.date, r]));
  for (let d = w.rawStart; d <= t.d; d = addDays(d, 1)) {
    const day = dailyBy[d];
    const cls = await db.classifyAt(env, d);
    const fl = feelings.results.filter((f) => f.date === d).map((f) => `${f.field}${f.value}`).join(" ");
    const head = day
      ? `score ${day.score ?? "—"} · ${day.status === "closed" ? (day.close_kind === "auto" ? "자동 마감" : "마감") : "열림"}`
      : "일기 없음";
    L.push(`## ${d} (${head}${fl ? " · " + fl : ""})`);
    if (day?.feelings_text) L.push(`상태 서술: ${day.feelings_text}`);
    for (const c of ["done", "missed", "todo", "deferred"] as const) {
      const rows = cls.results.filter((r) => r.class === c);
      if (rows.length) L.push(`${c}: ${rows.map((r) => `${r.title}(${r.rate}%)`).join(", ")}`);
    }
    for (const l of logs.results.filter((x) => x.date === d)) L.push(`- ${l.ts.slice(11, 16)} ${l.text}`);
    for (const m of memos.results.filter((x) => x.date === d)) L.push(`- (memo ${m.ts.slice(11, 16)}) ${m.text}`);
  }

  const ages = waiting.results.map((x) => diffDays(t.d, attributionOfIso(x.wait_anchor_at, t.boundary)) + 1);
  L.push("", `[Today 상태] 대기 ${ages.length}건${ages.length ? ` (최장 ${Math.max(...ages)}일)` : ""}`);

  return {
    text: L.join("\n"),
    meta: {
      raw: { start: w.rawStart, end: t.d, days: w.rawDays },
      weekly: { start: w.weeklyStart, end: w.weeklyEnd, source: weeklySource },
      total_days: w.rawDays + 7,
    } as Record<string, unknown>,
  };
}

const SYS_BASE =
  "너는 개인 기록 시스템 'Personal OS'의 분석 계층이다. 사용자의 기록(Me·기간·일기 raw)만을 근거로 " +
  "패턴을 찾고, 기록의 날짜·수치를 인용해 한국어 산문으로 답한다. 근거 없는 단정과 과잉 일반화를 피하고, " +
  "실행 가능한 관찰이 있으면 규칙 형태로 제안한다. 소제목·불릿 없이 2~5문단.";

/** 5.3 2-pass: 1차 독립(앵커링 방지) -> 2차는 과거를 읽으며 '추가'만 (1차 수정 금지). */
export async function create(env: Env, t: TimeCtx, prompt: unknown) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new ApiError(400, "prompt가 필요해요");
  if (prompt.length > 500) throw new ApiError(400, "prompt는 500자 이내로");
  const p = prompt.trim();

  const [{ text, meta }, m] = await Promise.all([assembleContext(env, t), models(env)]);

  const pass1 = await callModel(env, {
    model: m.high, maxTokens: 1400,
    system: SYS_BASE + " 과거 분석 결과는 주어지지 않는다 — 이번 기록만으로 독립적으로 판단하라.",
    user: `${text}\n\n[사용자 질문]\n${p}`,
  });

  const past = (await db.analysesRecentFull(env, 3)).results;
  const pastText = past.length
    ? past.map((a) => `(${a.created_at.slice(0, 10)}) 질문: ${a.prompt}\n${a.pass1}\n${a.pass2}`).join("\n---\n")
    : "(없음)";
  const pass2 = await callModel(env, {
    model: m.high, maxTokens: 1000,
    system: SYS_BASE +
      " 아래에 방금 작성된 1차 분석과 과거 분석들이 주어진다. 1차를 수정·재요약하지 말고, " +
      "과거 분석과의 연결·변화·반복 패턴 등 '추가' 관찰만 작성하라. 과거 분석이 없으면 첫 분석임을 짧게 밝혀라.",
    user: `${text}\n\n[사용자 질문]\n${p}\n\n[1차 분석]\n${pass1}\n\n[과거 분석]\n${pastText}`,
  });

  const id = await nextId(env, "analyses", t.compact);
  const fullMeta = { ...meta, models: m };
  await db.stInsertAnalysis(env, id, p, pass1, pass2, JSON.stringify(fullMeta), t.now).run();
  return { id, prompt: p, pass1, pass2, context_meta: fullMeta, created_at: t.now };
}
