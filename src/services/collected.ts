// 수집한 것을 제안으로 꺼낸다 (T-42 · ADR-030 본체 · ADR-037).
//
// T-41이 `collected_items`에 쌓는다. 여기는 **그중 곧 닥치는 것만 물어** 1탭으로 `events`에 넣는다.
//
// ★ **"마감"이라고 쓰지 않는다.** `DTSTART`가 마감 시각인지 아직 모른다(ADR-037 §실측의 ❌ 셋째) —
//   T-41이 칼럼을 `starts_at`이라 지은 것과 같은 이유다. `summary` 원문을 **다듬지 않고**
//   그대로 보여주고 그대로 `events.title`에 넣는다. 다듬는 순간 그것이 해석이고, 개강 첫날 틀린다.
import * as db from "../db";
import * as events from "./events";
// ★ **task 생성 로직을 여기 다시 짜지 않는다**(T-78 §금지). `createTask`가 id 발급·
//   `wait_anchor_at`·대기 판정을 한 곳에서 지고 있고, `deferTask`·`completeTask`가 그 전제 위에 있다.
import * as tasks from "./tasks";
import * as uclass from "./uclass";
import { isoNow } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/**
 * 앞으로 며칠 것까지 물을지 — **v1의 값이고 설계가 아니다**(T-42 결정 ①).
 *
 * 개강 첫 수집에 학기 전체가 들어온다(4월 실측이 주당 3~5건 · 창이 `+365일`). 넓히면
 * 첫 화면이 60건이 된다. **넓히는 것은 실사용이 요구할 때**이고, 2주 뒤 발표처럼
 * 미리 알아야 하는 것은 보호 규칙 제안(ADR-030의 나머지 절반)이 다룰 일이다.
 */
const WINDOW_DAYS = 7;

/**
 * 물어볼 것 — `state='new'`이고 `starts_at`이 `[지금, +7일]`인 것.
 *
 * **시계를 다시 읽지 않는다**(T-23·T-26). 창의 양 끝을 넘겨받은 `t.now`에서 만든다 —
 * 서비스가 자기 시계를 읽으면 `/api/admin/*`로 들어온 요청과 cron이 다른 '지금'을 본다.
 *
 * `starts_at`은 T-41이 **로컬 오프셋 표기로 정규화**해 둔 값이라 같은 오프셋끼리는
 * 문자열 비교가 시각 비교와 같다(`fired_at` 비교가 같은 성질에 기대고 있다).
 */
export async function pending(env: Env, t: TimeCtx) {
  const to = isoNow(Date.parse(t.now) + WINDOW_DAYS * 86400_000, t.offsetMin);
  const rows = await db.collectedPending(env, t.now, to);
  // 화면이 쓰는 것만 준다. **`description`은 안 보낸다** — 카드가 원문 한 줄만 쓴다.
  // ★ `categories`는 보낸다(T-74) — **과목을 아는 유일한 칸**이고 카드가 그것을 얹는다.
  //   ⚠️ **원문 그대로 보낸다.** 괄호 안(학기·코드)을 여기서 떼지 않는다 —
  //   쪼개기는 해석이고, 해석은 **표시하는 쪽**이 한다(0024 §해석 금지).
  return rows.results.map((r) => ({
    id: r.id, source: r.source, summary: r.summary, starts_at: r.starts_at,
    categories: r.categories,
  }));
}

/**
 * **가서 보는 길** (T-75 ②) — 창 없이 `new` 전부.
 *
 * ★★★ **밀어 주는 것(`pending`)과 갈라진 *길*이지 넓힌 창이 아니다.**
 *   창을 넓히면 11월 과제가 9월부터 매일 뜬다 — ADR-047의 *"항상 뜨는 것은 정보가 0"*.
 *   7일 창의 판단은 맞고, 없던 것은 **사용자가 보러 갈 자리**다(ADR-048 —
 *   *"볼 자리가 없는 것은 없는 것이다"*).
 *
 * ⚠️ **`t`를 안 받는다.** 시계가 필요 없다는 것이 이 함수의 뜻이다 — 인자로 두면
 *    다음 사람이 거기에 창을 건다. **`pending`만 시계를 받는다.**
 * ★ **응답 모양은 `pending`과 같다** — 화면이 **같은 시트**를 쓰기 때문이다(③).
 *   ⚠️ 여기서 모양이 갈리면 시트가 두 벌이 되고, 그건 이 티켓 §금지의 세 번째다.
 */
export async function list(env: Env) {
  const rows = await db.collectedNewAll(env);
  return rows.results.map((r) => ({
    id: r.id, source: r.source, summary: r.summary, starts_at: r.starts_at,
    categories: r.categories,
  }));
}

