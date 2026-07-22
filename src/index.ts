// 라우터 — 얇게. 도메인 규칙·트랜잭션 순서는 전부 services/에 있다.
// 불변성은 API가 아니라 DB 트리거가 최종 강제하고, 여기서는 그 거부를
// 사람이 읽을 수 있는 409/400으로 번역만 한다.
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError, type Env, type TimeCtx } from "./types";
import { loadTime } from "./lib/time";
import * as daily from "./services/daily";
import * as tasks from "./services/tasks";
import * as periods from "./services/periods";
import * as memos from "./services/memos";
import * as me from "./services/me";
import * as analysis from "./services/analysis";
import * as events from "./services/events";
import { PROVIDERS, aiConfig, testConnection } from "./lib/ai";
import * as guard from "./services/guard";
import { autoClose, scheduled } from "./scheduled";

type Ctx = { Bindings: Env; Variables: { t: TimeCtx } };
const app = new Hono<Ctx>();

app.use("*", cors());

// 인증(선택): API_TOKEN 시크릿이 있으면 Bearer 필수 — 없으면 열림(로컬 개발)
app.use("/api/*", async (c, next) => {
  const token = c.env.API_TOKEN;
  if (token && c.req.header("Authorization") !== `Bearer ${token}`) {
    return c.json({ error: "인증이 필요해요" }, 401);
  }
  await next();
});

// 요청당 시간 컨텍스트 한 번 — 귀속일(경계 05:00)은 여기서만 계산
app.use("/api/*", async (c, next) => {
  c.set("t", await loadTime(c.env));
  await next();
});

// D1/트리거 거부 → 사람 읽는 에러
function translateDbError(e: Error): ApiError | null {
  const m = e.message ?? "";
  const clean = m.replace(/^D1_ERROR:\s*/, "").replace(/:?\s*SQLITE_[A-Z_]+\b.*$/, "").trim();
  const immutable = ["수정할 수 없음", "삭제할 수 없음", "추가할 수 없음", "영구 보존", "사후 갱신"];
  if (immutable.some((s) => m.includes(s))) return new ApiError(409, clean);
  if (/UNIQUE constraint failed: schedule_entries/.test(m))
    return new ApiError(409, "그 날짜에 이미 이 task의 예정이 있어요");
  if (/FOREIGN KEY constraint/.test(m))
    return new ApiError(409, "다른 기록이 참조하고 있어 지울 수 없어요");
  if (/constraint failed/i.test(m)) return new ApiError(400, clean);
  return null;
}

app.onError((err, c) => {
  const e = err instanceof ApiError ? err : translateDbError(err);
  if (e) return c.json({ error: e.message }, e.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: "서버 오류" }, 500);
});

const body = async <T>(c: { req: { json(): Promise<unknown> } }): Promise<T> => {
  try { return (await c.req.json()) as T; }
  catch { throw new ApiError(400, "JSON 본문이 필요해요"); }
};

// ── Today (7장) ─────────────────────────────────────────────
app.get("/api/today", async (c) => c.json(await daily.assembleToday(c.env, c.get("t"))));

app.post("/api/logs", async (c) => {
  const b = await body<{ text: string; ts?: string }>(c);
  return c.json(await daily.addLog(c.env, c.get("t"), b.text, b.ts), 201);
});
app.patch("/api/logs/:id", async (c) => {
  const b = await body<{ ts?: string; text?: string }>(c);
  return c.json(await daily.editLog(c.env, Number(c.req.param("id")), b));
});

app.put("/api/daily/feelings", async (c) => {
  const b = await body<{ values: Record<string, number> }>(c);
  return c.json(await daily.setFeelings(c.env, c.get("t"), b.values));
});
app.put("/api/daily/feelings-text", async (c) => {
  const b = await body<{ text: string }>(c);
  return c.json(await daily.setFeelingsText(c.env, c.get("t"), b.text));
});
app.put("/api/daily/score", async (c) => {
  const b = await body<{ score: number }>(c);
  return c.json(await daily.setScore(c.env, c.get("t"), b.score));
});
app.post("/api/daily/classify-feelings", async (c) =>
  c.json(await daily.classifyFeelings(c.env, c.get("t"))));
app.post("/api/daily/close", async (c) => {
  const b = await body<{ kind?: "manual" | "brief" }>(c);
  return c.json(await daily.closeDay(c.env, c.get("t"), b.kind ?? "manual"));
});

// ── Calendar (2.2) ──────────────────────────────────────────
app.get("/api/calendar", async (c) => {
  const { start, end } = c.req.query();
  if (!start || !end) throw new ApiError(400, "start·end 쿼리가 필요해요 (YYYY-MM-DD)");
  return c.json(await daily.calendar(c.env, start, end));
});
app.get("/api/days/:date", async (c) =>
  c.json(await daily.assembleDay(c.env, c.get("t"), c.req.param("date"))));
app.get("/api/diary", async (c) =>
  c.json(await daily.diaryFeed(c.env, c.get("t"), Number(c.req.query("limit") ?? 30))));

app.post("/api/memos", async (c) => {
  const b = await body<{ date: string; ts?: string; text: string }>(c);
  return c.json(await memos.addMemo(c.env, c.get("t"), b), 201);
});

// ── Works · tasks (1.4 · 7장) ───────────────────────────────
app.get("/api/works/:segment", async (c) =>
  c.json(await tasks.segment(c.env, c.get("t"), c.req.param("segment"))));

