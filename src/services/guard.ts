// Guard (6장) — 8월 v1. 계획은 APP-PLAN.md, 근거는 APP-ADR.md.
//
// 이 파일은 **기록과 조회**만 한다. 발동은 기기가 한다(ADR-021):
// 보호 규칙은 일정 시각에서 역산되므로 시각으로 예측되고, 기기가 알람으로 예약해
// 스스로 깨어난다. 서버는 예약 재료를 내려주고 결과를 받아 적는다.
//
// §9 #1(규칙 문법·마찰 수위·Level 4 형태·outcome 판정)은 최소 형태로만 확정했다 —
// APP-PLAN의 '발동 규칙' 절. 정교화는 9~11월 실사용 데이터 뒤에.
import * as db from "../db";
import { aiConfig, callModel, parseModelJson, splitModel } from "../lib/ai";
import { buildCoreContext } from "../lib/context";
import { nextId } from "../lib/id";
import { attributionOfIso, isoNow, normalizeIso } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/** 설정 기본값 — event별 값이 없을 때. 초기값의 정확도보다 조정 가능한 구조가 중요하다. */
const DEFAULT_SLEEP_MIN = 360;   // 6시간
const DEFAULT_PREP_MIN = 90;     // 기상~출발

const LEVELS = [1, 2, 3, 4];
const REACTIONS = ["accepted", "override", "ignored"];

// Override 사유에 **길이 하한을 두지 않는다.**
// 20자 규칙을 뒀다가 실사용에서 마찰이 아니라 강제로 읽혀 걷어냈다 —
// §6.3이 원하는 것은 "비용을 치르게 한다"이지 "분량을 채우게 한다"가 아니다.
// 마찰은 대기 시간(friction_mult)이 지고, 사유는 §6.5의 데이터로서 비어 있지만 않으면 된다.
// (DB CHECK도 `override_reason IS NOT NULL`까지만 요구한다)

// ── 조회 ──────────────────────────────────────────────────────

export const events = async (env: Env, limit = 100) =>
  (await db.guardEventsList(env, limit)).results;

export const modes = async (env: Env) => ({
  modes: (await db.guardModes(env)).results,
  active: await db.guardActiveMode(env),
});

/**
 * **하향 = 강도 파라미터 중 하나라도 약해지는 것** (ADR-027 ①).
 *
 * 값이 커질수록 강한 것이 `+1`, 작아질수록 강한 것이 `-1`이다.
 * **`risk_threshold`만 `-1`이다 — 문턱이라 방향이 반대다.** 위험도가 이 값을 넘어야 개입하므로
 * 문턱을 올리면 개입이 줄어든다. 다섯을 전부 "낮아지면 약함"으로 짜면 `risk_threshold`를
 * 올린 모드가 상향으로 읽히고, 그게 바로 마찰 없이 마찰이 사라지는 길이다.
 *
 * 빠진 둘에도 이유가 있다:
 *   `ai_daily_cap` — ADR-024가 **지출 통제**로 규정한 값이다. 이걸 강도로 세면 예산 절감이 마찰을 부른다
 *   `sort`         — 표시 순서다. 정렬을 바꾸는 순간 하향 판정이 뒤집힌다
 */
const STRENGTH_DIR: Record<string, 1 | -1> = {
  max_level: 1,
  risk_threshold: -1,   // ← 높아지면 약함
  friction_mult: 1,
  use_fsi: 1,
  use_overlay: 1,
};

/** 하나라도 약해지면 하향. 놓치는 것보다 과하게 잡는 편이 옳다(ADR-027 §근거). */
export function isDowngrade(from: db.GuardModeRow, to: db.GuardModeRow): boolean {
  return Object.entries(STRENGTH_DIR).some(([col, dir]) => {
    const key = col as keyof db.GuardModeRow;
    return (Number(to[key]) - Number(from[key])) * dir < 0;
  });
}

