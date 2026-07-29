// Guard (6장) — 8월 v1. 계획은 APP-PLAN.md, 근거는 APP-ADR.md.
//
// 이 파일은 **기록과 조회**만 한다. 발동은 기기가 한다(ADR-021):
// 보호 규칙은 일정 시각에서 역산되므로 시각으로 예측되고, 기기가 알람으로 예약해
// 스스로 깨어난다. 서버는 예약 재료를 내려주고 결과를 받아 적는다.
//
// §9 #1(규칙 문법·마찰 수위·Level 4 형태·outcome 판정)은 최소 형태로만 확정했다 —
// APP-PLAN의 '발동 규칙' 절. 정교화는 9~11월 실사용 데이터 뒤에.
import * as db from "../db";
import { nextId } from "../lib/id";
import { attributionOfIso } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/** 설정 기본값 — event별 값이 없을 때. 초기값의 정확도보다 조정 가능한 구조가 중요하다. */
const DEFAULT_SLEEP_MIN = 360;   // 6시간
const DEFAULT_PREP_MIN = 90;     // 기상~출발

const LEVELS = [1, 2, 3, 4];
const REACTIONS = ["accepted", "override", "ignored"];

/** Override 사유 최소 길이 (§6.3 마찰). 짧게 치고 넘어가는 것을 막는다. */
const MIN_REASON = 20;

// ── 조회 ──────────────────────────────────────────────────────

export const events = async (env: Env, limit = 100) =>
  (await db.guardEventsList(env, limit)).results;

export const modes = async (env: Env) => ({
  modes: (await db.guardModes(env)).results,
  active: await db.guardActiveMode(env),
});

export async function setMode(env: Env, key: string) {
  const all = (await db.guardModes(env)).results;
  if (!all.some((m) => m.key === key)) throw new ApiError(404, "그런 모드가 없어요");
  // 부분 유니크 인덱스(active=1) 때문에 해제 → 설정 순서를 지켜야 한다. batch로 원자.
  await env.DB.batch([db.stClearActiveMode(env), db.stSetActiveMode(env, key)]);
  return { active: key };
}

/**
 * 기기가 알람을 예약할 재료. 하루 1회 pull한다.
 *
 * 데드라인은 **저장하지 않고 여기서 역산한다** — 파생은 저장하지 않는다(원칙 4).
 * 설계 §6.1 Level 3의 "현재 01:30"이 여기서 나온다:
 *   시험 09:00 − 준비 90분 − 수면 360분 = 01:30
 */
export async function schedule(env: Env, t: TimeCtx, days = 30) {
  const rows = (await db.protectedEvents(env, t.d, days)).results;
  const mode = await db.guardActiveMode(env);
  const maxLevel = mode?.max_level ?? 4;
  const nowMs = Date.now();

  const plans = rows.map((e) => {
    const sleep = e.protect_sleep_min ?? DEFAULT_SLEEP_MIN;
    const prep = e.protect_prep_min ?? DEFAULT_PREP_MIN;
    const cap = Math.min(e.protect_level ?? 4, maxLevel);

    // 시각이 없는 종일 일정은 09:00으로 본다 — 시험·약속의 통상 시작
    const hhmm = e.time ?? "09:00";
    const start = new Date(`${e.date}T${hhmm}:00${offsetSuffix(t.offsetMin)}`);
    const deadline = new Date(start.getTime() - (prep + sleep) * 60_000);

    // 보호 모드 진입 — '-1d 00:00' 형식. 파싱 실패 시 데드라인 24시간 전으로 폴백.
    const from = parseRelative(e.protect_from ?? null, start, t.offsetMin)
      ?? new Date(deadline.getTime() - 24 * 3600_000);

    // 전부 시각으로 예측 가능하므로 기기가 한꺼번에 예약한다.
    const fires: { at: string; level: number; title: string; body: string }[] = [];
    const push = (at: Date, level: number, title: string, body: string) => {
      if (level <= cap && at.getTime() > nowMs) {
        fires.push({ at: at.toISOString(), level, title, body });
      }
    };
    push(from, 1, "보호 모드 시작",
      `${e.title} — ${fmt(start, t.offsetMin)}. 지금부터 Guard가 지켜봅니다.`);
    push(new Date(deadline.getTime() - 2 * 3600_000), 2, "2시간 뒤 취침 데드라인",
      `${e.title}까지 준비 ${prep}분 · 수면 ${sleep}분을 두려면 ${fmt(deadline, t.offsetMin)}에는 자야 합니다.`);
    push(new Date(deadline.getTime() - 3600_000), 2, "1시간 뒤 취침 데드라인",
      `${e.title} — ${fmt(deadline, t.offsetMin)} 취침이 마지노선입니다.`);
    push(deadline, 3, "지금 자야 합니다",
      `${e.title}까지 ${(sleep / 60).toFixed(1)}시간 수면을 지키려면 지금이 마지막입니다.`);
    for (let i = 1; i <= 6; i++) {   // 데드라인 +30분부터 30분 간격
      push(new Date(deadline.getTime() + i * 30 * 60_000), 4, "수면이 부족합니다",
        `${e.title} — 계속하면 예상 수면이 ${Math.max(0, (sleep - i * 30) / 60).toFixed(1)}시간 이하입니다.`);
    }

    return {
      event_id: e.id, title: e.title, date: e.date, time: e.time ?? null,
      start: start.toISOString(),                // 기준점 — 데드라인이 여기서 역산된다
      protect_from: from.toISOString(), deadline: deadline.toISOString(),
      sleep_min: sleep, prep_min: prep, max_level: cap,
      fires,
    };
  });

  return {
    d: t.d,                                  // 서버 귀속일 — 기기는 이걸 그대로 쓴다(ADR-011)
    // 하루 경계는 사용자 설정이다. 기기의 재동기화 시각이 여기에 붙어야
    // '그날 일정이 확정된 뒤' 받는다는 전제가 유지된다.
    boundary: t.boundary,                    // 'HH:MM'
    mode: mode?.key ?? null,
    friction_mult: mode?.friction_mult ?? 1,
    events: plans,
  };
}

