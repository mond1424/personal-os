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
import { addDays, attributionOfIso, isoNow, normalizeIso } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";
// 시간표는 규칙이라 조회 시 전개된다(T-58). Guard는 **읽기만** 한다 — 전개도 저장도 저쪽 몫이다.
import { classesIn } from "./timetable";

/** 설정 기본값 — event별 값이 없을 때. 초기값의 정확도보다 조정 가능한 구조가 중요하다. */
const DEFAULT_SLEEP_MIN = 360;   // 6시간
const DEFAULT_PREP_MIN = 90;     // 기상~출발

const LEVELS = [1, 2, 3, 4];
const REACTIONS = ["accepted", "override", "ignored"];

/**
 * `ai_verdict='unavailable'`의 **이유** — 닫힌 목록 (T-31 · 0016).
 *
 * **여기가 대장이다.** `migrations/0016`의 CHECK와 `GuardVerify.kt`의 상수는 이것의 메아리이고,
 * 셋이 갈라지면 smoke가 빨간불이 된다 — 두 곳에 두면 갈라진다는 것을 이 리포가 두 번 물렸다.
 *
 * 닫아 두는 이유는 **12월에 세어야 하기 때문**이다. 자유 문자열이면 같은 원인이
 * 여러 철자로 흩어져 집계가 안 되고, 그러면 ADR-024를 재검토할 재료가 없다.
 */
export const UNAVAILABLE_REASONS = [
  "timeout", "dns", "network", "bad_response", "no_base",
  "server_timeout", "server_error", "cap",
] as const;

/** 2xx가 아닌 응답은 코드까지 — 401(토큰 만료)과 503(과부하)의 대응이 다르다. */
const HTTP_REASON = /^http_[0-9]{3}$/;

/**
 * 목록 밖은 **버리되 행은 살린다.** 여기서 400을 던지면 0016의 CHECK에 걸리는 것과
 * 결과가 같아진다 — 기기의 `flush()`가 400을 '재시도 무의미'로 보고 **발동 행을 버린다.**
 * 이 티켓이 늘리려는 것이 그 행이므로, **이유 하나 때문에 기록을 잃지 않는다.**
 * (구버전 서버 + 신버전 APK로 값이 갈리는 경우가 실제로 그 자리다.)
 *
 * 판정이 있으면 이유는 없다 — `approve`인데 "왜 못 불렀는가"가 붙으면 그 자체가 거짓이다.
 */
const unavailableReason = (verdict: string | null, raw: unknown): string | null => {
  if (verdict !== "unavailable") return null;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  return (UNAVAILABLE_REASONS as readonly string[]).includes(s) || HTTP_REASON.test(s) ? s : null;
};

/** 모델이 쓴 문장이라 상한이 없다 — 개입 이력은 영구 보존이므로 여기서 한 번 자른다. */
const AI_REASON_MAX = 500;

/**
 * **왜 그렇게 답했나** (T-38 · 0017). 위 `unavailableReason`과 정확히 반대편이다 —
 * 저쪽은 판정이 **없을 때만**, 이쪽은 판정이 **있을 때만** 값이 있다.
 *
 * `unavailable`에 이 값이 붙으면 그 자체가 거짓이다: 못 물어봤는데 "왜 그렇게 답했는지"가
 * 있을 수 없다. 기기도 같은 판단을 하지만(`Verdict.aiReason`) **여기서 다시 막는다** —
 * 옛 APK·PC 에이전트·수기 POST가 모두 이 문을 지나고, 둘이 갈라지면 서버가 이긴다.
 *
 * **길어도 거부하지 않고 자른다.** 400을 던지면 기기의 `flush()`가 '재시도 무의미'로 보고
 * **발동 행을 버린다**(T-31이 잡힌 자리 · 0016 주석). 이유 하나 때문에 기록을 잃지 않는다.
 */
const aiReason = (verdict: string | null, raw: unknown): string | null => {
  if (verdict !== "approve" && verdict !== "deny") return null;
  const s = typeof raw === "string" ? raw.trim() : "";
  return s ? s.slice(0, AI_REASON_MAX) : null;
};