app.post("/api/tasks", async (c) => {
  const b = await body<{ title: string; period_id?: string | null; date?: string }>(c);
  return c.json(await tasks.createTask(c.env, c.get("t"), b), 201);
});
app.get("/api/tasks/:id", async (c) =>
  c.json(await tasks.getTask(c.env, c.get("t"), c.req.param("id"))));
app.patch("/api/tasks/:id", async (c) => {
  const b = await body<{ title?: string; period_id?: string | null }>(c);
  return c.json(await tasks.updateTaskMeta(c.env, c.req.param("id"), b));
});
app.post("/api/tasks/:id/defer", async (c) => {
  const b = await body<{ from: string; to: string; rate?: number; reason?: string }>(c);
  return c.json(await tasks.deferTask(c.env, c.get("t"), c.req.param("id"), b.from, b.to, b.rate, b.reason));
});
app.post("/api/tasks/:id/schedule", async (c) => {
  const b = await body<{ date: string }>(c);
  return c.json(await tasks.scheduleTask(c.env, c.get("t"), c.req.param("id"), b.date));
});
app.post("/api/tasks/:id/extend", async (c) =>
  c.json(await tasks.extendWait(c.env, c.get("t"), c.req.param("id"))));
app.post("/api/tasks/:id/complete", async (c) =>
  c.json(await tasks.completeTask(c.env, c.get("t"), c.req.param("id"))));
app.delete("/api/tasks/:id", async (c) => c.json(await tasks.deleteTask(c.env, c.req.param("id"))));
app.put("/api/tasks/:id/rate", async (c) => {
  const b = await body<{ date: string; rate: number }>(c);
  return c.json(await tasks.setRate(c.env, c.req.param("id"), b.date, b.rate));
});

// ── Periods (2장) ───────────────────────────────────────────
app.get("/api/periods", async (c) => c.json(await periods.listPeriods(c.env, c.get("t"))));
app.post("/api/periods", async (c) => {
  const b = await body<Parameters<typeof periods.createPeriod>[2]>(c);
  return c.json(await periods.createPeriod(c.env, c.get("t"), b), 201);
});
app.get("/api/periods/:id", async (c) => c.json(await periods.getPeriodDetail(c.env, c.req.param("id"))));
app.patch("/api/periods/:id", async (c) => {
  const b = await body<Parameters<typeof periods.updatePeriod>[2]>(c);
  return c.json(await periods.updatePeriod(c.env, c.req.param("id"), b));
});
app.delete("/api/periods/:id", async (c) => c.json(await periods.deletePeriod(c.env, c.req.param("id"))));

// ── Me · settings (3장) ─────────────────────────────────────
app.get("/api/me", async (c) => c.json(await me.getMe(c.env, c.get("t"))));
app.put("/api/me/:field", async (c) => {
  const b = await body<{ value: string }>(c);
  return c.json(await me.putMeField(c.env, c.get("t"), c.req.param("field"), b.value));
});
app.get("/api/me/history", async (c) =>
  c.json(await me.meHistory(c.env, Number(c.req.query("limit") ?? 50))));
app.get("/api/settings", async (c) => c.json(await me.getSettings(c.env)));
app.get("/api/ai/providers", async (c) => c.json(PROVIDERS));
app.get("/api/ai/connections", async (c) => {
  const cfg = await aiConfig(c.env);
  return c.json({ connections: cfg.connections, low: cfg.low, high: cfg.high, fallback: cfg.provider });
});
app.post("/api/ai/test", async (c) => {
  const b = await body<{ which?: "low" | "high" }>(c).catch(() => ({}) as any);
  return c.json(await testConnection(c.env, b.which === "low" ? "low" : "high"));
});
app.put("/api/settings/:key", async (c) => {
  const b = await body<{ value: string }>(c);
  return c.json(await me.putSetting(c.env, c.req.param("key"), b.value));
});

// ── 일정(event) — 캘린더 전용 ───────────────────────────────
app.post("/api/events", async (c) => c.json(await events.create(c.env, c.get("t"), await body(c))));
app.patch("/api/events/:id", async (c) => c.json(await events.update(c.env, c.req.param("id"), await body(c))));
app.delete("/api/events/:id", async (c) => c.json(await events.remove(c.env, c.req.param("id"))));

// ── Analysis (5장) ──────────────────────────────────────────
app.get("/api/analyses", async (c) => c.json(await analysis.list(c.env)));
app.post("/api/analyses", async (c) => {
  const b = await body<{ prompt: string }>(c);
  return c.json(await analysis.create(c.env, c.get("t"), b.prompt));
});
// 조립될 컨텍스트 원문 — 무엇이 모델에 들어가는지 사용자가 직접 확인 (토큰 통제)
app.get("/api/analyses/context-raw", async (c) => {
  const { text, meta } = await analysis.assembleContext(c.env, c.get("t"));
  return c.json({ text, meta, chars: text.length });
});
app.get("/api/analyses/context-preview", async (c) =>
  c.json(await analysis.contextPreview(c.env, c.get("t"))));
app.get("/api/analyses/:id", async (c) => c.json(await analysis.get(c.env, c.req.param("id"))));

// ── Guard (구현 3 자리 — 조회만) ────────────────────────────
app.get("/api/guard/events", async (c) => c.json(await guard.events(c.env)));

// ── 운영 ────────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true, date: c.get("t").d, now: c.get("t").now }));
app.post("/api/admin/auto-close", async (c) => c.json(await autoClose(c.env))); // Cron 수동 트리거(개발용)

export default { fetch: app.fetch, scheduled };