// ── 기록 ──────────────────────────────────────────────────────

/**
 * 발동 기록. 기기가 발동한 뒤 밀어 올린다 — 오프라인이면 로컬에 쌓였다가 나중에 온다(ADR-023).
 * 그래서 `fired_at`은 서버 시각이 아니라 **기기가 보낸 시각**이고, 귀속일도 그걸로 계산한다.
 */
export async function record(env: Env, t: TimeCtx, input: any) {
  const clientId = typeof input?.client_id === "string" && input.client_id.trim()
    ? input.client_id.trim() : null;

  // 재시도 멱등 — POST가 닿았는데 응답만 유실된 경우 두 번째는 같은 행을 가리킨다.
  // 반응이 뒤늦게 왔으면 그것만 채운다(트리거가 'NULL → 값'만 허용한다).
  if (clientId) {
    const dup = await db.guardEventByClient(env, clientId);
    if (dup) {
      if (!dup.reaction && input?.reaction) {
        await applyReaction(env, t, dup.id, input);
      }
      return { id: dup.id, on_date: dup.on_date, level: dup.level, mode: dup.mode, duplicate: true };
    }
  }

  const level = Number(input?.level);
  if (!LEVELS.includes(level)) throw new ApiError(400, "level은 1~4");
  if (typeof input?.cause !== "string" || !input.cause.trim()) {
    throw new ApiError(400, "cause가 필요해요");
  }

  const firedAt = typeof input.fired_at === "string" ? input.fired_at : t.now;
  const onDate = attributionOfIso(firedAt, t.boundary);
  const id = await nextId(env, "guard_events", onDate.replace(/-/g, ""));
  const mode = input.mode ?? (await db.guardActiveMode(env))?.key ?? null;

  await db.stInsertGuardEvent(env, {
    id, fired_at: firedAt, on_date: onDate, cause: input.cause.trim(), level,
    mode,
    source: input.source === "pc" ? "pc" : "android",
    foreground_app: input.foreground_app ?? null,
    risk_score: Number.isFinite(Number(input.risk_score)) ? Number(input.risk_score) : null,
    // 판단 시점의 항 값 전부. 자기 보정의 원재료 — 소급해서 만들 수 없다.
    risk_snapshot: input.risk_snapshot ? JSON.stringify(input.risk_snapshot) : null,
    ai_used: input.ai_used ? 1 : 0,
    ai_verdict: input.ai_verdict ?? null,
    task_id: input.task_id ?? null,
    period_id: input.period_id ?? null,
    event_id: input.event_id ?? null,
    client_id: clientId,
    created_at: t.now,
  }).run();

  // 기기가 발동과 반응을 한 번에 올리는 경우(오프라인에서 둘 다 일어난 뒤 나중에 동기화).
  if (input?.reaction) await applyReaction(env, t, id, input);

  return { id, on_date: onDate, level, mode };
}

