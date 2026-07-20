// Guard (6장) — 구현 3의 자리. 규칙 문법·마찰 수위·위험도 계산은
// 9장 미확정: 구현 1 실사용 데이터가 쌓인 뒤, 구현 3 직전에 설계한다.
// 지금은 설정 화면(⚙ Guard 규칙·이력)의 이벤트 목록 조회만 제공.
// 평가 루프는 scheduled.ts의 Cron에 얹는다 — 자리는 이미 있다.
import * as db from "../db";
import type { Env } from "../types";

export const events = async (env: Env) => (await db.guardEventsList(env)).results;
