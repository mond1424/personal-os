// 과제 재촉 (ADR-050 · T-87) — 마감에서 재촉 시각을 계산한다.
//
// ★★ **저장하지 않는다.** 재촉 시각은 마감과 설정으로 정해지는 파생이다(원칙 1 · ADR-050 ⑥) —
//   요청마다 계산하고, *"몇 번째 재촉 뒤에 끝냈나"* 도 나중에 같은 계산으로 다시 나온다.
// ⚠️⚠️ **`guard_events`에 쓰지 않는다.** 그 표는 밤 개입의 원장이고 지울 수 없다(ADR-050 ⑥).
//   이 파일은 `db.nudgeTargets` 하나만 읽고 아무것도 쓰지 않는다.
//
// 울리는 것은 기기다(ADR-021 · T-88). 여기는 *"언제 무엇이"* 까지만 말한다 —
// **"마감까지 N시간" 은 만들지 않는다**: 만들면 받은 순간에 굳어 새벽의 알림이 저녁 기준으로 말한다
// (ADR-047 · `wakePoints`와 같은 이유). 기기가 `due − now`로 만든다.
import * as db from "../db";
import { courseOf } from "../lib/course";
import { addDays, attributionOfIso, isoNow } from "../lib/time";
import type { Env, TimeCtx } from "../types";

/**
 * ★ **저녁·아침 시각은 설정이 갖는다**(ADR-050 ② — 하루 경계와 같은 이유).
 * ⚠️ **기본값의 자리는 여기 하나다** — 문서·화면에 시각을 적지 않는다(적으면 두 벌이 된다).
 */
export const NUDGE_EVENING_KEY = "nudge_evening";
export const NUDGE_MORNING_KEY = "nudge_morning";
const DEFAULT_EVENING = "21:00";
const DEFAULT_MORNING = "09:00";

/** 마감 몇 시간 전 — ADR-050 ②의 뒤의 둘. */
const HOURS_BEFORE = [3, 1];

/**
 * **두 점 사이가 이것 미만이면 늦은 쪽 하나만** (ADR-050 ② 정리 규칙).
 * ⚠️⚠️ **미만(<)이다 — 정각 1시간 간격은 합치지 않는다** (ADR-050 ② 개정 · T-88 ①-a).
 *    T-87 은 이하(≤)로 짰고 그러면 **사슬로 무너진다**: 11:00 마감의 08:00(3시간 전)·09:00(아침)·10:00(1시간 전)이
 *    정확히 1시간씩이라 08→09, 09→10 이 차례로 합쳐져 **10:00 하나만** 남는다 — 사용자가 고른 넷 중 셋이 사라진다.
 *    ★ 이 규칙은 **거의 같은 시각의 중복**을 없애려는 것이지 간격을 줄이려는 것이 아니다.
 */
const MERGE_MS = 3600_000;

/** 기기가 동기화를 며칠 못 해도 버틸 만큼만 — `wakePoints`의 창과 같은 판단이다. */
const MAX_DAYS = 30;

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** `settings` 값은 문자열이라 읽을 때마다 다시 본다 — 형식이 아니면 기본값(던지면 예약 재료가 통째로 안 내려간다). */
const hmOr = (v: string | undefined, fallback: string) => (v && HM.test(v) ? v : fallback);

export type NudgeItem = { task_id: string; course: string | null; title: string; due: string };
export type NudgeBundle = { at: string; items: NudgeItem[] };

/**
 * 재촉 묶음 — 시각순. `GET /api/guard/schedule`의 `nudges`가 이것이다.
 *
 * ```
 * 전날 저녁    마감 귀속일의 전날, 설정 "저녁"
 * 당일 아침    마감 귀속일,       설정 "아침"
 * 3시간 전 · 1시간 전
 * ```
 *
 * ★★ **"전날"·"당일"은 귀속일로 센다** — 새벽 1시 마감은 사용자 머릿속에서 그 전날의 일이다.
 *   달력 날짜로 세면 *"당일 아침"* 이 마감 **뒤**(그날 09:00)로 가서 사라진다.
 *   ⚠️ 하루 경계는 `t.boundary`(설정값)다 — 상수로 박지 않는다.
 *
 * **정리 규칙 넷**(ADR-050 ② 개정):
 * ```
 * 요청 시점에 이미 지난 점       뺀다
 * 마감 시각 이후·같은 시각의 점   뺀다 (사후 재촉은 없다 — ⑤ · 같은 시각이면 "마감까지 0분" 이다)
 * 두 점 사이가 1시간 미만         늦은 쪽 하나만   (한 과제 안에서)
 * 같은 시각의 과제 여럿           한 묶음
 * ```
 */