/**
 * 뒤늦게 온 판정에서 **채울 것이 있는지** 본다 (T-39). 없으면 `null` — 단순 재시도가
 * 쓸데없이 UPDATE를 돌지 않게 한다.
 *
 * 값을 만드는 규칙은 insert 경로와 **같은 함수**를 쓴다. 두 벌로 두면
 * "직접 올린 행"과 "뒤늦게 채운 행"이 서로 다른 정규화를 거치게 되고,
 * 12월에 그 둘을 같은 표에서 세게 된다.
 */
const aiAmendOf = (input: any) => {
  const verdict = input?.ai_verdict ?? null;
  const a = {
    ai_used: (input?.ai_used ? 1 : 0) as 0 | 1,
    ai_verdict: verdict,
    ai_unavailable_reason: unavailableReason(verdict, input?.ai_unavailable_reason),
    ai_reason: aiReason(verdict, input?.ai_reason),
  };
  return a.ai_used || a.ai_verdict || a.ai_unavailable_reason || a.ai_reason ? a : null;
};

// Override 사유에 **길이 하한을 두지 않는다.**
// 20자 규칙을 뒀다가 실사용에서 마찰이 아니라 강제로 읽혀 걷어냈다 —
// §6.3이 원하는 것은 "비용을 치르게 한다"이지 "분량을 채우게 한다"가 아니다.
// 마찰은 대기 시간(friction_mult)이 지고, 사유는 §6.5의 데이터로서 비어 있지만 않으면 된다.
// (DB CHECK도 `override_reason IS NOT NULL`까지만 요구한다)

// ── 조회 ──────────────────────────────────────────────────────

export const events = async (env: Env, limit = 100) =>
  (await db.guardEventsList(env, limit)).results;

/** 시간 맥락은 **받는다** — 요청당 한 번이고 그 자리는 미들웨어다(`TimeCtx` 주석 1.2). */
export async function modes(env: Env, t: TimeCtx) {
  const rows = (await db.guardModes(env)).results;
  const active = rows.find((m) => m.active === 1) ?? null;
  const protecting = await protectingNow(env, t);

  return {
    modes: rows.map((mode) => ({
      ...mode,
      downgrade: active ? isDowngrade(active, mode) : false,
    })),
    active,
    protecting: protecting ? {
      title: protecting.title,
      start: normalizeIso(protecting.protect_from, t.offsetMin),
      until: normalizeIso(protecting.start, t.offsetMin),
    } : null,
  };
}

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
/**
 * 보호 일정 하나의 시각 축 — `start` · `deadline` · 보호 진입(`from`).
 *
 * **역산은 이 함수 하나뿐이다.** 두 벌 두면 반드시 갈라지고, 갈라지면 UI는 "01:30"이라 쓰고
 * 알람은 다른 시각에 울린다 — 새벽 실패다(`protectingNow`의 주석과 같은 이유).
 * T-32가 `record()`에서도 데드라인이 필요해지자 `schedule()` 안에 있던 것을 여기로 꺼냈다.
 */
function protectAxis(e: db.EventRow, offsetMin: number) {
  const sleep = e.protect_sleep_min ?? DEFAULT_SLEEP_MIN;
  const prep = e.protect_prep_min ?? DEFAULT_PREP_MIN;
  // 시각이 없는 종일 일정은 09:00으로 본다 — 시험·약속의 통상 시작
  const hhmm = e.time ?? "09:00";
  const start = new Date(`${e.date}T${hhmm}:00${offsetSuffix(offsetMin)}`);
  const deadline = new Date(start.getTime() - (prep + sleep) * 60_000);
  // 보호 모드 진입 — '-1d 00:00' 형식. 파싱 실패 시 데드라인 24시간 전으로 폴백.
  const from = parseRelative(e.protect_from ?? null, start, offsetMin)
    ?? new Date(deadline.getTime() - 24 * 3600_000);
  return { start, deadline, from, sleep, prep };
}