/** react()와 record()가 공유하는 반응 기록. 검증은 한 곳에만 둔다. */
async function applyReaction(env: Env, t: TimeCtx, id: string, input: any) {
  const reaction = String(input?.reaction ?? "");
  if (!REACTIONS.includes(reaction)) {
    throw new ApiError(400, "reaction은 accepted·override·ignored");
  }
  const reason = typeof input?.reason === "string" ? input.reason.trim() : "";
  if (reaction === "override" && reason.length < MIN_REASON) {
    throw new ApiError(400, `Override에는 사유가 ${MIN_REASON}자 이상 필요해요`);
  }
  const at = typeof input?.reacted_at === "string" ? input.reacted_at : t.now;
  await db.stReactGuardEvent(env, id, reaction, reaction === "override" ? reason : null, at).run();
  return { id, reaction, reacted_at: at };
}

/** 반응 — 한 번만 쓸 수 있다(0010 트리거). 두 번째는 409. */
export async function react(env: Env, t: TimeCtx, id: string, input: any) {
  const cur = await db.guardEventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 Guard 이벤트가 없어요");
  if (cur.reaction) throw new ApiError(409, "이미 반응이 기록됐어요 — 개입 이력은 고칠 수 없어요");
  return applyReaction(env, t, id, input);
}

/** outcome은 Guard가 판단하지 않는다 — 사용자가 사후 확정한다(§6.5). */
export async function setOutcome(env: Env, t: TimeCtx, id: string, outcome: string) {
  if (outcome !== "success" && outcome !== "failure") {
    throw new ApiError(400, "outcome은 success 또는 failure");
  }
  const cur = await db.guardEventGet(env, id);
  if (!cur) throw new ApiError(404, "해당 Guard 이벤트가 없어요");
  if (cur.outcome) throw new ApiError(409, "이미 결과가 확정됐어요");
  await db.stSetGuardOutcome(env, id, outcome, t.now).run();
  return { id, outcome, outcome_at: t.now };
}

export const pendingOutcome = async (env: Env) =>
  (await db.guardEventsPendingOutcome(env)).results;

// ── watch_apps (ADR-022) ─────────────────────────────────────

export const listWatchApps = async (env: Env, source?: string) =>
  (await db.watchApps(env, source)).results;

export async function addWatchApp(env: Env, t: TimeCtx, input: any) {
  const source = input?.source === "pc" ? "pc" : "android";
  const identifier = String(input?.identifier ?? "").trim();
  if (!identifier) throw new ApiError(400, "identifier가 필요해요");
  await db.stAddWatchApp(env, source, identifier, input?.label ?? null, t.now).run();
  return { source, identifier };
}

export async function removeWatchApp(env: Env, source: string, identifier: string) {
  await db.stRemoveWatchApp(env, source, identifier).run();
  return { source, identifier, deleted: true };
}

// ── helpers ──────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

function offsetSuffix(offsetMin: number) {
  const s = offsetMin < 0 ? "-" : "+";
  const a = Math.abs(offsetMin);
  return `${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** 문구용 표시. Worker는 UTC로 돌므로 오프셋을 더해 로컬 달력으로 읽는다. */
function fmt(d: Date, offsetMin: number) {
  const x = new Date(d.getTime() + offsetMin * 60_000);
  return `${x.getUTCMonth() + 1}/${x.getUTCDate()} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

/** '-1d 00:00' · '-2d 22:30' → 일정 시작 기준 절대 시각. 형식이 아니면 null. */
function parseRelative(spec: string | null, start: Date, offsetMin: number): Date | null {
  if (!spec) return null;
  const m = /^([+-]?\d+)d\s+([01]\d|2[0-3]):([0-5]\d)$/.exec(spec.trim());
  if (!m) return null;
  const base = new Date(start.getTime() + Number(m[1]) * 86_400_000);
  const shifted = new Date(base.getTime() + offsetMin * 60_000);   // 로컬 달력으로 읽는다
  const y = shifted.getUTCFullYear(), mo = shifted.getUTCMonth() + 1, da = shifted.getUTCDate();
  return new Date(`${y}-${pad(mo)}-${pad(da)}T${m[2]}:${m[3]}:00${offsetSuffix(offsetMin)}`);
}