/**
 * 수집이 돌았는지 사람이 볼 수 있게 한다 (T-43).
 *
 * ★ **T-33의 §금지와 충돌하지 않는다 — 구별이 여기 있다.**
 *   T-33이 실패를 숨기라 한 근거는 *"사용자가 할 수 있는 일이 없다"*였다(Guard 조회 실패).
 *   **수집 실패는 할 일이 있다** — 토큰이 만료됐으면 다시 넣어야 한다.
 *   **행동이 가능한 실패는 보인다.** 이 문단이 없으면 다음 사람이 T-33을 근거로 이 화면을 지운다.
 *
 * ⚠️ **URL·토큰을 싣지 않는다.** 그 값 자체가 열쇠다(ADR-037 §근거 ④) — 상태만이다.
 *   `configured`는 **있다/없다**만 말한다.
 *
 * `pending`에 섞지 않고 엔드포인트를 가른 이유: `pending`은 7일 창이고 이것은 원장 전체다.
 * 한 응답에 두 시야를 담으면 **읽는 쪽이 어느 쪽 0인지 모른다** — 그게 이 티켓의 증상이었다.
 */
export async function status(env: Env, t: TimeCtx) {
  const s = Object.fromEntries(
    (await db.settingsAll(env)).results.map((r) => [r.key, r.value]),
  );
  const lastAt = s[uclass.K_LAST] || null;

  // T-41이 `${시각} ${사유}` 한 줄로 남긴다. 시각에 공백이 없으므로 첫 공백이 경계다.
  const err = (s[uclass.K_ERROR] ?? "").trim();
  const cut = err.indexOf(" ");
  const errAt = err && cut > 0 ? err.slice(0, cut) : null;
  const reason = err ? (cut > 0 ? err.slice(cut + 1) : err) : null;

  // ★ **`last_seen_count`가 이 티켓의 본체다.** 없으면(한 번도 안 돌았으면) `null`이지 0이 아니다 —
  //   0은 *"목록이 비어 있었다"*이고 그것은 방학의 정상이다.
  const seenRaw = s[uclass.K_SEEN];
  const seen = seenRaw != null && seenRaw !== "" && Number.isFinite(Number(seenRaw))
    ? Number(seenRaw) : null;

  const counts = { new: 0, accepted: 0, dismissed: 0 };
  for (const row of (await db.collectedCountsByState(env)).results) {
    if (row.state in counts) counts[row.state as keyof typeof counts] = row.n;
  }

  const lastMs = Date.parse(lastAt ?? "");
  return {
    configured: !!env.UCLASS_ICAL_URL?.trim(),
    last_collect_at: lastAt,
    // 한 번도 안 돌았으면 `null`. 마지막 시도가 실패였으면 그 사유(성공하면 T-41이 지운다).
    last_result: reason ?? (lastAt ? "ok" : null),
    last_error_at: errAt,
    last_seen_count: seen,
    counts,
    next_earliest_at: Number.isFinite(lastMs)
      ? isoNow(lastMs + uclass.COLLECT_INTERVAL_MS, t.offsetMin) : null,
  };
}

/**
 * 받아들인다 — **`events` 행 하나와 `tasks` 행 하나**를 만들고 둘을 잇는다 (T-78).
 *
 * ★★ **둘 다 만드는 것이 이 함수의 본체다.** 설계 §1.7이 `events`를
 * *캘린더 전용 · 완료·이월 없음*으로 두었는데 **과제는 둘 다**이기 때문이다:
 *
 * ```
 * event   11/30 23:59 학기과제 기한   ★ 마감. 안 움직인다
 * task    "학기과제 기한"              ★ 할 일. 언제 할지는 움직인다
 * ```
 *
 * ⚠️ **하나로 합치면 둘 중 하나를 잃는다** — 설계가 *"미루기는 복사가 아니라 같은 일의
 *    이동"*이라고 한 것이 정확히 이 구분이다. T-78 이전에는 `events`만 만들어서,
 *    **과제가 달력에 있는데 할 일 목록은 0이었다**(2026-09-17 화면 실측).
 *
 * ★★ **새 task 에 예정일을 안 준다 — 대기(미배정)다.**
 *    마감일에 넣으면 그것은 *"마감일에 하라"*는 뜻이고 **거짓이고 나쁜 조언이다.**
 *    대기는 *"할 일은 있고 언제 할지 안 정했다"* 이고, 그게 실제 상태 그대로다(설계 1.4).
 *    **날짜는 사용자가 정한다.**
 *
 * ⚠️ **멱등이다.** 이미 `accepted`면 **`events`도 `tasks`도 또 만들지 않고** 있던 것을 돌려준다.
 * 느린 네트워크에서 두 번 눌리는 것이 이 카드의 기본 조건이다(T-42 §할 일 ①).
 * ★ **가드가 보는 것은 `event_id` 하나 그대로다** — `task_id`를 함께 요구하면
 *   **T-78 이전에 수락한 행이 그 문을 지나 오늘 task 를 만든다**(소급 생성 · T-78 §금지).
 *   그 행들의 `task_id`는 NULL로 남는 것이 맞다.
 *
 * **보호 규칙은 붙이지 않는다** — 별개의 결정이고 ADR-030의 나머지 절반이다.
 */