/**
 * 지금이 보호 구간인가 — ADR-027 ②. **판정식을 새로 쓰지 않는다.**
 *
 * `schedule()`이 이미 각 보호 일정의 `protect_from`(보호 진입)과 `start`(일정 시각)를 계산한다.
 * 그 사이에 지금이 들어 있으면 보호 중이다. 데드라인 역산을 두 벌 두면 반드시 갈라지고,
 * 갈라지면 어느 쪽이 옳은지 알 수 없다 — T-16이 귀속일을 `attributionOfIso` 하나에 맡긴 것과 같다.
 */
export async function protectingNow(env: Env, t: TimeCtx) {
  const nowMs = Date.parse(t.now);
  const { events } = await schedule(env, t);
  return events.find((p) =>
    Date.parse(p.protect_from) <= nowMs && nowMs <= Date.parse(p.start)) ?? null;
}

/**
 * 모드 전환. **상향은 지금과 똑같이 자유롭고, 하향에만 마찰이 붙는다**(ADR-019 부수 규칙 1·2).
 *
 * 모드 전환은 Override의 완벽한 우회로다 — 새벽에 coach → secretary로 내리면 마찰이 전부
 * 사라진다. 그래서 하향은 보호 구간 중 금지(409)이고, 밖에서도 사유를 요구한다(400).
 *
 * **대기(60초)는 서버가 걸지 않는다**(ADR-027 ③). 서버는 60초가 실제로 흘렀는지 알 수 없다 —
 * Override의 대기도 기기가 세고 서버엔 결과만 온다. 서버가 할 수 있는 전부는 사유를 막는 것이다.
 */
