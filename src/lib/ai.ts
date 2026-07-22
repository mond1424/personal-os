// AI 중계 (8장: 얇은 서버). 제공자별 요청 형식 차이만 여기서 흡수한다.
// 키는 ① 설정(ai_api_key, 사용자가 앱에서 입력) ② 서버 시크릿 ANTHROPIC_API_KEY 순으로 찾는다.
import * as db from "../db";
import { ApiError, type Env } from "../types";

export type Provider = "anthropic" | "openai" | "google";

export const PROVIDERS: Record<Provider, { label: string; keyHint: string; models: string[] }> = {
  anthropic: { label: "Claude (Anthropic)", keyHint: "sk-ant-…",
    models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"] },
  openai: { label: "OpenAI", keyHint: "sk-…",
    models: ["gpt-5-mini", "gpt-5"] },
  google: { label: "Gemini (Google)", keyHint: "AIza…",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"] },
};

export interface AiCall {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

/** 모델 값은 'provider/model' 형식. 슬래시가 없으면 기본 제공자(ai_provider)로 해석한다. */
export function splitModel(value: string, fallback: Provider): { provider: Provider; model: string } {
  const i = value.indexOf("/");
  if (i < 0) return { provider: fallback, model: value };
  const p = value.slice(0, i) as Provider;
  return { provider: PROVIDERS[p] ? p : fallback, model: value.slice(i + 1) };
}

/** 제공자별 키 — 여러 곳을 동시에 등록해 두고 모델마다 골라 쓸 수 있다. */
export async function aiConfig(env: Env) {
  const s = Object.fromEntries((await db.settingsAll(env)).results.map((r) => [r.key, r.value]));
  const fallback = (s.ai_provider as Provider) || "anthropic";
  const keyOf = (p: Provider) =>
    (s[`ai_key_${p}`] || "").trim() ||
    (p === fallback ? (s.ai_api_key || "").trim() : "") ||   // 예전 단일 키 설정 호환
    (p === "anthropic" ? (env.ANTHROPIC_API_KEY ?? "").trim() : "");
  const def = PROVIDERS[fallback]?.models ?? [];
  return {
    provider: fallback,
    keyOf,
    connections: (Object.keys(PROVIDERS) as Provider[]).map((p) => ({
      provider: p, label: PROVIDERS[p].label, keyHint: PROVIDERS[p].keyHint,
      models: PROVIDERS[p].models, has_key: !!keyOf(p),
    })),
    low: s.model_low || (def[0] ? `${fallback}/${def[0]}` : ""),
    high: s.model_high || (def[1] ? `${fallback}/${def[1]}` : ""),
  };
}

export async function callModel(env: Env, call: AiCall): Promise<string> {
  const cfg = await aiConfig(env);
  const { provider, model } = splitModel(call.model, cfg.provider);
  const key = cfg.keyOf(provider);
  if (!key)
    throw new ApiError(503, `${PROVIDERS[provider].label} 키가 없어요 — 설정 › AI 연결에서 등록해 주세요`);
  call = { ...call, model };
  const max = call.maxTokens ?? 1200;

  let url: string, headers: Record<string, string>, body: unknown;
  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
    body = { model: call.model, max_completion_tokens: max,
      messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }] };
  } else if (provider === "google") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(call.model)}:generateContent`;
    headers = { "content-type": "application/json", "x-goog-api-key": key };
    body = { system_instruction: { parts: [{ text: call.system }] },
      contents: [{ role: "user", parts: [{ text: call.user }] }],
      generationConfig: { maxOutputTokens: max } };
  } else {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
    body = { model: call.model, max_tokens: max, system: call.system,
      messages: [{ role: "user", content: call.user }] };
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const j = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const detail = j?.error?.message ?? j?.error?.[0]?.message ?? "응답 해석 불가";
    // 401/403은 거의 항상 '다른 제공자의 키'이거나 오타다 — 어디서 난 오류인지 분명히 말해 준다
    const hint = res.status === 401 || res.status === 403
      ? ` — ${PROVIDERS[provider].label}에 등록한 키가 거부됐어요. 그 제공자의 키가 맞는지 확인해 주세요(앱 접근 토큰과 헷갈리기 쉬워요)`
      : res.status === 404 ? ` — 모델 이름(${model})을 찾을 수 없어요`
      : "";
    throw new ApiError(502, `${PROVIDERS[provider].label} 호출 실패(${res.status})${hint}: ${detail}`);
  }

  const text = (
    provider === "openai" ? j?.choices?.[0]?.message?.content ?? ""
    : provider === "google" ? (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("")
    : (j?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("\n")
  ).trim();
  if (!text) throw new ApiError(502, "모델이 빈 응답을 반환했어요");
  return text;
}

/** 이전 이름 — 호출부 호환 */
export const callClaude = callModel;

/** 모델 응답에서 JSON만 추출 (```json 펜스 허용). 실패 시 null. */
export function parseModelJson<T>(text: string): T | null {
  const stripped = text.replace(/```json|```/g, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

/** 연결 테스트 — 실제로 한 번 불러 보고 결과를 그대로 돌려준다 (401 진단용). */
export async function testConnection(env: Env, which: "low" | "high") {
  const cfg = await aiConfig(env);
  const value = which === "low" ? cfg.low : cfg.high;
  const { provider, model } = splitModel(value, cfg.provider);
  const started = Date.now();
  try {
    const out = await callModel(env, { model: value, system: "한 단어로만 답한다.", user: "ping", maxTokens: 16 });
    return { ok: true, which, provider, model, ms: Date.now() - started, sample: out.slice(0, 40) };
  } catch (e: any) {
    return { ok: false, which, provider, model, ms: Date.now() - started, error: e.message ?? String(e) };
  }
}