/**
 * ★★★ **할 일의 이름은 할 일이어야 한다** (T-83 ① · ADR-048 계열).
 *
 * ```
 * event.title   "학기과제 기한"    ★ 맞다. 마감 그 자체이고, 그것이 사실이다
 * task.title    "학기과제 기한"    ⚠️ "기한을 한다" 가 된다
 * ```
 *
 * ★★ **T-78 이 event 와 task 를 가른 것과 같은 자리다** — *"마감은 고정이고 할 일은 이동한다."*
 * 같은 문자열을 쓰면 둘 중 하나가 반드시 틀린다.
 *
 * ⚠️ **끝의 `기한` 하나만 뗀다.** *"제출"·"문제"* 를 떼는 것은 **해석이고 근거가 없다.**
 * ⚠️ **`summary` 저장과 `events.title` 은 원문 그대로다**(T-74) — 근거가 *"사용자가 uclass 에서
 *    그 제목으로 찾는다"* 였고, **찾는 자리는 달력이다.**
 *
 * ★★ **여기가 자리인 이유** — `createTask` 안에서 다듬으면 **손으로 만든 task 까지** 바뀐다.
 *    다듬는 근거는 *"수집한 마감에서 왔다"* 하나이므로 **수집분만**이다(티켓 §금지).
 *    그리고 `task.title` 은 자유 변경 칸이라(`CLAUDE.md` §아키텍처 원칙 — id 불변 / title 자유)
 *    만들 때 한 번 다듬는 것은 **되돌릴 수 있는 해석**이다.
 */
const DEADLINE_SUFFIX = "기한";
export function taskTitleOf(summary: string): string {
  const s = summary.trim();
  if (!s.endsWith(DEADLINE_SUFFIX)) return summary;                 // 끝이 아니면 한 글자도 안 바꾼다
  return s.slice(0, -DEADLINE_SUFFIX.length).trim() || summary;     // 떼면 비는 제목은 원문을 쓴다
}

export const PAST_CHOICES = ["done", "todo", "skip"] as const;
export type PastChoice = (typeof PAST_CHOICES)[number];