export async function setMode(env: Env, t: TimeCtx, key: string, reason?: unknown) {
  const all = (await db.guardModes(env)).results;
  const next = all.find((m) => m.key === key);
  if (!next) throw new ApiError(404, "그런 모드가 없어요");
  const cur = all.find((m) => m.active === 1) ?? null;

  const down = !!cur && isDowngrade(cur, next);
  const text = typeof reason === "string" ? reason.trim() : "";
  if (down) {
    // ③ 보호 구간이 바로 사전 서약이 지켜야 할 구간이다 — 예외 없이 막는다(ADR-019 §감수하는 비용).
    const p = await protectingNow(env, t);
    if (p) throw new ApiError(409, `보호 중에는 내릴 수 없어요 — ${p.title}`);
    // ④ 사유는 §6.5의 데이터다. Override와 같이 길이 하한은 두지 않는다 — 비어 있지만 않으면 된다.
    if (!text) throw new ApiError(400, "왜 내리는지 적어주세요");
  }

  // 부분 유니크 인덱스(active=1) 때문에 해제 → 설정 순서를 지켜야 한다. batch로 원자.
  // ⑤ 기록은 방향과 무관하다 — 변경 궤적 자체가 분석 입력이고(§3), 하향만 남기면
  //   "내렸다 올렸다"의 앞뒤가 안 보인다. 사유가 붙는 쪽만 하향이다.
  await env.DB.batch([
    db.stClearActiveMode(env),
    db.stSetActiveMode(env, key),
    db.stMeHistory(env, "guard_mode", cur?.key ?? null, key, "user", t.now, down ? text : null),
  ]);
  return { active: key, downgrade: down, reason: down ? text : null };
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

  // 기기는 UTC('...Z')로 보낸다. 귀속일 계산과 `fired_at` 문자열 비교는 표기된 시각
  // 자리를 로컬로 읽으므로, **저장 전에 로컬 오프셋 표기로 맞춘다.**
  // 정규화가 없으면 KST 09~15시 발동이 전날로 귀속되고, `finalizeIgnored`의 유예도
  // 9시간 짧아진다. 클라이언트를 고치는 대신 여기서 흡수한다 — 9월 PC 에이전트가
  // 같은 실수를 해도 한 번 더 물리지 않는다.
  const firedAt = typeof input.fired_at === "string"
    ? normalizeIso(input.fired_at, t.offsetMin) : t.now;
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
  if (reaction === "override" && !reason) {
    throw new ApiError(400, "Override에는 사유가 필요해요");
  }
  // 반응 시각도 기기가 UTC로 보낸다. `fired_at`과 같은 표기여야 둘의 간격이 맞게 읽힌다.
  const at = typeof input?.reacted_at === "string"
    ? normalizeIso(input.reacted_at, t.offsetMin) : t.now;
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

/**
 * 반응 없이 남은 발동을 `ignored`로 확정한다 — **루프의 닫는 쪽**.
 *
 * 왜 필요한가: 수락·Override는 기기가 올려 주지만, 아무 반응 없이 지나간 발동은
 * 누구도 `reaction`을 쓰지 않아 영원히 NULL로 남는다. 그러면 §6.5 자기 보정이
 * "무시된 개입"이라는 가장 중요한 실패 사례를 아예 못 본다.
 *
 * ⚠️ 유예가 길어야 하는 이유(36시간): 기기는 오프라인이면 발동과 반응을 **함께**
 *    나중에 올린다(ADR-023). 재동기화는 하루 한 번(경계+10분)이라 최악의 지연이
 *    24시간에 가깝다. 서버가 먼저 `ignored`를 박으면 트리거가 진짜 반응을 막고,
 *    그 손실은 소급 복구가 불가능하다 — 개입 이력은 고칠 수 없기 때문이다.
 *    늦게 닫히는 것은 비용이 거의 없다. 보정은 10월에 집계되고, 그때 값이 맞으면 된다.
 */
export async function finalizeIgnored(env: Env, t: TimeCtx) {
  const GRACE_H = 36;
  // fired_at은 동일 오프셋 ISO다 — 문자열 비교로 순서가 보존된다.
  const cutoff = isoNow(Date.parse(t.now) - GRACE_H * 3_600_000, t.offsetMin);
  const stale = await db.guardEventsUnreacted(env, cutoff);
  for (const row of stale.results) {
    // 트리거가 이미 반응이 있으면 거부한다. WHERE reaction IS NULL이 먼저 걸러
    // 경합(같은 순간 기기가 올린 반응)에서도 조용히 지나간다.
    await db.stReactGuardEvent(env, row.id, "ignored", null, t.now).run();
  }
  return { ignored: stale.results.length, cutoff };
}

// ── Level 4 AI 검증 (ADR-024) ────────────────────────────────
//
// **Level 1~3은 손대지 않는다**(ADR-021). 이 함수는 Level 3 → 4 **격상**에만 조건을 붙인다.
// 실패 방향이 안전하다: AI를 못 부르면 Level 3에 머문다 — Level 3이 이미 화면 점유와
// 알람 소리를 하므로 개입이 사라지지 않고, 잃는 것은 격상뿐이다.
//
// **어떤 경우에도 200으로 답한다.** 판정 불가는 `level: 3`이지 500이 아니다 —
// 기기가 오류 분기를 타게 만들면 그 분기는 하필 새벽에 터진다.
//
// 지출 통제 6겹(ADR-024). 순서에 뜻이 있다:
//   ⑤ 킬 스위치 → ② 캐시 → ③ 일일 상한 → 키 확인 → ④ 타임아웃 8초 → ① 여기만 model_high를 부른다
// **캐시를 상한보다 먼저 본다** — 캐시 적중은 돈이 0이므로, 상한이 찼다고 이미 받은 판정을
// 버리면 그 밤의 Level 4가 이유 없이 죽는다. 상한이 막아야 하는 것은 '새 호출'이다.
const AI_TIMEOUT_MS = 8_000;
const DEFAULT_AI_DAILY_CAP = 5;

export type VerifySource = "ai" | "cache" | "cap" | "timeout" | "error" | "off";

export interface VerifyResult {
  level: 3 | 4;
  approved: boolean;
  reason: string;
  ai_used: 0 | 1;
  cached: boolean;
  source: VerifySource;
}

/**
 * `ai_used`는 **"판정을 받았는가"가 아니라 "모델을 불렀는가"**다 (T-07).
 *
 * 통제 ③이 지키려는 것은 판정의 수가 아니라 **지출**이다. 그러니 세는 지점도 돈이 나가는 지점 —
 * 요청이 나갔으면 1이다. 타임아웃·제공자 실패·파싱 실패는 전부 요청이 **이미 나간 뒤**다.
 * 이걸 0으로 세면 8초 타임아웃이 반복되는 밤에 상한이 사실상 사라진다.
 *
 * 가르는 선은 하나: **`callModel`에 들어갔는가.** 들어가기 전에 막힌 것(킬 스위치·캐시·상한·
 * 키 없음)은 0, 들어간 뒤 무슨 일이 나든 1이다.
 */
const stay3 = (source: VerifySource, reason: string, aiUsed: 0 | 1 = 0): VerifyResult =>
  ({ level: 3, approved: false, reason, ai_used: aiUsed, cached: false, source });

export async function verifyLevel4(env: Env, t: TimeCtx, input: any): Promise<VerifyResult> {
  // 이 엔드포인트는 격상 전용이다. 다른 Level을 물어 오는 것은 기기 배선 버그이므로
  // 조용히 3을 주지 않고 400으로 드러낸다 — 발동 경로의 오배선은 빨리 시끄러워야 한다.
  if (Number(input?.level_candidate) !== 4) {
    throw new ApiError(400, "level_candidate는 4여야 해요 — 이 경로는 Level 3→4 격상 전용이에요");
  }
  if (typeof input?.cause !== "string" || !input.cause.trim()) {
    throw new ApiError(400, "cause가 필요해요");
  }

  const onDate = t.d;
  const eventId = typeof input?.event_id === "string" && input.event_id.trim()
    ? input.event_id.trim() : null;

  // ⑤ 킬 스위치 — 끄면 **결정론으로 돌아간다(= 항상 격상)**. ADR-024가 정한 방향이다.
  // 여기서 Level 3으로 떨구면 "AI를 끄면 Guard가 약해진다"가 되어 끄기가 벌이 된다.
  const settings = Object.fromEntries((await db.settingsAll(env)).results.map((r) => [r.key, r.value]));
  if (String(settings.guard_ai_verify ?? "").trim() === "off") {
    return { level: 4, approved: true, reason: "AI 검증이 꺼져 있어요 — 결정론으로 격상해요",
      ai_used: 0, cached: false, source: "off" };
  }

  // ② event당 1회 캐시 — 가장 중요한 통제. Level 4는 30분마다 재발동한다.
  const hit = await db.guardAiVerdictFor(env, onDate, eventId);
  if (hit) {
    const approved = hit.ai_verdict === "approve";
    return { level: approved ? 4 : 3, approved,
      reason: `같은 ${eventId ? "일정" : "밤"}에 대한 판정을 재사용했어요 (${hit.id})`,
      ai_used: 0, cached: true, source: "cache" };
  }

  // ③ 일일 상한 — 모드 프로파일이 정한다(ADR-019).
  const mode = await db.guardActiveMode(env);
  const cap = mode?.ai_daily_cap ?? DEFAULT_AI_DAILY_CAP;
  const used = (await db.guardAiCallsOn(env, onDate))?.n ?? 0;
  if (used >= cap) return stay3("cap", `오늘 AI 검증 상한(${cap}회)을 다 썼어요 — Level 3으로 남아요`);

  // 키가 없으면 부를 수 없다. `callModel`은 이때 503을 던지는데, 그 예외를 그대로 올리면
  // 기기가 오류 분기를 탄다 — 여기서 흡수해 200 + Level 3으로 번역한다.
  const cfg = await aiConfig(env);
  const { provider } = splitModel(cfg.high, cfg.provider);
  if (!cfg.high || !cfg.keyOf(provider)) {
    return stay3("error", "model_high 키가 없어요 — 검증 없이 격상하지 않아요");
  }

  // ④ 타임아웃 8초. `callModel`의 시그니처를 바꾸지 않는다(분석 경로가 물린다) —
  // 호출부에서 race를 씌운다. 진 쪽의 fetch는 버려진다.
  const core = await buildCoreContext(env, t);
  const started = Date.now();
  let text: string;
  try {
    text = await Promise.race([
      callModel(env, {
        model: cfg.high,
        system: VERIFY_SYSTEM,
        user: verifyUser(core, t, input),
        maxTokens: 300,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("__timeout__")), AI_TIMEOUT_MS)),
    ]);
  } catch (e: any) {
    if (e?.message === "__timeout__") {
      // **요청은 이미 나갔다.** 응답을 안 기다릴 뿐이므로 지출은 발생했다 → 1 (T-07).
      return stay3("timeout", `${AI_TIMEOUT_MS / 1000}초 안에 판정이 안 왔어요 — Level 3으로 남아요`, 1);
    }
    // 503은 `callModel`이 **요청을 보내기 전에** 키가 없어서 던지는 것이다(ai.ts).
    // 위에서 이미 걸렀으므로 여기 오는 건 그 사이에 키가 지워진 경우뿐 — 나가지 않았으니 0.
    // 그 밖(502 제공자 응답 실패·fetch 거절)은 전부 요청이 나간 뒤다 → 1.
    const wentOut = !(e instanceof ApiError && e.status === 503);
    return stay3("error",
      `검증을 못 했어요 — Level 3으로 남아요 (${e?.message ?? "알 수 없는 오류"})`,
      wentOut ? 1 : 0);
  }

  // 형식을 어긴 응답은 **사용자에 대한 판단으로 번역하지 않는다.** 거부가 아니라 판정 불가다.
  // 요청도 응답도 있었으므로 지출은 발생했다 → 1.
  const parsed = parseModelJson<{ approve?: unknown; reason?: unknown }>(text);
  if (!parsed || typeof parsed.approve !== "boolean") {
    return stay3("error", "판정을 형식대로 받지 못했어요 — Level 3으로 남아요", 1);
  }

  const reason = typeof parsed.reason === "string" && parsed.reason.trim()
    ? parsed.reason.trim() : (parsed.approve ? "격상 필요" : "격상 불필요");
  // ⑥ 기록은 기기가 발동을 올릴 때 `record()`가 한다 — ai_used·ai_verdict를 함께 받는다.
  //   여기서 행을 만들지 않는다: 검증만 하고 발동하지 않은 밤의 유령 행이 개입 이력을 오염시킨다.
  return {
    level: parsed.approve ? 4 : 3,
    approved: parsed.approve,
    reason: `${reason} (${Date.now() - started}ms)`,
    ai_used: 1,
    cached: false,
    source: "ai",
  };
}

