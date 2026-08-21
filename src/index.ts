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
import * as collected from "./services/collected";
import * as events from "./services/events";
import { PROVIDERS, aiConfig, testConnection } from "./lib/ai";
import * as guard from "./services/guard";
import * as lm from "./services/lifemodel";
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
  if (e) return c.json({ error: e.message, ...(e.suggest ? { suggest: e.suggest } : {}) }, e.status as ContentfulStatusCode);
  console.error(err);
  return c.json({ error: "서버 오류" }, 500);
});

const body = async <T>(c: { req: { json(): Promise<unknown> } }): Promise<T> => {
  try { return (await c.req.json()) as T; }
  catch { throw new ApiError(400, "JSON 본문이 필요해요"); }
};
// 본문이 '선택'인 엔드포인트용 — 없거나 깨졌으면 빈 객체. 무본문으로 부르던 기존 호출을 깨지 않는다.
const bodyOpt = async <T>(c: { req: { json(): Promise<unknown> } }): Promise<Partial<T>> => {
  try { return (await c.req.json()) as Partial<T>; } catch { return {}; }
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
app.post("/api/tasks/:id/cancel", async (c) => {
  const b = await bodyOpt<{ reason?: string }>(c);   // 사유는 선택 — 무본문 취소도 그대로 동작
  return c.json(await tasks.cancelTask(c.env, c.get("t"), c.req.param("id"), b.reason));
});
app.post("/api/tasks/:id/uncancel", async (c) =>
  c.json(await tasks.uncancelTask(c.env, c.req.param("id"))));
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
  const b = await body<{ prompt: string; depth?: unknown }>(c);
  return c.json(await analysis.create(c.env, c.get("t"), b.prompt, b.depth));
});
// 조립될 컨텍스트 원문 — 무엇이 모델에 들어가는지 사용자가 직접 확인 (토큰 통제)
app.get("/api/analyses/context-raw", async (c) => {
  const { text, meta } = await analysis.assembleContext(c.env, c.get("t"));
  return c.json({ text, meta, chars: text.length });
});
app.get("/api/analyses/context-preview", async (c) =>
  c.json(await analysis.contextPreview(c.env, c.get("t"))));
app.get("/api/analyses/:id", async (c) => c.json(await analysis.get(c.env, c.req.param("id"))));

// ── Life Model (me-reinforcement-plan Phase 1) ──────────────
// Me = 천천히 변하는 상태 저장소. 이벤트 스트림과 데이터 성격이 달라 분리한다.
// ⚠️ 라우트 순서 — 리터럴 경로를 `:section` 와일드카드보다 **앞**에 둔다.
//    뒤에 두면 POST /api/lm/import-me 가 POST /api/lm/:section 에 먼저 잡혀
//    section="import-me"로 들어가고 body를 요구한다.
//    (/api/analyses/context-* 가 /api/analyses/:id 보다 앞이어야 하는 것과 같은 함정)
app.get("/api/lm/sections", async (c) => c.json(await lm.sections(c.env)));

/** 기존 Me 텍스트를 Overview로 복사한다. 원본은 지우지 않는다 — 멱등. */
app.post("/api/lm/import-me", async (c) => c.json(await lm.importFromMe(c.env, c.get("t"))));

app.patch("/api/lm/item/:id", async (c) =>
  c.json(await lm.update(c.env, c.get("t"), c.req.param("id"), await body(c))));
app.delete("/api/lm/item/:id", async (c) => c.json(await lm.remove(c.env, c.req.param("id"))));

// 스키마 — 쓰기 검증·프롬프트 주입·UI 폼 생성이 같은 것을 읽는다(§2.2)
app.get("/api/lm/:section/schema", async (c) => c.json(await lm.schema(c.env, c.req.param("section"))));

app.get("/api/lm/:section", async (c) => c.json(await lm.list(c.env, c.req.param("section"))));
app.post("/api/lm/:section", async (c) =>
  c.json(await lm.create(c.env, c.get("t"), c.req.param("section"), await body(c)), 201));

// ── 일정 보호 규칙 (6.2 사전 서약) ──────────────────────────
// 본문 수정과 분리한다 — 보호 규칙은 계획이라 마감된 날에도 붙일 수 있어야 한다.
app.put("/api/events/:id/protect", async (c) =>
  c.json(await events.setProtect(c.env, c.req.param("id"), await body(c))));