/**
 * ★ **아침에 무엇이 기다리는가** — Level 2가 밤마다 다른 말을 할 재료 (ADR-047 · T-60).
 *
 * L2의 조건은 *"화면이 N분 이상 켜져 있다"* 하나뿐이었고 **그 시각에 그것은 거의 언제나
 * 참이라, 여섯 밤(8/26~8/31)이 100% 무시됐다.** 항상 참인 신호는 아무것도 말하지 않는다.
 * 이 목록이 *"오늘 밤이 다른 밤과 어떻게 다른가"* 를 준다 — **T-58 전까지는 원천에 없던 값이다.**
 *
 * ★ **하루에 하나, 그 날 가장 이른 약속만 싣는다.** 기기가 알아야 하는 것은
 *   *"자고 일어나서 곧 해야 할 것이 있나"* 이고, 그 뒤의 일정은 그 판단을 안 바꾼다.
 *
 * ⚠️ **시각이 없는 종일 일정은 세지 않는다.** 공휴일·기념일이 `09:00`으로 읽히면
 *    (`protectAxis`는 그렇게 읽는다 — 저쪽은 *보호할 시험*이라 맞다) **추석 전날 밤에 L2가
 *    뜬다.** 그건 이 티켓이 없애려는 바로 그 소음이다. 종일로 적힌 시험은 `protect_from`이
 *    붙어 **예약 경로(`fires[]`)가 이미 지키므로**, 여기서 빠져도 안전 쪽이 안 뚫린다.
 *
 * ⚠️ **지난 것은 안 싣는다**(`fires[]`와 같은 규칙). 기기는 여기서 *"now 이후 첫 항목"* 을
 *    고르는데, 이미 지난 항목이 섞여 있으면 그 고르기가 재료 순서에 의존하게 된다.
 */
const WAKE_WINDOW_DAYS = 30;

async function wakePoints(env: Env, t: TimeCtx, days: number) {
  // ⚠️ **`days`를 그대로 쓰지 않는다.** `classesIn`은 창이 너무 넓으면 **던지고**(400),
  //    그러면 넓은 `?days=`가 기기의 예약 pull을 **통째로** 깨뜨린다 — 지금까지 무해하던
  //    질의 인자가 아침 재료를 붙인 순간 다른 것까지 끊는 손잡이가 된다.
  //    기기에 필요한 것은 *"동기화가 며칠 실패해도 버틸 만큼"* 이고 그 이상은 쓰이지 않는다.
  const end = addDays(t.d, Math.max(1, Math.min(days, WAKE_WINDOW_DAYS)));
  const nowMs = Date.parse(t.now);
  const [classes, evs] = await Promise.all([
    classesIn(env, t.d, end),                  // 규칙에서 전개한 파생 — 저장 없음 (T-58)
    db.eventsRange(env, t.d, end),
  ]);

  const best = new Map<string, { at: string; title: string; source: "class" | "event" }>();
  const put = (date: string, time: string, title: string, source: "class" | "event") => {
    const at = new Date(`${date}T${time}:00${offsetSuffix(t.offsetMin)}`);
    const ms = at.getTime();
    if (!Number.isFinite(ms) || ms <= nowMs) return;
    const cur = best.get(date);
    if (cur && Date.parse(cur.at) <= ms) return;
    best.set(date, { at: at.toISOString(), title, source });
  };
  for (const c of classes) put(c.date, c.start_time, c.subject, "class");
  for (const e of evs.results) if (e.time) put(e.date, e.time, e.title, "event");

  return [...best.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));
}

