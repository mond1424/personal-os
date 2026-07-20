// 시간 규약 (스키마 헤더와 동일)
//   날짜 = 'YYYY-MM-DD' (귀속일) · 시각 = ISO8601 오프셋 포함
//   귀속일은 항상 "기록 시점"에 계산해 저장 — 경계 설정을 바꿔도 과거는 재해석되지 않는다.
// KST(+09:00)는 DST가 없으므로 고정 오프셋 산술로 충분하다.

import type { Env, TimeCtx } from "../types";

export function parseOffset(s: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(s);
  if (!m) return 9 * 60;
  const v = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -v : v;
}

function shifted(utcMs: number, offsetMin: number): Date {
  return new Date(utcMs + offsetMin * 60_000); // UTC 게터로 로컬 벽시계를 읽는다
}

/** 귀속일: 로컬 시각이 경계(HH:MM) 이전이면 전날. */
export function attributionDate(utcMs: number, offsetMin: number, boundary: string): string {
  const t = shifted(utcMs, offsetMin);
  const [bh = 5, bm = 0] = boundary.split(":").map(Number);
  if (t.getUTCHours() * 60 + t.getUTCMinutes() < bh * 60 + bm) {
    t.setUTCDate(t.getUTCDate() - 1);
  }
  return t.toISOString().slice(0, 10);
}

/** 오프셋 포함 ISO 시각 — '2026-07-18T16:45:00+09:00' */
export function isoNow(utcMs: number, offsetMin: number): string {
  const p = shifted(utcMs, offsetMin).toISOString().slice(0, 19);
  const sign = offsetMin >= 0 ? "+" : "-";
  const a = Math.abs(offsetMin);
  const hh = String(Math.floor(a / 60)).padStart(2, "0");
  const mm = String(a % 60).padStart(2, "0");
  return `${p}${sign}${hh}:${mm}`;
}

/**
 * 이미 로컬 오프셋이 붙은 ISO 시각의 귀속일 (1.2).
 * SQLite의 date()는 오프셋을 UTC로 환산해버려 경계와 어긋난다 — 대기 일수처럼
 * 귀속일 기준이어야 하는 계산은 전부 이 함수를 통과시킨다.
 */
export function attributionOfIso(iso: string, boundary: string): string {
  const date = iso.slice(0, 10);
  const hh = Number(iso.slice(11, 13));
  const mm = Number(iso.slice(14, 16));
  const [bh = 5, bm = 0] = boundary.split(":").map(Number);
  return hh * 60 + mm < bh * 60 + bm ? addDays(date, -1) : date;
}

export const isDate = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));

export function addDays(date: string, n: number): string {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const diffDays = (a: string, b: string): number =>
  Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86_400_000);

/** 그 주의 월요일 (5.2 윈도우 — 목업 기준 주 = 월~일). */
export function mondayOf(date: string): string {
  const t = new Date(date + "T00:00:00Z");
  return addDays(date, -((t.getUTCDay() + 6) % 7));
}

/** settings에서 경계·오프셋을 읽어 요청 시간 컨텍스트를 만든다. */
export async function loadTime(env: Env, utcMs: number = Date.now()): Promise<TimeCtx> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('day_boundary','utc_offset')"
  ).all<{ key: string; value: string }>();
  const map = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  const boundary = map["day_boundary"] ?? "05:00";
  const offsetMin = parseOffset(map["utc_offset"] ?? "+09:00");
  const d = attributionDate(utcMs, offsetMin, boundary);
  return { d, now: isoNow(utcMs, offsetMin), compact: d.replaceAll("-", ""), boundary, offsetMin };
}
