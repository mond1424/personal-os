// Claude API 중계 (8장: 얇은 서버 — 환경변수 API 키).
// 키는 wrangler secret put ANTHROPIC_API_KEY 로만 주입한다. 코드·DB에 저장 금지.
import { ApiError, type Env } from "../types";

export interface AiCall {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

export async function callClaude(env: Env, call: AiCall): Promise<string> {
  if (!env.ANTHROPIC_API_KEY)
    throw new ApiError(503, "ANTHROPIC_API_KEY 시크릿이 없어요 — `wrangler secret put ANTHROPIC_API_KEY` 후 다시 시도");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: call.maxTokens ?? 1200,
      system: call.system,
      messages: [{ role: "user", content: call.user }],
    }),
  });
  const j = (await res.json().catch(() => null)) as
    | { content?: Array<{ type: string; text?: string }>; error?: { message?: string } }
    | null;
  if (!res.ok)
    throw new ApiError(502, `모델 호출 실패(${res.status}): ${j?.error?.message ?? "응답 해석 불가"}`);
  const text = (j?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new ApiError(502, "모델이 빈 응답을 반환했어요");
  return text;
}

/** 모델 응답에서 JSON만 추출 (```json 펜스 허용). 실패 시 null. */
export function parseModelJson<T>(text: string): T | null {
  const stripped = text.replace(/```json|```/g, "").trim();
  const m = stripped.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}