export async function schedule(env: Env, t: TimeCtx, days = 30) {
  const rows = (await db.protectedEvents(env, t.d, days)).results;
  const mode = await db.guardActiveMode(env);
  const maxLevel = mode?.max_level ?? 4;
  const nowMs = Date.parse(t.now);   // 요청당 한 번 읽은 시계를 그대로 쓴다 (T-23 · T-26)

  const plans = rows.map((e) => {
    const { start, deadline, from, sleep, prep } = protectAxis(e, t.offsetMin);
    const cap = Math.min(e.protect_level ?? 4, maxLevel);

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
    // ★ **재료이지 판정이 아니다** (ADR-047 · T-60). *"띄울까 말까"* 는 기기가 발동 시점에
    //   정한다 — 그 판단에 `now`가 들어가고, 발동 경로엔 네트워크가 없기 때문이다(ADR-021).
    //   서버는 *"무엇이 언제 있다"* 까지만 말한다.
    wake: await wakePoints(env, t, days),
  };
}

// ── Level 2 무시 누적 (ADR-047 ③ · T-60) ─────────────────────

/**
 * ⚠️ **기본값은 여기 하나뿐이고, `settings`가 덮는다.** 하루 경계와 같은 모양이다 —
 * 문서·티켓에 숫자를 적지 않는 이유도 같다(적으면 두 벌이 되고 그 순간 한쪽이 낡는다).
 */
const L2_NAG_KEY = "guard_l2_ignore_threshold";
const L2_NAG_ACK_KEY = "guard_l2_ignore_ack";
const DEFAULT_L2_NAG = 3;

const l2NagInt = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/**
 * 연속 무시가 임계를 넘으면 **끄는 선택지를 준다** — 더 세게 하지 않는다 (ADR-047 ③).
 *
 * ★ **무시로 개입을 늘리지 않는 것이 이 조항의 핵심이다.** 자동 강화는 ②와 정면 충돌한다:
 *   공강 전날의 무시가 쌓여 **시험 전날 과잉 개입**이 된다. 끌 수 없는 알림은 사용자가
 *   OS에서 무음 처리하고, 그러면 개입도 **관측도** 함께 잃는다(ADR-026의 이탈 경로).
 *
 * ⚠️ **`reaction IS NULL`은 세지도, 끊지도 않는다.** `finalizeIgnored`의 유예가 36시간이라
 *    (기기가 오프라인이면 발동과 반응을 함께 늦게 올린다 — ADR-023) 어젯밤 발동은 오늘
 *    구조적으로 NULL이다. NULL이 끊으면 이 값은 **영원히 0에 가깝고 카드가 한 번도 안 뜬다** —
 *    `daily.ts`가 `ignored`를 문장으로 말하지 않기로 한 것과 같은 자리다.
 */
export async function l2Nag(env: Env) {
  const [rows, settings] = await Promise.all([
    db.guardWatchL2Recent(env),
    db.settingsAll(env),
  ]);
  const s = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));

  let streak = 0;
  for (const r of rows.results) {
    if (r.reaction === null) continue;          // 아직 확정 전 — 모른다는 뜻이다
    if (r.reaction !== "ignored") break;        // 한 번이라도 응답했으면 연속이 끊긴다
    streak++;
  }

  const threshold = l2NagInt(s[L2_NAG_KEY], DEFAULT_L2_NAG);
  const ack = l2NagInt(s[L2_NAG_ACK_KEY], 0);
  return {
    streak,
    threshold,
    ack,
    // ★ `streak > ack`가 짝이다 — 없으면 *"그대로"* 를 고른 사용자에게 **같은 카드가
    //   매번 다시 뜬다.** 그건 이 카드가 없애려는 잔소리와 같은 모양이다.
    over: streak >= threshold && streak > ack,
  };
}

/** *"봤다"* 를 적는다 — 끄든 그대로 두든, 이 숫자까지는 다시 묻지 않는다. */
export async function ackL2Nag(env: Env) {
  const cur = await l2Nag(env);
  await db.stSettingPut(env, L2_NAG_ACK_KEY, String(cur.streak)).run();
  return { ...cur, ack: cur.streak, over: false };
}

// ── 기록 ──────────────────────────────────────────────────────

/** §6.6 서버 항을 볼 창(일). Score 추세·Feelings가 이 폭으로 잡힌다. */
const RISK_WINDOW_DAYS = 7;

