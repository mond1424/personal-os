// 시간표 (ADR-045 · T-58) — **규칙을 저장하고 날짜는 전개한다.**
//
// 자동 수집 두 경로가 둘 다 비었다(uclass iCal VEVENT 0 · 폰 캘린더에 시간표 없음).
// 그래서 사용자가 한 번 붙여넣는다 — **입력 한 번의 수익률이 이 프로젝트에서 가장 높은 데이터다.**
//
// ⚠️ **파싱에 모델을 부르지 않는다** — 비결정론·비용·오프라인. 정규식으로 되는 형식이고,
//    정확성은 파서가 아니라 **확인 화면**이 책임진다(ADR-045 ③).
// ⚠️ **못 읽은 줄을 조용히 버리지 않는다.** 버리면 시간표가 반만 든 채 학기를 간다 —
//    T-54·T-55가 두 번 배운 자리다. 못 읽은 원문을 그대로 돌려주고 사용자가 고친다.
import * as db from "../db";
import { nextId } from "../lib/id";
import { addDays, diffDays, isDate } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/** 1=월 … 7=일 (ISO-8601). `weekday` 컬럼과 같은 약속이다. */
const WEEK = ["월", "화", "수", "목", "금", "토", "일"];

/** 조회 창 상한. ⚠️ 넘으면 **조용히 빈 배열을 주지 않고 거절한다** — 빈 시간표와 구별돼야 한다. */
const MAX_SPAN_DAYS = 400;

/** 그 날짜의 요일 (1=월 … 7=일). */
export function weekdayOf(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();   // 0=일
  return w === 0 ? 7 : w;
}

/** `10시` · `10:00` · `10시30분` — 셋 다 같은 것으로 읽는다. 못 읽으면 `null`. */
function parseTime(tok: string): string | null {
  const m = tok.trim().match(/^(\d{1,2})\s*(?::\s*(\d{2})|시(?:\s*(\d{1,2})\s*분)?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? m[3] ?? "0");
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export interface ParsedRule {
  subject: string; weekday: number; start_time: string; end_time: string;
}
export interface UnreadLine { line: number; text: string; reason: string }
export interface ParseResult {
  rules: ParsedRule[];
  unread: UnreadLine[];
  term: { start: string; end: string } | null;
}

const DASH = "[-~–—]";
const SEG = new RegExp(`^(.+?)\\s*${DASH}\\s*(.+?)\\s+(\\S.*)$`);
const TERM = new RegExp(`^\\s*(?:학기|기간)\\s*[:：]?\\s*(\\d{4}-\\d{2}-\\d{2})\\s*${DASH}\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$`);
const HEAD = /^\s*([월화수목금토일])(?:요일)?\s*[:：]?\s*(.*)$/;
/** 수업이 없는 날을 **못 읽은 줄로 세지 않는다** — 그것은 사용자가 적어 준 정보다. */
const FREE = /^(공강|없음|휴강|-|—)$/;

/**
 * 붙여넣은 텍스트 → 규칙. **순수 함수다** — 저장하지 않고 DB도 안 본다.
 *
 * ★ 이 형식을 규격으로 굳히지 않는다. 다음 학기에 사용자가 다르게 쓸 수 있고,
 *   그때 조용히 어긋나면 이 기능이 무의미해진다. 그래서 못 읽은 것이 **전부** 돌아간다.
 */
export function parseText(text: unknown): ParseResult {
  if (typeof text !== "string") throw new ApiError(400, "붙여넣은 내용이 필요해요");
  if (text.length > 20_000) throw new ApiError(400, "붙여넣은 내용이 너무 길어요");
  const rules: ParsedRule[] = [];
  const unread: UnreadLine[] = [];
  let term: { start: string; end: string } | null = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;                                   // 빈 줄은 줄이 아니다
    const t = line.match(TERM);
    if (t) { const [, ts = "", te = ""] = t; term = { start: ts, end: te }; return; }
    const h = line.match(HEAD);
    if (!h) { unread.push({ line: i + 1, text: line, reason: "요일로 시작하지 않아요" }); return; }
    const [, day = "", tail = ""] = h;
    const weekday = WEEK.indexOf(day) + 1;
    const rest = tail.trim();
    if (!rest || FREE.test(rest)) return;                // 공강 — 읽었고, 규칙이 없는 것이 맞다
    for (const segRaw of rest.split(/\s*[,，·、/]\s*/)) {
      const seg = segRaw.trim();
      if (!seg || FREE.test(seg)) continue;
      const m = seg.match(SEG);
      if (!m) { unread.push({ line: i + 1, text: line, reason: `"${seg}"를 못 읽었어요` }); continue; }
      const [, rawStart = "", rawEnd = "", rawSubject = ""] = m;
      const start = parseTime(rawStart);
      const end = parseTime(rawEnd);
      const subject = rawSubject.trim();
      if (!start || !end) { unread.push({ line: i + 1, text: line, reason: `"${seg}"의 시각을 못 읽었어요` }); continue; }
      if (end <= start) { unread.push({ line: i + 1, text: line, reason: `"${seg}"는 끝이 시작보다 빨라요` }); continue; }
      if (!subject) { unread.push({ line: i + 1, text: line, reason: `"${seg}"에 과목이 없어요` }); continue; }
      rules.push({ subject, weekday, start_time: start, end_time: end });
    }
  });
  return { rules, unread, term };
}