// ── Guard (6장) ─────────────────────────────────────────────
// 발동은 기기가 한다(ADR-021). 서버는 예약 재료를 주고 결과를 받아 적는다.
app.get("/api/guard/events", async (c) =>
  c.json(await guard.events(c.env, Number(c.req.query("limit") ?? 100))));

/** 기기가 하루 1회 pull — 보호 일정과 발동 예정 시각 전부. */
app.get("/api/guard/schedule", async (c) =>
  c.json(await guard.schedule(c.env, c.get("t"), Number(c.req.query("days") ?? 30))));

/** 발동 기록. 오프라인이면 기기에 쌓였다가 나중에 온다(ADR-023) — fired_at은 기기 시각. */
app.post("/api/guard/events", async (c) =>
  c.json(await guard.record(c.env, c.get("t"), await body(c)), 201));

/**
 * Level 3 → 4 격상 검증 (ADR-024). **리터럴 경로라 `/events/:id/*`보다 앞에 둘 필요는 없지만**
 * `/api/guard/events`와 접두사가 다르므로 충돌하지 않는다.
 *
 * 판정 불가는 `level: 3` + 200이다 — 4xx/5xx로 답하면 기기의 오류 분기가 새벽에 터진다.
 */
app.post("/api/guard/verify", async (c) =>
  c.json(await guard.verifyLevel4(c.env, c.get("t"), await body(c))));

/** 반응 — 한 번만. 두 번째는 409(불변성 §1.3). */
app.post("/api/guard/events/:id/react", async (c) =>
  c.json(await guard.react(c.env, c.get("t"), c.req.param("id"), await body(c))));

/** outcome은 Guard가 판단하지 않는다 — 사후 확정(§6.5). */
app.post("/api/guard/events/:id/outcome", async (c) => {
  const b = await body<{ outcome: string }>(c);
  return c.json(await guard.setOutcome(c.env, c.get("t"), c.req.param("id"), b.outcome));
});
app.get("/api/guard/pending-outcome", async (c) => c.json(await guard.pendingOutcome(c.env)));

// 수집한 학사 일정을 제안으로 꺼낸다 (T-42 · ADR-030 본체).
// **자동으로 events에 넣지 않는다** — 오수집이 캘린더를 오염시킨다. 제안까지가 상한이다.
app.get("/api/collected/pending", async (c) => c.json(await collected.pending(c.env, c.get("t"))));
/**
 * 수집이 돌았는지 (T-43). **`pending`과 가른다** — 7일 창의 0과 원장 전체의 0은 다른 말이다.
 * ⚠️ URL·토큰은 안 나간다. `configured`가 있다/없다만 말한다.
 */
app.get("/api/collected/status", async (c) => c.json(await collected.status(c.env, c.get("t"))));
/** 멱등 — 두 번 눌러도 `events`는 하나다. */
app.post("/api/collected/:id/accept", async (c) =>
  c.json(await collected.accept(c.env, c.get("t"), c.req.param("id"))));
app.post("/api/collected/:id/dismiss", async (c) =>
  c.json(await collected.dismiss(c.env, c.req.param("id"))));

// 모드 — 규칙이 아니라 파라미터 프로파일 (ADR-019)
app.get("/api/guard/modes", async (c) => c.json(await guard.modes(c.env, c.get("t"))));
/** 하향에는 사유가 필요하다 — 보호 구간 중이면 사유가 있어도 409 (ADR-019 부수 규칙 1·2 · ADR-027). */
app.put("/api/guard/modes/active", async (c) => {
  const b = await body<{ key: string; reason?: string }>(c);
  return c.json(await guard.setMode(c.env, c.get("t"), b.key, b.reason));
});

// 감시 목록 — PC 확장 자리 (ADR-022)
app.get("/api/guard/watch-apps", async (c) =>
  c.json(await guard.listWatchApps(c.env, c.req.query("source"))));
app.post("/api/guard/watch-apps", async (c) =>
  c.json(await guard.addWatchApp(c.env, c.get("t"), await body(c)), 201));
app.delete("/api/guard/watch-apps/:source/:identifier", async (c) =>
  c.json(await guard.removeWatchApp(c.env, c.req.param("source"), c.req.param("identifier"))));

// ── 운영 ────────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true, date: c.get("t").d, now: c.get("t").now }));
app.post("/api/admin/auto-close", async (c) => c.json(await autoClose(c.env, c.get("t")))); // Cron 수동 트리거(개발용)

export default { fetch: app.fetch, scheduled };
