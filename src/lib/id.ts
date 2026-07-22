// 엔티티 id = 'YYYYMMDD-NNN' (queries.sql A)
// 단일 사용자 앱 — 트랜잭션 batch 안에서 조회 → INSERT로 충분하다.
import type { Env } from "../types";

const TABLES = ["tasks", "periods", "memos", "analyses", "guard_events", "events"] as const;
export type IdTable = (typeof TABLES)[number];

export async function nextId(env: Env, table: IdTable, compact: string): Promise<string> {
  if (!TABLES.includes(table)) throw new Error("unknown table");
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(CAST(substr(id, 10) AS INTEGER)), 0) + 1 AS n FROM ${table} WHERE id LIKE ?`
  ).bind(`${compact}-%`).first<{ n: number }>();
  return `${compact}-${String(row?.n ?? 1).padStart(3, "0")}`;
}