/**
 * §6.6의 **서버 출처 항** — `risk_snapshot`에 얹힌다 (T-32).
 *
 * 계획(APP-PLAN §위험도)은 Log 활동·수면 추정·Feelings·Score 추세·데드라인까지의 시간을
 * 요구하는데 **기기엔 그 데이터가 없다.** ADR-021이 발동을 기기로 옮기면서 스냅샷 생산도
 * 같이 기기로 갔고, 서버 출처 항이 통째로 사라진 채 아무 데도 안 적혔다 — 그걸 여기서 메운다.
 *
 * ★ **전부 `firedAt` 기준이다. `t.now`가 아니다.**
 * `record()`는 오프라인에서 쌓였다가 나중에 올라오는 경로도 탄다(ADR-023).
 * "지금"으로 조회하면 **새벽 발동의 스냅샷이 아침 값으로 채워지고**, 그 오염은
 * **네트워크가 나쁜 밤에만** 일어난다 — 즉 가장 읽고 싶은 밤에만.
 *
 * ★ **발동 이후에 생긴 기록은 쓰지 않는다.** 큐가 늦게 올라오면 그 사이의 Log가 DB에 있는데,
 * 그것까지 담으면 스냅샷이 **판단 시점에 없던 것을 안다.** `ts <= firedAt`으로 자른다.
 * (Feelings·Score는 날짜 단위라 보장도 날짜 단위다 — 아래 각 항에 적어 둔다.)
 */
async function riskServerTerms(
  env: Env, t: TimeCtx, firedAt: string, onDate: string, eventId: string | null,
) {
  const firedMs = Date.parse(firedAt);
  const from = addDays(onDate, -RISK_WINDOW_DAYS);
  const prev = addDays(onDate, -1);

  // ── 최근 Log 활동 (각성 신호) · 수면 추정 (§1.2) ──
  // 같은 조회로 둘을 낸다 — 원본이 하나이므로 두 번 물을 이유가 없다.
  const logs = (await db.logsRange(env, from, onDate)).results
    .filter((l) => Date.parse(l.ts) <= firedMs);          // ★ 발동 이후는 없던 일이다
  const dayLast = logs.at(-1) ?? null;
  const logs24h = logs.filter((l) => Date.parse(l.ts) > firedMs - 24 * 3600_000).length;
  const hm = (iso: string) => {
    const m = /T(\d{2}:\d{2})/.exec(iso);
    return m ? m[1] : null;
  };
  const prevLogs = logs.filter((l) => l.date === prev);

  // ── 최근 Feelings — 가장 최근에 기록된 날의 값 ──
  // 날짜 단위라 '발동 이후 작성'을 초 단위로 가를 수 없다. 귀속일 경계(기본 06:00) 덕에
  // 새벽 발동의 onDate는 전날이고 그 날 Feelings는 낮에 쓰인 것이라 실무상 과거다.
  const feels = (await db.feelingsRange(env, from, onDate)).results;
  const feelDate = feels.at(-1)?.date ?? null;
  const feelings = feelDate
    ? Object.fromEntries(feels.filter((f) => f.date === feelDate).map((f) => [f.field, f.value]))
    : null;

  // ── Score 추세 ──
  // 마감 때 매겨지므로 발동 시점의 onDate는 보통 아직 비어 있다 — 그게 사실이다.
  const scores = (await db.dailyRange(env, from, onDate)).results
    .filter((d) => d.score !== null) as { date: string; score: number }[];
  const last = scores.at(-1)?.score ?? null;
  const avg = scores.length
    ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : null;

  // ── 데드라인까지 남은 시간 · 보호 구간이었나 ──
  // 역산은 `protectAxis` 하나뿐이다(위). 여기서 다시 쓰지 않는다.
  let deadlineMin: number | null = null;
  let protecting: boolean | null = null;
  if (eventId) {
    const ev = await db.eventGet(env, eventId);
    if (ev?.protect_from != null) {
      const ax = protectAxis(ev, t.offsetMin);
      deadlineMin = Math.round((ax.deadline.getTime() - firedMs) / 60_000);  // 음수 = 지났다
      protecting = ax.from.getTime() <= firedMs && firedMs <= ax.start.getTime();
    }
  }

  return {
    at: firedAt, on_date: onDate, window_days: RISK_WINDOW_DAYS,
    deadline_min: deadlineMin,          // 데드라인까지 남은 분 (음수 = 이미 지났다)
    protecting,                         // 보호 구간 안이었나 (event 없으면 null)
    logs_24h: logs24h,                  // 각성 신호 — 발동 직전 24시간의 기록 수
    log_last_min: dayLast ? Math.round((firedMs - Date.parse(dayLast.ts)) / 60_000) : null,
    sleep_prev_last: prevLogs.at(-1) ? hm(prevLogs.at(-1)!.ts) : null,   // 전날 마지막 기록
    sleep_prev_first: prevLogs[0] ? hm(prevLogs[0].ts) : null,           // 전날 첫 기록
    feelings, feelings_date: feelDate,
    score_last: last, score_avg: avg,
    score_trend: last !== null && avg !== null ? last - avg : null,
  };
}

