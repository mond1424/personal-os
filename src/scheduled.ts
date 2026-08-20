// Cron 엔트리 — 자동 마감 (H). 30분마다 돌지만 멱등이라 안전하다.
// 구현 3에서 Guard 평가 루프(6.4 — 규칙 평가 + Web Push)가 여기 얹힌다.
import * as db from "./db";
import { closeDay } from "./services/daily";
import { finalizeIgnored } from "./services/guard";
import { collect as collectUclass } from "./services/uclass";
import { loadTime } from "./lib/time";
import type { Env, TimeCtx } from "./types";

// 시간 맥락은 **받는다.** 부르는 자리는 진입 계층 둘뿐이다 —
// HTTP는 `index.ts`의 미들웨어, cron은 아래 `scheduled`. `/api/admin/auto-close`로
// 들어오면 미들웨어가 만든 것을 그대로 쓴다(요청당 한 번 — `TimeCtx` 주석 1.2).
export async function autoClose(env: Env, t: TimeCtx) {
  // H-1) 열린 채 남은 지난 날 → auto 마감 (기록 → 물화 → close 순서는 closeDay가 보장)
  const open = await db.openDatesBefore(env, t.d);
  for (const { date } of open.results) {
    await closeDay(env, t, "auto", date);
  }

  // H-2) 행조차 없는데 예정이 있던 날 → closed 행 생성 후 mech 물화
  //      (불변 조건: "과거 예정일에는 항상 closed daily가 존재한다" — F의 안전 근거)
  const orphans = await db.orphanEntryDates(env, t.d);
  for (const { date } of orphans.results) {
    await db.stInsertClosedDaily(env, date, t.now).run();
    const cls = await db.classifyAt(env, date); // 이제 closed → missed로 분류된다
    const mech = JSON.stringify({
      date, score: null, feelings: {},
      sections: {
        done: cls.results.filter((r) => r.class === "done").map((r) => ({ id: r.id, title: r.title, rate: r.rate })),
        missed: cls.results.filter((r) => r.class === "missed").map((r) => ({ id: r.id, title: r.title, rate: r.rate })),
        deferred: cls.results.filter((r) => r.class === "deferred").map((r) => ({ id: r.id, title: r.title, rate: r.rate, to: r.deferred_to })),
      },
    });
    await db.stUpsertMech(env, "daily", date, mech, t.now).run();
  }

  // H-3) 반응 없이 남은 Guard 발동 → 'ignored' 확정 (ADR-025의 닫는 쪽).
  //      마감과 독립이다 — 여기서 던지면 자동 마감이 통째로 멈춘다.
  const ign = await finalizeIgnored(env, t).catch(() => ({ ignored: 0 }));

  // H-4) 학사 마감 수집 (T-41 · ADR-037). **H-3과 같은 이유로 독립이다** —
  //      원천이 밖에 있어 실패가 흔하고(토큰 만료·서버 점검·네트워크),
  //      여기서 던지면 그 시각의 자동 마감이 통째로 멈춘다.
  //      **실패 사유는 `settings.uclass_last_error`에 남는다** — 조용히 사라지지 않는다.
  //      토큰이 없으면 `skipped: 'no_token'`으로 끝난다(배포해도 아무것도 안 바뀐다).
  const col = await collectUclass(env, t)
    .catch((e: any) => ({ skipped: "error", error: String(e?.message ?? e).slice(0, 120) }));

  return {
    closed: open.results.length, orphaned: orphans.results.length,
    guard_ignored: ign.ignored, uclass: col, as_of: t.d,
  };
}

export async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  await autoClose(env, await loadTime(env));   // cron에는 요청이 없다 — 여기가 그 경계다
}
