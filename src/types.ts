export interface Env {
  DB: D1Database;
  API_TOKEN?: string;
  ANTHROPIC_API_KEY?: string; // wrangler secret — 구현 2 (lib/ai.ts)
}

/** 요청 한 번의 시간 컨텍스트 — 귀속일은 여기서 한 번만 계산한다 (1.2). */
export interface TimeCtx {
  d: string;        // 오늘의 귀속일 'YYYY-MM-DD' (경계 반영)
  now: string;      // ISO8601, 오프셋 포함
  compact: string;  // 'YYYYMMDD' — id 생성용 (귀속일 기준)
  boundary: string; // 'HH:MM'
  offsetMin: number;
}

/** 서비스 계층이 던지는 의도된 실패 — index.ts가 상태코드로 번역.
 *  suggest: 프런트가 후속 액션 버튼을 띄우기 위한 기계 판독 힌트(예: "cancel"). */
export class ApiError extends Error {
  constructor(public status: number, message: string, public suggest?: string) {
    super(message);
  }
}