export async function accept(env: Env, t: TimeCtx, id: string, choice?: string) {
  const row = await db.collectedGet(env, id);
  if (!row) throw new ApiError(404, "해당 항목이 없어요");

  if (row.state === "accepted" && row.event_id) {
    return {
      id: row.id, event_id: row.event_id, task_id: row.task_id,
      state: "accepted", duplicate: true,
    };
  }
  if (!row.starts_at) throw new ApiError(400, "시각이 없어 일정으로 만들 수 없어요");

  // `2026-09-03T23:00:00+09:00` → date `2026-09-03` · time `23:00`.
  // **원문을 다듬지 않는다** — `title`은 `summary` 그대로다(결정 ②).
  const date = row.starts_at.slice(0, 10);
  const time = row.starts_at.slice(11, 16);

  /*
   * ★★★ **마감이 지났으면 묻는다** (T-80 ③ · 2026-09-21 사용자).
   *
   * ⚠️ **미래엔 안 묻는다** — 사용자가 고른 것이 *"자동으로"* 다. 묻는 것은 과거뿐이다.
   * ★ **아무것도 만들지 않고 돌아간다.** 물어 놓고 만들면 *"묻는다"* 가 장식이 된다.
   *   `state`는 그대로 `new`라 다음 호출이 세 갈래 중 하나를 들고 다시 온다.
   */
  const past = date < t.d;
  if (past && !choice) {
    return {
      id: row.id, state: row.state, needs_choice: true,
      summary: row.summary, starts_at: row.starts_at,
    };
  }
  if (choice && !PAST_CHOICES.includes(choice as PastChoice)) {
    throw new ApiError(400, "choice는 done·todo·skip");
  }
  // ⚠️ **미래에 온 `choice`는 무시한다** — 물은 적이 없으므로 답도 없다.
  const pick: PastChoice | null = past ? ((choice as PastChoice) ?? null) : null;

  if (pick === "skip") {
    // ★ event 도 task 도 안 만든다. **거절은 거절이다.**
    await db.stDismissCollected(env, id).run();
    return { id: row.id, state: "dismissed", event_id: null, task_id: null, duplicate: false };
  }

  const ev = await events.create(env, t, { title: row.summary, date, time });

  /*
   * ★★ **"이미 했어요"는 task 를 안 만든다** — *하지 않은 것을 기록하지 않는다.*
   *   언제 얼마나 했는지 모르는 채 완료 task 를 만들면 원장이 거짓이 되고 분석이 그 위에 선다.
   * ⚠️ **`event`는 만든다** — *"그 마감이 있었다"* 는 사실이고 달력은 사실의 기록이다.
   * ★ 그 구분은 `collected_items.task_id`가 NULL 로 남아 **이미 진다**(T-78). 마이그레이션 없다.
   */
  if (pick === "done") {
    await db.stAcceptCollected(env, id, ev.id, null).run();
    return { id: row.id, event_id: ev.id, task_id: null, state: "accepted", duplicate: false };
  }

  /*
   * ★★★★ **예정일을 정한다 — T-78 §금지의 그 줄을 뒤집는다** (T-80 ② · 2026-09-21 사용자).
   *
   * T-78은 *"앱이 마감일을 고르면 그것은 앱의 해석"* 이라 비웠다. 지금은 **사용자가 고른
   * 기본값**이라 해석이 아니라 설정이다(티켓 §근거 ③).
   * ⚠️ **T-78의 ①은 안 풀렸다** — *"마감일에 하라"* 로 읽히는 위험은 남고, 화면이
   *   **먼 것을 약하게** 그려 그것을 누른다(④). 재검토 트리거는 티켓에 있다.
   *
   * ⚠️ **시각은 안 넘긴다.** 마감 시각은 `events`가 갖는다 — **예정은 날짜다.**
   *
   * ★★ **과거 마감의 "아직 해야 해요"는 *오늘*이다.** 마감이 지났으면 지금이 제일 빠른 날이고,
   *   과거 날짜는 `assertSchedulable`이 400으로, 그 뒤 트리거가 409로 막는다(함정 6).
   * ⚠️⚠️ **그런데 오늘이 이미 마감된 날이면 오늘도 막힌다** — 트리거가 보는 것은
   *   *"지났는가"* 가 아니라 `daily.status='closed'` 하나다(`0001` `trg_entries_frozen_ins`).
   *   ★ 그때는 **대기로 떨어뜨리고 응답이 그 사실을 말한다** — 추측해서 409를 맞는 대신.
   */
  const when = past ? t.d : date;
  /* ⚠️ **보는 것은 *넣는 날*이지 *오늘*이 아니다.** 트리거가 보는 것이 `NEW.date`의 `daily.status`라
   *    (`0001` `trg_entries_frozen_ins`) 여기서도 같은 날을 봐야 판정이 트리거와 같아진다.
   * ★★ **처음엔 `t.d`를 봤고, 그래서 변이 P5(예정일을 지난 마감일로 넣는다)가 아무 검사도
   *    안 죽였다** — `when`을 안 읽으니 바꿔도 결과가 같았다. **읽지 않는 값은 지킬 수 없다.** */
  const closed = past && (await db.getDaily(env, when))?.status === "closed";
  // ★ **제목만 다듬는다** — `events.title`(위 `ev`)과 `summary` 저장은 원문 그대로다 (T-83 ①).
  const taskTitle = taskTitleOf(row.summary);
  const task = await tasks.createTask(
    env, t, closed ? { title: taskTitle } : { title: taskTitle, date: when },
  );
  await db.stAcceptCollected(env, id, ev.id, task.id).run();
  return {
    id: row.id, event_id: ev.id, task_id: task.id, state: "accepted", duplicate: false,
    // 화면이 토스트를 고르는 재료. **추측하지 않게 서버가 말한다.**
    scheduled_for: closed ? null : when, waiting: !!task.waiting,
  };
}

/**
 * 거절한다. **다시 묻지 않는다** — `last_modified`가 바뀌어도 그대로다
 * (T-41의 `stTouchCollected`가 `state`를 안 건드린다). **거절한 것을 또 묻는 것이 잔소리다.**
 */
export async function dismiss(env: Env, id: string) {
  const row = await db.collectedGet(env, id);
  if (!row) throw new ApiError(404, "해당 항목이 없어요");
  await db.stDismissCollected(env, id).run();
  return { id, state: "dismissed" };
}