/**
 * 위험도 점수 — **기록 전용. 게이트가 아니다** (ADR-021 · T-32 ②).
 *
 * 발동이 **이미 끝난 뒤**에 계산하므로 구조적으로 게이트가 될 수 없다.
 * 그것이 ADR-021이 요구한 형태다 — *"위험도는 기록하되 발동 게이트로 쓰지 않는다."*
 *
 * ⚠️ **가중치는 전부 임시값이다.** 10월에 실제 스냅샷에서 유도한다(APP-PLAN §위험도).
 * 지금 정교하게 만들 이유가 없다 — 목적은 *"그 순간의 값들로 낸 숫자가 남아 있다"*까지다.
 * 항이 넷뿐인 것도 의도다. 늘리면 유도할 때 무엇이 기여했는지 가리기만 어려워진다.
 */
function riskScore(device: Record<string, unknown>, s: Awaited<ReturnType<typeof riskServerTerms>>): number {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  let n = 0;
  // ① 심야일수록. 0~6시가 §6.1이 겨냥한 구간이다.
  const hour = num(device.hour);
  if (hour >= 0 && hour < 6) n += 25; else if (hour >= 22) n += 15;
  // ② 사용자가 실제로 붙잡고 있던 시간. **개입이 켜 둔 몫은 뺀다** — T-30·T-31이 가른 그 자리다.
  const userSec = Math.max(0, num(device.screen_on_sec) - num(device.intervene_sec));
  if (userSec >= 3600) n += 30; else if (userSec >= 1800) n += 20;
  // ③ 데드라인을 이미 지났는가. 지난 뒤가 §6.1의 Level 4 구간이다.
  if (s.deadline_min !== null) n += s.deadline_min < 0 ? 25 : s.deadline_min <= 120 ? 15 : 0;
  // ④ 각성 신호 — 발동 직전까지 기록하고 있었다면 깨어 있던 것이 확실하다(§1.2).
  if (s.log_last_min !== null && s.log_last_min <= 60) n += 10;
  return Math.min(100, n);
}

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
      // **판정도 뒤늦게 온다** (T-39). 검증은 발동 뒤 최악 16초까지 걸리는데(T-37),
      // 그 사이에 사용자가 반응하면 `flush()`가 발동 행을 먼저 올려 버린다 —
      // 새벽에 깨서 화면을 바로 치우는 것은 **드문 일이 아니라 기본값**이다.
      // 전엔 여기서 `reaction`만 봐서, 기기를 고쳐도 판정이 서버에 안 실렸다.
      const amend = aiAmendOf(input);
      if (amend) await db.stAmendGuardAi(env, dup.id, amend).run();
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

  // ── §6.6 서버 항을 얹는다 (T-32) ──
  // **기기가 스냅샷을 안 보냈으면 만들지 않는다.** "기기가 안 보낸 것"과 "서버가 못 찾은 것"은
  // 다른 사실이고, 서버 항만으로 행을 만들면 12월에 그 둘이 같은 모양으로 보인다.
  const deviceSnap = input.risk_snapshot && typeof input.risk_snapshot === "object"
    ? input.risk_snapshot as Record<string, unknown> : null;
  // **출처를 평면에 섞지 않는다.** 기기 항은 최상위 그대로 두고 서버 항은 `server` 아래 —
  // 섞으면 12월에 "이 항은 누가 잰 것인가"를 물을 수 없다. 기기 키의 이름도 바꾸지 않는다
  // (8월 표본과 갈라진다). **더하고, 바꾸지 않는다.**
  const server = deviceSnap ? await riskServerTerms(env, t, firedAt, onDate, input.event_id ?? null) : null;
  const snapshot = deviceSnap && server ? { ...deviceSnap, server } : null;

  await db.stInsertGuardEvent(env, {
    id, fired_at: firedAt, on_date: onDate, cause: input.cause.trim(), level,
    mode,
    source: input.source === "pc" ? "pc" : "android",
    foreground_app: input.foreground_app ?? null,
    // 점수는 **서버가 낸다** (T-32 ②). 기기는 항 값만 뜨고 점수를 내지 않는다 —
    // 발동이 끝난 뒤에 계산하므로 게이트가 될 수 없고, 그것이 ADR-021이 요구한 형태다.
    // 기기가 굳이 보내면 그것을 존중한다(9월 PC 에이전트 자리).
    risk_score: Number.isFinite(Number(input.risk_score)) ? Number(input.risk_score)
      : (deviceSnap && server ? riskScore(deviceSnap, server) : null),
    // 판단 시점의 항 값 전부. 자기 보정의 원재료 — 소급해서 만들 수 없다.
    risk_snapshot: snapshot ? JSON.stringify(snapshot) : null,
    ai_used: input.ai_used ? 1 : 0,
    ai_verdict: input.ai_verdict ?? null,
    // 왜 못 불렀는가 (0016). 목록 밖이면 조용히 비운다 — 위 주석 참조.
    ai_unavailable_reason: unavailableReason(input.ai_verdict ?? null, input.ai_unavailable_reason),
    // 왜 그렇게 답했는가 (0017). 판정이 있을 때만 — 위 둘은 짝이고 동시에 차지 않는다.
    ai_reason: aiReason(input.ai_verdict ?? null, input.ai_reason),
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

/**
 * 뒤따른 발동이 있었으면 **그 사이에 자지 않은 것이다** (T-56 · ADR-044).
 *
 * ★ **`outcome`에 쓰지 않는다.** 그 칸은 append-only라 시스템이 먼저 박으면 사용자가
 *   *"아니 그건 잤다가 깬 거였다"* 라고 답할 길이 **DB 층에서 막힌다.** 그리고 §6.5가
 *   전례를 읽을 때 *"사람이 말한 것"* 과 *"기계가 추론한 것"* 이 한 칸에 섞인다 —
 *   T-50이 `ai_*`를 따로 지킨 것과 같은 이유다. **판단의 출처를 섞지 않는다.**
 *
 * 그래서 **다른 이름으로 나간다.** 화면은 이것으로 자리를 채우되 버튼을 남기고,
 * 사용자가 누르면 그 답이 `outcome`에 들어가 이긴다.
 */
const outcomeInferred = (laterFires: number) => (laterFires > 0 ? "failure" : null);

export const pendingOutcome = async (env: Env) =>
  (await db.guardEventsPendingOutcome(env)).results.map((r) => ({
    ...r,
    outcome_inferred: outcomeInferred(r.later_fires ?? 0),
  }));

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
//
// **Level 4의 대가를 사실대로 적는다** (T-29). 원래 "신규 작업 차단까지"라고 적혀 있었는데
// 그 강제력은 구현이 없었고, 모델이 없는 대가를 저울에 올려 판정했다 — 그렇게 쌓인
// `guard_events`가 §6.5가 읽을 전례다. T-28이 거짓을 지웠고 T-29가 강제력을 만들었다.
// **"차단"이라고 쓰지 않는다 — 막지 않기 때문이다**(ADR-035): 적는 것도 대기에 담는 것도
// 내일 이후를 고르는 것도 그대로이고, 바뀌는 것은 그것이 어느 날에 놓이는가 하나다.
const VERIFY_SYSTEM = [
  "너는 개인 판단-보조 시스템의 개입 수위 검증기다.",
  "Level 3(화면 점유 + 알람)이 이미 발동한 상태에서, Level 4로 격상할 근거가 있는지만 판정한다.",
  "Level 4의 대가: Override 대기가 60초에서 180초로 늘고, 격상 뒤 30분 동안 오늘 날짜가 새로 붙지 않는다 — 새 일도, 미루던 일도 내일 이후로 간다.",
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
