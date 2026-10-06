// 실 D1을 읽지 않는다. 입력은 migrations/의 SQL과 스냅샷의 사람이 쓴 머리말뿐이다.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(root, "docs/schema-current.sql");
const migrationsPath = join(root, "migrations");
const lf = (text) => text.replace(/\r/g, "");
const band = "-- ==========================================================";
const sections = [
  ["table", "테이블"],
  ["view", "뷰"],
  ["index", "인덱스"],
  ["trigger", "트리거"],
];

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
    throw new Error("사용법: npm run schema [-- --check]");
  }
  const check = args[0] === "--check";
  const current = lf(readFileSync(snapshotPath, "utf8"));
  const bodyStart = current.search(/^-- ====/m);
  if (bodyStart < 0) throw new Error("스냅샷의 첫 -- ==== 구분선을 찾지 못했습니다.");
  const header = current.slice(0, bodyStart);
  const migrations = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  if (!migrations.length) throw new Error("적용할 migrations/*.sql이 없습니다.");

  const db = new DatabaseSync(":memory:");
  let generated;
  let objects = 0;
  try {
    for (const name of migrations) {
      try {
        db.exec(lf(readFileSync(join(migrationsPath, name), "utf8")));
      } catch (cause) {
        throw new Error(`마이그레이션 적용 실패: ${name}`, { cause });
      }
    }
    // sql이 NULL인 자동 인덱스만 빠진다. sqlite_sequence는 SQL이 있어 포함한다.
    const query = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY name",
    );
    const body = sections.map(([type, title]) => {
      const rows = query.all(type);
      objects += rows.length;
      const statements = rows.map(({ sql }) => `${lf(sql).trimEnd().replace(/;$/, "")};`);
      return `${band}\n-- ${title}\n${band}\n${statements.join("\n\n")}`;
    }).join("\n\n");
    generated = header + body + "\n";
  } finally {
    db.close();
  }

  if (check) {
    if (current !== generated) {
      const before = current.split("\n"), after = generated.split("\n");
      let line = 0;
      while (before[line] === after[line]) line++;
      console.error(`[schema] docs/schema-current.sql: 첫 차이 ${line + 1}행`);
      console.error(`현재: ${before[line] === undefined ? "<EOF>" : JSON.stringify(before[line])}`);
      console.error(`생성: ${after[line] === undefined ? "<EOF>" : JSON.stringify(after[line])}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[schema] 일치 — 마이그레이션 ${migrations.length}개 · 객체 ${objects}개 (쓰기 없음)`);
  } else {
    writeFileSync(snapshotPath, generated, "utf8");
    console.log(`[schema] docs/schema-current.sql 갱신 — 마이그레이션 ${migrations.length}개 · 객체 ${objects}개`);
  }
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
