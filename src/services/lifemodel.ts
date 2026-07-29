// Life Model — me-reinforcement-plan Phase 1
//
// Me를 '천천히 변하는 상태(state) 저장소'로 확장한다. 이벤트 스트림(일정·일기·요약)과
// 데이터 성격이 다르므로 저장도 분리한다.
//
// 원칙 두 개가 이 파일의 형태를 정한다:
//   §0-2 빈칸 허용   — 초기 정보가 비어 있어도 동작한다. 필수 필드를 최소로 둔다
//   §0-6 자유 형식 JSON 금지 — 저장되는 구조화 데이터는 전부 스키마 검증을 통과한다
import * as db from "../db";
import { nextId } from "../lib/id";
import { fieldsOf, parseSchema, validate } from "../lib/schema";
import { ApiError, type Env, type TimeCtx } from "../types";

/** 아직 만들지 않은 섹션은 빈 껍데기로 노출하지 않는다(§1). 실재하는 것만 센다. */
export async function sections(env: Env) {
  const [counts, schemas] = await Promise.all([
    db.lmSections(env),
    db.lmSchemasAll(env),
  ]);
  const byKey = new Map(counts.results.map((r) => [r.section, r]));
  return {
    sections: schemas.results.map((s) => ({
      section: s.section,
      schema_version: s.version,
      n: byKey.get(s.section)?.n ?? 0,
      last: byKey.get(s.section)?.last ?? null,
    })),
  };
}

/** 섹션 스키마 — 검증·프롬프트 주입·UI 폼 생성이 같은 것을 읽는다(§2.2). */
export async function schema(env: Env, section: string) {
  const row = await db.lmSchemaActive(env, section);
  if (!row) throw new ApiError(404, "그런 섹션이 없어요");
  const parsed = parseSchema(row.body);
  if (!parsed) throw new ApiError(500, "스키마가 깨져 있어요");
  return { section, version: row.version, schema: parsed, fields: fieldsOf(parsed) };
}

export async function list(env: Env, section: string) {
  const rows = (await db.lmItems(env, section)).results;
  return rows.map(hydrate);
}

export async function create(env: Env, t: TimeCtx, section: string, input: any) {
  const s = await requireSchema(env, section);
  const title = String(input?.title ?? "").trim();
  if (!title) throw new ApiError(400, "제목이 필요해요");

  const data = input?.data ?? null;
  assertValid(s.schema, data, s.version);

  const id = await nextId(env, "lm_item", t.compact);
  await db.stInsertLmItem(
    env, id, section, title,
    input?.body ?? null,
    data ? JSON.stringify(data) : null,
    s.version,
    input?.source === "ai_approved" ? "ai_approved" : "manual",
    t.now,
  ).run();
  return { id, section, title, schema_version: s.version };
}

export async function update(env: Env, t: TimeCtx, id: string, input: any) {
  const cur = await db.lmItemGet(env, id);
  if (!cur) throw new ApiError(404, "해당 항목이 없어요");
  const s = await requireSchema(env, cur.section);

  const title = input?.title === undefined ? cur.title : String(input.title).trim();
  if (!title) throw new ApiError(400, "제목이 필요해요");

  // data를 아예 안 보내면 기존 값을 유지한다. null을 보내면 지운다.
  const data = input?.data === undefined
    ? (cur.data ? JSON.parse(cur.data) : null)
    : input.data;
  assertValid(s.schema, data, s.version);

  await db.stUpdateLmItem(
    env, id, title,
    input?.body === undefined ? cur.body : input.body,
    data ? JSON.stringify(data) : null,
    t.now,
  ).run();

  // version은 트리거가 올린다. 갱신된 값을 돌려줘야 프런트가 stale 비교에 쓸 수 있다.
  const after = await db.lmItemGet(env, id);
  return hydrate(after!);
}

export async function remove(env: Env, id: string) {
  const cur = await db.lmItemGet(env, id);
  if (!cur) throw new ApiError(404, "해당 항목이 없어요");
  await db.stDeleteLmItem(env, id).run();
  return { id, deleted: true };
}

/**
 * 기존 Me 텍스트를 Overview로 이관한다(§8 Phase 1).
 *
 * **원본을 지우지 않는다.** `me` 테이블은 설계 §3의 고정 5필드 프레임이고
 * `me_history`가 변경 궤적을 분석 입력으로 쓴다(§3). 여기서는 복사만 한다 —
 * 되돌릴 수 있어야 하고, 이관이 잘못돼도 원본이 남아야 한다.
 *
 * 멱등: 이미 이관된 필드는 건너뛴다.
 */
export async function importFromMe(env: Env, t: TimeCtx) {
  const s = await requireSchema(env, "overview");
  const me = (await db.meAll(env)).results as Array<{ field: string; value: string }>;
  const existing = (await db.lmItems(env, "overview")).results;
  const done = new Set(existing.map((r) => r.title));

  const LABEL: Record<string, string> = {
    direction: "방향", interests: "관심사", career: "진로",
    personality: "성격", life_pattern: "생활 패턴",
  };

  const made: string[] = [];
  for (const row of me) {
    const label = LABEL[row.field] ?? row.field;
    if (done.has(label) || !row.value?.trim()) continue;
    const id = await nextId(env, "lm_item", t.compact);
    await db.stInsertLmItem(
      env, id, "overview", label, row.value, null, s.version, "manual", t.now,
    ).run();
    made.push(label);
  }
  return { imported: made, skipped: me.length - made.length };
}

// ── helpers ──────────────────────────────────────────────────

async function requireSchema(env: Env, section: string) {
  const row = await db.lmSchemaActive(env, section);
  if (!row) throw new ApiError(404, "그런 섹션이 없어요");
  const parsed = parseSchema(row.body);
  if (!parsed) throw new ApiError(500, "스키마가 깨져 있어요");
  return { schema: parsed, version: row.version };
}

/** 검증 실패는 **어느 필드가 왜**인지 그대로 돌려준다 — 폼이 필드 옆에 표시할 수 있게. */
function assertValid(schema: ReturnType<typeof parseSchema>, data: unknown, version: number) {
  if (data === null || data === undefined) return;   // 빈칸 허용(§0-2)
  if (typeof data !== "object") throw new ApiError(400, "data는 객체여야 해요");
  const issues = validate(schema!, data);
  if (issues.length) {
    throw new ApiError(400, `스키마 v${version} 위반 — ` + issues.map((i) => `${i.path}: ${i.message}`).join(" · "));
  }
}

const hydrate = (r: db.LmItemRow) => ({
  ...r,
  data: r.data ? safeParse(r.data) : null,
});

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