// 묻는 것은 **"지금이 Level 4에 해당하는가"** 하나다. "얼마나 강하게 개입할지"를 묻지 않는다 —
// 개입 수위는 규칙과 모드 프로파일이 정하고, 모델에 넘기면 그게 §6.3이 경고한 도구 이탈이다.
const VERIFY_SYSTEM = [
  "너는 개인 판단-보조 시스템의 개입 수위 검증기다.",
  "Level 3(화면 점유 + 알람)이 이미 발동한 상태에서, Level 4(신규 작업 차단까지)로 격상할 근거가 있는지만 판정한다.",
  "격상은 비싸다 — 근거가 분명하지 않으면 승인하지 않는다. 정보가 부족하면 승인하지 않는다.",
  'JSON 한 덩어리로만 답한다: {"approve": true|false, "reason": "한 문장"}',
].join("\n");

function verifyUser(core: string, t: TimeCtx, input: any): string {
  const snap = input?.risk_snapshot ? JSON.stringify(input.risk_snapshot) : "정보 없음";
  return [
    "[사용자 코어 컨텍스트]",
    core,
    "",
    "[이번 발동의 사실]",
    `- 현재: ${t.now} (귀속일 ${t.d})`,
    `- 발동 사유: ${input?.cause ?? "정보 없음"}`,
    `- 연결된 일정: ${input?.event_id ?? "없음 (감지 경로)"}`,
    `- 전면 앱: ${input?.foreground_app ?? "정보 없음"}`,
    `- risk_snapshot: ${snap}`,
    "",
    "위 사실이 Level 4 격상에 해당하는가?",
  ].join("\n");
}

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
