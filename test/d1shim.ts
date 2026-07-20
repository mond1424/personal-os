// D1 셰임 — node:sqlite(DatabaseSync) 위에 코드가 쓰는 D1 표면만 구현.
// batch = BEGIN…COMMIT: D1의 "batch는 자동 트랜잭션" 의미를 재현한다.
import { DatabaseSync } from "node:sqlite";

type P = string | number | null;

class Stmt {
  private params: P[] = [];
  constructor(private raw: DatabaseSync, private sql: string) {}
  bind(...p: P[]) { this.params = p; return this; }
  async all<T>() {
    const results = this.raw.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true as const, meta: {} };
  }
  async first<T>() {
    return ((this.raw.prepare(this.sql).get(...this.params) as T | undefined) ?? null);
  }
  async run() { return this.runSync(); }
  runSync() {
    const r = this.raw.prepare(this.sql).run(...this.params);
    return {
      success: true as const, results: [] as unknown[],
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

export function makeD1(schemaSql: string): D1Database {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(schemaSql);
  const shim = {
    prepare: (sql: string) => new Stmt(raw, sql),
    async batch(stmts: Stmt[]) {
      raw.exec("BEGIN");
      try {
        const out = stmts.map((s) => s.runSync());
        raw.exec("COMMIT");
        return out;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql: string) { raw.exec(sql); return { count: 0, duration: 0 }; },
    /** 테스트 전용 — 시드·검증용 직접 접근 */
    _raw: raw,
  };
  return shim as unknown as D1Database;
}

export const rawOf = (db: D1Database) => (db as unknown as { _raw: DatabaseSync })._raw;