/** 저장 전 검증. **확인 화면이 고친 값이 여기로 온다** — 파서를 다시 태우지 않는다. */
function validate(input: any): { rules: ParsedRule[]; term_start: string; term_end: string } {
  const rules = Array.isArray(input?.rules) ? input.rules : null;
  if (!rules) throw new ApiError(400, "시간표가 필요해요");
  if (rules.length > 200) throw new ApiError(400, "시간표가 너무 커요");
  // ⚠️ **학기 범위는 코드에 없다.** 매 학기 바뀌므로 입력으로 받고, 없으면 거절한다 —
  //    기본값을 박아 두면 다음 학기에 조용히 틀린 날짜로 전개된다(ADR-045 ④).
  if (!isDate(input?.term_start) || !isDate(input?.term_end))
    throw new ApiError(400, "학기 시작일과 종료일이 필요해요 (YYYY-MM-DD)");
  if (input.term_end < input.term_start) throw new ApiError(400, "학기 종료일이 시작일보다 빨라요");
  const out: ParsedRule[] = rules.map((r: any, i: number) => {
    const where = `${i + 1}번째 줄`;
    const subject = typeof r?.subject === "string" ? r.subject.trim() : "";
    if (!subject) throw new ApiError(400, `${where}: 과목이 필요해요`);
    if (subject.length > 120) throw new ApiError(400, `${where}: 과목이 너무 길어요`);
    const weekday = Number(r?.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)
      throw new ApiError(400, `${where}: 요일은 1(월)~7(일)이에요`);
    const start = parseTime(String(r?.start_time ?? ""));
    const end = parseTime(String(r?.end_time ?? ""));
    if (!start || !end) throw new ApiError(400, `${where}: 시각 형식은 HH:MM`);
    if (end <= start) throw new ApiError(400, `${where}: 끝이 시작보다 빨라요`);
    return { subject, weekday, start_time: start, end_time: end };
  });
  return { rules: out, term_start: input.term_start, term_end: input.term_end };
}

export const list = async (env: Env) => {
  const rows = (await db.timetableRules(env)).results;
  const first = rows[0];
  return {
    rules: rows,
    // 학기는 규칙마다 같은 값이라 하나로 접어 준다 — 화면이 다시 세지 않게.
    term: first ? { start: first.term_start, end: first.term_end } : null,
  };
};

/**
 * 시간표 전체를 갈아 끼운다. **부분 수정이 없다** — 한 학기 시간표는 한 벌이고,
 * 붙여넣기가 그 한 벌을 통째로 준다. 부분 수정을 열면 *"지운 수업이 남아 있다"*가 생긴다.
 */
export async function replace(env: Env, t: TimeCtx, input: any) {
  const v = validate(input);
  const base = Number((await nextId(env, "timetable_rules", t.compact)).slice(9));
  const stmts = [db.stClearTimetable(env)];
  v.rules.forEach((r, i) => {
    const id = `${t.compact}-${String(base + i).padStart(3, "0")}`;
    stmts.push(db.stInsertTimetableRule(
      env, id, r.subject, r.weekday, r.start_time, r.end_time, v.term_start, v.term_end, t.now));
  });
  await env.DB.batch(stmts);
  return list(env);
}

export interface ClassInstance {
  date: string; subject: string; start_time: string; end_time: string; rule_id: string;
}

/**
 * ★ **전개는 여기서만, 조회할 때만 일어난다. 어디에도 저장되지 않는다** (원칙 1 · ADR-045 ②).
 *
 * 15주치 행을 만들어 두면 학기가 바뀔 때 그 전부를 손봐야 한다.
 * `CalendarContract.Instances`가 provider에서 하는 일과 같은 모양이다.
 */
export function expand(rules: db.TimetableRule[], start: string, end: string): ClassInstance[] {
  if (!isDate(start) || !isDate(end)) throw new ApiError(400, "날짜 형식은 YYYY-MM-DD");
  const span = diffDays(end, start);
  if (span < 0) return [];
  if (span > MAX_SPAN_DAYS) throw new ApiError(400, "조회 구간이 너무 넓어요");
  const out: ClassInstance[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    const w = weekdayOf(date);
    for (const r of rules) {
      if (r.weekday !== w) continue;
      // 학기 밖은 전개하지 않는다 — 방학에 수업이 뜨면 그 화면 전체가 못 믿을 것이 된다.
      if (date < r.term_start || date > r.term_end) continue;
      out.push({
        date, subject: r.subject,
        start_time: r.start_time, end_time: r.end_time, rule_id: r.id,
      });
    }
  }
  return out.sort((a, b) =>
    a.date === b.date
      ? (a.start_time === b.start_time ? a.subject.localeCompare(b.subject) : a.start_time.localeCompare(b.start_time))
      : a.date.localeCompare(b.date));
}

/** 화면이 부르는 자리 — 규칙을 읽어 창만큼 전개한다. */
export async function classesIn(env: Env, start: string, end: string): Promise<ClassInstance[]> {
  const rows = (await db.timetableRules(env)).results;
  if (!rows.length) return [];
  return expand(rows, start, end);
}
