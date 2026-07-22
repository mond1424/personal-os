// Me (3장) — 모든 분석의 장기 맥락 프레임. 오염 주의.
// '지금'은 활성 기간 goals의 조인 파생 — 저장하지 않는다 (원칙 4).
import * as db from "../db";
import { ApiError, type Env, type TimeCtx } from "../types";

export async function getMe(env: Env, t: TimeCtx) {
  const [fields, active] = await Promise.all([db.meAll(env), db.periodsAt(env, t.d)]);
  const nowGoals = await Promise.all(
    active.results.map(async (p) => {
      const full = await db.getPeriod(env, p.id);
      return { period_id: p.id, title: p.title, color: p.color, goals: JSON.parse(full!.goals) as string[] };
    }),
  );
  return { fields: fields.results, now: nowGoals };
}

/** 갱신 = 이력 + 현재값을 한 batch로 — 이력 자체가 분석 입력 (3장). */
export async function putMeField(env: Env, t: TimeCtx, field: string, value: string) {
  if (!/^[a-z_]{1,40}$/.test(field)) throw new ApiError(400, "field는 소문자·언더스코어");
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "value가 비어 있어요");
  const cur = await db.meGet(env, field);
  await env.DB.batch([
    db.stMeHistory(env, field, cur?.value ?? null, value.trim(), "user", t.now),
    db.stMeUpsert(env, field, value.trim(), t.now),
  ]);
  return { field };
  // AI 제안(diff) → 승인 플로우는 구현 2 — 그때 source='ai'로 같은 경로를 탄다.
}

export const meHistory = async (env: Env, limit = 50) =>
  (await db.meHistory(env, Math.min(limit, 200))).results;

// ── settings ─────────────────────────────────────────────────
const RULES: Record<string, (v: string) => boolean> = {
  day_boundary: (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  utc_offset: (v) => /^[+-](0\d|1[0-4]):[0-5]\d$/.test(v),
  // 필드명은 소문자·언더스코어만 (putMeField의 field 규칙과 동일). UI가 필드명을
  // onclick·innerHTML에 그대로 넣는데 onclick은 esc로 못 막으므로, 형식을 여기서 강제해 안전을 보장한다.
  feelings_fields: (v) => {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === "string" && /^[a-z_]{1,40}$/.test(x));
    } catch { return false; }
  },
  // 구현 2 — 모델 이원화 (8장 High-Low mix). 미래 모델도 쓸 수 있게 id 형식만 검증.
  // 'provider/model' 또는 'model' (구버전 호환)
  model_low: (v) => /^([a-z]+\/)?[a-z0-9][a-z0-9.-]{2,63}$/.test(v),
  model_high: (v) => /^([a-z]+\/)?[a-z0-9][a-z0-9.-]{2,63}$/.test(v),
  ai_provider: (v) => ["anthropic", "openai", "google"].includes(v),
  ai_api_key: (v) => v === "" || (v.length >= 8 && v.length <= 200 && !/\s/.test(v)),
  ai_key_anthropic: (v) => v === "" || (v.length >= 8 && v.length <= 200 && !/\s/.test(v)),
  ai_key_openai: (v) => v === "" || (v.length >= 8 && v.length <= 200 && !/\s/.test(v)),
  ai_key_google: (v) => v === "" || (v.length >= 8 && v.length <= 200 && !/\s/.test(v)),
};

/** 개인 키는 값을 돌려주지 않는다 — 설정 여부만. */
const MASKED = new Set(["ai_api_key", "ai_key_anthropic", "ai_key_openai", "ai_key_google"]);

export const getSettings = async (env: Env) =>
  (await db.settingsAll(env)).results.map((r) =>
    MASKED.has(r.key) ? { ...r, value: r.value ? "설정됨" : "" } : r);

export async function putSetting(env: Env, key: string, value: string) {
  const rule = RULES[key];
  if (!rule) throw new ApiError(404, `설정 키: ${Object.keys(RULES).join(" | ")}`);
  if (typeof value !== "string" || !rule(value)) throw new ApiError(400, `${key} 값 형식이 맞지 않아요`);
  await db.stSettingPut(env, key, value).run();
  return { key, value };
  // 경계 변경은 이후 기록부터 적용 — 과거 귀속일은 재해석되지 않는다 (스키마 헤더 원칙)
}