export async function nudges(env: Env, t: TimeCtx, days = MAX_DAYS, taskId: string | null = null): Promise<NudgeBundle[]> {
  const span = Math.max(1, Math.min(Number.isFinite(days) ? days : MAX_DAYS, MAX_DAYS));
  const [rows, settings] = await Promise.all([
    // ★ 하한이 `t.d`면 충분하다 — 귀속일은 달력 날짜보다 늦을 수 없으므로 *"아직 안 지난 마감"* 의 달력 날짜는
    //   언제나 `t.d` 이후다. 남는 것(오늘 이미 지난 마감)은 아래 `nowMs`가 거른다.
    db.nudgeTargets(env, t.d, addDays(t.d, span), taskId),
    db.settingsAll(env),
  ]);
  const s = Object.fromEntries(settings.results.map((r) => [r.key, r.value]));
  const evening = hmOr(s[NUDGE_EVENING_KEY], DEFAULT_EVENING);
  const morning = hmOr(s[NUDGE_MORNING_KEY], DEFAULT_MORNING);
  const nowMs = Date.parse(t.now);                     // 요청당 한 번 읽은 시계 (T-23 · T-26)
  const sfx = isoNow(0, t.offsetMin).slice(19);        // '+09:00'

  /** 귀속일 `date`의 `hm` — 경계 이전 시각이면 그 귀속일의 **다음 달력 날짜**다(경계를 바꿔도 맞게). */
  const onDay = (date: string, hm: string) =>
    Date.parse(`${hm < t.boundary ? addDays(date, 1) : date}T${hm}:00${sfx}`);

  const byAt = new Map<number, NudgeItem[]>();
  for (const r of rows.results) {
    const dueLocal = `${r.date}T${r.time}:00${sfx}`;
    const dueMs = Date.parse(dueLocal);
    if (!Number.isFinite(dueMs) || dueMs <= nowMs) continue;
    const day = attributionOfIso(dueLocal, t.boundary);  // ★ 마감의 귀속일 — "전날·당일"의 기준

    const points = [
      onDay(addDays(day, -1), evening),
      onDay(day, morning),
      ...HOURS_BEFORE.map((h) => dueMs - h * 3600_000),
    ].filter((ms) => Number.isFinite(ms) && ms < dueMs && ms > nowMs)
      .sort((a, b) => b - a);                            // 늦은 것부터 — 늦은 쪽이 남는다

    const kept: number[] = [];
    for (const ms of points) {
      const later = kept[kept.length - 1];             // 마지막으로 남긴 것 = 바로 뒤의 점
      if (later !== undefined && later - ms < MERGE_MS) continue;   // ⚠️ 미만 — 이하면 사슬로 무너진다
      kept.push(ms);
    }

    const item: NudgeItem = {
      task_id: r.task_id, course: courseOf(r.categories), title: r.title,
      due: new Date(dueMs).toISOString(),
    };
    for (const ms of kept) {
      const list = byAt.get(ms);
      if (list) list.push(item); else byAt.set(ms, [item]);
    }
  }

  return [...byAt.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, items]) => ({ at: new Date(ms).toISOString(), items }));
}

/**
 * **이 할 일이 지금 재촉을 갖는가** — 응답의 `nudge_changed`를 만드는 재료 (T-87 ③).
 *
 * ★ **웹이 추측하지 않게 서버가 말한다** — 어느 할 일이 수집분인지 웹은 모른다.
 *   완료·취소는 **바꾸기 전에**, 수락·취소 되돌리기는 **바꾼 뒤에** 묻는다 — 어느 쪽이든
 *   *"이 동작으로 기기의 예약이 달라지는가"* 이다.
 * ⚠️ **같은 계산을 쓴다** — 대상 판정을 따로 짜면(예: *"수집분이면 참"*) 마감이 지났거나 창 밖이라
 *    실린 적 없는 과제에서도 무거운 `sync()`가 돈다.
 */
export async function hasNudges(env: Env, t: TimeCtx, taskId: string): Promise<boolean> {
  return (await nudges(env, t, MAX_DAYS, taskId)).length > 0;
}

/**
 * **이 할 일의 재촉을 한 줄로** — 바꾸기 전후를 견줄 때 쓴다 (T-88 ①-c · 일정 수정).
 * ★ 일정 수정은 *"재촉이 있는가"* 가 아니라 **"달라졌는가"** 를 물어야 한다 — 제목만 고친 마감은
 *   재촉이 있어도 기기를 깨울 이유가 없다(재촉이 싣는 이름은 할 일의 제목이다).
 */
export async function nudgeKey(env: Env, t: TimeCtx, taskId: string): Promise<string> {
  return JSON.stringify(await nudges(env, t, MAX_DAYS, taskId));
}
