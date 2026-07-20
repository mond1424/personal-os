// Cron 엔트리 — 자동 마감 (H). 30분마다 돌지만 멱등이라 안전하다.
// 구현 3에서 Guard 평가 루프(6.4 — 규칙 평가 + Web Push)가 여기 얹힌다.
import * as db from "./db";
import { closeDay } from "./services/daily";
import { loadTime } from "./lib/time";
import type { Env } from "./types";

export async function autoClose(env: Env) {
  const t = await loadTime(env);

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

  return { closed: open.results.length, orphaned: orphans.results.length, as_of: t.d };
}

export async function scheduled(_event: ScheduledController, env: Env): Promise<void> {
  await autoClose(env);
}
