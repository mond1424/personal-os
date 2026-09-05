/* Personal OS · Worker 스모크 테스트
 * HTTP 계층(Hono)까지 통째로 태운다 — 라우팅·검증·트리거 에러 번역 전부.
 * 시나리오는 목업의 플로우: 생성 → 기록 → 미루기 → 마감 → memo →
 * 재배정 → 자동 마감(Cron 경로) → 대기 연장.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../src/index";
import * as db from "../src/db";
import { autoClose } from "../src/scheduled";
import * as guard from "../src/services/guard";
import * as uclass from "../src/services/uclass";
import { attributionDate, isoNow, addDays, mondayOf, diffDays, loadTime } from "../src/lib/time";
import { buildCoreContext } from "../src/lib/context";
import type { Env } from "../src/types";
import { makeD1, rawOf } from "./d1shim";

const here = dirname(fileURLToPath(import.meta.url));
const schema = ["0001_init.sql", "0002_models.sql", "0003_ai_provider.sql", "0004_events.sql", "0005_delete_scope.sql", "0006_fix_model_high.sql", "0007_defer_reason.sql", "0008_cancel_task.sql", "0009_cancel_reason.sql", "0010_guard.sql", "0011_guard_sync.sql", "0012_life_model.sql", "0013_analysis_backfill.sql", "0014_schema_titles.sql", "0015_me_history_reason.sql", "0016_guard_unavailable_reason.sql", "0017_ai_reason.sql", "0018_collected_items.sql", "0019_guard_ai_immutable.sql", "0020_cal_sync.sql", "0021_timetable.sql"]
  .map((f) => readFileSync(join(here, "../migrations/" + f), "utf8")).join("\n");
const env: Env = { DB: makeD1(schema) };
const raw = rawOf(env.DB);

let passN = 0; const fails: string[] = [];
function ok(name: string, cond: boolean, detail = "") {
  if (cond) { passN++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ FAIL ${name}${detail ? " — " + detail : ""}`); }
}

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await worker.fetch(
    new Request(`http://local${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json", ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    {} as ExecutionContext,
  );
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, json };
}

// ── 0. 시간 라이브러리 — 순수 함수는 고정 시각으로 ─────────────
console.log("\n[0] 시간 — 귀속일(경계 05:00)·주(월요일) 계산");
const KST = 9 * 60;
ok("16:45 KST → 그날", attributionDate(Date.parse("2026-07-18T16:45:00+09:00"), KST, "05:00") === "2026-07-18");
ok("새벽 02:00 KST → 전날 귀속 (1.2)", attributionDate(Date.parse("2026-07-19T02:00:00+09:00"), KST, "05:00") === "2026-07-18");
ok("경계 정각 05:00 → 새 날", attributionDate(Date.parse("2026-07-19T05:00:00+09:00"), KST, "05:00") === "2026-07-19");
ok("ISO 오프셋 포맷", isoNow(Date.parse("2026-07-18T16:45:00+09:00"), KST) === "2026-07-18T16:45:00+09:00");
ok("mondayOf(토 7/18) = 7/13", mondayOf("2026-07-18") === "2026-07-13");

const t0 = await loadTime(env);
const D = t0.d;                     // 오늘(실제 시계) 귀속일 — 이하 상대 날짜로 진행
const D_1 = addDays(D, -1), D_2 = addDays(D, -2), D_3 = addDays(D, -3);
const N1 = addDays(D, 1), N2 = addDays(D, 2);
console.log(`  · 오늘 귀속일 = ${D}`);

// ── 1. 생성 — 기간 · task (대기/예정) ──────────────────────────
console.log("\n[1] 생성 — periods · tasks");
const pMint = await api("POST", "/api/periods", {
  title: "Personal OS 설계", start_date: addDays(D, -6), end_date: addDays(D, 6),
  color: "#7ED4A9", goals: ["Personal OS v1"],
});
ok("기간 생성 201 + id 규약", pMint.status === 201 && new RegExp(`^${t0.compact}-001$`).test(pMint.json.id), JSON.stringify(pMint.json));
const MINT = pMint.json.id as string;
ok("기간 검증 — start > end 거부", (await api("POST", "/api/periods", { title: "x", start_date: N1, end_date: D, color: "#000000" })).status === 400);

const tA = (await api("POST", "/api/tasks", { title: "곡선 분할 프로토타입", period_id: MINT, date: D })).json.id as string;
const tC = (await api("POST", "/api/tasks", { title: "실기 기출 1회분", period_id: MINT, date: D })).json.id as string;
const tB = (await api("POST", "/api/tasks", { title: "『양자컴퓨팅 입문』 읽기" })).json.id as string;
ok("같은 날 id 순번 증가", tA.endsWith("-001") && tC.endsWith("-002") && tB.endsWith("-003"), `${tA} ${tC} ${tB}`);
ok("제목만 = 대기(waiting)", (await api("GET", `/api/tasks/${tB}`)).json.is_waiting === 1);
ok("없는 기간 참조 404", (await api("POST", "/api/tasks", { title: "x", period_id: "20990101-001" })).status === 404);

// ── 2. Today 조립 + 기록 ──────────────────────────────────────
console.log("\n[2] Today 조인 + Log·Feelings·Score");
let today = (await api("GET", "/api/today")).json;
ok("Todo 2건 (A·C)", today.todo.length === 2);
ok("대기 상시 행 n=1 · 1일째", today.waiting.n === 1 && today.waiting.max_age === 1);
ok("활성 기간 칩에 mint", today.periods.some((p: any) => p.id === MINT));
ok("daily 행 아직 없음 (건너뛴 날 = 행 없음)", today.daily === null);
// T-45 ② — ①의 짝. **발동이 없어도 집계는 온다**: `null`(못 읽었다)이 아니라 0이다.
// 여기가 그 자리인 이유: 이 지점의 `guard_events`는 아직 비어 있다(발동 기록은 [9]에서 시작한다).
ok("② 발동이 0이면 집계가 0을 준다 (없는 게 아니라 0)",
  !!today.guard && today.guard.fired === 0 && today.guard.last_at === null && today.guard.ignored === 0,
  JSON.stringify(today.guard));

ok("Log 추가 201", (await api("POST", "/api/logs", { text: "곡선 통일 결정." })).status === 201);
ok("빈 Log 400", (await api("POST", "/api/logs", { text: "  " })).status === 400);

/* ── T-48 · 홈 "오늘 찍기" 위젯이 실제로 보내는 본문 (ADR-043) ────────────────
 * ★ **정규식으로 "PUT이 있다"를 세지 않는다.** Kotlin의 상수를 뽑아 **그것으로 본문을 조립해
 *   진짜로 쏜다** — 경로·바깥 키·눈금 중 하나라도 갈라지면 여기서 죽는다.
 *   T-46이 `DEEP_LINK`를 살아 있는 `deepLinkAction`에 먹인 것과 같은 자리다:
 *   두 문자열을 각자 정규식으로 보면 갈라져도 둘 다 초록이다.
 *
 * ⚠️ **여기가 열린 날이라서** 성공 경로를 여기서 잰다. 마감 뒤(§4)에 짝이 하나 더 있다 —
 *    거기서는 같은 본문이 409로 돌아온다. 그 둘이 위젯 ④의 두 얼굴이다.
 * ⚠️ 아래 `Feelings 눈금`·`Score 7`이 이 절이 흔든 값을 원래대로 덮는다 — §4의 물화 검사
 *    (`mech.feelings.energy === 6` · `mech.score === 7`)가 그 값을 읽기 때문이다.
 */
const ktBare = (p: string) => readFileSync(join(here, p), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const ktScaleStore = ktBare("../android/app/src/main/java/dev/mond1424/personalos/widget/ScaleStore.kt");
const ktStr = (src: string, name: string) =>
  (new RegExp(`const val ${name}\\s*=\\s*"([^"]*)"`).exec(src) || [])[1] ?? "";
const mSteps = /val STEPS\s*=\s*intArrayOf\(([^)]*)\)/.exec(ktScaleStore);
const W_STEPS: number[] = (mSteps?.[1] ?? "").split(",").filter((s) => s.trim()).map((s) => Number(s.trim()));
const mFields = /val FEELING_FIELDS\s*=\s*arrayOf\(([^)]*)\)/.exec(ktScaleStore);
const W_FIELDS: string[] = ((mFields?.[1] ?? "").match(/"[^"]+"/g) ?? []).map((x) => x.slice(1, -1));
const W_PATH_F = ktStr(ktScaleStore, "PATH_FEELINGS");
const W_PATH_S = ktStr(ktScaleStore, "PATH_SCORE");
const W_SCORE_FIELD = ktStr(ktScaleStore, "FIELD_SCORE");
const W_BODY_F = ktStr(ktScaleStore, "BODY_FEELINGS");
const W_BODY_S = ktStr(ktScaleStore, "BODY_SCORE");

/** 뽑아 온 것이 비면 **거기서 알아채야 한다** — 빈 값으로 조용히 굴러가면 아래가 전부 무의미해진다. */
const wF = (i: number): string => W_FIELDS[i] ?? "(지표 없음)";
const wS = (i: number): number => W_STEPS[i] ?? -1;

/** 위젯이 조립하는 본문 그대로. 상수 하나가 바뀌면 아래 왕복이 전부 따라 바뀐다. */
const wBody = (field: string, value: number): Record<string, unknown> =>
  field === W_SCORE_FIELD ? { [W_BODY_S]: value } : { [W_BODY_F]: { [field]: value } };

ok("[T-48] 위젯 눈금이 다섯 칸(2·4·6·8·10) · 지표 셋이다",
  JSON.stringify(W_STEPS) === "[2,4,6,8,10]" && W_FIELDS.length === 3,
  `${JSON.stringify(W_STEPS)} / ${JSON.stringify(W_FIELDS)}`);

// ★ 다섯 칸을 하나씩 눌러 본다 — 보낸 값이 그대로 담기는가.
const wSeen: number[] = [];
for (const step of W_STEPS) {
  const r = await api("PUT", W_PATH_F, wBody(wF(0), step));
  if (r.status !== 200) { wSeen.push(-r.status); continue; }
  const t = (await api("GET", "/api/today")).json;
  wSeen.push(t.feelings.find((f: any) => f.field === wF(0))?.value ?? -1);
}
ok("[T-48] ★ 다섯 칸이 그대로 담긴다 (위젯 본문으로 PUT → 되읽기)",
  JSON.stringify(wSeen) === JSON.stringify(W_STEPS), JSON.stringify(wSeen));

// 세 지표와 score는 **경로도 본문 모양도 다르다.** 한 경로만 맞아도 통과하지 않게 셋 다 본다.
const wCodes = [
  (await api("PUT", W_PATH_F, wBody(wF(1), wS(1)))).status,
  (await api("PUT", W_PATH_F, wBody(wF(2), wS(3)))).status,
  (await api("PUT", W_PATH_S, wBody(W_SCORE_FIELD, wS(2)))).status,
];
const wAfter = (await api("GET", "/api/today")).json;
const wVal = (f: string) => wAfter.feelings.find((x: any) => x.field === f)?.value ?? null;
ok("[T-48] 세 지표와 score가 각자 제 경로로 간다",
  JSON.stringify(wCodes) === "[200,200,200]"
  && wVal(wF(1)) === wS(1) && wVal(wF(2)) === wS(3)
  && wAfter.daily?.score === wS(2),
  `${JSON.stringify(wCodes)} / ${wVal(wF(1))}·${wVal(wF(2))}·${wAfter.daily?.score}`);

ok("Feelings 눈금", (await api("PUT", "/api/daily/feelings", { values: { energy: 6, stress: 4 } })).status === 200);
ok("Feelings 범위 검증", (await api("PUT", "/api/daily/feelings", { values: { energy: 11 } })).status === 400);
ok("Score 7", (await api("PUT", "/api/daily/score", { score: 7 })).status === 200);
today = (await api("GET", "/api/today")).json;
ok("기록 후 daily open + 값 반영", today.daily?.status === "open" && today.daily?.score === 7 && today.logs.length === 1);

// ── 3. 미루기(열린 날) + 다이얼 ───────────────────────────────
console.log("\n[3] 미루기 — 열린 날은 defer 표기 + 새 항목");
ok("미루기 2주 초과 거부", (await api("POST", `/api/tasks/${tC}/defer`, { from: D, to: addDays(D, 20) })).status === 400);
// 신규 일정은 상한 없음 (미루기에만 2주 규칙 — 시험 등 먼 확정 일정)
const tFar = (await api("POST", "/api/tasks", { title: "먼 확정 일정", date: addDays(D, 45) })).json.id as string;
ok("신규 일정 45일 뒤 허용", typeof tFar === "string");
ok("지난 날짜 신규 일정 거부", (await api("POST", "/api/tasks", { title: "과거", date: addDays(D, -1) })).status === 400);
const tWaitFar = (await api("POST", "/api/tasks", { title: "대기→먼 날짜" })).json.id as string;
ok("대기 → 30일 뒤 확정 허용", (await api("POST", `/api/tasks/${tWaitFar}/schedule`, { date: addDays(D, 30) })).status === 200);
ok("같은 날로 미루기 거부", (await api("POST", `/api/tasks/${tC}/defer`, { from: D, to: D })).status === 400);
const df = await api("POST", `/api/tasks/${tC}/defer`, { from: D, to: N2 });
ok("미루기 성공 (reassigned=false)", df.status === 200 && df.json.reassigned === false);
ok("이중 미루기 409", (await api("POST", `/api/tasks/${tC}/defer`, { from: D, to: N1 })).status === 409);
today = (await api("GET", "/api/today")).json;
ok("미룬 항목은 Todo에서 제외", today.todo.length === 1 && today.todo[0].id === tA);
ok("다이얼 40", (await api("PUT", `/api/tasks/${tA}/rate`, { date: D, rate: 40 })).status === 200);
ok("이동된 항목 다이얼 404", (await api("PUT", `/api/tasks/${tC}/rate`, { date: D, rate: 10 })).status === 404);
const cStats = (await api("GET", `/api/tasks/${tC}`)).json;
ok("이월 1회 · 새 항목 rate 0 (v0.8)", cStats.defer_count === 1 && cStats.entries.at(-1).rate === 0);

// 미루기와 함께 완료율 확정 — "그 예정일까지 얼마나 갔나"는 미루는 순간에 알 수 있다
const tR = (await api("POST", "/api/tasks", { title: "미루며 완료율", date: D })).json.id as string;
const dfR = await api("POST", `/api/tasks/${tR}/defer`, { from: D, to: N1, rate: 75 });
ok("미루기 + rate 동시 처리", dfR.status === 200 && dfR.json.rate === 75);
const rStats = (await api("GET", `/api/tasks/${tR}`)).json;
ok("원 항목에 75% 확정", rStats.entries[0].rate === 75 && rStats.entries[0].deferred_to === N1);
ok("새 항목은 0에서 시작 (v0.8 원칙 유지)", rStats.entries.at(-1).rate === 0);
ok("rate 범위 밖이면 400",
  (await api("POST", `/api/tasks/${tR}/defer`, { from: N1, to: N2, rate: 130 })).status === 400);
ok("rate 없이도 그대로 동작",
  (await api("POST", `/api/tasks/${tR}/defer`, { from: N1, to: N2 })).status === 200);

// 미루기 사유 (0007) — 도착지(새 예정) 항목에만 남는다. trim 적용, 원 항목엔 안 남는다.
const N3 = addDays(D, 3);
const dfRe = await api("POST", `/api/tasks/${tR}/defer`, { from: N2, to: N3, reason: "  다른 일이 급해서  " });
ok("미루기 사유와 함께 처리(200)", dfRe.status === 200);
const reStats = (await api("GET", `/api/tasks/${tR}`)).json;
ok("도착지 항목에 사유 저장(trim)",
  reStats.entries.find((e: any) => e.date === N3)?.defer_reason === "다른 일이 급해서", JSON.stringify(reStats.entries));
ok("원 항목(N2)엔 사유 없음",
  (reStats.entries.find((e: any) => e.date === N2)?.defer_reason ?? null) === null);

// 취소 테스트 예약 — 마감 전 D에 예정을 심어 둔다(마감 후엔 INSERT 트리거가 막는다).
// 마감되면 missed로 확정되고, 뒤의 [취소] 절에서 '마감된 날 항목 보존'을 검증한다 (0008).
const tCanKeep = (await api("POST", "/api/tasks", { title: "취소-마감보존", date: D })).json.id as string;

// ── 4. 하루 마감 (G) — todo → missed 확정 ────────────────────
console.log("\n[4] 마감 — 물화 → close, 이후 동결");
const close = await api("POST", "/api/daily/close", { kind: "manual" });
ok("마감 성공", close.status === 200);
ok("이중 마감 409", (await api("POST", "/api/daily/close", {})).status === 409);
const mech = JSON.parse(raw.prepare("SELECT mech FROM summaries WHERE kind='daily' AND key=?").get(D)!.mech as string);
ok("mech: A가 missed로 확정 (rate 40 보존)", mech.sections.missed.some((x: any) => x.id === tA && x.rate === 40));
ok("mech: C는 deferred", mech.sections.deferred.some((x: any) => x.id === tC && x.to === N2));
ok("mech: score·feelings 물화", mech.score === 7 && mech.feelings.energy === 6);
ok("마감 후 Log 추가 → 409 번역", (await api("POST", "/api/logs", { text: "소급" })).status === 409);
ok("마감 후 Score 수정 → 409", (await api("PUT", "/api/daily/score", { score: 9 })).status === 409);
ok("마감 후 다이얼 → 동결 409", (await api("PUT", `/api/tasks/${tA}/rate`, { date: D, rate: 90 })).status === 409);

/* ★ T-48의 짝 — **거부는 상상이 아니다** (ADR-043 결정 ③).
 * 위 [2]에서 200을 받은 **그 본문 그대로** 다시 쏜다. 마감된 날에는 `feelings_frozen_ins`가
 * **추가까지** 막아 409가 온다(함정 6 — '마감된 날에도 추가되는 것'은 events와 memo뿐이다).
 * 위젯은 토스트를 못 띄우므로, 이 409를 안 되돌리면 **그 하루의 마지막 탭이 조용히 사라진다.**
 * 여기서 세는 것은 "서버가 정말 거부하는가"이고, "위젯이 되돌리는가"는 front가 센다. */
ok("[T-48] ★ 마감된 날엔 위젯 feelings 본문도 409 (추가까지 막힌다)",
  (await api("PUT", W_PATH_F, wBody(wF(0), wS(0)))).status === 409);
ok("[T-48] ★ score 경로도 같다 — 되돌릴 자리가 두 경로 다 있다",
  (await api("PUT", W_PATH_S, wBody(W_SCORE_FIELD, wS(4)))).status === 409);

// ── 5. memo — 어느 날짜에든(3단계) + summary stale ──────────────
console.log("\n[5] memo — 어느 날짜에든 + stale");
ok("memo 추가 201", (await api("POST", "/api/memos", { date: D, text: "마감 후 소회" })).status === 201);
ok("daily summary stale=1", raw.prepare("SELECT stale FROM summaries WHERE kind='daily' AND key=?").get(D)!.stale === 1);
raw.prepare("INSERT INTO memos (id, date, ts, text, created_at) VALUES (?, ?, ?, ?, ?)")
  .run("memo-origin-boundary", D, "14:30", "경계 안쪽 작성", `${N1}T03:00:00+09:00`);
raw.prepare("INSERT INTO memos (id, date, ts, text, created_at) VALUES (?, ?, ?, ?, ?)")
  .run("memo-origin-later", D, "09:00", "나중 작성", `${N1}T09:00:00+09:00`);
const memoOriginDay = (await api("GET", `/api/days/${D}`)).json;
ok("귀속일 경계를 넘은 03:00 memo도 그날 쓴 것으로 판정",
  memoOriginDay.memos.find((m: any) => m.id === "memo-origin-boundary")?.same_day === true);
ok("귀속일이 다른 나중 memo는 same_day=false",
  memoOriginDay.memos.find((m: any) => m.id === "memo-origin-later")?.same_day === false);
ok("memo 순서는 created_at이 아니라 ts 그대로",
  memoOriginDay.memos.filter((m: any) => m.id.startsWith("memo-origin-"))
    .map((m: any) => m.ts).join(",") === "09:00,14:30");
// 3단계: memo는 어느 날짜에든 붙는다 — daily가 없으면 자동으로 open daily를 만들고 붙인다(404 폐기).
// (미래일로 검증 — 과거 open daily는 뒤의 autoClose 테스트에 섞이므로.)
const memoFut = addDays(D, 6);
ok("일기 없던(미래) 날 memo도 201(daily 자동 생성)",
  (await api("POST", "/api/memos", { date: memoFut, text: "미래 메모" })).status === 201);
const futDay = (await api("GET", `/api/days/${memoFut}`)).json;
ok("빈 open daily가 생기고 memo가 붙음 · relation=future",
  futDay.daily?.status === "open" && futDay.relation === "future" && futDay.memos.some((m: any) => m.text === "미래 메모"));
// memo는 셀 본문(calMemos 줄)에 직접 실린다 — 3단계에서 .dr 마커 조건에서는 빠졌다.
const calMemo = (await api("GET", `/api/calendar?start=${D}&end=${addDays(D, 7)}`)).json;
ok("memo 있는 날은 셀 memo 줄로 실림(diary 마커 아님)",
  calMemo.memos.some((x: any) => x.date === memoFut) && !calMemo.diary.some((x: any) => x.date === memoFut));

// ── 6. 재배정 — 마감된 날에서의 미루기 (v0.8 재배정 대기) ─────
console.log("\n[6] 재배정 — 원 항목 동결 유지, 새 예정만");
today = (await api("GET", "/api/today")).json; // 마감 후에도 조회는 그대로
ok("같은 날엔 아직 재배정 대기 미노출 ('다음 날' 노출 — 1.2)", !today.reassign.some((r: any) => r.id === tA));
// 마감된 날에서 미룰 땐 완료율을 보내도 조용히 버린다 — 지난 기록은 불변(1.3).
// 트리거가 거부해 500이 나면 안 되고, 원 항목의 rate(40)도 그대로여야 한다.
const re = await api("POST", `/api/tasks/${tA}/defer`, { from: D, to: N1, rate: 90 });
ok("재배정 = reassigned=true", re.status === 200 && re.json.reassigned === true);
ok("마감된 날의 완료율은 rate를 보내도 안 바뀜",
  (await api("GET", `/api/tasks/${tA}`)).json.entries.find((e: any) => e.date === D).rate === 40,
  JSON.stringify(re.json));
const aEntries = (await api("GET", `/api/tasks/${tA}`)).json.entries;
ok("원 항목 deferred_to 없음 = Missed 기록 보존", aEntries.find((e: any) => e.date === D).deferred_to === null);
ok("이월 카운트 +1 (통일 공식)", (await api("GET", `/api/tasks/${tA}`)).json.defer_count === 1);
const dayD = (await api("GET", `/api/days/${D}`)).json;
ok("날짜 팝업: A는 그날 missed로 분류(F)", dayD.tasks.find((x: any) => x.id === tA).class === "missed");

// ── 7. 대기 플로우 — 연장·일정 확정·완료 ──────────────────────
console.log("\n[7] 대기 — 연장(이력)·확정·완료");
// 12일째 대기 중인 task 시드 (연장은 며칠 지난 뒤 일어나는 게 실사용)
const OLD_ANCHOR = `${addDays(D, -12)}T09:00:00+09:00`;
raw.prepare("INSERT INTO tasks (id, title, wait_anchor_at, created_at) VALUES ('20260626-001', '『데이터 지향 설계』 읽기', ?, ?)").run(OLD_ANCHOR, OLD_ANCHOR);
const waitList = (await api("GET", "/api/works/waiting")).json;
ok("대기 목록 — 13일째 (n일째 = 경과 + 1)", waitList.find((w: any) => w.id === "20260626-001")?.age === 13);
const ext = await api("POST", "/api/tasks/20260626-001/extend");
ok("연장 성공 + 기한 반환", ext.status === 200 && ext.json.deadline === addDays(D, 21));
const extDetail = (await api("GET", "/api/tasks/20260626-001")).json;
ok("연장 이력 1건 (트리거 자동) — 이전 앵커 보존", extDetail.extensions.length === 1 && extDetail.extensions[0].prev_anchor_at === OLD_ANCHOR);
ok("연장 후 다시 1일째", extDetail.wait_age === 1);
const tD = (await api("POST", "/api/tasks", { title: "포트폴리오 리포 정리" })).json.id as string;
ok("일정 확정", (await api("POST", `/api/tasks/${tD}/schedule`, { date: N1 })).status === 200);
ok("예정 있는 task 재확정 409", (await api("POST", `/api/tasks/${tD}/schedule`, { date: N2 })).status === 409);
ok("예정 있는 task 연장 409", (await api("POST", `/api/tasks/${tD}/extend`)).status === 409);
ok("대기 task 바로 완료", (await api("POST", `/api/tasks/${tB}/complete`)).status === 200);
ok("이중 완료 409", (await api("POST", `/api/tasks/${tB}/complete`)).status === 409);
const done = (await api("GET", "/api/works/done")).json;
ok("Works 완료에 등장", done.some((x: any) => x.id === tB));
today = (await api("GET", "/api/today")).json;
ok("Today Done에는 없음 (예정 없이 완료 — 목업 동작)", !today.done.some((x: any) => x.id === tB));

// ── 8. 자동 마감 (H — Cron 경로) ──────────────────────────────
console.log("\n[8] 자동 마감 — 열린 과거 + 행 없는 예정일");
// 시드: 과거 열린 날(D-2, 로그 있음) + 행조차 없는 예정일(D-3, task G)
raw.prepare("INSERT INTO daily (date, created_at) VALUES (?, ?)").run(D_2, t0.now);
raw.prepare("INSERT INTO logs (date, ts, text, created_at) VALUES (?, ?, ?, ?)").run(D_2, `${D_2}T22:00:00+09:00`, "과거 열린 날", t0.now);
raw.prepare("INSERT INTO tasks (id, title, wait_anchor_at, created_at) VALUES ('20260601-001', '영단어 세트', ?, ?)").run(t0.now, t0.now);
raw.prepare("INSERT INTO schedule_entries (task_id, date, created_at) VALUES ('20260601-001', ?, ?)").run(D_3, t0.now);
const ac = await api("POST", "/api/admin/auto-close");
ok("Cron 결과 — 마감 1 · 고아 1", ac.json.closed === 1 && ac.json.orphaned === 1, JSON.stringify(ac.json));
ok("열린 과거 → auto 마감", (await api("GET", `/api/days/${D_2}`)).json.daily.close_kind === "auto");
const g = (await api("GET", `/api/days/${D_3}`)).json;
ok("고아 예정일 → closed 행 + missed 확정", g.daily?.status === "closed" && g.tasks[0].class === "missed");
ok("고아 날 mech summary 생성", !!raw.prepare("SELECT mech FROM summaries WHERE kind='daily' AND key=?").get(D_3));
ok("멱등 — 재실행 시 0·0", (await api("POST", "/api/admin/auto-close")).json.closed === 0 && true);
today = (await api("GET", "/api/today")).json;
ok("영단어가 재배정 대기에 (v0.8 정의)", today.reassign.some((r: any) => r.id === "20260601-001"));
const re2 = await api("POST", "/api/tasks/20260601-001/defer", { from: D_3, to: N1 });
ok("재배정 대기 → 미루기 (insert-only)", re2.status === 200 && re2.json.reassigned === true);
today = (await api("GET", "/api/today")).json;
ok("재배정 후 대기열 비움", today.reassign.length === 0);

// ── 9. 캘린더·기간·Me·설정·미리보기 ───────────────────────────
console.log("\n[9] 나머지 조립 — 캘린더·달성률·Me·설정·5.2 미리보기");
const cal = (await api("GET", `/api/calendar?start=${addDays(D, -7)}&end=${addDays(D, 7)}`)).json;
ok("캘린더: 기간 밴드 + 셀 글줄 + 일기 마커", cal.periods.length >= 1 && cal.entries.length >= 3 && cal.diary.some((x: any) => x.date === D));
const plist = (await api("GET", "/api/periods")).json;
const mint = plist.find((p: any) => p.id === MINT);
// mint 소속: A(미완료, 최신 rate 0) · C(미완료, 최신 rate 0) → 달성률 0.0
ok("달성률 = 다이얼 평균 (뷰)", mint.achievement === 0, String(mint.achievement));
ok("경과일 파생", mint.elapsed_days === 7 && mint.total_days === 13, `${mint.elapsed_days}/${mint.total_days}`);

ok("Me 필드 갱신", (await api("PUT", "/api/me/direction", { value: "도구를 만들어 스스로를 관찰하고 보정하는 사람" })).status === 200);
const meNow = (await api("GET", "/api/me")).json;
ok("Me: '지금' = 활성 기간 goals 조인 (비저장)", meNow.now.some((n: any) => n.goals.includes("Personal OS v1")));
ok("Me 이력 기록", (await api("GET", "/api/me/history")).json.length === 1);
ok("설정 검증 — 잘못된 경계 400", (await api("PUT", "/api/settings/day_boundary", { value: "25:00" })).status === 400);
ok("설정 갱신 OK", (await api("PUT", "/api/settings/day_boundary", { value: "05:00" })).status === 200);

const pv = (await api("GET", "/api/analyses/context-preview")).json;
const expElapsed = diffDays(D, mondayOf(D)) + 1;
const expRawStart = expElapsed >= 4 ? mondayOf(D) : addDays(mondayOf(D), -7);
ok("5.2 윈도우 — raw 시작·총일수", pv.raw.start === expRawStart && pv.total_days === diffDays(D, expRawStart) + 1 + 7, JSON.stringify(pv));
ok("guard 이벤트 조회 (빈 목록)", (await api("GET", "/api/guard/events")).json.length === 0);
ok("health", (await api("GET", "/api/health")).json.date === D);

// 9.4 task 삭제 — 계획 취소 vs 기록 보존
const tDel = (await api("POST", "/api/tasks", { title: "취소될 계획", date: N1 })).json.id as string;
ok("미래 예정 task 삭제 OK", (await api("DELETE", `/api/tasks/${tDel}`)).status === 200);
ok("삭제 후 404", (await api("GET", `/api/tasks/${tDel}`)).status === 404);
const delBlocked = await api("DELETE", `/api/tasks/${tA}`);
ok("지난 기록 있는 task 삭제 409", delBlocked.status === 409);
// 어떤 기록이 막는지 날짜로 말한다 — "다른 기록이 참조하고 있어요"로는 손쓸 수 없다
ok("삭제 거부 사유에 마감된 날짜가 들어감",
  /\d+\/\d+/.test(delBlocked.json.error) && delBlocked.json.error.includes("마감된 날"), delBlocked.json.error);

// 연장한 적 있는 대기 task 도 취소된다 (0005 — 예전엔 FK가 걸려 영영 못 지웠다)
// 앵커가 '며칠 전'이어야 UPDATE가 실제 변화가 되고 트리거가 이력을 남긴다
const tExt = "20260620-009";
const EXT_ANCHOR = `${addDays(D, -10)}T09:00:00+09:00`;
raw.prepare("INSERT INTO tasks (id, title, wait_anchor_at, created_at) VALUES (?, '연장했다가 접는 계획', ?, ?)")
  .run(tExt, EXT_ANCHOR, EXT_ANCHOR);
ok("연장 성공", (await api("POST", `/api/tasks/${tExt}/extend`)).status === 200);
ok("연장 이력 존재", (await api("GET", `/api/tasks/${tExt}`)).json.extensions.length === 1);
ok("연장 이력 있는 task 삭제 OK", (await api("DELETE", `/api/tasks/${tExt}`)).status === 200);
ok("연장 이력도 함께 사라짐",
  raw.prepare("SELECT COUNT(*) AS n FROM wait_extensions WHERE task_id = ?").get(tExt)!.n === 0);
// 그래도 마감 기록이 걸린 task의 연장 이력은 트리거가 막는다 (append-only 보존)
raw.prepare("INSERT INTO wait_extensions (task_id, prev_anchor_at, extended_at) VALUES (?, ?, ?)")
  .run(tA, EXT_ANCHOR, t0.now);
ok("마감 기록 있는 task의 연장 이력 삭제는 여전히 거부",
  (() => { try { raw.prepare("DELETE FROM wait_extensions WHERE task_id = ?").run(tA); return false; } catch { return true; } })());

// ── 9.5 구현 2: 모델 이원화 · AI 경로 ────────────────────────
console.log("\n[9.5] 모델 설정 · AI 경로 (키 없이 — 게이트만 검증)");
const setModels = (await api("GET", "/api/settings")).json as Array<{ key: string; value: string }>;
const mm = Object.fromEntries(setModels.map((r) => [r.key, r.value]));
ok("모델 기본값 2건 (low·high)", !!mm.model_low && !!mm.model_high, JSON.stringify(mm));
ok("모델 변경 OK", (await api("PUT", "/api/settings/model_high", { value: "claude-opus-4-8" })).status === 200);
ok("모델 형식 검증 400", (await api("PUT", "/api/settings/model_low", { value: "not a model!" })).status === 400);

const ctxRaw = (await api("GET", "/api/analyses/context-raw")).json;
ok("컨텍스트 조립 — Me·기간·raw 포함", ctxRaw.text.includes("[Me — 장기 맥락]") && ctxRaw.text.includes("[최근 raw") && ctxRaw.chars > 50);
ok("컨텍스트 meta — weekly 출처 기록", ctxRaw.meta.weekly.source === "mech" || ctxRaw.meta.weekly.source === "ai");
ok("분석 prompt 없으면 400", (await api("POST", "/api/analyses", {})).status === 400);
ok("키 없으면 분석 503", (await api("POST", "/api/analyses", { prompt: "이번 주 리듬" })).status === 503);
// 5.3 출력 분량 — 키가 없어 생성까지는 못 가므로(503) '검증 단계를 통과하는지'만 본다.
// depth가 400을 내지 않고 AI 호출까지 도달하면 통과. context_meta.depth 실값은 폰에서 확인.
ok("분석 depth normal — 400 아님", (await api("POST", "/api/analyses", { prompt: "이번 주 리듬", depth: "normal" })).status === 503);
ok("분석 depth deep — 400 아님", (await api("POST", "/api/analyses", { prompt: "이번 주 리듬", depth: "deep" })).status === 503);
ok("분석 depth 잘못된 값 — 400 아니라 detailed fallback", (await api("POST", "/api/analyses", { prompt: "이번 주 리듬", depth: "garbage" })).status === 503);
ok("서술 없으면 분류 400", (await api("POST", "/api/daily/classify-feelings")).status === 400);

// AI 연결 — 제공자 전환 · 개인 키 마스킹
ok("제공자 목록 3종", Object.keys((await api("GET", "/api/ai/providers")).json).length === 3);
const conns = (await api("GET", "/api/ai/connections")).json;
ok("연결 목록 — 제공자별 키 보유 여부", conns.connections.length === 3 && conns.connections.every((x: any) => "has_key" in x));
await api("PUT", "/api/settings/ai_key_openai", { value: "sk-openai-testkey" });
const conns2 = (await api("GET", "/api/ai/connections")).json;
ok("여러 제공자 동시 등록", conns2.connections.find((x: any) => x.provider === "openai").has_key === true);
ok("모델 값에 제공자 지정", (await api("PUT", "/api/settings/model_high", { value: "openai/gpt-5" })).status === 200);
const t1 = (await api("POST", "/api/ai/test", { which: "high" })).json;
ok("연결 테스트 — 제공자·모델 리포트", t1.provider === "openai" && t1.model === "gpt-5", JSON.stringify(t1));
ok("연결 테스트 실패도 200으로 진단 반환", t1.ok === false && typeof t1.error === "string");
await api("PUT", "/api/settings/ai_key_openai", { value: "" });
await api("PUT", "/api/settings/model_high", { value: "anthropic/claude-sonnet-5" });
ok("제공자 전환 OK", (await api("PUT", "/api/settings/ai_provider", { value: "openai" })).status === 200);
ok("모르는 제공자 400", (await api("PUT", "/api/settings/ai_provider", { value: "acme" })).status === 400);
ok("개인 키 저장 OK", (await api("PUT", "/api/settings/ai_api_key", { value: "sk-test-abcdefgh" })).status === 200);
const masked = (await api("GET", "/api/settings")).json as Array<{ key: string; value: string }>;
ok("키는 값 대신 '설정됨'만 노출", masked.find((r) => r.key === "ai_api_key")?.value === "설정됨");
await api("PUT", "/api/settings/ai_api_key", { value: "" });
await api("PUT", "/api/settings/ai_provider", { value: "anthropic" });

// 완료 = 살아 있는 항목에 진행률 100 (예정일이 미래여도)
const tFut = (await api("POST", "/api/tasks", { title: "미래 예정 완료", date: addDays(D, 9) })).json.id as string;
const cRes = (await api("POST", `/api/tasks/${tFut}/complete`)).json;
ok("완료 응답 — 예정일 함께", cRes.planned_on === addDays(D, 9) && cRes.rate_applied === true, JSON.stringify(cRes));
const tFutDetail = (await api("GET", `/api/tasks/${tFut}`)).json;
ok("미래 예정 항목도 100%", tFutDetail.entries.at(-1).rate === 100, JSON.stringify(tFutDetail.entries));
const doneList = (await api("GET", "/api/works/done")).json as Array<{ id: string; planned_on: string | null }>;
ok("완료 목록에 예정일 포함", doneList.find((r) => r.id === tFut)?.planned_on === addDays(D, 9));

// ── 9.6 일정(event) — task와 분리 ────────────────────────────
console.log("\n[9.6] 일정 — 캘린더 전용 엔티티");
const evId = (await api("POST", "/api/events", { title: "정처기 실기", date: addDays(D, 3), time: "10:00" })).json.id as string;
ok("일정 생성", typeof evId === "string" && evId.includes("-"));
ok("제목 없으면 400", (await api("POST", "/api/events", { date: D })).status === 400);
ok("시각 형식 검증", (await api("POST", "/api/events", { title: "x", date: D, time: "25:00" })).status === 400);
const dayEv = (await api("GET", `/api/days/${addDays(D, 3)}`)).json;
ok("날짜 조회에 일정 포함", dayEv.events.length === 1 && dayEv.events[0].time === "10:00");
ok("task 목록과 섞이지 않음", dayEv.tasks.every((x: any) => x.id !== evId));
const calEv = (await api("GET", `/api/calendar?start=${D}&end=${addDays(D, 7)}`)).json;
ok("캘린더 응답에 일정", calEv.events.some((e: any) => e.id === evId));
ok("일정 수정", (await api("PATCH", `/api/events/${evId}`, { time: "14:00" })).status === 200);
ok("일정 삭제", (await api("DELETE", `/api/events/${evId}`)).status === 200);
// 마감된 날의 일정은 불변
const evClosed = (await api("POST", "/api/events", { title: "지난 약속", date: D })).json.id as string;
await api("POST", "/api/daily/close", { kind: "manual" });
ok("마감된 날 일정 삭제 409", (await api("DELETE", `/api/events/${evClosed}`)).status === 409);

// ── 취소 — 제3의 종결 (0008): 삭제가 막히는 일을 기록 보존한 채 목록에서 내린다 ──
console.log("\n[취소] 열린 예정만 비우고 마감 기록은 보존 · state로 상태 판정");

// (1) 미래(daily 행 없는) 예정 → 취소 시 삭제. state=cancelled(status는 not_finished 유지).
const tCanFut = (await api("POST", "/api/tasks", { title: "취소-미래" })).json.id as string;
await api("POST", `/api/tasks/${tCanFut}/schedule`, { date: addDays(D, 5) });
const canRes = (await api("POST", `/api/tasks/${tCanFut}/cancel`)).json;
ok("취소 응답 kept_dates 빈 배열", Array.isArray(canRes.kept_dates) && canRes.kept_dates.length === 0);
ok("취소 → 미래(daily 없는) 예정 삭제",
  (raw.prepare("SELECT COUNT(*) AS n FROM schedule_entries WHERE task_id=?").get(tCanFut) as any).n === 0);
const canStat = (await api("GET", `/api/tasks/${tCanFut}`)).json;
ok("state='cancelled'인데 status는 'not_finished' (조합 규칙 고정)",
  canStat.state === "cancelled" && canStat.status === "not_finished");
ok("취소 → scheduled·waiting 목록에서 빠짐",
  !(await api("GET", "/api/works/scheduled")).json.some((x: any) => x.id === tCanFut)
  && !(await api("GET", "/api/works/waiting")).json.some((x: any) => x.id === tCanFut));
ok("취소 → done 목록에 kind='cancelled'로 등장",
  (await api("GET", "/api/works/done")).json.some((x: any) => x.id === tCanFut && x.kind === "cancelled"));

// (2) 취소된 task는 complete·defer·extend 각각 409
ok("취소된 task 완료 409", (await api("POST", `/api/tasks/${tCanFut}/complete`)).status === 409);
ok("취소된 task 미루기 409",
  (await api("POST", `/api/tasks/${tCanFut}/defer`, { from: addDays(D, 5), to: addDays(D, 6) })).status === 409);
ok("취소된 task 연장 409", (await api("POST", `/api/tasks/${tCanFut}/extend`)).status === 409);

// (3) 취소 해제 → 예정 복구 없이 대기(is_waiting=1)
const uncRes = (await api("POST", `/api/tasks/${tCanFut}/uncancel`)).json;
ok("취소 해제 → 대기 복귀", uncRes.cancelled === false && uncRes.waiting === true);
ok("취소 해제 후 state=not_finished", (await api("GET", `/api/tasks/${tCanFut}`)).json.state === "not_finished");
ok("이미 취소 아닌데 해제하면 409", (await api("POST", `/api/tasks/${tCanFut}/uncancel`)).status === 409);

// (4) 마감된 날 항목 보존 + classifyAt 여전히 missed
const keepRes = (await api("POST", `/api/tasks/${tCanKeep}/cancel`)).json;
ok("취소해도 마감된 날(D) 예정은 보존",
  keepRes.kept_dates.includes(D)
  && (raw.prepare("SELECT COUNT(*) AS n FROM schedule_entries WHERE task_id=? AND date=?").get(tCanKeep, D) as any).n === 1);
ok("취소된 task도 마감된 날엔 여전히 missed(분류 불변)",
  (await api("GET", `/api/days/${D}`)).json.tasks.find((x: any) => x.id === tCanKeep)?.class === "missed");
ok("취소된 task는 Today Todo에서 제외",
  !(await api("GET", "/api/today")).json.todo.some((x: any) => x.id === tCanKeep));
ok("취소된 task는 예정 목록에서 제외",
  !(await api("GET", "/api/works/scheduled")).json.some((x: any) => x.id === tCanKeep));
ok("취소된 task는 재배정 대기에서 제외",
  !(await db.reassignQueue(env, N1)).results.some((x) => x.id === tCanKeep));
await api("POST", `/api/tasks/${tCanKeep}/uncancel`);
ok("취소 해제하면 재배정 대기에 다시 등장",
  (await db.reassignQueue(env, N1)).results.some((x) => x.id === tCanKeep));

// (5) 취소는 기간 달성률 평균을 오염시키지 않는다 (v_period_achievement: state <> 'cancelled')
const pCan = (await api("POST", "/api/periods",
  { title: "취소달성률", start_date: D, end_date: addDays(D, 30), color: "#123456" })).json.id as string;
const tPerLive = (await api("POST", "/api/tasks", { title: "살아있는70", period_id: pCan })).json.id as string;
await api("POST", `/api/tasks/${tPerLive}/schedule`, { date: addDays(D, 3) });
await api("PUT", `/api/tasks/${tPerLive}/rate`, { date: addDays(D, 3), rate: 70 });
const achBefore = (raw.prepare("SELECT achievement FROM v_period_achievement WHERE id=?").get(pCan) as any).achievement;
const tPerCan = (await api("POST", "/api/tasks", { title: "취소될0", period_id: pCan })).json.id as string;
await api("POST", `/api/tasks/${tPerCan}/schedule`, { date: addDays(D, 4) });
await api("POST", `/api/tasks/${tPerCan}/cancel`);
const achAfter = (raw.prepare("SELECT achievement FROM v_period_achievement WHERE id=?").get(pCan) as any).achievement;
ok("취소 전 기간 달성률 70", achBefore === 70);
ok("취소 task는 달성률 평균에서 제외 — 70 유지(오염 방지)", achAfter === 70);

// (6) 완료된 task는 취소 불가
const tCanFin = (await api("POST", "/api/tasks", { title: "완료라취소불가" })).json.id as string;
await api("POST", `/api/tasks/${tCanFin}/complete`);
ok("완료된 task 취소 409", (await api("POST", `/api/tasks/${tCanFin}/cancel`)).status === 409);

// (7) 취소 사유 (0009) — append-only. 취소 시 한 번 쓰고, 해제해도 지우지 않는다.
const mkCan = async (title: string) => (await api("POST", "/api/tasks", { title })).json.id as string;
const tRz = await mkCan("사유와 함께 취소");
ok("사유와 함께 취소 200", (await api("POST", `/api/tasks/${tRz}/cancel`, { reason: "방향이 바뀌어서" })).status === 200);
const rzStat = (await api("GET", `/api/tasks/${tRz}`)).json;
ok("사유가 tasks에 남음 · cancelled_by='user'",
  rzStat.cancel_reason === "방향이 바뀌어서" && rzStat.cancelled_by === "user", JSON.stringify(rzStat.cancel_reason));
const tRzNone = await mkCan("사유 없이 취소");
await api("POST", `/api/tasks/${tRzNone}/cancel`);
ok("사유 없이 취소 → cancel_reason null", (await api("GET", `/api/tasks/${tRzNone}`)).json.cancel_reason === null);
const tRzBlank = await mkCan("공백만 사유");
await api("POST", `/api/tasks/${tRzBlank}/cancel`, { reason: "   " });
ok("공백만 사유 → NULL로 정규화", (await api("GET", `/api/tasks/${tRzBlank}`)).json.cancel_reason === null);
const tRzLong = await mkCan("긴 사유");
ok("사유 501자 400", (await api("POST", `/api/tasks/${tRzLong}/cancel`, { reason: "가".repeat(501) })).status === 400);
// ★ append-only 핵심 — 해제해도 사유는 남는다(다음 취소가 덮어쓴다).
await api("POST", `/api/tasks/${tRz}/uncancel`);
const rzAfter = (await api("GET", `/api/tasks/${tRz}`)).json;
ok("취소 해제 후에도 사유 보존 · state=not_finished",
  rzAfter.cancel_reason === "방향이 바뀌어서" && rzAfter.state === "not_finished", JSON.stringify(rzAfter.cancel_reason));

// ── 9.5 Guard (0010) — 발동은 기기가, 서버는 재료와 기록 ─────
console.log("\n[9.5] Guard — 보호 규칙 · 발동 기록 · 불변성");

// (1) 보호 규칙 부착 — 일정 본문 수정과 분리된 경로
// ★ 날짜는 **상대**다 (T-36). 고정 날짜를 쓰면 달력이 언젠가 그것을 따라잡는다 —
//   `2026-08-15` + `-1d 00:00`이 8/14에 보호 구간을 열어 **한 번에 11건**이 빨간불이 됐다.
//   ★ **피해야 할 시계가 둘이다.** 이 일정의 보호 구간(`-1d 00:00` ~ 당일 09:00)은
//     ① 실시각(오늘)과 ② T-23 검사가 **주입하는 시계**(`gNow.start + 1분` = `D+2 09:01`)를
//     **둘 다** 벗어나야 한다. `D+3`이면 구간이 `D+2 00:00`에 시작해 ②를 삼킨다 —
//     실제로 그렇게 고쳤다가 11건은 돌아오고 **다른 하나가 죽었다.**
//     `D+4` ⇒ 구간 `D+3 00:00 ~ D+4 09:00` — 둘 다 밖이다.
//   구간 **안**을 보는 검사는 따로 있고(`gNow`), 그쪽은 이미 상대였다.
const gEvDate = addDays(D, 4);
const gEv = (await api("POST", "/api/events", { title: "정보처리기사 실기", date: gEvDate, time: "09:00" })).json.id as string;
ok("보호 없는 일정은 schedule에 안 잡힘",
  ((await api("GET", "/api/guard/schedule")).json.events as any[]).every((e) => e.event_id !== gEv));
ok("보호 규칙 부착 200",
  (await api("PUT", `/api/events/${gEv}/protect`, { protect_from: "-1d 00:00", protect_level: 4 })).status === 200);
ok("잘못된 protect_from 400",
  (await api("PUT", `/api/events/${gEv}/protect`, { protect_from: "어제밤" })).status === 400);
ok("protect_level 5는 400",
  (await api("PUT", `/api/events/${gEv}/protect`, { protect_level: 5 })).status === 400);

// (2) 데드라인 역산 — 09:00 − 준비 90 − 수면 360 = 01:30 (설계 §6.1 예시와 일치)
const sched = (await api("GET", "/api/guard/schedule")).json;
const plan = (sched.events as any[]).find((e) => e.event_id === gEv);
ok("보호 일정이 schedule에 잡힘", !!plan);
ok("서버 귀속일 d를 함께 준다 (ADR-011)", typeof sched.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sched.d));
// 오프셋에 묶이지 않게 '간격'으로 본다 — 09:00 − 90분 − 360분 = 01:30 (설계 §6.1 예시)
ok("데드라인 = 일정시각 − 준비(90) − 수면(360)",
  !!plan && (new Date(plan.start).getTime() - new Date(plan.deadline).getTime()) === 450 * 60_000,
  `${plan?.start} → ${plan?.deadline}`);
ok("발동 예정이 Level별로 생성됨",
  !!plan && plan.fires.length > 0 && plan.fires.every((f: any) => f.level >= 1 && f.level <= 4));

// (3) 모드 — 파라미터 프로파일 (ADR-019)
const modes = (await api("GET", "/api/guard/modes")).json;
ok("모드 2종 · coach 활성", modes.modes.length === 2 && modes.active.key === "coach");
ok("모드 판정 응답 — 각 모드에 downgrade boolean",
  modes.modes.every((m: any) => typeof m.downgrade === "boolean"), JSON.stringify(modes.modes));
ok("모드 판정 응답 — 활성 모드 자신은 downgrade=false",
  modes.modes.find((m: any) => m.key === modes.active.key)?.downgrade === false, JSON.stringify(modes));
ok("모드 판정 응답 — 보호 구간 밖이면 protecting=null",
  modes.protecting === null, JSON.stringify(modes.protecting));
// coach → secretary는 **하향**이라 이제 사유가 필요하다 (ADR-027). 여기선 마찰이 아니라
// 'Level 2 상한'을 보는 자리이므로 사유를 실어 통과시킨다 — 마찰 자체는 (3b)가 본다.
await api("PUT", "/api/guard/modes/active", { key: "secretary", reason: "상한 검사" });
const sec = (await api("GET", "/api/guard/schedule")).json;
const secPlan = (sec.events as any[]).find((e) => e.event_id === gEv);
ok("secretary 모드는 Level 2로 상한 — L3·L4 발동 없음",
  !!secPlan && secPlan.max_level === 2 && secPlan.fires.every((f: any) => f.level <= 2));
ok("없는 모드 404", (await api("PUT", "/api/guard/modes/active", { key: "없음" })).status === 404);
await api("PUT", "/api/guard/modes/active", { key: "coach" });

// (3b) 모드 하향에는 마찰이 붙는다 — ADR-019 부수 규칙 1·2, 판정은 ADR-027 ①
//
// 모드 전환은 Override의 완벽한 우회로다. 새벽에 coach → secretary로 내리면 마찰이 전부 사라진다.
// 판정은 **강도 파라미터 다섯**이고, `ai_daily_cap`(지출)·`sort`(표시)는 들어가지 않는다.
//
// 검사용 행을 따로 만든다 — `coach`·`secretary`는 실사용 행이라 고치지 않는다.
// 둘 다 coach(4 · 40 · 1.0 · 1 · 1 · cap 5)에서 **한 컬럼만** 다르다.
raw.prepare(`INSERT INTO guard_modes (key, label, max_level, risk_threshold, friction_mult, use_fsi, use_overlay, ai_daily_cap, sort, active)
             VALUES ('smoke_risk', '문턱만 높은 모드', 4, 90, 1.0, 1, 1, 5, 9, 0)`).run();
raw.prepare(`INSERT INTO guard_modes (key, label, max_level, risk_threshold, friction_mult, use_fsi, use_overlay, ai_daily_cap, sort, active)
             VALUES ('smoke_cap', '예산만 낮은 모드', 4, 40, 1.0, 1, 1, 0, 9, 0)`).run();
const activeKey = async () => (await api("GET", "/api/guard/modes")).json.active.key;

const guardModeColumns = raw.prepare("PRAGMA table_info(guard_modes)").all() as Array<{ name: string }>;
ok("모드 판정 응답 — guard_modes에 파생 컬럼 없음",
  guardModeColumns.map((c) => c.name).join(",") ===
    "key,label,max_level,risk_threshold,friction_mult,use_fsi,use_overlay,ai_daily_cap,sort,active",
  JSON.stringify(guardModeColumns.map((c) => c.name)));

const modeVerdicts = (await api("GET", "/api/guard/modes")).json;
ok("모드 판정 응답 — risk_threshold만 높은 모드도 downgrade=true",
  modeVerdicts.modes.find((m: any) => m.key === "smoke_risk")?.downgrade === true,
  JSON.stringify(modeVerdicts.modes));

// ★ 5번 — **`risk_threshold`만 높은 모드도 하향이다.** 문턱이라 방향이 반대다.
//   다섯을 전부 "낮아지면 약함"으로 짜면 이 줄만 빨간불이 된다(다른 줄은 그대로 통과한다).
ok("risk_threshold만 높은 모드로 바꾸면 하향 — 사유 없으면 400",
  (await api("PUT", "/api/guard/modes/active", { key: "smoke_risk" })).status === 400);
ok("400이면 모드는 그대로 coach", (await activeKey()) === "coach");
ok("사유를 실으면 같은 전환이 통과", (await api("PUT", "/api/guard/modes/active",
  { key: "smoke_risk", reason: "문턱을 올려 본다" })).status === 200);
ok("문턱을 되내리는 것은 상향 — 사유 없이 통과",
  (await api("PUT", "/api/guard/modes/active", { key: "coach" })).status === 200);

// 6번 — `ai_daily_cap`은 지출 통제다(ADR-024). 강도로 세면 예산 절감이 마찰을 부른다.
ok("ai_daily_cap만 낮은 모드는 하향이 아니다 — 사유 없이 200",
  (await api("PUT", "/api/guard/modes/active", { key: "smoke_cap" })).status === 200);
await api("PUT", "/api/guard/modes/active", { key: "coach" });

// ★ T-19 6번 — 응답의 downgrade는 힌트일 뿐이다. 요청 본문으로 거짓 판정을 보내도 PUT이 다시 판정한다.
const forgedVerdict = await api("PUT", "/api/guard/modes/active", { key: "secretary", downgrade: false });
ok("모드 판정 응답 — 요청의 downgrade=false를 믿지 않고 하향 차단",
  forgedVerdict.status === 400, JSON.stringify(forgedVerdict.json));
// 변이에서 거짓 판정을 믿어 모드가 바뀌어도 뒤 검사가 연쇄 실패하지 않게 전제를 독립 복원한다.
raw.prepare("UPDATE guard_modes SET active = 0").run();
raw.prepare("UPDATE guard_modes SET active = 1 WHERE key = 'coach'").run();

// 2·3번 — 보호 구간 밖의 하향: 사유가 없으면 400, 있으면 통과하고 `me_history`에 남는다.
ok("보호 구간 밖 하향 · 사유 없음 400",
  (await api("PUT", "/api/guard/modes/active", { key: "secretary" })).status === 400);
ok("공백만 사유도 400",
  (await api("PUT", "/api/guard/modes/active", { key: "secretary", reason: "   " })).status === 400);
const downRes = await api("PUT", "/api/guard/modes/active", { key: "secretary", reason: "시험 끝나서 며칠 쉰다" });
ok("보호 구간 밖 하향 · 사유 있으면 200 · downgrade=true",
  downRes.status === 200 && downRes.json.downgrade === true, JSON.stringify(downRes.json));
const mh = raw.prepare("SELECT old_value, new_value, reason FROM me_history WHERE field='guard_mode' ORDER BY id DESC LIMIT 1").get() as any;
ok("me_history에 사유가 남는다 (0015 · field='guard_mode')",
  mh?.old_value === "coach" && mh?.new_value === "secretary" && mh?.reason === "시험 끝나서 며칠 쉰다",
  JSON.stringify(mh));

// 1·4번 — 보호 구간 중. 지금이 [protect_from, start] 안에 들어가는 일정을 하나 건다.
//   `d+2` 일정에 '-2d 00:00' → 구간은 [귀속일 00:00, d+2 09:00]이라 하루 중 언제 돌려도 안에 있다.
const dPlus = (n: number) => {
  const x = new Date(`${sched.d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const gNow = (await api("POST", "/api/events", { title: "지금 보호 중인 시험", date: dPlus(2), time: "09:00" })).json.id as string;
await api("PUT", `/api/events/${gNow}/protect`, { protect_from: "-2d 00:00", protect_level: 4 });
const nowPlan = ((await api("GET", "/api/guard/schedule")).json.events as any[]).find((e) => e.event_id === gNow);
ok("보호 구간이 지금을 포함한다 (검사의 전제)",
  !!nowPlan && Date.parse(nowPlan.protect_from) <= Date.now() && Date.now() <= Date.parse(nowPlan.start),
  JSON.stringify(nowPlan && { from: nowPlan.protect_from, start: nowPlan.start }));
const protectedVerdict = (await api("GET", "/api/guard/modes")).json.protecting;
ok("모드 판정 응답 — 보호 구간이면 일정 이름과 until",
  protectedVerdict?.title === "지금 보호 중인 시험" &&
    Date.parse(protectedVerdict.start) === Date.parse(nowPlan?.protect_from) &&
    Date.parse(protectedVerdict.until) === Date.parse(nowPlan?.start),
  JSON.stringify(protectedVerdict));
ok("모드 판정 응답 — 사람용 시각만 로컬 오프셋 · schedule UTC 유지",
  nowPlan?.protect_from.endsWith("Z") && nowPlan?.start.endsWith("Z") &&
    protectedVerdict?.start.endsWith("+09:00") && protectedVerdict?.until.endsWith("+09:00"),
  JSON.stringify({ schedule: nowPlan, protecting: protectedVerdict }));
// ★ T-23 — 판정의 근거는 **라우트가 넘긴 `t`**여야 한다. 서비스가 자기 시계를 다시 읽으면
//   05:00 경계를 넘는 순간 미들웨어와 귀속일이 갈라지는데 **응답 모양은 똑같다** — 위 검사들은
//   전부 그대로 초록이다. 그래서 t를 갈아 끼워 판정이 따라 움직이는지 본다:
//   일정 시각 1분 뒤를 가리키는 t면 보호 구간 밖이므로 protecting은 null이어야 한다.
//   서비스가 loadTime을 다시 부르면 주입한 t를 무시하고 '보호 중'을 그대로 돌려준다 → 빨간불.
const tAfterStart = { ...t0, now: isoNow(Date.parse(nowPlan.start) + 60_000, t0.offsetMin) };
const injected = await guard.modes(env, tAfterStart);
const passedThrough = await guard.modes(env, t0);
ok("모드 판정 — 넘겨받은 t를 따른다 (서비스가 시계를 다시 읽지 않는다)",
  injected.protecting === null && passedThrough.protecting?.title === "지금 보호 중인 시험",
  JSON.stringify({ t_주입: tAfterStart.now, 주입: injected.protecting, 실시각: passedThrough.protecting }));
// 4번 — **상향은 보호 구간 중에도 자유롭다**(부수 규칙 1). 사유도 대기도 없다.
ok("보호 구간 중 상향은 사유 없이 200 (secretary → coach)",
  (await api("PUT", "/api/guard/modes/active", { key: "coach" })).status === 200);
// 1번 — 그 구간이 바로 사전 서약이 지켜야 할 구간이다. 사유가 있어도 막는다.
const blocked = await api("PUT", "/api/guard/modes/active", { key: "secretary", reason: "그래도 내리고 싶다" });
ok("보호 구간 중 하향은 사유가 있어도 409", blocked.status === 409, JSON.stringify(blocked.json));
ok("409면 모드는 그대로 coach", (await activeKey()) === "coach");
// 상향 기록에는 사유가 없다 — 방향과 무관하게 궤적은 남긴다(§3).
const mhUp = raw.prepare("SELECT new_value, reason FROM me_history WHERE field='guard_mode' ORDER BY id DESC LIMIT 1").get() as any;
ok("상향도 me_history에 남되 reason은 NULL",
  mhUp?.new_value === "coach" && mhUp?.reason === null, JSON.stringify(mhUp));

ok("이 블록이 끝난 시점의 활성 모드는 coach (API 경로가 남긴 상태)", (await activeKey()) === "coach");
// 정리는 **검사 결과와 무관하게** 되돌린다. 여기서 하향 판정이 깨지면 활성 모드가 엉뚱한 곳에
// 멈추는데, 그대로 두면 뒤의 `ai_daily_cap` 검사들이 함께 빨간불이 되어 원인이 흐려진다.
await api("PUT", `/api/events/${gNow}/protect`, { protect: false });
raw.prepare("UPDATE guard_modes SET active = 0").run();
raw.prepare("UPDATE guard_modes SET active = 1 WHERE key = 'coach'").run();
raw.prepare("DELETE FROM guard_modes WHERE key IN ('smoke_risk','smoke_cap')").run();
ok("정리 후 모드 2종 · coach 활성", (await api("GET", "/api/guard/modes")).json.modes.length === 2
  && (await activeKey()) === "coach");

// (4) 발동 기록 — 기기가 밀어 올린다
const gRec = await api("POST", "/api/guard/events", {
  cause: "protect:sleep-deadline", level: 3, event_id: gEv,
  // 그 일정의 취침 데드라인(09:00 − 90 − 360 = 01:30)에 발동한 것이다 — 날짜는 일정을 따라간다.
  fired_at: `${gEvDate}T01:30:00+09:00`, foreground_app: "com.android.chrome",
  risk_score: 62, risk_snapshot: { hour: 1.5, sleepEst: 3.2, logsLastHour: 4 },
});
ok("발동 기록 201", gRec.status === 201);
const gId = gRec.json.id as string;
// 01:30은 경계(06:00) 아래라 **전날**에 귀속된다 — 값이 아니라 그 성질을 본다.
ok("귀속일이 기기 시각 기준 (01:30 → 전날)", gRec.json.on_date === addDays(gEvDate, -1), gRec.json.on_date);
ok("level 5는 400", (await api("POST", "/api/guard/events", { cause: "x", level: 5 })).status === 400);
ok("cause 없으면 400", (await api("POST", "/api/guard/events", { level: 3 })).status === 400);

// (5) 반응 — 한 번만. Override엔 사유 20자 (§6.3 마찰)
// 길이 하한은 없다 — 마찰은 대기가 지고, 사유는 비어 있지만 않으면 된다(§6.3 재조정)
ok("빈 사유 Override 400",
  (await api("POST", `/api/guard/events/${gId}/react`, { reaction: "override", reason: "   " })).status === 400);
ok("사유 없이 Override 400",
  (await api("POST", `/api/guard/events/${gId}/react`, { reaction: "override" })).status === 400);
const gReason = "좀만더";   // 3자 — 짧아도 통과해야 한다
ok("짧은 사유도 Override 200",
  (await api("POST", `/api/guard/events/${gId}/react`, { reaction: "override", reason: gReason })).status === 200,
  `사유 ${gReason.length}자`);
ok("두 번째 반응은 409 (개입 이력 불변)",
  (await api("POST", `/api/guard/events/${gId}/react`, { reaction: "accepted" })).status === 409);

// (6) outcome — Guard가 판단하지 않는다 (§6.5)
ok("outcome 확정 200",
  (await api("POST", `/api/guard/events/${gId}/outcome`, { outcome: "failure" })).status === 200);
ok("outcome 재확정 409",
  (await api("POST", `/api/guard/events/${gId}/outcome`, { outcome: "success" })).status === 409);
ok("잘못된 outcome 400",
  (await api("POST", `/api/guard/events/${gId}/outcome`, { outcome: "몰라" })).status === 400);

// (7) risk_snapshot 보존 — 자기 보정의 원재료. 소급 생성이 불가능하므로 반드시 남아야 한다.
const gList = (await api("GET", "/api/guard/events")).json as any[];
const gRow = gList.find((r) => r.id === gId);
ok("risk_snapshot이 JSON으로 보존됨",
  !!gRow && JSON.parse(gRow.risk_snapshot).sleepEst === 3.2, gRow?.risk_snapshot);
ok("foreground_app · mode · source 기록됨",
  !!gRow && gRow.foreground_app === "com.android.chrome" && gRow.mode === "coach" && gRow.source === "android");

// (7.5) client_id 멱등 (0011) — 밀어 올리기 재시도가 두 행을 만들면 안 된다
// 내일 02:00 — **유예(36시간) 안쪽**이라는 것이 이 fixture의 성질이다(아래 (7.6)이 그것을 본다).
const cidBody = { cause: "protect:test", level: 3, client_id: "dev-uuid-1", fired_at: `${N1}T02:00:00+09:00` };
const c1 = await api("POST", "/api/guard/events", cidBody);
const c2 = await api("POST", "/api/guard/events", cidBody);          // 응답 유실 후 재시도 흉내
ok("같은 client_id 재전송 → 같은 행 · duplicate 표시",
  c1.json.id === c2.json.id && c2.json.duplicate === true, `${c1.json.id} / ${c2.json.id}`);
// 오프라인에서 발동과 반응이 둘 다 일어난 뒤 한 번에 올라오는 경우
const c3 = await api("POST", "/api/guard/events", {
  ...cidBody, client_id: "dev-uuid-2", reaction: "override", reason: "내일 시험인데 이것만 마무리하고 자겠습니다",
});
ok("발동+반응 동시 전송 201", c3.status === 201);
const c3row = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.client_id === "dev-uuid-2");
ok("반응이 같이 기록됨", !!c3row && c3row.reaction === "override", c3row?.reaction);
// 발동만 먼저 올라간 뒤, 반응이 나중에 같은 client_id로 도착
const c4 = await api("POST", "/api/guard/events", { ...cidBody, client_id: "dev-uuid-3" });
await api("POST", "/api/guard/events", { client_id: "dev-uuid-3", reaction: "ignored" });
const c4row = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.id === c4.json.id);
ok("나중에 온 반응이 기존 행에 채워짐 (ignored)", !!c4row && c4row.reaction === "ignored", c4row?.reaction);

// (7.5b) 기기가 보낸 UTC 시각의 정규화 — 실기기 덤프에서 드러난 결함
// KST 14:00 = UTC 05:00. 정규화가 없으면 '05시'가 경계(06:00) 아래로 읽혀 전날로 귀속된다.
const utcFire = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "dev-uuid-utc",
  fired_at: `${N1}T05:00:00Z`, reaction: "accepted", reacted_at: `${N1}T05:00:30Z`,
});
ok("UTC 발동이 올바른 날에 귀속 (KST 14:00 → 당일)", utcFire.json.on_date === N1, utcFire.json.on_date);
const utcRow = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.client_id === "dev-uuid-utc");
ok("fired_at·reacted_at이 로컬 오프셋 표기로 저장",
  !!utcRow && utcRow.fired_at === `${N1}T14:00:00+09:00` && utcRow.reacted_at === `${N1}T14:00:30+09:00`,
  `${utcRow?.fired_at} / ${utcRow?.reacted_at}`);

// (7.6) 반응 없는 발동의 'ignored' 확정 (ADR-025 — 루프의 닫는 쪽)
// 유예 36시간: 기기가 오프라인이면 발동과 반응을 함께 늦게 올린다. 먼저 박으면 진짜 반응이 막힌다.
const oldFire = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "dev-uuid-old",
  fired_at: `${D_3}T02:00:00+09:00`,   // 사흘 전 — **유예 36시간을 확실히 넘긴 쪽**
});
const acG = await api("POST", "/api/admin/auto-close");
const oldRow = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.id === oldFire.json.id);
ok("유예를 넘긴 무반응 발동 → ignored", !!oldRow && oldRow.reaction === "ignored", oldRow?.reaction);
ok("auto-close가 확정 수를 보고", acG.json.guard_ignored >= 1, acG.json.guard_ignored);
// 유예 안쪽(미래 fired_at)은 건드리지 않는다 — 늦게 도착할 반응의 자리를 비워 둔다
const freshRow = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.client_id === "dev-uuid-1");
ok("유예 안쪽 발동은 NULL 유지", !!freshRow && freshRow.reaction === null, freshRow?.reaction);
// 멱등 — 이미 ignored인 행을 두 번 건드려 409가 나면 안 된다
ok("재실행 시 같은 행을 다시 확정하지 않음",
  (await api("POST", "/api/admin/auto-close")).json.guard_ignored === 0);

// (7.7) 마감 요약이 읽는 개입 집계 (T-45) — `today`에 얹는다. 새 호출을 만들지 않는다.
// **상대로 잰다**(before → after). 앞 블록들이 오늘 귀속으로 만든 행 수를 세어 두면
// 그 수가 바뀔 때마다 이 검사가 거짓 실패한다 — 고정 날짜와 같은 종류의 함정이다.
const g45 = async () => (await api("GET", "/api/today")).json.guard;
const g45Before = await g45();
// ③ 귀속일 경계 — **오늘 새벽 02:00은 어제 것이다.** 집계는 `on_date`를 그대로 쓰므로 안 들어온다.
const g45Dawn = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "t45-dawn", fired_at: `${D}T02:00:00+09:00`,
});
const g45AfterDawn = await g45();
ok("③ 오늘 새벽 발동은 어제로 귀속 — 오늘 집계에 안 들어간다",
  g45Dawn.json.on_date === D_1 && g45AfterDawn.fired === g45Before.fired,
  `on_date ${g45Dawn.json.on_date} · ${g45Before.fired}→${g45AfterDawn.fired}`);
// ① 지금 발동한 것은 오늘 것이다 — 수가 하나 늘고 `last_at`이 MAX를 따른다.
const g45Now = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "t45-now", fired_at: t0.now,
});
const g45AfterNow = await g45();
const g45ExpectLast = g45Before.last_at && g45Before.last_at > t0.now ? g45Before.last_at : t0.now;
ok("① 발동이 있으면 집계가 실제 수를 준다 · last_at은 마지막 발동",
  g45Now.json.on_date === D && g45AfterNow.fired === g45Before.fired + 1
  && g45AfterNow.last_at === g45ExpectLast,
  `${g45Before.fired}→${g45AfterNow.fired} · last ${g45AfterNow.last_at}`);
// ④ ignored도 센다 — 다만 **문장으로는 말하지 않는다**(유예 36시간이라 마감 시점엔 늘 0이고,
//    말하는 순간 주어가 사용자가 된다). 집계 자체는 맞아야 관측이 가능하다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "t45-ign", fired_at: t0.now, reaction: "ignored",
});
const g45AfterIgn = await g45();
ok("④ ignored도 집계된다 (응답에만 — 문장에는 안 쓴다)",
  g45AfterIgn.ignored === g45AfterNow.ignored + 1 && g45AfterIgn.fired === g45AfterNow.fired + 1,
  `ignored ${g45AfterNow.ignored}→${g45AfterIgn.ignored}`);
// ⑤ 화면에 낼 수 없는 값은 **응답에 아예 안 싣는다** — level·ai_verdict는 사용자에게 뜻이 없다.
ok("⑤ 집계는 fired·last_at·ignored 셋뿐 — level·ai_verdict를 안 보낸다",
  JSON.stringify(Object.keys(g45AfterIgn).sort()) === JSON.stringify(["fired", "ignored", "last_at"]),
  JSON.stringify(Object.keys(g45AfterIgn)));

// (7.8) 뒤에 또 깨어 있었으면 묻지 않아도 안다 (T-56 · ADR-044)
//
// ⚠️ **고정 날짜를 안 쓴다**(함정 12) — 오늘에서 상대로 잡는다. 그리고 이 블록만 쓰는 밤을
//    고른다: 앞의 발동들은 전부 D+3 이하이고 여기는 D+5부터라 **절대 시각으로도 뒤에 있다.**
// ⚠️ **경계 아래 시각을 안 쓴다.** 22시·23시는 어느 경계에서도 같은 귀속일이라
//    `on_date`를 가정할 필요가 없다 — 그래도 fixture가 그것을 **직접 확인한다**.
console.log("\n[9.4c] 뒤따른 발동으로 결과를 추론한다 (T-56 · ADR-044)");

const t56Fire = async (day: string, hm: string, level: number, cid: string) =>
  (await api("POST", "/api/guard/events", {
    cause: "watch:bedtime", level, client_id: cid,
    fired_at: `${day}T${hm}:00+09:00`, reaction: "accepted", reacted_at: `${day}T${hm}:30+09:00`,
  })).json;
const t56Pending = async () => (await api("GET", "/api/guard/pending-outcome")).json as any[];
const t56Row = async (id: string) => (await t56Pending()).find((r) => r.id === id);
const t56Stored = async (id: string) =>
  ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.id === id);

// ── 밤 1 — 뒤따른 발동이 L3
const t56N1 = addDays(D, 5);
const t56A1 = await t56Fire(t56N1, "22:10", 3, "t56-a1");
const t56B1 = await t56Fire(t56N1, "23:40", 3, "t56-b1");
ok("fixture — 둘이 같은 귀속일이다 (값을 가정하지 않고 응답이 준 것을 본다)",
  t56A1.on_date === t56B1.on_date, `${t56A1.on_date} / ${t56B1.on_date}`);
const t56P1 = await t56Row(t56A1.id);
ok("1 뒤에 발동이 있으면 추론이 붙는다",
  !!t56P1 && t56P1.later_fires >= 1 && t56P1.outcome_inferred === "failure",
  JSON.stringify(t56P1 && { later: t56P1.later_fires, inf: t56P1.outcome_inferred }));

// ★ 1의 짝 — 마지막 발동은 뒤가 없다. **이 시점에 b1 뒤로는 아무것도 없다**(밤 2~4는 아직
//   안 만들었다). 그래서 이 검사는 '귀속일 조건'이 아니라 **'뒤따름' 자체**만 센다.
const t56P1b = await t56Row(t56B1.id);
ok("2 ★ 뒤에 발동이 없으면 안 붙는다 (1의 짝)",
  !!t56P1b && t56P1b.later_fires === 0 && t56P1b.outcome_inferred === null,
  JSON.stringify(t56P1b && { later: t56P1b.later_fires, inf: t56P1b.outcome_inferred }));

// ── 밤 2 — 뒤따른 발동이 **L2**. 화면이 켜져야 뜨는 것은 L2도 같다(ADR-044 ③).
const t56N2 = addDays(D, 7);
const t56A2 = await t56Fire(t56N2, "22:10", 3, "t56-a2");
await t56Fire(t56N2, "23:40", 2, "t56-b2");
const t56P2 = await t56Row(t56A2.id);
// ⚠️ **1과 비교만 한다.** `=== "failure"`나 `later_fires >= 1`을 함께 쓰면
//    *"추론을 통째로 뺀 변이"*에서 1과 함께 죽어, **레벨 필터를 겨냥한 이 검사가 자기 몫을
//    못 센다.** L2 뒤와 L3 뒤가 **같은지**가 이 검사의 전부다.
ok("7 L2가 뒤따라도 추론이 붙는다 (레벨로 안 가른다 · 1과 같은 값이어야 한다)",
  !!t56P2 && t56P2.outcome_inferred === t56P1?.outcome_inferred,
  `L2뒤=${t56P2?.outcome_inferred} L3뒤=${t56P1?.outcome_inferred}`);

// ── 밤 3 — 뒤에 발동이 있지만 **다른 귀속일**이다
const t56N3 = addDays(D, 9);
const t56A3 = await t56Fire(t56N3, "22:10", 3, "t56-a3");
const t56C3 = await t56Fire(addDays(t56N3, 1), "22:10", 3, "t56-c3");
ok("fixture — 다음 날 밤은 다른 귀속일이다",
  t56A3.on_date !== t56C3.on_date, `${t56A3.on_date} / ${t56C3.on_date}`);
const t56P3 = await t56Row(t56A3.id);
// ⚠️ **세는 자리를 직접 본다.** `outcome_inferred === null`을 함께 쓰면 *"항상 추론을 붙이는
//    변이"*가 2와 함께 이것도 죽여, **귀속일을 겨냥한 이 검사가 자기 몫을 못 센다.**
//    걸러졌는지는 `later_fires`가 0인 것으로 충분하고, 그게 이 검사가 세는 전부다.
ok("6 다른 귀속일의 발동은 세지 않는다",
  !!t56P3 && t56P3.later_fires === 0,
  JSON.stringify(t56P3 && { later: t56P3.later_fires, inf: t56P3.outcome_inferred }));

// ── 밤 4 — ★ 이 티켓의 회귀 검사 셋. 순서에 뜻이 있다: 4 → 5 → 3.
const t56N4 = addDays(D, 11);
const t56A4 = await t56Fire(t56N4, "22:10", 3, "t56-a4");
await t56Fire(t56N4, "23:40", 3, "t56-b4");
const t56P4 = await t56Row(t56A4.id);
const t56S4 = await t56Stored(t56A4.id);
// 4 — **없는 것을 세는 검사.** 추론이 붙은 채로도 저장된 칸은 비어 있어야 한다.
//     `outcome_at`까지 본다: 값만 안 쓰고 시각을 쓰는 구현도 append-only를 건드린 것이다.
//     ⚠️ *"pending 전체가 NULL"*로 넓히지 않는다 — `outcome IS NULL` 필터를 지우는 변이가
//        답이 있는 옛 행을 끌고 들어와 **3을 겨냥한 그 변이가 여기까지 죽인다.**
//        자동 기입이 내려앉을 자리는 **추론이 붙은 바로 그 행**이고, 그 한 행이면 충분하다.
ok("4 ★ 추론이 붙어도 outcome은 여전히 NULL이다 (없는 것을 세는 검사)",
  !!t56P4 && t56P4.outcome_inferred === "failure" && t56P4.outcome === null
  && !!t56S4 && t56S4.outcome === null && t56S4.outcome_at === null,
  `pending=${t56P4?.outcome} stored=${t56S4?.outcome}/${t56S4?.outcome_at}`);

// 5 — ★ **4의 실물.** 트리거가 막는지는 API를 거쳐야만 알 수 있다.
//     추론과 **반대되는** 답을 넣는다 — 자동 판정이 선점했다면 여기서 409가 난다.
const t56Write = await api("POST", `/api/guard/events/${t56A4.id}/outcome`, { outcome: "success" });
ok("5 ★ 추론이 붙은 뒤에도 사용자가 답을 쓸 수 있다 (트리거가 안 막는다)",
  t56Write.status === 200 && t56Write.json.outcome === "success",
  `${t56Write.status} ${JSON.stringify(t56Write.json)}`);

// 3 — 사용자의 답이 이긴다. 그 줄은 물음에서 사라지고, 저장된 값은 추론이 아니라 사람의 것이다.
const t56S4After = await t56Stored(t56A4.id);
ok("3 ★ 사용자 답이 있으면 추론이 그것을 덮지 않는다",
  !!t56S4After && t56S4After.outcome === "success" && !(await t56Row(t56A4.id)),
  `stored=${t56S4After?.outcome} 물음에 남았나=${!!(await t56Row(t56A4.id))}`);

// (8) 감시 목록 — PC 확장 자리 (ADR-022)
ok("watch app 추가 201",
  (await api("POST", "/api/guard/watch-apps", { source: "pc", identifier: "Code.exe", label: "VS Code" })).status === 201);
ok("source로 필터",
  ((await api("GET", "/api/guard/watch-apps?source=pc")).json as any[]).length === 1);

// (9) 보호 해제
await api("PUT", `/api/events/${gEv}/protect`, { protect: false });
ok("보호 해제 후 schedule에서 빠짐",
  ((await api("GET", "/api/guard/schedule")).json.events as any[]).every((e) => e.event_id !== gEv));

// (10) Level 4 AI 검증 (ADR-024) — **실제 모델 호출은 검사하지 않는다.**
// 돈이 나가고 네트워크에 걸린다. 호출 여부는 상한·캐시·킬 스위치로 판별한다.
// 순서에 뜻이 있다: 상한을 채운 뒤 캐시를 넣어 **캐시가 상한을 이기는지**, 마지막에 킬 스위치가
// 둘 다를 이기는지 본다. 통제가 겹으로 쌓여 있다는 것 자체가 검사 대상이다.
console.log("\n[9.5b] Level 4 AI 검증 — 지출 통제 6겹 (ADR-024)");

const verify = (b: any) => api("POST", "/api/guard/verify", b);
const VBASE = { client_id: "verify-uuid-1", cause: "protect:deadline", level_candidate: 4 };

// 격상 전용 — 다른 Level을 물어 오는 것은 기기 배선 버그다. 조용히 3을 주지 않는다.
ok("level_candidate가 4가 아니면 400", (await verify({ ...VBASE, level_candidate: 3 })).status === 400);
ok("cause 없으면 400", (await verify({ client_id: "x", level_candidate: 4 })).status === 400);

// 키가 없으면 부를 수 없다 — 그래도 **200 + Level 3**이다. 기기가 오류 분기를 타면 새벽에 터진다.
const vNoKey = await verify(VBASE);
ok("키 없음 → 200 · level 3 · source error", vNoKey.status === 200
  && vNoKey.json.level === 3 && vNoKey.json.source === "error" && vNoKey.json.ai_used === 0,
  JSON.stringify(vNoKey.json));
ok("판정 불가는 approved=false (fail-open 아님)", vNoKey.json.approved === false);

// (T-07) `ai_used`는 **"판정을 받았는가"가 아니라 "모델을 불렀는가"**다.
// 통제 ③이 지키는 것은 판정 수가 아니라 지출이므로, 요청이 나갔으면 1이어야 한다.
// 이걸 0으로 세면 8초 타임아웃이 반복되는 밤에 상한이 사실상 사라진다.
//
// **AI를 실제로 부르지 않는다** — `fetch`를 갈아 끼워 제공자 응답만 흉내 낸다.
// **상한을 채우기 전에** 둔다 — `guard_events`는 삭제가 트리거로 막혀 있어(개입 이력 영구 보존)
// 나중에 상한을 비울 수 없다. 검사 순서 자체가 불변성에 걸려 있다.
await api("PUT", "/api/settings/ai_key_anthropic", { value: "sk-ant-smoke-fake" });
const realFetch = globalThis.fetch;
// event_id를 새로 줘서 캐시를 피한다 — 캐시에 걸리면 callModel까지 가지 못한다
const VCALL = { ...VBASE, client_id: "verify-call-1", event_id: "20260731-777" };

globalThis.fetch = (async () =>
  new Response(JSON.stringify({ error: { message: "provider down" } }), { status: 500 })) as typeof fetch;
const vProv = await verify(VCALL);
ok("제공자 응답 실패 → ai_used 1 (요청이 나갔다)",
  vProv.json.source === "error" && vProv.json.ai_used === 1 && vProv.json.level === 3,
  JSON.stringify(vProv.json));

globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
const vNet = await verify(VCALL);
ok("네트워크 거절 → ai_used 1", vNet.json.source === "error" && vNet.json.ai_used === 1,
  JSON.stringify(vNet.json));

// 200인데 JSON이 아닌 응답 — **요청도 응답도 있었으므로** 지출은 발생했다.
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ content: [{ type: "text", text: "판정을 형식 없이 말해 버림" }] }),
    { status: 200 })) as typeof fetch;
const vParse = await verify(VCALL);
ok("파싱 실패 → ai_used 1 · 거부가 아니라 판정 불가",
  vParse.json.source === "error" && vParse.json.ai_used === 1 && vParse.json.approved === false,
  JSON.stringify(vParse.json));

globalThis.fetch = realFetch;
await api("PUT", "/api/settings/ai_key_anthropic", { value: "" });
// 키를 지우면 다시 **호출 전** 실패다 → 0. 이 대비가 T-07이 가르는 선이다.
const vNoKey2 = await verify(VCALL);
ok("키 없음은 여전히 ai_used 0 (호출 전에 막혔다)",
  vNoKey2.json.source === "error" && vNoKey2.json.ai_used === 0, JSON.stringify(vNoKey2.json));

// ③ 일일 상한 — coach 모드의 ai_daily_cap = 5 (0010 시드). ai_used=1 행을 그만큼 만든다.
// ai_verdict는 비워 둔다 — 캐시가 먼저 걸리면 상한을 검사하는 게 아니게 된다.
const capN = (await api("GET", "/api/guard/modes")).json.active.ai_daily_cap;
for (let i = 0; i < capN; i++) {
  await api("POST", "/api/guard/events", {
    cause: "protect:deadline", level: 4, client_id: `cap-uuid-${i}`, ai_used: 1,
  });
}
const vCap = await verify(VBASE);
ok("상한 초과 → level 3 · source cap · 호출 없음",
  vCap.json.level === 3 && vCap.json.source === "cap" && vCap.json.ai_used === 0, JSON.stringify(vCap.json));

// ② event당 1회 캐시 — 같은 밤(event_id 없는 감지 경로)의 판정을 재사용한다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 4, client_id: "cache-uuid-1", ai_used: 1, ai_verdict: "approve",
});
const vCache = await verify(VBASE);
ok("캐시 적중 → source cache · ai_used 0", vCache.json.source === "cache" && vCache.json.ai_used === 0,
  JSON.stringify(vCache.json));
ok("캐시된 approve는 격상까지 재사용", vCache.json.level === 4 && vCache.json.cached === true);
// **캐시가 상한을 이긴다** — 적중은 돈이 0이므로, 상한이 찼다고 이미 받은 판정을 버리면
// 그 밤의 Level 4가 이유 없이 죽는다. 상한이 막아야 하는 것은 '새 호출'이다.
ok("상한이 찼어도 캐시는 살아 있다", vCache.json.level === 4 && vCap.json.source === "cap");
// 캐시가 무조건 승인은 아니다 — deny도 그대로 재사용한다
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "cache-uuid-2", ai_used: 1, ai_verdict: "deny",
});
const vDeny = await verify(VBASE);
ok("캐시된 deny → level 3", vDeny.json.source === "cache" && vDeny.json.level === 3 && vDeny.json.approved === false);

// ── T-31 · `unavailable`이 이유를 말한다 (0016) ────────────────
// **값의 모양은 안 바뀐다.** `ai_verdict`는 계속 'unavailable'이고 이유만 옆 칼럼에 붙는다.
// 티켓 초안대로 'unavailable:timeout'을 값에 넣으면 0010의 CHECK에 걸려 400이 되고,
// 기기의 `flush()`가 400을 '재시도 무의미'로 보고 **그 발동 행을 통째로 버린다** —
// 관측을 늘리려던 티켓이 네트워크가 나쁜 밤의 기록을 지우게 된다.
// ★ 음성과 양성이 **한 쌍이라야 문다.** 바로 앞의 캐시 값은 `deny`(level 3)인데,
//   `unavailable`을 집어도 `guard.ts`의 `hit.ai_verdict === "approve"`가 거짓이라
//   **결과가 deny와 글자 그대로 같다** — 그래서 `IN`을 지워도 초록이다(실제로 확인했다).
//   그래서 여기서는 **approve를 먼저 깔고** 그 위에 unavailable을 얹는다:
//   `IN`이 살아 있으면 approve가 나와 level 4, 지우면 최신 unavailable이 나와 level 3이다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 4, client_id: "unavail-uuid-0", ai_used: 1, ai_verdict: "approve",
});
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "unavail-uuid-1", ai_used: 1,
  ai_verdict: "unavailable", ai_unavailable_reason: "timeout",
});
ok("이유가 그대로 남는다 (0016 · 닫힌 목록 안)",
  raw.prepare("SELECT ai_verdict AS v FROM guard_events WHERE client_id='unavail-uuid-1'").get()?.v === "unavailable"
  && raw.prepare("SELECT ai_unavailable_reason AS r FROM guard_events WHERE client_id='unavail-uuid-1'").get()?.r === "timeout");

const vUnavail = await verify(VBASE);
// 음성 — `unavailable`은 **가장 최근 행인데도** 안 잡힌다. 판정이 아니라 "부를 수 없었다"는
// 기록이고, 재사용하면 네트워크가 돌아온 뒤에도 그 밤 내내 Level 3에 묶인다(ADR-024 ②).
ok("unavailable은 캐시에 안 잡힌다 — 최신 행인데도 그 앞의 approve가 나온다",
  vUnavail.json.source === "cache" && vUnavail.json.level === 4 && vUnavail.json.approved === true,
  JSON.stringify(vUnavail.json));
// 양성 대조 — 캐시가 통째로 죽으면 상한(cap)이 잡힌다. 음성만 보면 그 경우도 초록이다(AGENT-CHAIN §5).
ok("양성 대조 — 캐시가 살아 있다 (죽었으면 source가 cap이 된다)",
  vUnavail.json.cached === true && vUnavail.json.ai_used === 0, JSON.stringify(vUnavail.json));

// 목록 밖 이유는 **버리되 행은 살린다.** 여기서 400을 던지면 CHECK에 걸리는 것과 결과가
// 같아진다 — `flush()`가 발동 행을 버린다. 이유 하나 때문에 기록을 잃지 않는다.
// (구버전 서버 + 신버전 APK로 값이 갈리는 경우가 실제로 그 자리다.)
const vJunk = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "unavail-uuid-2", ai_used: 0,
  ai_verdict: "unavailable", ai_unavailable_reason: "돌연변이",
});
ok("목록 밖 이유여도 발동 행은 산다 (201 · 이유만 비워진다)",
  vJunk.status === 201
  && raw.prepare("SELECT ai_unavailable_reason AS r FROM guard_events WHERE client_id='unavail-uuid-2'").get()?.r === null,
  JSON.stringify(vJunk.json));

// http_NNN 은 코드까지 남긴다 — 401(토큰 만료)과 503(과부하)의 대응이 다르다.
// 모양이 닫혀 있다는 것까지 본다: `http_503`은 통과, `http_50`은 목록 밖이다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "unavail-uuid-3", ai_used: 1,
  ai_verdict: "unavailable", ai_unavailable_reason: "http_503",
});
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "unavail-uuid-4", ai_used: 1,
  ai_verdict: "unavailable", ai_unavailable_reason: "http_50",
});
ok("http_503은 남고 http_50은 목록 밖이다 (세 자리로 닫혀 있다)",
  raw.prepare("SELECT ai_unavailable_reason AS r FROM guard_events WHERE client_id='unavail-uuid-3'").get()?.r === "http_503"
  && raw.prepare("SELECT ai_unavailable_reason AS r FROM guard_events WHERE client_id='unavail-uuid-4'").get()?.r === null);

// 판정이 있으면 이유는 없다 — `approve`인데 "왜 못 불렀는가"가 붙으면 그 자체가 거짓이다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 4, client_id: "unavail-uuid-5", ai_used: 1,
  ai_verdict: "approve", ai_unavailable_reason: "timeout",
});
ok("approve에는 이유가 안 붙는다 (판정이 있으면 못 부른 게 아니다)",
  raw.prepare("SELECT ai_unavailable_reason AS r FROM guard_events WHERE client_id='unavail-uuid-5'").get()?.r === null);

// ── T-38 · 왜 그렇게 답했는가 (0017) ────────────────────────────
// deny 열한 번의 사유가 어디에도 없었다. 서버는 만들어 보냈고 기기는 파싱까지 했는데
// `amendFire`가 나르지 않아 그 자리에서 버려졌다. **늘리는 것은 기록뿐이다** —
// 판정도 프롬프트도 안 건드린다.
const reasonOf = (cid: string) =>
  raw.prepare("SELECT ai_reason AS r, ai_unavailable_reason AS u FROM guard_events WHERE client_id=?").get(cid);

await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 4, client_id: "reason-uuid-1", ai_used: 1,
  ai_verdict: "approve", ai_reason: "시험이 9시간 뒤이고 지금 2시간째 깨어 있어요",
});
ok("approve 판정에 ai_reason이 실린다",
  reasonOf("reason-uuid-1")?.r === "시험이 9시간 뒤이고 지금 2시간째 깨어 있어요");

await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "reason-uuid-2", ai_used: 1,
  ai_verdict: "deny", ai_reason: "내일 일정이 오후라 격상까지는 불필요해요",
});
ok("deny 판정에도 실린다 — approve만 남기면 대조군이 없다",
  reasonOf("reason-uuid-2")?.r === "내일 일정이 오후라 격상까지는 불필요해요");

// ★ 3의 짝. 못 물어봤는데 "왜 그렇게 답했는지"가 있으면 그 자체가 거짓이다.
// 둘이 동시에 차면 12월에 어느 쪽을 세는지가 흐려진다 — 기계가 세는 쪽과 사람이 읽는 쪽이다.
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "reason-uuid-3", ai_used: 1,
  ai_verdict: "unavailable", ai_unavailable_reason: "server_timeout",
  ai_reason: "이것은 판정의 사유가 아니다",
});
const r3 = reasonOf("reason-uuid-3");
ok("unavailable이면 ai_reason은 비고 ai_unavailable_reason만 찬다",
  r3?.r === null && r3?.u === "server_timeout", JSON.stringify(r3));

// ★ T-31의 교훈. 새 칼럼을 필수로 만들면 옛 APK가 올리는 행이 400이 되고
// `flush()`가 그것을 '재시도 무의미'로 버린다 — **관측을 늘리려다 관측을 잃는다.**
const rOld = await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "reason-uuid-4", ai_used: 1,
  ai_verdict: "deny",
});
ok("★ ai_reason 없는 판정을 올려도 행이 산다 (옛 APK · NULL 허용)",
  rOld.status === 201 && reasonOf("reason-uuid-4")?.r === null, String(rOld.status));

// 길이도 같은 이유로 **거부하지 않고 자른다.** 400은 위와 같은 행 유실 경로다.
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "reason-uuid-5", ai_used: 1,
  ai_verdict: "deny", ai_reason: "가".repeat(700),
});
ok("긴 이유는 잘리되 행은 산다 (400을 던지면 flush가 행을 버린다)",
  String(reasonOf("reason-uuid-5")?.r ?? "").length === 500);

// ★ 위 다섯의 짝. **저것들만으로는 이 티켓을 못 지킨다** — 서버로 직접 POST하므로
// 기기가 `reason`을 다시 버려도 전부 초록이다. 그런데 T-38이 고치는 결함이 바로 그 자리다:
// 서버는 늘 보냈고 `GuardVerify`는 파싱까지 했는데 `amendFire`가 안 날라서 사라졌다.
// **끊기는 자리를 검사가 직접 봐야 한다** — 언어가 달라 타입이 이어 주지 않는다.
// ⚠️ **주석을 걷어내고 본다.** 안 그러면 그 줄을 `//`로 막아도 정규식이 그대로 맞아
// 초록이 된다 — 배선을 끊는 가장 쉬운 방법이 검사를 못 지나가야 한다(T-36의 `isComment`와 같다).
const ktCode = (p: string) => readFileSync(join(here, p), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const ktQueue = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/GuardEventQueue.kt");
const ktNotif = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/GuardNotifications.kt");
const KT_STORES = /put\("ai_reason"/;
const KT_CARRIES = /aiReason\s*=\s*v\?\.aiReason/;
ok("기기가 이유를 나른다 — 큐가 담고 호출부가 넘긴다 (T-38의 본체)",
  KT_STORES.test(ktQueue) && KT_CARRIES.test(ktNotif),
  `queue=${KT_STORES.test(ktQueue)} notif=${KT_CARRIES.test(ktNotif)}`);
// 위는 **스캐너가 죽어도 false가 아니라 조용히 false**가 된다 — 그건 실패로는 보이지만
// 원인이 "안 날랐다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다.
ok("★ 스캐너가 살아 있다 — 이어진 모양은 잡고 끊긴 모양은 안 잡는다",
  KT_STORES.test('hit.put("ai_reason", aiReason ?: JSONObject.NULL)')
  && !KT_STORES.test('hit.put("ai_verdict", aiVerdict ?: JSONObject.NULL)')
  && KT_CARRIES.test("aiReason = v?.aiReason,")
  && !KT_CARRIES.test("unavailableReason = a.reason,"));

// ── T-39 · 판정이 flush를 앞질러도 살아남는다 ───────────────────
// 검증은 발동 뒤 최악 16초까지 걸리는데(T-37) 그 사이에 사용자가 반응하면
// `GuardAlertActivity`가 `flush()`를 불러 발동 행이 먼저 올라간다. 새벽에 깬 사람이
// 화면을 바로 치우는 것은 **드문 일이 아니라 기본값**이고, 그러면 T-38이 되찾은
// `ai_reason`이 **가장 흔한 상황에서** 사라진다. 두 곳이 함께 막혀 있었다.

// 1. 본체 — 발동이 먼저 올라간 뒤 판정만 담긴 항목이 온다(cause·level 없이).
await api("POST", "/api/guard/events", { cause: "protect:deadline", level: 3, client_id: "t39-late-1" });
const rLate = await api("POST", "/api/guard/events", {
  client_id: "t39-late-1", ai_used: 1, ai_verdict: "deny",
  ai_reason: "내일 일정이 오후라 격상까지는 불필요해요",
});
const late1 = raw.prepare(
  "SELECT ai_used AS u, ai_verdict AS v, ai_reason AS r FROM guard_events WHERE client_id='t39-late-1'").get();
ok("flush 뒤에 도착한 판정이 서버에 실린다 (cause·level 없이 와도 400이 아니다)",
  rLate.status < 400 && rLate.json?.duplicate === true
  && late1?.u === 1 && late1?.v === "deny" && String(late1?.r ?? "").startsWith("내일"),
  `${rLate.status} ${JSON.stringify(late1)}`);

// 2. 1의 짝 — `NULL → 값`만이다. 재시도가 판정을 뒤집으면 안 된다.
//    ⚠️ **여기는 서버(`stAmendGuardAi`의 MAX·COALESCE)가 지키는 자리다.**
//       전엔 이것이 *유일한* 방어선이었다 — 트리거가 ai_* 넷을 아예 안 봤다.
//       **T-50(0019)이 그 마지막 방벽을 채웠다**(아래 [T-50] 절이 DB 쪽을 직접 센다).
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 4, client_id: "t39-late-2", ai_used: 1,
  ai_verdict: "approve", ai_reason: "첫 판정",
});
await api("POST", "/api/guard/events", {
  client_id: "t39-late-2", ai_used: 0, ai_verdict: "deny", ai_reason: "두 번째",
});
const late2 = raw.prepare(
  "SELECT ai_used AS u, ai_verdict AS v, ai_reason AS r FROM guard_events WHERE client_id='t39-late-2'").get();
ok("이미 값이 있으면 덮지 않는다 — ai_used도 1에서 0으로 안 내려간다",
  late2?.v === "approve" && late2?.r === "첫 판정" && late2?.u === 1, JSON.stringify(late2));

// 3. **위 둘은 서버로 직접 POST 한다 — 기기가 무엇을 하든 초록이다.** T-38에서 실제로 물린 자리다.
//    기기가 fallback 항목을 만드는지는 소스를 직접 봐야 한다.
const amendBlock = ktQueue.slice(ktQueue.indexOf("fun amendFire("), ktQueue.indexOf("fun recordReaction("));
const carriesFallback = (block: string) =>
  block.length > 0 && !/\?: return/.test(block) && /write\(ctx, list \+ o\)/.test(block);
ok("기기가 fallback 항목을 만든다 — 큐에 없으면 버리지 않는다 (T-39의 본체)",
  carriesFallback(amendBlock), `block=${amendBlock.length}자`);

// ── T-50 · AI 판정도 한 번만 채워진다 (0019) ────────────────────
// ★ **여기서는 API로 안 막고 DB로 막히는지를 센다.** 위 T-39 검사들은 서버를 거치므로
//    `stAmendGuardAi`의 `MAX`·`COALESCE`가 먼저 일하고, 트리거는 한 번도 안 불린다 —
//    즉 **트리거가 통째로 없어도 저 검사들은 전부 초록이다.** 원칙 2가 말하는 최종 강제는
//    그쪽이 아니라 이쪽이라, 이 절은 `raw.prepare`로 **직접 UPDATE를 쏜다.**
console.log("\n[T-50] guard_events — AI 판정 append-only (DB가 최종 강제)");

/** 그 UPDATE가 트리거에 막히는가. 막히면 true. */
const t50Blocked = (sql: string, ...args: unknown[]) => {
  try { raw.prepare(sql).run(...args as any[]); return false; } catch { return true; }
};

await api("POST", "/api/guard/events", { cause: "protect:deadline", level: 3, client_id: "t50-fresh" });
const t50Id = raw.prepare("SELECT id AS i FROM guard_events WHERE client_id='t50-fresh'").get()?.i as string;

// ① 첫 기입은 통과해야 한다 — **`ai_used`가 여기서 0 → 1이다.**
//    `OLD.ai_used IS NOT NULL`로 썼으면 NOT NULL 컬럼이라 항상 참이 되어 이 줄이 막힌다.
//    그러면 T-39가 되찾은 경로(판정이 뒤늦게 오는 밤)가 통째로 죽는다.
await api("POST", "/api/guard/events", {
  client_id: "t50-fresh", ai_used: 1, ai_verdict: "deny", ai_reason: "첫 판정",
});
const t50a = raw.prepare(
  "SELECT ai_used AS u, ai_verdict AS v, ai_reason AS r FROM guard_events WHERE id=?").get(t50Id);
ok("① NULL → 값은 그대로 통과한다 (amendFire 경로 · ai_used는 0 → 1)",
  t50a?.u === 1 && t50a?.v === "deny" && t50a?.r === "첫 판정", JSON.stringify(t50a));

// ② ★ 이 티켓의 핵심 — 채운 뒤 다른 값으로 바꾸면 DB가 막는다.
ok("② ★ 채운 뒤 다른 값으로 바꾸면 트리거가 막는다 (ai_verdict)",
  t50Blocked("UPDATE guard_events SET ai_verdict='approve' WHERE id=?", t50Id));

// ③ ★ ②의 짝 — **같은 값 재기입은 통과한다.** ②만 보면 *"값이 있으면 무조건 거부"*가
//    통과하고, 그러면 오프라인 재전송이 막힌다(ADR-023 — 기기가 같은 것을 다시 올린다).
ok("③ ★ 같은 값으로 다시 쓰는 것은 통과한다 (재전송이 막히면 안 된다)",
  !t50Blocked("UPDATE guard_events SET ai_verdict='deny' WHERE id=?", t50Id));

// ④ 셋 다인가 — 하나만 고치지 않았나.
ok("④ ai_used · ai_reason 도 같다 (1 → 0으로 못 내리고, 이유도 못 덮는다)",
  t50Blocked("UPDATE guard_events SET ai_used=0 WHERE id=?", t50Id)
  && t50Blocked("UPDATE guard_events SET ai_reason='다른 이유' WHERE id=?", t50Id));

// ④' ⚠️ **티켓은 셋이라 했지만 같은 구멍이 넷이었다.** `ai_unavailable_reason`(0016)도
//     `amendFire`가 같은 호출에서 쓰는 사후 필드인데 트리거 밖에 있었다.
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "t50-unavail",
  ai_used: 1, ai_verdict: "unavailable", ai_unavailable_reason: "timeout",
});
const t50Uid = raw.prepare("SELECT id AS i FROM guard_events WHERE client_id='t50-unavail'").get()?.i as string;
ok("④' ai_unavailable_reason 도 같다 — 0016이 더한 넷째 사후 필드",
  t50Blocked("UPDATE guard_events SET ai_unavailable_reason='dns' WHERE id=?", t50Uid)
  && !t50Blocked("UPDATE guard_events SET ai_unavailable_reason='timeout' WHERE id=?", t50Uid));

// ⑤·⑥ ★ 회귀 — 트리거를 DROP/CREATE로 통째로 다시 썼다. **옛 보호를 한 줄이라도 잃으면
//    조용히 사라진다**(이 작업의 유일한 위험).
//
// ⚠️ **ai_* 가 안 채워진 행을 따로 쓴다.** 위 행(t50-fresh)에는 판정이 들어 있어서,
//    ai 규칙이 망가지면 그 행에 대한 **모든** UPDATE가 막힌다 — 그러면 ⑤·⑥이
//    *"reaction 보호가 살아 있어서"*가 아니라 *"ai 규칙이 다 막아서"* 초록이 된다.
//    옛 보호를 재는 검사는 옛 필드만 있는 행에서 재야 한다.
// ⚠️ **준비용 UPDATE도 `t50Blocked`로 감싼다.** 맨 `raw.prepare().run()`으로 두면
//    변이 하나가 여기서 던져 **smoke가 통째로 죽고 숫자를 잃는다** — 실제로 그렇게 됐다.
//    "검사 하나가 죽는다"와 "검사가 안 돈다"는 다르다(T-49 ③과 같은 자리).
await api("POST", "/api/guard/events", { cause: "protect:deadline", level: 3, client_id: "t50-legacy" });
const t50Lid = raw.prepare("SELECT id AS i FROM guard_events WHERE client_id='t50-legacy'").get()?.i as string;

// 먼저 채운다(NULL → 값). **채우는 것 자체가 통과해야** 아래 거부가 뜻을 가진다.
const t50Filled = !t50Blocked("UPDATE guard_events SET reaction='accepted' WHERE id=?", t50Lid)
  && !t50Blocked("UPDATE guard_events SET outcome='success' WHERE id=?", t50Lid);
// ⚠️ 바꿔 볼 값으로 'override'를 쓰지 않는다 — 0010의 CHECK(사유 필수)에 먼저 걸려
//    **트리거가 아니라 CHECK 때문에** 막히는 거짓 초록이 된다.
ok("⑤ ★ reaction · outcome 의 기존 보호가 그대로다 (다시 쓰면서 안 잃었다)",
  t50Filled
  && t50Blocked("UPDATE guard_events SET reaction='ignored' WHERE id=?", t50Lid)
  && t50Blocked("UPDATE guard_events SET outcome='failure' WHERE id=?", t50Lid),
  `채움=${t50Filled}`);

// ⑥ ★ ⑤의 짝 — level은 사후 필드가 **아니다.** 바뀌면 무조건 차단이고, 완화하지 않았다.
//    격상(ADR-024)은 `POST /api/guard/verify`가 판정만 돌려주고 **기기가 그 level로 발동한
//    뒤에** 행이 생기므로, 발동 시점의 level은 사실이고 바뀔 경로가 없다.
ok("⑥ ★ level 은 여전히 무조건 차단이다 (사후 필드로 완화하지 않았다)",
  t50Blocked("UPDATE guard_events SET level=4 WHERE id=?", t50Lid));

// 4. ★ 3의 짝. 슬라이스가 빗나가면 `amendBlock`이 빈 문자열이 되는데, 그때 **조용히 초록이
//    되지 않도록** 빈 블록도 거짓으로 둔다 — 그 자리를 합성 소스로 확인한다.
ok("★ 스캐너가 살아 있다 — 옛 모양(?: return)은 잡고 빈 블록도 거짓이다",
  !carriesFallback("val hit = list.firstOrNull { it } ?: return\nwrite(ctx, list + o)")
  && carriesFallback("if (hit != null) { write(ctx, list); return }\nwrite(ctx, list + o)")
  && !carriesFallback(""));

// ── T-40 · flush가 자기 스냅샷으로 큐를 덮지 않는다 ──────────────
// 실측이 원인을 짚었다(2026-08-20, 반응 시점만 바꿔 넷): +0.48·+0.57초는 판정이 유실되고
// +1.31·+30초는 남았다. `read` → `post`(~1.8초) → `write(list.drop(1))`가 **목록 전체를 덮어**
// 그 창에 들어온 것을 지운다 — amendFire의 판정뿐 아니라 **새 발동 행까지** 사라진다.
//
// ⚠️ **경쟁 조건은 정적 검사가 증명하지 못한다.** 아래 셋은 배선이 되돌려지는 것을 막을 뿐이고,
//    진짜 판정은 티켓 §확인 절차의 실측이다. 그래도 두는 이유는 T-38·T-39와 같다 —
//    **서버로 직접 POST하는 검사는 기기가 무엇을 하든 초록이기 때문이다.**
const flushBlock = ktQueue.slice(ktQueue.indexOf("fun flush("), ktQueue.indexOf("private fun post("));
const rereadsAfterPost = (b: string) => (b.match(/read\(ctx\)/g) ?? []).length >= 2;
const removesByKey = (b: string) =>
  b.length > 0 && !/drop\(1\)/.test(b) && /indexOfFirst/.test(b) && /filterIndexed/.test(b);
const guardsRepeat = (b: string) => /tried/.test(b) && /!in tried/.test(b);

ok("flush가 POST 뒤에 큐를 다시 읽는다 — 스냅샷을 재사용하지 않는다",
  flushBlock.length > 0 && rereadsAfterPost(flushBlock), `block=${flushBlock.length}자`);
ok("제거가 위치(drop(1))가 아니라 그 항목 기준이다",
  removesByKey(flushBlock), `block=${flushBlock.length}자`);
// 남긴 항목이 다시 first()가 되므로 이것이 없으면 **한 flush가 무한히 돈다.**
ok("한 flush 안에서 같은 것을 두 번 보내지 않는다 (무한 루프 방지)",
  guardsRepeat(flushBlock));
ok("★ 스캐너가 살아 있다 — 옛 flush 모양을 실제로 잡고 빈 블록도 거짓이다",
  !rereadsAfterPost("val list = read(ctx); post(...); write(ctx, list.drop(1))")
  && !removesByKey("val list = read(ctx); write(ctx, list.drop(1))")
  && !guardsRepeat("val list = read(ctx); write(ctx, list.drop(1))")
  && !removesByKey(""));

// ★ 대장이 셋이다 — TS · 0016의 CHECK · GuardVerify.kt. **두 곳에 두면 갈라진다.**
//   기대값이 비어 있지 않으므로 **스캐너가 죽어 목록이 `[]`가 되면 그 자체로 빨간불**이다
//   (T-26의 교훈 — '0건'은 못 찾을 때도 초록이다).
const sql0016 = readFileSync(join(here, "../migrations/0016_guard_unavailable_reason.sql"), "utf8")
  .replace(/--[^\n]*/g, "");                       // 주석 안의 괄호가 IN 블록을 잘라먹는다
const inBlock = sql0016.slice(sql0016.indexOf("ai_unavailable_reason IN ("));
const sqlReasons = [...inBlock.slice(0, inBlock.indexOf(")")).matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]);
const ktSrc = readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/guard/GuardVerify.kt"), "utf8");
const ktBlock = ktSrc.slice(ktSrc.indexOf("object Reason {"), ktSrc.indexOf("fun http("));
const ktReasons = [...ktBlock.matchAll(/const val [A-Z_]+ = "([a-z_]+)"/g)].map((m) => m[1]);
const ledger = [...guard.UNAVAILABLE_REASONS].sort().join(",");
ok(`이유의 닫힌 목록이 TS·0016·Kotlin 셋 다 같다 (${guard.UNAVAILABLE_REASONS.length}개)`,
  ledger.length > 0 && sqlReasons.sort().join(",") === ledger && ktReasons.sort().join(",") === ledger,
  `ts=${ledger} sql=${sqlReasons.join(",")} kt=${ktReasons.join(",")}`);
ok("http_NNN 모양도 셋이 같다 (0016 GLOB · Kotlin http())",
  /GLOB 'http_\[0-9\]\[0-9\]\[0-9\]'/.test(sql0016) && /fun http\(code: Int\) = "http_\$code"/.test(ktSrc));

// snapshot()의 **짝** — 새 항만 보면 기존 항을 지워도 통과한다(티켓 §확인 절차 2번).
// `screen_on_sec`은 개입 몫을 **포함한 채** 남아야 한다: 미리 빼서 저장하면 파생을
// 물화하는 것이고(원칙 1) 이름과 뜻이 갈라진다. 읽는 쪽이 뺀다.
const logSrc = readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/guard/GuardActivityLog.kt"), "utf8");
ok("snapshot()에 intervene_sec이 더해졌고 screen_on_sec은 그대로다",
  /\.put\("intervene_sec"/.test(logSrc) && /\.put\("screen_on_sec"/.test(logSrc));
ok("빼서 저장하지 않는다 — screen_on_sec에 개입 몫을 감산한 자리가 없다",
  !/screenOnMs\s*-=|screenOnMs\s*-\s*interveneMs/.test(logSrc));

// ⑤ 킬 스위치 — 끄면 **결정론 복귀 = 항상 격상**. Level 3으로 떨구면 끄기가 벌이 된다.
await api("PUT", "/api/settings/guard_ai_verify", { value: "off" });
const vOff = await verify(VBASE);
ok("킬 스위치 off → level 4 · source off · ai_used 0",
  vOff.json.level === 4 && vOff.json.source === "off" && vOff.json.ai_used === 0, JSON.stringify(vOff.json));
ok("킬 스위치는 상한·캐시보다 먼저다", vOff.json.cached === false);
await api("PUT", "/api/settings/guard_ai_verify", { value: "on" });

// ── T-32 · risk_snapshot에 서버 항을 얹는다 (§6.6) ─────────────
// 기기엔 logs·feelings·daily가 없다. ADR-021이 발동을 기기로 옮기면서 서버 출처 항이
// 통째로 사라졌고, 그 누락이 어디에도 안 적혔다. record()가 firedAt 기준으로 메운다.
const OFF = t0.now.slice(-6);                       // 이 리포의 오프셋 표기를 그대로 쓴다
const P3 = addDays(D, -9);   // smoke가 마감하지 않는 날 — 마감된 날엔 트리거가 Log를 막는다
raw.prepare("INSERT INTO daily (date, created_at) VALUES (?, ?) ON CONFLICT (date) DO NOTHING").run(P3, t0.now);
raw.prepare("INSERT INTO logs (date, ts, text, created_at) VALUES (?, ?, ?, ?)")
  .run(P3, `${P3}T21:00:00${OFF}`, "사흘 전 저녁", t0.now);
raw.prepare("INSERT INTO logs (date, ts, text, created_at) VALUES (?, ?, ?, ?)")
  .run(P3, `${P3}T23:30:00${OFF}`, "사흘 전 밤", t0.now);

const DEV_SNAP = {
  window_min: 60, hour: 23.75, screen_on_sec: 4200, intervene_sec: 600,
  unlocks: 9, top_apps: [{ app: "com.example.x", sec: 3000 }], samples: 42, usage_permission: true,
};
const snapOf = (cid: string) => {
  const s = raw.prepare("SELECT risk_snapshot AS s, risk_score AS n FROM guard_events WHERE client_id=?").get(cid);
  return { snap: s?.s ? JSON.parse(String(s.s)) : null, score: s?.n ?? null };
};

// ① 과거 발동 — **오프라인 큐가 나중에 올라온 경로다**(ADR-023).
//    서버 항이 firedAt이 아니라 '지금'으로 조회되면 새벽 스냅샷이 아침 값으로 채워진다.
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "t32-past", risk_snapshot: DEV_SNAP,
  fired_at: `${P3}T23:45:00${OFF}`,
});
const past = snapOf("t32-past");
ok("firedAt 기준으로 조회한다 — 사흘 전 발동이 그 날의 Log를 담는다",
  past.snap?.server?.on_date === P3 && past.snap.server.logs_24h === 2
  && past.snap.server.log_last_min === 15, JSON.stringify(past.snap?.server));
ok("수면 추정은 전날 Log의 첫/마지막이다 (§1.2) — 사흘 전엔 전날 기록이 없다",
  past.snap?.server?.sleep_prev_first === null && past.snap?.server?.sleep_prev_last === null);

// ② 양성 대조 — 오늘 발동은 오늘 값을 담는다.
//    ①만 보면 조회가 통째로 죽어 전부 비어도 초록이다(AGENT-CHAIN §5).
await api("POST", "/api/logs", { text: "T-32 오늘 기록" });
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "t32-now", risk_snapshot: DEV_SNAP,
});
const now32 = snapOf("t32-now");
ok("양성 대조 — 오늘 발동은 오늘 값을 담는다 (조회가 살아 있다)",
  now32.snap?.server?.on_date === D && now32.snap.server.logs_24h > 0
  && now32.snap.server.log_last_min !== null, JSON.stringify(now32.snap?.server));

// ③ 기기 항이 **그대로 남는다** — 서버가 얹으면서 지우거나 이름을 바꾸지 않는다.
//    ①②만 보면 기기 항을 통째로 덮어써도 초록이다.
ok("기기 항이 그대로다 — 여덟 키가 값까지 같다",
  Object.keys(DEV_SNAP).every((k) => JSON.stringify(now32.snap[k]) === JSON.stringify((DEV_SNAP as any)[k])),
  JSON.stringify(now32.snap));
ok("출처가 갈려 있다 — 서버 항은 server 아래에만 있다",
  typeof now32.snap.server === "object" && now32.snap.logs_24h === undefined
  && now32.snap.score_last === undefined);

// ④ risk_score — 서버가 낸다. **발동이 끝난 뒤라 게이트가 될 수 없다**(ADR-021).
ok("risk_score가 NULL이 아니다 (서버가 냈다)",
  typeof now32.score === "number" && now32.score > 0 && now32.score <= 100, String(now32.score));
// 양성 대조 — 항이 없으면 어떻게 되는지. **기기가 안 보낸 것과 서버가 못 찾은 것은 다르다.**
await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 3, client_id: "t32-nosnap",
});
const bare = snapOf("t32-nosnap");
ok("스냅샷이 없으면 서버 항만으로 만들지 않는다 — snapshot·score 둘 다 NULL",
  bare.snap === null && bare.score === null, JSON.stringify(bare));

// ⑤ 데드라인까지 남은 시간 · 보호 구간 여부 — 역산은 protectAxis 하나뿐이다.
//    **자기 일정을 직접 만든다** — 위 gNow는 603줄에서 보호가 해제됐다(재사용하면 전제가 조용히 썩는다).
const g32 = (await api("POST", "/api/events", { title: "T-32 보호 중인 시험", date: dPlus(2), time: "09:00" })).json.id as string;
await api("PUT", `/api/events/${g32}/protect`, { protect_from: "-2d 00:00", protect_level: 4 });
const evPlan = ((await api("GET", "/api/guard/schedule")).json.events as any[]).find((e) => e.event_id === g32);
ok("보호 구간이 지금을 포함한다 (⑤의 전제)",
  !!evPlan && Date.parse(evPlan.protect_from) <= Date.parse(t0.now), JSON.stringify(evPlan?.protect_from));
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "t32-ev", risk_snapshot: DEV_SNAP, event_id: g32,
});
const evSnap = snapOf("t32-ev");
ok("데드라인까지 남은 분이 schedule()의 역산과 같은 값이다 (두 벌이 아니다)",
  evSnap.snap?.server?.deadline_min !== null
  && Math.abs(evSnap.snap.server.deadline_min
    - Math.round((Date.parse(evPlan.deadline) - Date.parse(evSnap.snap.server.at)) / 60_000)) === 0,
  JSON.stringify({ got: evSnap.snap?.server?.deadline_min, plan: evPlan?.deadline }));
ok("보호 구간 안이었음을 남긴다 · event 없는 감지 경로는 null",
  evSnap.snap.server.protecting === true && now32.snap.server.protecting === null);


// buildCoreContext (§6.2) — **빈 섹션을 생략하지 않는다.**
// 생략하면 모델이 빈 곳을 상상으로 메우고, 명시하면 "정보가 없어 판단 보류"가 나온다.
const core0 = await buildCoreContext(env, t0);
ok("빈 섹션을 명시 직렬화 (Education 0건 → '정보 없음')", core0.includes("Education: 정보 없음"), core0.slice(0, 120));
ok("Overview·Goals도 빈 채로 명시된다",
  core0.includes("Overview: 정보 없음") && core0.includes("Goals: 정보 없음"));
ok("§6.2 순서 — Overview가 Goals보다 앞", core0.indexOf("Overview") < core0.indexOf("Goals"));
ok("디데이 없으면 제약도 명시", core0.includes("제약(디데이): 정보 없음"));

// 채워진 섹션은 항목이 실린다 — 같은 코드의 반대 분기. 넣은 행은 지운다.
raw.prepare(`INSERT INTO lm_item (id, section, title, body, schema_version, source, version, created_at, updated_at)
             VALUES ('20260730-901', 'overview', '현재 상태', '물리학과 3학년', 1, 'manual', 1, ?, ?)`).run(t0.now, t0.now);
raw.prepare("INSERT INTO periods (id, title, color, start_date, end_date, kind, dday_label, created_at) VALUES ('20260730-902', '입대 준비', '#7ED4A9', ?, ?, 'constraint', '입대', ?)")
  .run(D, addDays(D, 30), t0.now);
const core1 = await buildCoreContext(env, t0);
ok("채워진 섹션은 항목이 실린다", core1.includes("현재 상태") && core1.includes("물리학과 3학년")
  && !core1.includes("Overview: 정보 없음"), core1.slice(0, 160));
ok("디데이는 남은 일수를 조회 시 계산", core1.includes("입대") && core1.includes("30일"),
  core1.slice(core1.indexOf("제약")));
raw.prepare("DELETE FROM lm_item WHERE id = '20260730-901'").run();
raw.prepare("DELETE FROM periods WHERE id = '20260730-902'").run();

// ── 9.7 Life Model (0012) — me-reinforcement-plan Phase 1 ────
console.log("\n[9.7] Life Model — 스키마 검증 · CRUD · 앵커");

// (1) 스키마 레지스트리 — 검증·프롬프트·폼이 같은 것을 읽는다
const lmSecs = (await api("GET", "/api/lm/sections")).json;
ok("섹션 3종 등록 (overview·goals·education)", lmSecs.sections.length === 3);
const eduSchema = (await api("GET", "/api/lm/education/schema")).json;
ok("스키마 v1 + 필드 파생", eduSchema.version === 1 && eduSchema.fields.some((f: any) => f.key === "status" && f.enum));
ok("없는 섹션 404", (await api("GET", "/api/lm/없음/schema")).status === 404);

// (1b) 표시 라벨은 스키마가 준다(0014) — 폼이 영문 키를 그대로 보여주지 않게. 검증 의미는 그대로다.
const eduByKey: Record<string, any> = Object.fromEntries(eduSchema.fields.map((f: any) => [f.key, f]));
ok("필드에 표시 라벨(title)이 실린다",
  eduByKey.name?.title === "과목명" && eduByKey.credits?.title === "학점" && eduByKey.prerequisites?.title === "선수과목",
  JSON.stringify(eduSchema.fields.map((f: any) => f.title)));
ok("라벨이 검증을 바꾸지 않는다 (required·enum·itemType 그대로)",
  eduByKey.status?.required === true && Array.isArray(eduByKey.status?.enum) && eduByKey.prerequisites?.itemType === "string");
// 스키마가 늘 완전하다고 가정하지 않는다 — v2에서 새 필드에 title을 빼먹으면 key로 떠야 한다
raw.prepare("INSERT INTO lm_schema (section, version, body, active, created_at) VALUES ('smoke_notitle', 1, ?, 1, ?)")
  .run('{"section":"smoke_notitle","version":1,"type":"object","required":[],"properties":{"bare_key":{"type":"string"},"labeled":{"type":"string","title":"라벨 있음"}}}', t0.now);
const bareFields = (await api("GET", "/api/lm/smoke_notitle/schema")).json.fields;
ok("title이 없는 필드는 key로 폴백",
  bareFields.find((f: any) => f.key === "bare_key")?.title === "bare_key" &&
  bareFields.find((f: any) => f.key === "labeled")?.title === "라벨 있음",
  JSON.stringify(bareFields));
raw.prepare("DELETE FROM lm_schema WHERE section='smoke_notitle'").run();

// (2) 스키마 검증 — §0-6 자유 형식 JSON 금지
ok("필수 필드 누락 400",
  (await api("POST", "/api/lm/education", { title: "양자역학1", data: { name: "양자역학1" } })).status === 400);
ok("enum 위반 400",
  (await api("POST", "/api/lm/education", { title: "x", data: { name: "x", status: "듣는중" } })).status === 400);
ok("타입 위반 400",
  (await api("POST", "/api/lm/education", { title: "x", data: { name: "x", status: "completed", credits: "셋" } })).status === 400);
ok("배열 원소 타입 위반 400",
  (await api("POST", "/api/lm/education", { title: "x", data: { name: "x", status: "planned", prerequisites: [1, 2] } })).status === 400);

// (3) 빈칸 허용 — §0-2. data 없이도 저장된다
// 제목은 이관 라벨(방향·관심사·진로·성격·생활 패턴)과 겹치지 않게 — 겹치면 (6)의 이관이 건너뛴다
const lmBare = await api("POST", "/api/lm/overview", { title: "현재 상태", body: "물리학과 3학년" });
ok("data 없이 생성 201 (빈칸 허용)", lmBare.status === 201);

// (4) 정상 생성 + 조회
const lmEdu = await api("POST", "/api/lm/education", {
  title: "양자역학1",
  data: { name: "양자역학1", status: "completed", term: "2026-1", grade: "B+", credits: 3, prerequisites: ["일반물리2"] },
});
ok("스키마 통과 시 201", lmEdu.status === 201);
const eduList = (await api("GET", "/api/lm/education")).json as any[];
const eduRow = eduList.find((r) => r.id === lmEdu.json.id);
ok("data가 객체로 복원됨", !!eduRow && eduRow.data.grade === "B+" && eduRow.data.prerequisites[0] === "일반물리2");
ok("schema_version 기록", eduRow.schema_version === 1);

// (5) version 자동 증가 — §5 stale 체인의 출발점. 트리거가 강제한다.
ok("생성 직후 version 1", eduRow.version === 1);
const lmUp = await api("PATCH", `/api/lm/item/${lmEdu.json.id}`, { data: { ...eduRow.data, grade: "A0" } });
ok("수정 시 version 2로 자동 증가", lmUp.json.version === 2, String(lmUp.json.version));
ok("수정도 스키마 검증을 탄다",
  (await api("PATCH", `/api/lm/item/${lmEdu.json.id}`, { data: { name: "x", status: "몰라" } })).status === 400);

// (6) Me → Overview 이관 — 원본을 지우지 않는다. 멱등.
await api("PUT", "/api/me/direction", { value: "물리를 오래 하고 싶다" });
const imp1 = await api("POST", "/api/lm/import-me");
ok("Me 이관 실행", imp1.status === 200 && imp1.json.imported.length >= 1, JSON.stringify(imp1.json));
const imp2 = await api("POST", "/api/lm/import-me");
ok("두 번째 이관은 아무것도 안 함 (멱등)", imp2.json?.imported?.length === 0, JSON.stringify(imp2.json));
// 리터럴 경로가 :section 와일드카드에 먹히지 않는지 — 순서 회귀 방지
ok("import-me가 :section으로 안 잡힘", imp1.json?.imported !== undefined && imp1.status === 200);
// getMe는 fields를 **행 배열**로 돌려준다 ({field, value, updated_at}[]) — 객체 맵이 아니다
const meFields = (await api("GET", "/api/me")).json.fields as Array<{ field: string; value: string }>;
ok("원본 me는 그대로 (복사만 한다)",
  meFields.find((f) => f.field === "direction")?.value === "물리를 오래 하고 싶다");
ok("Overview에도 같은 값이 들어옴",
  ((await api("GET", "/api/lm/overview")).json as any[]).some((r) => r.title === "방향" && r.body === "물리를 오래 하고 싶다"));

// (7) 기간 constraint/디데이 (§1) — 별도 구조 없이 기간에 속성을 얹는다
const pCon = await api("POST", "/api/periods", {
  title: "입대까지", start_date: D, end_date: addDays(D, 200), color: "#C4401F",
});
ok("기간 생성 (constraint 속성은 0012 컬럼)", pCon.status === 201);

// (8) 삭제
ok("항목 삭제", (await api("DELETE", `/api/lm/item/${lmBare.json.id}`)).status === 200);
ok("없는 항목 수정 404", (await api("PATCH", "/api/lm/item/20990101-999", { title: "x" })).status === 404);

// ── 10. 인증 ─────────────────────────────────────────────────
console.log("\n[10] 인증 — API_TOKEN 있으면 Bearer 필수");
const envAuth: Env = { DB: env.DB, API_TOKEN: "secret" };
const authed = async (h: Record<string, string>) =>
  (await worker.fetch(new Request("http://local/api/health", { headers: h }), envAuth, {} as ExecutionContext)).status;
ok("토큰 없이 401", (await authed({})) === 401);
ok("Bearer로 200", (await authed({ Authorization: "Bearer secret" })) === 200);

// ── 11. 시간 맥락은 요청당 한 번 (T-23) ──────────────────────
// 응답으로는 확인되지 않는 종류다 — 서비스가 `loadTime`을 다시 부르든 라우트가 `t`를 넘기든
// **응답은 글자 하나까지 같다.** 갈라지는 것은 05:00 경계를 넘는 그 창뿐이고, 그때조차
// 아무 오류도 나지 않는다(T-07의 UTC 귀속일이 그랬다). 그래서 **부르는 자리를 직접 센다.**
console.log("\n[11] 시간 맥락 — loadTime을 부르는 자리");

const srcDir = join(here, "../src");
const srcFiles = (readdirSync(srcDir, { recursive: true, encoding: "utf8" }) as string[])
  .filter((f) => f.endsWith(".ts")).map((f) => f.replaceAll("\\", "/"));
// 언급이 아니라 **호출**을 센다: 선언(`function loadTime(`)과 주석 줄을 뺀 나머지.
// 판정은 **줄 단위**다 — 파일 전체에서 `/* … */`를 걷어내려 했더니 `app.use("/api/*")`의
// `/*`가 열려 `\s*/`(정규식 리터럴)까지 18줄을 먹고 index.ts의 진짜 호출을 지웠다.
// 아래 양성 대조가 그걸 잡았다. 줄을 넘지 않으면 그 사고가 안 난다.
const loadTimeCalls = (rel: string) =>
  readFileSync(join(srcDir, rel), "utf8").split("\n").filter((line) => {
    const m = /(?<!function\s)\bloadTime\s*\(/.exec(line);
    if (!m) return false;
    const head = line.slice(0, m.index).trimStart();          // 호출 앞자리
    return !head.startsWith("*") && !head.startsWith("/*") && !head.includes("//");
  }).length;
const callSites = srcFiles.map((f) => [f, loadTimeCalls(f)] as const).filter(([, n]) => n > 0);

ok("서비스 계층에 loadTime 호출이 0이다 (T-23 검사 2)",
  callSites.every(([f]) => !f.startsWith("services/")), JSON.stringify(callSites));
// ↑ 하나만으로는 정규식이 죽어도 초록이다. 진입 계층 둘을 **양성 대조**로 함께 못 박는다 —
//   이 줄이 초록이어야 위의 0이 '못 찾았다'가 아니라 '없다'는 뜻이 된다.
//   lib/·db/로 옮겨 부르는 우회도 여기서 걸린다: 자리는 둘이고 각각 한 번이다.
ok("부르는 자리는 진입 계층 둘뿐 — index.ts 미들웨어 1 · scheduled.ts cron 1",
  callSites.length === 2 && loadTimeCalls("index.ts") === 1 && loadTimeCalls("scheduled.ts") === 1,
  JSON.stringify(callSites));
ok("훑은 범위가 src 전체다 (파일 수 · 서비스 포함)",
  srcFiles.length >= 15 && srcFiles.some((f) => f.startsWith("services/")) && srcFiles.includes("lib/time.ts"),
  `${srcFiles.length}개 — ${srcFiles.join(" ")}`);

// ── 12. schedule()도 넘겨받은 시계를 쓴다 (T-26) ───────────────
// `schedule()`은 `t`를 받아 놓고 `Date.now()`로 시계를 다시 읽었다. 같은 함수의 `protectingNow`는
// 이미 `Date.parse(t.now)`를 쓴다 — 한 함수 안에 시계가 두 벌인 채로 두면 다음에 또 "여기도 있었네"가 된다.
console.log("\n[12] Guard schedule — 지난 발동을 거르는 시계도 주입된 t다");

// (1) 자리 검사. **먼저 스캐너가 살아 있음을 보인다** — T-23에서 주석 제거 정규식이 죽었는데도
//     '0건'이 그대로 초록이던 자리다. 옛 코드 줄을 그대로 먹여 잡히는지, 주석·`Date.parse`는
//     안 잡는지 양쪽에서 확인한다. 이 줄이 초록이어야 아래 대장이 '못 찾았다'가 아닌 뜻을 갖는다.
const clockLines = (text: string) =>
  text.split("\n").filter((line) => {
    const m = /\bDate\.now\s*\(/.exec(line);
    if (!m) return false;
    const head = line.slice(0, m.index).trimStart();          // 호출 앞자리 — 줄을 넘지 않는다(T-23)
    return !head.startsWith("*") && !head.startsWith("/*") && !head.includes("//");
  });
ok("검사가 살아 있다 (양성 대조) — 옛 `Date.now()` 줄은 잡고 주석·`Date.parse`는 안 잡는다",
  clockLines("  const nowMs = Date.now();").length === 1 &&
  clockLines("  const started = Date.now();").length === 1 &&
  clockLines("  // const nowMs = Date.now();").length === 0 &&
  clockLines("   * Date.now()를 쓰지 않는다").length === 0 &&
  clockLines("  const nowMs = Date.parse(t.now);").length === 0);

// 남은 자리를 **전부 못 박는다.** "src에 0"이라고 쓸 수 없다 — `Date.now()`는 더 있고 성격이 다르다:
// `loadTime`의 기본값(진입 계층이 요청당 한 번 읽는 그 자리)과 경과(ms) 측정이다. 대장으로 두면
// 새 `Date.now()`가 어디에 생기든, 그리고 **스캐너가 죽어 대장이 비어도** 이 줄이 빨간불이 된다.
const clockLedger = srcFiles
  .map((f) => [f, clockLines(readFileSync(join(srcDir, f), "utf8")).length] as const)
  .filter(([, n]) => n > 0)
  .sort((a, b) => a[0].localeCompare(b[0]));
ok("src의 Date.now()는 여섯 줄뿐 — lib/ai.ts 3 · lib/time.ts 1 · services/guard.ts 2 (T-26 검사 1)",
  JSON.stringify(clockLedger) ===
    JSON.stringify([["lib/ai.ts", 3], ["lib/time.ts", 1], ["services/guard.ts", 2]]),
  JSON.stringify(clockLedger));
const guardClock = clockLines(readFileSync(join(srcDir, "services/guard.ts"), "utf8"));
ok("services/guard.ts에 남은 둘은 경과(ms) 측정이다 — '지금'으로 읽는 자리가 0이다",
  guardClock.length === 2 && guardClock.every((l) => /started/.test(l)),
  JSON.stringify(guardClock));

// (2) 경계를 **양쪽에서** 누른다. 한쪽만 보면 부등호가 뒤집혀도 통과한다.
//     날짜는 오늘 기준 상대로 만든다 — 고정 날짜는 그날이 지나면 조용히 낡는다(T-12).
const ev26 = (await api("POST", "/api/events",
  { title: "T-26 보호 일정", date: addDays(D, 10), time: "09:00" })).json.id as string;
ok("T-26 검사용 보호 규칙 부착 200 (검사의 전제)",
  (await api("PUT", `/api/events/${ev26}/protect`, { protect_from: "-1d 00:00", protect_level: 4 })).status === 200);

const planAt = async (utcMs: number) =>
  ((await guard.schedule(env, { ...t0, now: isoNow(utcMs, t0.offsetMin) })).events as any[])
    .find((e) => e.event_id === ev26);
const fireAt = (plan: any, ms: number) => plan.fires.some((f: any) => Date.parse(f.at) === ms);
const firesOf = (plan: any) => JSON.stringify(plan.fires.map((f: any) => `L${f.level}@${f.at}`));

// 기준점은 **응답이 준 데드라인**이다 — 역산식을 검사가 다시 구현하면 두 벌이 갈라진다(T-05).
const base26 = await planAt(Date.parse(t0.now));
const dl26 = Date.parse(base26.deadline);
ok("실시각에서는 열 건 전부 미래다 (경계 검사의 전제)",
  base26.fires.length === 10 && fireAt(base26, Date.parse(base26.protect_from)) && fireAt(base26, dl26),
  firesOf(base26));

// ↓ 여기가 T-26이다. `Date.now()`면 주입한 t를 무시하므로 실시각(열 건 전부 미래)이 그대로 나온다
//   → '1분 후'가 빨간불. 부등호가 뒤집히면 '1분 전'이 빨간불. 두 줄이 서로 다른 것을 막는다.
const before26 = await planAt(dl26 - 60_000);
ok("데드라인 1분 전 — 데드라인 발동은 남고, 이미 지난 보호 시작(L1)은 빠진다",
  fireAt(before26, dl26) && !fireAt(before26, Date.parse(base26.protect_from)), firesOf(before26));
const after26 = await planAt(dl26 + 60_000);
ok("데드라인 1분 후 — 데드라인 발동은 빠지고, 30분 뒤 Level 4는 남는다",
  !fireAt(after26, dl26) && fireAt(after26, dl26 + 30 * 60_000), firesOf(after26));

// ── 13. 프롬프트는 없는 강제력을 말하지 않는다 (T-28) ─────────
// `VERIFY_SYSTEM`이 Level 4를 "신규 작업 차단까지"라고 적어 뒀는데 **차단은 구현이 없었다.**
// 모델이 존재하지 않는 대가를 저울에 올려 판정했고, 그렇게 쌓인 `guard_events`가
// §6.5가 읽을 전례다. T-28은 **거짓을 지우기만** 한다 — 사실은 강제력이 생긴 뒤에 적는다(T-29).
//
// 응답으로는 확인되지 않는다: 프롬프트가 뭐라 쓰였든 `/api/guard/verify`의 모양은 같다.
// 그래서 **보내는 문자열을 직접 본다.**
console.log("\n[13] Level 4 프롬프트 — 없는 강제력을 말하지 않는다");

const guardSrc = readFileSync(join(srcDir, "services/guard.ts"), "utf8");
// 배열 **안**만 본다 — 위쪽 설명 주석은 이 결정을 기록하느라 '막는다'를 쓴다.
// 주석을 걷어내는 정규식으로 가르려다 T-23이 18줄을 먹었다. 경계를 좁히면 그 사고가 안 난다.
const verifySystemOf = (text: string) =>
  /const VERIFY_SYSTEM = \[([\s\S]*?)\]\.join/.exec(text)?.[1] ?? "";
const vs = verifySystemOf(guardSrc);

// 양성 대조 ① — **추출이 실제로 됐다.** 정규식이 죽으면 `vs`가 ""가 되고 아래 '차단 없음'이
//   *못 찾아서* 초록이 된다(AGENT-CHAIN §5). 아는 문구가 담겨 있어야 그 0이 뜻을 갖는다.
ok("VERIFY_SYSTEM을 실제로 읽었다 (양성 대조 · T-28 검사 2)",
  vs.includes("개입 수위 검증기") && vs.includes("Level 3(화면 점유 + 알람)")
    && vs.includes('{"approve": true|false') && vs.length > 150,
  `${vs.length}자`);
// 양성 대조 ② — 같은 스캐너에 **옛 문구를 그대로 먹인다.** 잡아야 한다.
//   이 줄이 초록이어야 아래 '없다'가 '못 찾았다'가 아니라 '지웠다'는 뜻이 된다.
const oldVerifyBlock =
  'const VERIFY_SYSTEM = [\n  "Level 4(신규 작업 차단까지)로 격상할 근거가 있는지만 판정한다.",\n].join';
ok("옛 문구는 잡는다 (양성 대조 · 스캐너가 살아 있다)",
  verifySystemOf(oldVerifyBlock).includes("차단"), verifySystemOf(oldVerifyBlock));

ok("VERIFY_SYSTEM에 '차단'이 없다 — 막지 않으므로 그렇게 쓰지 않는다 (T-28 검사 1)",
  !vs.includes("차단"), vs);

// T-29 — 이제 강제력이 **있다.** 거짓을 지운 자리에 사실을 적었다.
// 빈칸으로 두면 모델이 대가를 0으로 놓고 판정한다 — 그것도 §6.5의 전례를 비뚤게 한다.
//
// **둘 다 적혔는지 본다.** 초안이 "새 일에"라고 써서 미루기를 뺐는데 구현은 둘 다 막는다 —
// ADR-035 ①이 명시적으로 구별한 것(새 일 / 있던 부담의 이동)을 프롬프트가 도로 합치면,
// 그것이 이 티켓 계열이 고치려던 것과 **같은 종류의 어긋남**이다.
ok("VERIFY_SYSTEM이 실제 대가를 말한다 — 180초 · 30분 · 새 일과 미루던 일 둘 다 (T-29)",
  vs.includes("180초") && vs.includes("30분")
    && vs.includes("오늘 날짜가 새로 붙지 않는다")
    && vs.includes("새 일도") && vs.includes("미루던 일도"), vs);

// ── T-36 · 검사 자신을 훑는다 — 고정 날짜는 언젠가 현재가 된다 ────
console.log("\n[T-36] fixture 날짜가 상대인가 (검사가 자기 소스를 훑는다)");
// 8/14에 `2026-08-15` 하나가 보호 구간을 열어 **한 번에 11건**이 빨간불이 됐다.
// 회귀가 아니라 달력이 fixture를 따라잡은 것이고, 고치는 것만으로는 재발을 못 막는다 —
// **다음에 누가 또 심으면 그 순간 빨간불이 되어야 한다**(CLAUDE.md 함정 12).
const smokeSrc = readFileSync(join(here, "smoke.ts"), "utf8").split("\n");
const DATE_LIT = /20\d\d-\d\d-\d\d/;
// 고정 날짜가 허용되는 유일한 자리: **순수 함수에 넘기는 시각 인자.**
// 그 함수들은 시계를 읽지 않고 인자만 보므로 달력이 따라잡을 수 없다 —
// 오히려 고정이어야 30일 달·윤년을 날짜와 무관하게 검사할 수 있다(T-12가 front에서 한 것).
const PURE_CLOCK = /(attributionDate|isoNow|mondayOf)\(/;
const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
const scanFixed = (lines: string[]) => lines
  .map((l, i) => ({ n: i + 1, l }))
  .filter((x) => DATE_LIT.test(x.l) && !isComment(x.l) && !PURE_CLOCK.test(x.l));

const stray = scanFixed(smokeSrc);
ok("fixture에 고정 날짜가 없다 — 서버 시계와 만나는 날짜는 전부 상대다",
  stray.length === 0, stray.map((x) => `:${x.n} ${x.l.trim().slice(0, 70)}`).join(" | "));

// ★ 짝. 위는 **스캐너가 죽어도 0건이라 초록이다** — 실제로 잡는지를 합성 줄로 확인한다.
// ⚠️ 합성 날짜를 이어 붙이는 이유: 여기 그대로 적으면 위 검사가 **자기 자신을 잡는다.**
const probeDate = "20" + "26-08-15";
ok("★ 스캐너가 살아 있다 — 고정 날짜를 실제로 잡는다",
  scanFixed([`  await api("POST", "/api/events", { date: "${probeDate}" });`]).length === 1);
// 허용된 자리도 **개수로** 센다. '0건'만 보면 시간 블록이 통째로 사라져도 조용히 통과한다(T-26).
const pureFixed = smokeSrc.filter((l) => DATE_LIT.test(l) && !isComment(l) && PURE_CLOCK.test(l));
ok("순수 함수에 넘기는 고정 시각은 그대로 있다 — 다섯 줄", pureFixed.length === 5, String(pureFixed.length));

// ── T-37 · 중첩 타임아웃은 바깥이 안보다 길다 (ADR-038) ──────────
console.log("\n[T-37] 기기가 서버보다 먼저 포기하지 않는다");
// 두 상수가 **서로 다른 언어·다른 파일**에 있고 서로를 모른다. 한쪽만 고쳐도 아무것도
// 빨간불이 되지 않았고, 그래서 기기 6초 < 서버 8초인 채로 남아 `server_timeout`이
// **구조적으로 관측 불가능**했다 — T-31이 갈라 둔 두 이유 중 한쪽이 죽어 있었다.
// `guardSrc`는 [13]에서 이미 읽었다 — 같은 파일을 두 번 읽지 않는다.
const KT_READ = /const val READ_TIMEOUT_MS = ([0-9_]+)/;
const KT_CONNECT = /const val CONNECT_TIMEOUT_MS = ([0-9_]+)/;
const TS_AI = /const AI_TIMEOUT_MS = ([0-9_]+)/;
const msOf = (re: RegExp, src: string): number | null => {
  const hit = re.exec(src)?.[1];
  return hit === undefined ? null : Number(hit.replace(/_/g, ""));
};
const ktRead = msOf(KT_READ, ktSrc);
const ktConnect = msOf(KT_CONNECT, ktSrc);
const serverAi = msOf(TS_AI, guardSrc);

// ③ **먼저** 둘을 찾았는지 본다. 못 찾으면 아래 부등호가 *조용히* 뜻을 잃는다 —
//    `null > null`은 false라 실패로 보이지만, 원인이 "값이 뒤집혔다"인지
//    "정규식이 낡았다"인지 구별이 안 된다(AGENT-CHAIN §5).
ok("두 상수를 각각 찾았다 — 못 찾으면 아래 검사가 뜻을 잃는다",
  ktRead !== null && ktConnect !== null && serverAi !== null,
  `read=${ktRead} connect=${ktConnect} server=${serverAi}`);

// ① 본체.
ok("기기 readTimeout이 서버 AI_TIMEOUT_MS보다 길다 (바깥이 안보다 길다)",
  ktRead !== null && serverAi !== null && ktRead > serverAi,
  `read=${ktRead} server=${serverAi}`);

// connect는 read보다 **짧아야** 한다. 둘의 뜻이 다르기 때문이다 —
// 연결 부재는 빨리 알수록 낫고, 읽기는 서버가 생각하는 시간이다.
// 한 상수로 되돌리면 이 줄이 죽는다(두 값이 같아진다).
ok("connect와 read가 다른 값이고 connect가 짧다 (한 상수로 되돌리면 죽는다)",
  ktConnect !== null && ktRead !== null && ktConnect < ktRead,
  `connect=${ktConnect} read=${ktRead}`);

// ② ★ 위 셋은 **스캐너가 죽으면 이유를 못 말한다.** 합성 소스로 실제로 뽑는지 본다.
//    숫자를 이어 붙이지 않아도 되는 것은 이 파일에 날짜가 아니라 밀리초가 있어서다(T-36과 다르다).
ok("★ 스캐너가 살아 있다 — 합성 소스에서 세 값을 실제로 뽑는다",
  msOf(KT_READ, "    private const val READ_TIMEOUT_MS = 1_234") === 1234
  && msOf(KT_CONNECT, "    private const val CONNECT_TIMEOUT_MS = 567") === 567
  && msOf(TS_AI, "const AI_TIMEOUT_MS = 8_000;") === 8000
  && msOf(KT_READ, "private const val TIMEOUT_MS = 6_000") === null);

// ── T-41 · 학사 마감 수집 (0018 · ADR-037) ──────────────────────
console.log("\n[T-41] iCal 수집 — 해석하지 않고 원문을 쌓는다");
// ★ **fixture는 실측으로 받은 원본 파일 그 자체다** (2026-08-17 · 330바이트 · 줄끝 전부 CRLF).
//    사본을 test/ 아래로 뜨지 않는다 — 두 벌이 되면 갈라지고, 갈라진 쪽이 원본 행세를 한다.
//    **파싱은 순수 함수라 고정 날짜가 허용되는 자리**다(T-36이 정의한 예외) —
//    오히려 고정이어야 형식을 달력과 무관하게 검사한다.
const ICS_RAW = readFileSync(join(here, "../docs/samples/uclass-icalexport-20260817.ics"), "utf8");
const CRLF = "\r\n";

const UID_A = "10788@uclass.uos.ac.kr";   // 원본의 UID (ADR-037 §근거 ②)
const UID_B = "10999@uclass.uos.ac.kr";
const LM_1 = "20260817T130943Z";          // 원본의 LAST-MODIFIED
const DTSTART_Z = "20260818T130900Z";     // 원본의 DTSTART (UTC)

// 원본을 **잘라서** 쓴다 — 머리(METHOD가 PRODID 앞이고 CALSCALE이 없다)와 꼬리를 그대로 둔 채
// VEVENT 블록만 복제·치환한다. 그래야 둘 이상을 만드는 검사도 원본 형식 위에서 돈다.
const VEV_0 = ICS_RAW.indexOf("BEGIN:VEVENT");
const VEV_1 = ICS_RAW.indexOf("END:VEVENT") + "END:VEVENT".length;
const ICS_HEAD = ICS_RAW.slice(0, VEV_0);   // BEGIN:VCALENDAR … VERSION:2.0 CRLF
const ICS_TAIL = ICS_RAW.slice(VEV_1);      // CRLF END:VCALENDAR CRLF
const VEVENT = ICS_RAW.slice(VEV_0, VEV_1);

const vevent = (uid: string, summaryLine: string, lastMod: string) => VEVENT
  .replace(`UID:${UID_A}`, `UID:${uid}`)
  .replace("SUMMARY:test", summaryLine)
  .replace(`LAST-MODIFIED:${LM_1}`, `LAST-MODIFIED:${lastMod}`);
const ics = (...evs: string[]) => ICS_HEAD + evs.join(CRLF) + ICS_TAIL;

// ⚠️ **접힌 줄은 합성이다.** 원본은 `SUMMARY:test` 넉 자라 안 접혔는데, 긴 SUMMARY는
//    75옥텟에서 반드시 접혀 온다. 기대값을 fixture에서 **계산**해 둘이 갈라지지 않게 한다 —
//    손으로 적으면 그 자체가 또 하나의 추측이다.
const FOLD_1 = "SUMMARY:양자역학 과제 2 4월 18일 23:00 기한 — 제목이 길면 ";
const FOLD_2 = " 이렇게 접혀서 온다";
const FOLDED_JOINED = FOLD_1.slice("SUMMARY:".length) + FOLD_2.slice(1);

// 기대값을 **fixture에서 독립으로 계산**한다. `icalDateToIso`를 그대로 부르면 순환이고,
// 대시 있는 리터럴을 적으면 T-36의 고정 날짜 스캐너가 잡는다(그게 맞다 — 그 가드를 넓히지 않는다).
// 여기 날짜가 서버 시계와 만날 일은 없다: 이 값은 fixture에서 나와 fixture로 돌아간다.
const isoOf = (c: string) =>
  `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(9, 11)}:${c.slice(11, 13)}:${c.slice(13, 15)}Z`;

// **원본 파일을 손대지 않고 그대로** 파싱한다 — 위 조립이 원본과 어긋나면 여기서 갈린다.
const ip1 = uclass.parseIcal(ICS_RAW);
ok("원본 .ics 를 그대로 파싱한다 — UID·SUMMARY·DTSTART·LAST-MODIFIED",
  ip1.length === 1 && ip1[0]?.uid === UID_A && ip1[0]?.summary === "test"
  && ip1[0]?.description === null
  && ip1[0]?.dtstart === isoOf(DTSTART_Z) && ip1[0]?.lastModified === LM_1,
  JSON.stringify(ip1));
// 조립한 것이 원본과 같은지 — 이게 어긋나면 아래 검사들이 **원본이 아닌 것**을 보고 있는 것이다.
ok("★ 잘라 붙인 것이 원본 바이트와 같다 (아래 검사들이 원본 위에서 돈다)",
  ics(vevent(UID_A, "SUMMARY:test", LM_1)) === ICS_RAW,
  `${ics(vevent(UID_A, "SUMMARY:test", LM_1)).length} vs ${ICS_RAW.length}`);

const ip2 = uclass.parseIcal(ics(vevent(UID_A, FOLD_1 + CRLF + FOLD_2, LM_1)));
ok("줄 접힘(RFC 5545)을 편다 — 긴 SUMMARY가 이어 붙는다",
  ip2[0]?.summary === FOLDED_JOINED, JSON.stringify(ip2[0]?.summary));

const envU: Env = { ...env, UCLASS_ICAL_URL: "https://uclass.example/export.php?authtoken=SMOKE" };
const realFetchU = globalThis.fetch;
let icalFetches = 0;
const serve = (body: string) => {
  globalThis.fetch = (async () => { icalFetches++; return new Response(body, { status: 200 }); }) as typeof fetch;
};
const uidRow = (uid: string) => raw.prepare(
  "SELECT summary AS su, last_modified AS lm, state AS st, starts_at AS sa FROM collected_items WHERE uid=?").get(uid);
const uidCount = (uid: string) =>
  (raw.prepare("SELECT COUNT(*) AS n FROM collected_items WHERE uid=?").get(uid) as any).n;

serve(ics(vevent(UID_A, "SUMMARY:개인 일정", LM_1), vevent(UID_B, "SUMMARY:과제1 기한", LM_1)));
const u1 = await uclass.collect(envU, t0);
ok("첫 수집 — 둘 다 새 행 · DTSTART가 로컬 오프셋으로 정규화된다",
  u1.added === 2 && u1.collected === 2 && String(uidRow(UID_A)?.sa ?? "").includes("+"),
  `${JSON.stringify(u1)} ${uidRow(UID_A)?.sa}`);

// 3. 같은 UID를 다시 — 중복 행이 아니라 갱신이다(UNIQUE가 diff 기준이자 멱등 키다).
serve(ics(vevent(UID_A, "SUMMARY:개인 일정 (제목 변경)", LM_1), vevent(UID_B, "SUMMARY:과제1 기한", LM_1)));
const u2 = await uclass.collect(envU, t0, true);
ok("같은 UID를 다시 넣으면 갱신이지 중복이 아니다 · 원문이 갱신된다",
  u2.added === 0 && uidCount(UID_A) === 1 && uidRow(UID_A)?.su === "개인 일정 (제목 변경)",
  `${JSON.stringify(u2)} ${uidRow(UID_A)?.su}`);

// 4. `state`는 사용자의 것이다 — 원천이 바뀌었다고 되돌리지 않는다.
raw.prepare("UPDATE collected_items SET state='dismissed' WHERE uid=?").run(UID_A);
serve(ics(vevent(UID_A, "SUMMARY:개인 일정 (또 변경)", "20260820T090000Z"), vevent(UID_B, "SUMMARY:과제1 기한", LM_1)));
const u3 = await uclass.collect(envU, t0, true);
ok("last_modified가 바뀌면 갱신되고 state는 안 바뀐다",
  u3.changed === 1 && uidRow(UID_A)?.lm === "20260820T090000Z" && uidRow(UID_A)?.st === "dismissed",
  `${JSON.stringify(u3)} ${JSON.stringify(uidRow(UID_A))}`);

// 5. ★ 3·4의 짝. 창이 `-5일 ~ +365일`이라 **지난 마감은 저절로 목록에서 빠진다** —
//    그걸 삭제로 읽으면 어제 한 과제가 오늘 사라진다.
serve(ics(vevent(UID_B, "SUMMARY:과제1 기한", LM_1)));            // A가 목록에서 빠졌다
const u4 = await uclass.collect(envU, t0, true);
ok("★ 목록에서 빠져도 행이 남는다 — 사라짐은 삭제가 아니다",
  u4.collected === 1 && uidCount(UID_A) === 1 && uidRow(UID_A)?.st === "dismissed",
  `${JSON.stringify(u4)} A=${uidCount(UID_A)}`);

// 6. 토큰이 없으면 — 이 코드를 지금 배포해도 아무것도 안 바뀐다.
const u5 = await uclass.collect(env, t0, true);
ok("토큰이 없으면 조용히 건너뛴다 — 예외를 안 던진다",
  u5.skipped === "no_token" && u5.added === 0, JSON.stringify(u5));

// 8. 빈도 — cron은 30분마다 돌지만 마감은 분 단위로 생기지 않는다.
const fetchesBefore = icalFetches;
const u6 = await uclass.collect(envU, t0);           // force 없이 · 방금 수집했다
ok("30분마다 fetch하지 않는다 — 마지막 수집에서 6시간 안이면 건너뛴다",
  u6.skipped === "too_soon" && icalFetches === fetchesBefore,
  `${JSON.stringify(u6)} fetches ${fetchesBefore}→${icalFetches}`);

// 7. ★ 5의 짝. 원천이 밖에 있어 실패가 흔하다 — 그것이 자동 마감을 멈추면 안 된다.
//    빈도 게이트를 비워야 실제로 fetch까지 간다(안 비우면 이 검사가 공회전한다).
raw.prepare("DELETE FROM settings WHERE key='uclass_last_collect_at'").run();
globalThis.fetch = (async () => { throw new TypeError("uclass down"); }) as typeof fetch;
// ⚠️ **여기서 그냥 부르면 변이가 러너를 죽인다** — `.catch`를 떼면 던짐이 그대로 올라와
//    요약도 개수도 안 남는다(T-35에서 같은 자리를 물렸다). 던짐을 **빨간불로 번역**한다.
const acU: any = await autoClose(envU, t0).catch((e: any) => ({ threw: String(e?.message ?? e) }));
ok("★ 수집이 던져도 autoClose가 끝까지 간다",
  !acU.threw && acU.uclass?.skipped === "error" && acU.as_of === t0.d && typeof acU.closed === "number",
  acU.threw ? `autoClose가 던졌다 — .catch가 없다: ${acU.threw}` : JSON.stringify(acU));
ok("실패가 조용히 사라지지 않는다 — 사유가 settings에 남고 URL은 안 실린다", (() => {
  const e = raw.prepare("SELECT value AS v FROM settings WHERE key='uclass_last_error'").get() as any;
  return !!e?.v && String(e.v).includes("uclass down") && !String(e.v).includes("authtoken");
})());
globalThis.fetch = realFetchU;

// ── T-42 · 수집한 것을 제안으로 꺼낸다 ──────────────────────────
console.log("\n[T-42] 제안 — 곧 닥치는 것만 묻고, 원문을 다듬지 않는다");
// 창의 양 끝을 **서버가 쓰는 시계로** 만든다. `starts_at`은 T-41이 로컬 오프셋으로
// 정규화해 둔 값이라 같은 오프셋끼리 문자열 비교가 시각 비교와 같다.
const atPlus = (ms: number) => isoNow(Date.parse(t0.now) + ms, t0.offsetMin);
const HOUR = 3600_000, DAY = 24 * HOUR;
const putCollected = (uid: string, summary: string, startsAt: string, state = "new") =>
  raw.prepare(`INSERT INTO collected_items
      (id, uid, source, summary, starts_at, first_seen_at, last_seen_at, state, created_at)
      VALUES (?,?, 'uclass', ?, ?, ?, ?, ?, ?)`)
    .run(`2026-t42-${uid}`, uid, summary, startsAt, t0.now, t0.now, state, t0.now);

// ⚠️ **제목에 "마감"·"제출"을 쓰지 않는다** — 원문이 무엇이든 그대로 나른다는 것이
//    이 검사의 요지이므로, fixture 자체도 원천이 줄 법한 문장을 그대로 쓴다.
const RAW_TITLE = "5주차 과제 (~9/3 23:00) 기한";
putCollected("t42-in", RAW_TITLE, atPlus(2 * DAY));                 // 창 안
putCollected("t42-far", "먼 것", atPlus(9 * DAY));                   // 7일 밖
putCollected("t42-past", "지난 것", atPlus(-2 * DAY));               // 과거
putCollected("t42-dis", "거절한 것", atPlus(3 * DAY), "dismissed");  // 이미 거절

const pend1 = (await api("GET", "/api/collected/pending")).json;
ok("pending이 7일 밖·과거·dismissed를 안 준다 — 창 안 하나만",
  pend1.length === 1 && pend1[0].summary === RAW_TITLE, JSON.stringify(pend1.map((r: any) => r.summary)));

// ⚠️ **위치(`[0]`)로 고르지 않는다.** 그러면 아래 둘이 검사 1의 출력에 매달려,
//    창 필터가 깨졌을 때 **셋이 한꺼번에** 죽는다(변이가 무엇을 죽였는지 못 읽는다).
//    아는 원문으로 집으면 각 검사가 자기 것만 본다.
const accId = pend1.find((r: any) => r.summary === RAW_TITLE)?.id;
const acc1 = (await api("POST", `/api/collected/${accId}/accept`)).json;
const evRow = raw.prepare("SELECT title AS ti, date AS dt, time AS tm FROM events WHERE id=?").get(acc1.event_id) as any;
ok("accept가 events를 만들고 state·event_id를 잇는다 · title은 원문 그대로",
  !!acc1.event_id && evRow?.ti === RAW_TITLE && evRow?.tm === atPlus(2 * DAY).slice(11, 16)
  && (raw.prepare("SELECT state AS s, event_id AS e FROM collected_items WHERE id=?").get(accId) as any)?.s === "accepted",
  `${JSON.stringify(acc1)} ${JSON.stringify(evRow)}`);

// ★ 2의 짝. 느린 네트워크에서 두 번 눌리는 것이 이 카드의 기본 조건이다.
const acc2 = (await api("POST", `/api/collected/${accId}/accept`)).json;
const evCount = (raw.prepare("SELECT COUNT(*) AS n FROM events WHERE title=?").get(RAW_TITLE) as any).n;
ok("★ accept를 두 번 불러도 events가 하나다 (멱등)",
  acc2.event_id === acc1.event_id && acc2.duplicate === true && evCount === 1,
  `${JSON.stringify(acc2)} events=${evCount}`);

putCollected("t42-d2", "거절할 것", atPlus(4 * DAY));
const dId = (await api("GET", "/api/collected/pending")).json.find((r: any) => r.summary === "거절할 것").id;
await api("POST", `/api/collected/${dId}/dismiss`);
ok("dismiss 뒤에는 pending에 안 나온다",
  !(await api("GET", "/api/collected/pending")).json.some((r: any) => r.id === dId));

// **문구에 해석이 없다** — 결정 ②는 화면 문자열로만 확인된다(§확인 절차 4행).
const cardSrc = readFileSync(join(here, "../public/app.js"), "utf8");
const cardBlock = cardSrc.slice(
  cardSrc.indexOf("async function loadCollected"), cardSrc.indexOf("세 번 밀린 일의 출구 (T-35 · ADR-036)"));
const htmlSrc = readFileSync(join(here, "../public/index.html"), "utf8");
const htmlBlock = htmlSrc.slice(htmlSrc.indexOf('id="td-coll"'), htmlSrc.indexOf('id="td-events"'))
  + htmlSrc.slice(htmlSrc.indexOf('id="sh-coll"'), htmlSrc.indexOf('id="sh-add"'));
const noVerdict = (b: string) => b.length > 0 && !/마감|제출|due/i.test(b);
ok("★ 카드 문구가 DTSTART의 뜻을 넘겨짚지 않는다 — '마감'·'제출'이 없다",
  noVerdict(cardBlock) && noVerdict(htmlBlock), `app=${cardBlock.length}자 html=${htmlBlock.length}자`);
// 위는 **블록이 비어도(슬라이스가 빗나가도) 거짓**이라 조용히 통과하지 않는다.
// 그래도 정규식이 낡으면 알 수 없으므로 합성 문자열로 실제로 잡는지 본다.
ok("★ 스캐너가 살아 있다 — '마감'이 든 문구를 실제로 잡는다",
  !noVerdict("새로 들어온 마감 3건") && !noVerdict("") && noVerdict("새로 들어온 일정 3건"));

// ── T-43 · 수집이 돌았는지 사람이 볼 수 있다 ────────────────────
console.log("\n[T-43] 상태 — '돌았지만 0건'과 '안 돌았다'를 가른다");
// **토큰이 있는 env로 부른다.** 기본 `api()`는 `UCLASS_ICAL_URL`이 없는 env를 쓰므로
// 그것으로만 검사하면 ④(URL 유출 없음)가 **없는 것을 안 실었다고 말하는 공회전**이 된다.
// 본문을 **문자열 그대로** 들고 온다 — 유출 검사는 파싱한 객체가 아니라 나간 바이트를 봐야 한다.
const apiU = async (path: string) => {
  const res = await worker.fetch(new Request(`http://local${path}`), envU, {} as ExecutionContext);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* no body */ }
  return { status: res.status, text, json };
};
const rowsN = (state: string) =>
  (raw.prepare("SELECT COUNT(*) AS n FROM collected_items WHERE state=?").get(state) as any).n;

// 1. 한 번도 안 돌았다 — T-41이 아무것도 안 남긴 상태를 만든다.
raw.prepare("DELETE FROM settings WHERE key LIKE 'uclass_%'").run();
const st1 = (await apiU("/api/collected/status")).json;
// ⚠️ **건수는 여기서 안 본다.** 넣어 뒀더니 `last_seen_count`를 빼는 변이가 ①까지 죽였다 —
//    그러면 어느 결함이 무엇을 죽였는지 못 읽는다. null과 0의 대비는 아래 ★짝의 몫이다.
ok("① 한 번도 안 돌았으면 last_collect_at이 없다 (다음 수집 시각도 없다)",
  st1.last_collect_at === null && st1.last_result === null && st1.next_earliest_at === null,
  JSON.stringify(st1));

// 2. ★ 1의 짝이자 이 티켓의 본체. **실제로 한 바퀴 돌린다** — settings에 손으로 값을 넣으면
//    "수집 경로가 건수를 남기는가"를 안 보고 "status가 읽는가"만 보게 된다.
serve(ics());                                   // 원본 형식 그대로 · VEVENT가 하나도 없다
const u7 = await uclass.collect(envU, t0, true);
const st2 = (await apiU("/api/collected/status")).json;
ok("★② 돌았고 0건이면 last_collect_at이 있고 last_seen_count가 0이다",
  u7.collected === 0 && st2.last_collect_at === t0.now
  && st2.last_seen_count === 0 && st2.last_result === "ok",
  `${JSON.stringify(u7)} ${JSON.stringify(st2)}`);
ok("★ ①과 ②가 실제로 갈린다 — null과 0이 같은 값이 아니다",
  st1.last_seen_count === null && st2.last_seen_count === 0,
  `${st1.last_seen_count} vs ${st2.last_seen_count}`);
// 간격은 `uclass.ts`가 주인이다. **여기 6시간을 못 박아 둔다** — 바뀌면 빨간불이 되고,
// 그때 화면이 자기 간격을 따로 들고 있지 않은지 다시 보게 된다(T-05가 450분에 쓴 방법).
ok("② next_earliest_at = 마지막 수집 + 6시간",
  st2.next_earliest_at === isoNow(Date.parse(t0.now) + 6 * 3600_000, t0.offsetMin),
  st2.next_earliest_at);

// 3. 실패 사유. **성공 시각은 안 밀린다** — 그래야 "마지막으로 성공한 게 언제냐"가 남는다.
globalThis.fetch = (async () => new Response("nope", { status: 403 })) as typeof fetch;
await uclass.collect(envU, t0, true).catch(() => {});
const st3 = (await apiU("/api/collected/status")).json;
ok("③ 실패하면 last_result에 사유가 들어간다 · 마지막 성공 시각은 그대로다",
  st3.last_result === "http_403" && st3.last_error_at === t0.now
  && st3.last_collect_at === st2.last_collect_at, JSON.stringify(st3));

// 3′. ★ 3의 변형 — **2xx가 달력이라는 뜻이 아니다.** 만료된 세션은 로그인 HTML을 200으로 준다.
//     이걸 안 막으면 그 응답이 `last_seen_count=0`인 **성공**으로 기록돼 ②와 구별되지 않는다.
const beforeHtml = rowsN("new") + rowsN("accepted") + rowsN("dismissed");
globalThis.fetch = (async () => new Response("<html>login</html>", { status: 200 })) as typeof fetch;
await uclass.collect(envU, t0, true).catch(() => {});
const st3b = (await apiU("/api/collected/status")).json;
ok("★③′ 200이어도 달력이 아니면 실패다 — 로그인 HTML이 '0건 성공'으로 안 남는다",
  st3b.last_result === "not_calendar" && st3b.last_collect_at === st2.last_collect_at
  && rowsN("new") + rowsN("accepted") + rowsN("dismissed") === beforeHtml,
  JSON.stringify(st3b));
globalThis.fetch = realFetchU;

// 4. **없는 것을 세는 검사.** URL 자체가 열쇠다(ADR-037 §근거 ④).
const st4 = await apiU("/api/collected/status");
const leaks = (s: string) => /authtoken|SMOKE|uclass\.example/i.test(s);
ok("④ 응답에 URL·토큰이 없다 — configured는 있다/없다만 말한다",
  st4.status === 200 && st4.json.configured === true && !leaks(st4.text),
  st4.text.slice(0, 200));
ok("★ 스캐너가 살아 있다 — 토큰이 실린 응답이면 실제로 잡는다",
  leaks(`{"url":"${envU.UCLASS_ICAL_URL}"}`) && !leaks(JSON.stringify({ configured: true })));

// 5. counts는 조회 시 센다(원칙 1). T-42가 하나를 accepted로 만들어 뒀으므로 0이 아니다.
ok("⑤ counts가 원장을 그대로 센다 — 파생을 저장하지 않는다",
  st4.json.counts.new === rowsN("new") && st4.json.counts.accepted === rowsN("accepted")
  && st4.json.counts.dismissed === rowsN("dismissed") && st4.json.counts.accepted > 0,
  `${JSON.stringify(st4.json.counts)} vs new=${rowsN("new")} acc=${rowsN("accepted")} dis=${rowsN("dismissed")}`);

// 6. 시크릿이 없는 env — 화면의 '설정 안 됨'이 여기서 갈린다.
ok("⑥ 토큰이 없으면 configured=false",
  (await api("GET", "/api/collected/status")).json.configured === false);

// 7. 화면 문구도 스캐너로 센다 — **"눈으로 확인한다"는 확인 절차가 아니다**(AGENT-CHAIN §5).
//    T-42의 `noVerdict`를 그대로 쓴다. 블록이 비면(슬라이스가 빗나가면) 거짓이라 조용히 안 지나간다.
const collBlock = cardSrc.slice(
  cardSrc.indexOf("function collectAgo"), cardSrc.indexOf("function toggleSet"));
ok("⑦ 상태 한 줄이 DTSTART의 뜻을 넘겨짚지 않는다 — '마감'·'제출'이 없다",
  noVerdict(collBlock), `${collBlock.length}자`);
ok("⑦ 상태 한 줄이 URL·토큰을 화면에 쓰지 않는다",
  collBlock.length > 0 && !/url|token|authtoken/i.test(collBlock), `${collBlock.length}자`);

// ── T-47 · '이월 중'은 미룬 것만이 아니다 (ADR-042) ──────────────
console.log("\n[T-47] Works 이월 중 — 지난 예정이 그대로 남은 것도 잡는다");
// 지난 날짜로 새 예정을 잡는 것은 API가 400으로 막는다(그게 맞다). 실사용에서 이 상태는
// **오늘이었던 예정이 그냥 지나가며** 생긴다 — 원장에 직접 그 모양을 만든다.
// ⚠️ 날짜는 전부 `D` 상대다(함정 12). id도 `D-40`에서 뽑아 고정 날짜를 안 남긴다.
const t47Task = (n: number, title: string) => {
  const id = `${addDays(D, -40).replace(/-/g, "")}-${String(900 + n).padStart(3, "0")}`;
  raw.prepare("INSERT INTO tasks (id, title, wait_anchor_at, created_at) VALUES (?, ?, ?, ?)")
    .run(id, title, t0.now, t0.now);
  return id;
};
const t47Entry = (id: string, date: string) =>
  raw.prepare("INSERT INTO schedule_entries (task_id, date, created_at) VALUES (?, ?, ?)")
    .run(id, date, t0.now);
// ⚠️ **마감된 날엔 예정을 추가하는 것조차 트리거가 막는다**(실측 — 함정 6의 '일정은 추가만'은
//    `events` 얘기다). 어느 과거 날이 마감돼 있는지는 위 시나리오가 늘 때마다 달라지므로
//    **고정 오프셋을 박지 않고 원장에 묻는다** — 박아 두면 절이 하나 늘 때 조용히 폭발한다.
const t47Open = [...Array(20).keys()].map((i) => addDays(D, -(i + 4)))
  .find((d) => (raw.prepare("SELECT status FROM daily WHERE date = ?").get(d) as any)?.status !== "closed");
ok("픽스처 — 마감되지 않은 과거 날을 찾았다 (지난 예정을 둘 자리)", !!t47Open, String(t47Open));

const t47Past = t47Task(1, "지난 예정 그대로 — 미룬 적 없다");   // 실측된 그 사건(20260817-001)
t47Entry(t47Past, t47Open!);
// 경계(`latest_date = D`)는 **오늘 예정이 있는, 실사용에서 가장 흔한 상태**다.
// 그런데 smoke는 [4]에서 오늘을 이미 마감했고 마감된 날엔 INSERT가 막힌다 —
// 열린 앞날에 넣고 날짜만 오늘로 옮긴다(UPDATE 동결 트리거는 `OLD.date`를 보므로
// 열린 날에서 출발하면 통과한다). **경계를 포기하면 `<`를 `<=`로 바꾸는 변이가 안 잡히고,
// 그러면 오늘 할 일이 전부 '이월 중'이 된다.**
const t47Today = t47Task(2, "오늘 예정만");                       // 경계: latest_date = D
t47Entry(t47Today, addDays(D, 6));
raw.prepare("UPDATE schedule_entries SET date = ? WHERE task_id = ?").run(D, t47Today);
const t47Fut = t47Task(3, "앞날 예정만");
t47Entry(t47Fut, addDays(D, 4));
const t47Fin = t47Task(4, "지난 예정 + 완료");
t47Entry(t47Fin, t47Open!);
await api("POST", `/api/tasks/${t47Fin}/complete`);
// ⚠️ **취소를 먼저 하고 항목을 넣는다.** 반대로 하면 취소가 열린 날의 예정을 지워
//    `latest_date`가 NULL이 되고, 그러면 이 픽스처는 **state 조건이 죽어도 통과한다**
//    (조건을 지키지 못하는 검사). 마감된 날에 넣는 우회는 트리거가 막는다 —
//    'schedule_entries는 마감된 날에 추가도 안 된다'가 실측이다.
const t47Can = t47Task(5, "지난 예정 + 취소");
await api("POST", `/api/tasks/${t47Can}/cancel`);
t47Entry(t47Can, t47Open!);

const t47List = (await api("GET", "/api/works/deferring")).json as Array<{
  id: string; defer_count: number; first_date: string; latest_date: string;
}>;
const t47Has = (id: string) => t47List.some((x) => x.id === id);
const t47Row = t47List.find((x) => x.id === t47Past);

// ① 실제로 놓쳤던 것 — 다섯 섹션 어디에도 없어서 Today의 '미루기'가 유일한 문이었다.
ok("① 지난 예정 + 미완 + 이월 0인 task가 '이월 중'에 나온다",
  !!t47Row && t47Row.defer_count === 0, JSON.stringify(t47Row ?? t47List.map((x) => x.id)));
// first_date는 그대로다 — 화면이 "8월 17일의 그 일"로 읽히는 근거가 그 값이다.
ok("① 첫 예정일이 그대로 실린다 (화면이 '언제의 일'인지 말할 수 있다)",
  t47Row?.first_date === t47Open, `${t47Row?.first_date} vs ${t47Open}`);
// ★ ①의 짝. 조건이 다 삼켰으면 '이월 중'이 곧 '모든 미완'이 된다 — 그러면 세그먼트가 뜻을 잃는다.
ok("★② 오늘·앞으로의 예정만 있는 task는 '이월 중'에 없다 (조건이 다 삼키지 않았다)",
  !t47Has(t47Today) && !t47Has(t47Fut),
  `today=${t47Has(t47Today)} fut=${t47Has(t47Fut)}`);
// ③ state 조건이 살아 있나 — 끝난 일은 지난 예정을 남겨도 '이월 중'이 아니다.
ok("③ 완료·취소된 task는 지난 예정이 있어도 '이월 중'에 없다",
  !t47Has(t47Fin) && !t47Has(t47Can), `fin=${t47Has(t47Fin)} can=${t47Has(t47Can)}`);
// ★ ①의 두 번째 짝 — **첫 변이(`defer_count > 0` 제거)를 죽이는 자리다.**
//   미룬 것은 앞날 예정이라 `latest_date < D`가 안 잡는다. 조건 한쪽만 남으면 여기가 빨간불이 된다.
//   tC는 [3]에서 D → D+2로 미뤘다(defer_count 1 · latest_date = D+2).
ok("★ 미룬 일은 도착지가 앞날이어도 '이월 중'에 남는다 (조건의 두 갈래가 둘 다 산다)",
  t47Has(tC) && t47List.find((x) => x.id === tC)!.defer_count === 1
  && t47List.find((x) => x.id === tC)!.latest_date > D,
  JSON.stringify(t47List.find((x) => x.id === tC)));

// ── T-52 · 폰 캘린더 미러 (0020 · ADR-029) ──────────────────────
// **창을 통째로 보내면 서버가 그 상태에 맞춘다.** 화면 변화는 없다 — 그건 T-53이다.
console.log("\n[T-52] /api/cal/sync — 멱등 upsert · 마감 이탈 · 삭제의 경계");

// 창은 **D(마감된 날)를 포함한다** — ③의 자리가 창 안에 있어야 검사가 성립한다.
const CW_TO = addDays(D, 10);
// ⚠️ **LWW 기준 시각도 상대로 잡는다**(함정 12). 고정 문자열을 쓰면 스캐너가 잡고,
//    잡는 것이 맞다 — *"언젠가 반드시 현재가 된다"* 는 규칙에 예외를 두기 시작하면
//    다음 사람이 그 예외를 근거로 진짜 위험한 고정 날짜를 넣는다.
const CU_NEW = `${D}T01:00:00Z`;              // 지금 버전
const CU_OLD = `${addDays(D, -30)}T00:00:00Z`; // 30일 전 — 무시돼야 하는 구갱신
const calItem = (uid: string, date: string, extra: Record<string, unknown> = {}) =>
  ({ ext_uid: uid, title: `캘린더 ${uid}`, date, ext_updated: CU_NEW, ...extra });
const calSync = (items: unknown[]) =>
  api("POST", "/api/cal/sync", { items, window: { from: D, to: CW_TO } });
const calRows = () => raw.prepare(
  "SELECT id, ext_uid, date, title, time, ext_updated, protect_from FROM events WHERE ext_src='devcal' ORDER BY ext_uid").all() as any[];
const calCount = () => calRows().length;

// ① 멱등 — 같은 것을 두 번 보내면 한 행이다.
const calBase = [
  calItem("ev-1", N1, { time: "10:00" }),
  calItem("ev-2", N2, { all_day: true }),
];
const cal1 = await calSync(calBase);
const calAfter1 = calCount();
const cal2 = await calSync(calBase);
ok("① 같은 것을 두 번 보내면 한 행이다 (멱등)",
  cal1.status === 200 && cal1.json.upserted === 2 && calAfter1 === 2
  && cal2.json.upserted === 2 && calCount() === 2,
  `1차 ${JSON.stringify(cal1.json)} / 2차 ${JSON.stringify(cal2.json)} / 행 ${calCount()}`);

// ② ★ 마감된 날은 동기화에서 영구 이탈한다. `events`엔 `_ins` 트리거가 없어(함정 6)
//    **DB가 안 막아 준다 — 서버가 먼저 판단해서 건너뛴다.**
// ⚠️ **②는 행위, ③은 보고다.** 둘을 한 검사에 두면 *"안 넣었는데 안 세는"* 구현과
//    *"세는데 넣어 버린"* 구현이 **같은 한 줄을 죽여** 어느 결함인지 못 읽는다.
//    그래서 ②는 **행 수만** 보고, ③은 **응답이 실제와 맞는가**만 본다(수가 0이어도 성립한다).
const calClosed = await calSync([...calBase, calItem("ev-closed-a", D), calItem("ev-closed-b", D)]);
const calOnClosed = calRows().filter((r) => r.date === D).length;
ok("② ★ 마감된 날의 항목이 실제로 안 들어간다 (DB가 아니라 서버가 막는다)",
  calOnClosed === 0 && calClosed.json.upserted === 2 && calCount() === 2,
  `마감일행=${calOnClosed} upserted=${calClosed.json.upserted} 전체=${calCount()}`);

// ③ ★ ②의 짝 — **조용하지 않은가.** 건너뛴 수가 응답에 그대로 있어야 한다.
//    ②만 보면 *"조용히 건너뛰는 구현"*이 통과하고, 그러면 동기화가 절반만 도는 밤에 아무도 모른다.
//    ★ **보낸 것 중 마감된 날이면서 실제로 안 들어간 수**와 응답을 맞춘다 —
//      마감 판정 자체가 사라지면 양쪽이 0으로 함께 내려가 이 검사는 성립한 채 ②만 죽는다.
const calClosedAbsent = 2 - calOnClosed;
ok("③ ★ 응답의 skipped_closed 가 실제로 빠진 수와 맞는다 (건너뛰기가 조용하지 않다)",
  calClosed.json.skipped_closed === calClosedAbsent,
  `응답=${calClosed.json.skipped_closed} 실제로빠진수=${calClosedAbsent}`);

// ④ LWW — 저장된 것보다 **오래된** 갱신은 무시한다.
const calStale = await calSync([
  { ...calItem("ev-1", N1, { time: "10:00" }), title: "옛 제목", ext_updated: CU_OLD },
  calItem("ev-2", N2, { all_day: true }),
]);
const calE1 = calRows().find((r) => r.ext_uid === "ev-1");
ok("④ 구갱신(ext_updated 가 옛것)은 무시되고 skipped_stale 이 센다",
  calStale.json.skipped_stale === 1 && calE1?.title === "캘린더 ev-1",
  `${JSON.stringify(calStale.json)} title=${calE1?.title}`);

// ⑧ 반복은 **인스턴스 단위**다. 마스터 1건으로 키잉하면 개강 후 수업이 통째로 한 행이 된다.
// ⚠️ **삭제 경로보다 앞에 둔다.** 뒤에 두면 ④·⑥을 깨뜨리는 변이가 그 왕복까지 함께 실패시켜
//    ⑧이 딸려 죽는다 — 어느 결함이 무엇을 죽였는지 못 읽는다(T-47이 ⑦을 둘로 가른 자리).
// ⚠️ **ev-2를 함께 보낸다.** 빼면 이 동기화의 삭제 단계가 ev-2를 지워, 아래 ⑥이 쓸 자리가 사라진다.
const calRep = await calSync([
  calItem("ev-1", N1, { time: "10:00" }),
  calItem("ev-2", N2, { all_day: true }),
  { ...calItem("77:" + N1, N1, { time: "09:00" }), title: "주간 수업" },
  { ...calItem("77:" + N2, N2, { time: "09:00" }), title: "주간 수업" },
  { ...calItem("77:" + N3, N3, { time: "09:00" }), title: "주간 수업" },
]);
const calRepRows = calRows().filter((r) => r.ext_uid.startsWith("77:"));
ok("⑧ 반복 인스턴스가 '<id>:<날짜>' 로 개별 행이 된다",
  calRep.status === 200 && calRepRows.length === 3
  && new Set(calRepRows.map((r) => r.date)).size === 3,
  `${JSON.stringify(calRepRows.map((r) => `${r.ext_uid}@${r.date}`))}`);

// ⑦ ★ **가장 위험한 자리** — 앱이 만든 일정은 창 안이어도 안 지워진다.
//    ⑤보다 먼저 만들어 둔다: 같은 동기화에서 하나는 지워지고 하나는 남아야 짝이 성립한다.
const calMine = (await api("POST", "/api/events", { title: "내가 만든 일정", date: N1, time: "15:00" })).json.id as string;

// ⑥ 준비 — 개입 이력이 참조하는 미러. 보호까지 붙여 둔다.
const calGuardEv = calRows().find((r) => r.ext_uid === "ev-2")!;
await api("PUT", `/api/events/${calGuardEv.id}/protect`, { protect_from: "-1d 00:00", protect_level: 4 });
await api("POST", "/api/guard/events", {
  cause: "protect:deadline", level: 3, client_id: "t52-ref", event_id: calGuardEv.id,
});

// ⑤ 창 안에서 **안 온** 미러는 지워진다. 이번엔 ev-1만 보낸다.
const calDel = await calSync([calItem("ev-1", N1, { time: "10:00" })]);
const calNow = calRows();
ok("⑤ 창 안에서 안 온 devcal 일정은 지워진다",
  calNow.some((r) => r.ext_uid === "ev-1"), `남은 것 ${JSON.stringify(calNow.map((r) => r.ext_uid))}`);

// ⑥ ★ guard 이력이 참조하면 **안 지우고 protect 만 푼다**(개입 이력은 영구 보존이고 FK가 걸려 있다).
// ⚠️ 여기서 `deleted === 0`을 세지 않는다 — 그러면 **삭제 범위가 넓어지는 결함**(⑦의 것)이
//    이 검사까지 함께 죽여, 어느 경계가 무너졌는지 못 읽는다. 이 검사가 지는 것은
//    *"참조되는 것이 살아남고 보호만 풀렸는가"* 하나다.
const calKept = calNow.find((r) => r.ext_uid === "ev-2");
ok("⑥ ★ guard 이력이 참조하면 안 지우고 protect 만 푼다",
  calDel.json.protected_kept === 1 && !!calKept && calKept.protect_from === null,
  `${JSON.stringify(calDel.json)} kept=${JSON.stringify(calKept)}`);

// ⑦ ★ ⑤의 짝 — **앱이 만든 일정은 창 안이어도 안 지워진다.**
//    ⑤만 보면 *"창 안의 것을 전부 지우는 구현"*이 통과하고, 그건 동기화가 사용자의 것을
//    삭제하는 모양이다. 방벽은 `if`가 아니라 **후보를 고르는 SQL**(`ext_src = 'devcal'`)이다.
const calMineRow = raw.prepare("SELECT id, ext_src FROM events WHERE id=?").get(calMine) as any;
ok("⑦ ★ ext_src IS NULL 인 일정은 창 안이어도 안 지워진다 (동기화가 사용자의 것을 안 건드린다)",
  !!calMineRow && calMineRow.ext_src === null,
  `행=${JSON.stringify(calMineRow)}`);

// ── 시간표 (T-58 · ADR-045) — 규칙을 저장하고 날짜는 전개한다 ──
console.log("\n[T-58] 시간표 — 규칙만 저장 · 전개는 조회 시");

// ⚠️ **고정 날짜를 쓰지 않는다**(함정 12). 학기 범위도 오늘에서 상대로 잡는다 —
//    박아 두면 언젠가 반드시 현재가 되고, 그날 이 검사 전부가 뜻 없이 빨간불이 된다.
const ttTermStart = addDays(D, -60), ttTermEnd = addDays(D, 60);
const ttText = [
  "월요일 10시-13시 전자기및연습1, 14시-16시 역학및연습2",
  "화요일 공강",
  "수요일 10시-13시 양자물리및연습2, 14시-17시 수리물리1",
  "목요일 10시-12시 전자기및연습1, 14시-17시 역학및연습2",
  "금요일 10시-12시 양자물리및연습2, 14시-17시 인간과인공지능",
].join("\n");

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const ttLen = (rs: any[], w: number) => {
  const r = rs.find((x) => x.subject === "전자기및연습1" && x.weekday === w);
  return r ? mins(r.end_time) - mins(r.start_time) : null;
};

const ttParsed = await api("POST", "/api/timetable/parse", { text: ttText });
const ttSubjects = new Set((ttParsed.json?.rules ?? []).map((r: any) => r.subject));
ok("1 붙여넣은 텍스트가 규칙으로 파싱된다 (8칸 · 5과목 · 화요일 0 · 길이 보존)",
  ttParsed.status === 200 && ttParsed.json.rules.length === 8 && ttSubjects.size === 5
  && ttParsed.json.rules.filter((r: any) => r.weekday === 2).length === 0
  && ttParsed.json.unread.length === 0
  && ttLen(ttParsed.json.rules, 1) === 180 && ttLen(ttParsed.json.rules, 4) === 120,
  `${ttParsed.status} 칸=${ttParsed.json?.rules?.length} 과목=${ttSubjects.size}`
  + ` 화=${ttParsed.json?.rules?.filter((r: any) => r.weekday === 2).length}`
  + ` 월=${ttLen(ttParsed.json?.rules ?? [], 1)} 목=${ttLen(ttParsed.json?.rules ?? [], 4)}`
  + ` 못읽음=${JSON.stringify(ttParsed.json?.unread)}`);

/* ⚠️ 아래 검사들은 **파서 출력을 쓰지 않는다.** 저장으로 오는 것은 파서가 아니라
 *   *확인 화면이 고친 값*이고(ADR-045 ③), 그렇게 떼어 놔야 파서를 겨냥한 변이가
 *   저장·전개 검사까지 함께 죽이지 않는다 — T-56·T-57에서 겪은 그 자리다. */
const ttWant = [
  { subject: "전자기및연습1", weekday: 1, start_time: "10:00", end_time: "13:00" },
  { subject: "역학및연습2", weekday: 1, start_time: "14:00", end_time: "16:00" },
  { subject: "양자물리및연습2", weekday: 3, start_time: "10:00", end_time: "13:00" },
  { subject: "수리물리1", weekday: 3, start_time: "14:00", end_time: "17:00" },
  { subject: "전자기및연습1", weekday: 4, start_time: "10:00", end_time: "12:00" },
  { subject: "역학및연습2", weekday: 4, start_time: "14:00", end_time: "17:00" },
  { subject: "양자물리및연습2", weekday: 5, start_time: "10:00", end_time: "12:00" },
  { subject: "인간과인공지능", weekday: 5, start_time: "14:00", end_time: "17:00" },
];
const ttSaved = await api("PUT", "/api/timetable",
  { rules: ttWant, term_start: ttTermStart, term_end: ttTermEnd });

/* 4 ★ **없는 것을 세는 검사** — 규칙만 남고 인스턴스는 어디에도 안 생겼는가.
 *   창을 넓게 열어 전개시킨 **뒤에** 센다: 전개가 행을 만들면 여기서 늘어난다. */
const ttEventsBefore = (raw.prepare("SELECT COUNT(*) AS n FROM events").get() as any).n;
const ttWide = await api("GET", `/api/calendar?start=${addDays(D, -28)}&end=${addDays(D, 28)}`);
const ttRuleRows = (raw.prepare("SELECT COUNT(*) AS n FROM timetable_rules").get() as any).n;
const ttEventsAfter = (raw.prepare("SELECT COUNT(*) AS n FROM events").get() as any).n;
// ⚠️ **여기서 "전개가 일어났는가"를 같이 세지 않는다** — 그건 5의 몫이다. 겹쳐 세면
//    전개를 없앤 변이가 4까지 죽여 **4가 자기 몫(행이 안 생겼는가)을 못 센다.**
//    4만 보면 *"아무것도 전개 안 하는 구현"*이 통과하는 것은 맞고, 그래서 5가 짝으로 선다.
ok("4 ★ 규칙만 저장된다 — 전개해도 인스턴스 행이 안 생긴다 (없는 것을 세는 검사)",
  ttSaved.status === 200 && ttRuleRows === 8 && ttEventsAfter === ttEventsBefore,
  `규칙행=${ttRuleRows} events=${ttEventsBefore}→${ttEventsAfter} 전개=${ttWide.json?.classes?.length}`);

/* 5 ★ 4의 짝 — **전개가 실제로 일어나는가.** 4만 보면 *"아무것도 전개 안 하는 구현"*이 통과한다.
 *   한 주(월~일) 창에는 정확히 8칸이 있어야 하고, **각 인스턴스의 시각이 자기 규칙과 같아야** 한다. */
const ttMon = mondayOf(D);
const ttWeek = await api("GET", `/api/calendar?start=${ttMon}&end=${addDays(ttMon, 6)}`);
const ttRules = (await api("GET", "/api/timetable")).json.rules as any[];
const ttTimesMatch = (ttWeek.json?.classes ?? []).every((c: any) => {
  const r = ttRules.find((x) => x.id === c.rule_id);
  return !!r && r.start_time === c.start_time && r.end_time === c.end_time;
});
ok("5 ★ 규칙이 창 범위만큼 전개된다 — 한 주 8칸 · 시각이 규칙 그대로 (4의 짝)",
  ttWeek.status === 200 && ttWeek.json.classes.length === 8 && ttTimesMatch,
  `한주=${ttWeek.json?.classes?.length} 시각일치=${ttTimesMatch}`);

/* 6 ★ **이 티켓이 존재하는 이유.** 포털 그리드는 시작 칸만 그려 길이를 말하지 않는데,
 *   같은 과목이 요일마다 길이가 다르다. 같은 길이로 뭉개는 구현이 통과하면
 *   **시간표가 틀린 채 학기를 가고** Guard가 그 값으로 보호 일정을 건다. */
// ⚠️ **전개된 인스턴스로 세지 않는다** — 전개를 없앤 변이가 6까지 죽인다.
//    전개가 규칙의 시각을 그대로 싣는지는 **5의 `시각일치`가** 이미 센다. 여기는 저장된 규칙만 본다.
ok("6 같은 과목이 요일마다 다른 길이를 갖는다 (월 3시간 · 목 2시간)",
  ttLen(ttRules, 1) === 180 && ttLen(ttRules, 4) === 120,
  `규칙 월=${ttLen(ttRules, 1)} 목=${ttLen(ttRules, 4)}`);

// 7 학기 밖 — 방학에 수업이 뜨면 그 화면 전체가 못 믿을 것이 된다.
const ttOut = await api("GET", `/api/calendar?start=${addDays(ttTermEnd, 7)}&end=${addDays(ttTermEnd, 13)}`);
ok("7 학기 범위 밖 날짜에는 안 뜬다",
  ttOut.status === 200 && ttOut.json.classes.length === 0,
  `밖=${ttOut.json?.classes?.length}`);

/* 8 ★ **학기 범위가 입력에서 온다.** 코드에 박으면 다음 학기에 조용히 틀린 날짜로 전개된다.
 *   행동(범위 없이 보내면 거절)과 원문(서비스에 날짜 리터럴이 없다)을 **함께** 센다 —
 *   앞만 보면 기본값을 두고 검증만 남긴 구현이 통과한다. */
const ttNoTerm = await api("PUT", "/api/timetable", { rules: ttWant });
const ttSrc = readFileSync(join(here, "../src/services/timetable.ts"), "utf8");
const ttDateLiteral = /["'`]\d{4}-\d{2}-\d{2}["'`]|["'`]\d{2}-\d{2}["'`]/.test(ttSrc);
ok("8 ★ 학기 범위가 입력에서 온다 — 거절하고, 코드에 날짜가 없다 (스캐너)",
  ttNoTerm.status === 400 && !ttDateLiteral,
  `범위없음=${ttNoTerm.status} 날짜리터럴=${ttDateLiteral}`);

// ── Level 2가 밤마다 다른 말을 한다 (T-60 · ADR-047) ─────────
//
// L2의 조건은 *"화면이 N분 이상 켜져 있다"* 하나뿐이었고 **그 시각에 그것은 거의 언제나
// 참이라 여섯 밤(8/26~8/31)이 100% 무시됐다.** 위 §T-58이 저장해 둔 시간표가 여기서
// *"오늘 밤이 다른 밤과 어떻게 다른가"* 를 준다 — **그 전에는 원천에 없던 값이다.**
console.log("\n[T-60] Level 2가 밤마다 다른 말을 한다 — 아침 재료");

/** 로컬 'HH:MM'을 절대 시각으로. **서버와 같은 시계(`t0.offsetMin`)를 쓰되 식은 여기 것이다.** */
const wakeMs = (date: string, hm: string) => Date.parse(`${date}T${hm}:00Z`) - t0.offsetMin * 60_000;

const t60Sched = (await api("GET", "/api/guard/schedule")).json;
const t60Wake: any[] = t60Sched.wake ?? [];

/* 1 **재료가 시각과 제목을 싣는다.** 기대값은 구현에서 베끼지 않고 **다른 엔드포인트**
 *   (`/api/calendar`)가 준 그 창의 수업·일정에서 만든다 — 두 경로가 같은 말을 해야 한다.
 *   ⚠️ 창을 D+8~D+14로 잡는 이유: 오늘·내일은 실제 시계에 따라 이미 지난 칸이 섞이는데,
 *      `wake`는 **지난 것을 안 싣는다**(그것이 규칙이다). 창이 앞이면 검사가 시각에 의존한다. */
const t60From = addDays(D, 8), t60To = addDays(D, 14);
const t60Cal = (await api("GET", `/api/calendar?start=${t60From}&end=${t60To}`)).json;
const t60Want = new Map<string, { hm: string; title: string }>();
const t60Bid = (date: string, hm: string, title: string) => {
  const cur = t60Want.get(date);
  if (!cur || hm < cur.hm) t60Want.set(date, { hm, title });
};
for (const c of t60Cal.classes ?? []) t60Bid(c.date, c.start_time, c.subject);
for (const e of t60Cal.events ?? []) if (e.time) t60Bid(e.date, e.time, e.title);
const t60Got = new Map<string, any>(
  t60Wake.filter((w) => w.date >= t60From && w.date <= t60To).map((w) => [w.date, w]));
const t60Match = [...t60Want].every(([date, v]) => {
  const g = t60Got.get(date);
  return !!g && Date.parse(g.at) === wakeMs(date, v.hm) && g.title === v.title;
});
ok("1 아침 재료가 그 날 첫 약속의 시각과 제목을 싣는다 (캘린더와 같은 말을 한다)",
  t60Want.size > 0 && t60Match && t60Got.size === t60Want.size,
  `기대=${t60Want.size} 받음=${t60Got.size} 일치=${t60Match}`);

/* 2 ★ **1의 짝** — 수업도 일정도 없는 날은 재료에 없다. 화요일이 공강이고, 그 밤에 뜨는
 *   L2가 정확히 여섯 밤을 무시하게 만든 소음이다. **없는 것을 세지 않으면 "항상 뜬다"가
 *   그대로 통과한다.** */
const t60Empty = [...Array(7)].map((_, i) => addDays(t60From, i)).filter((d) => !t60Want.has(d));
ok("2 ★ 수업도 일정도 없는 날은 재료에 없다 (1의 짝 — 공강 밤은 말할 것이 없다)",
  t60Empty.length > 0 && t60Empty.every((d) => !t60Got.has(d)),
  `빈날=${t60Empty.length} 그중재료있음=${t60Empty.filter((d) => t60Got.has(d)).length}`);

/* 3 ★ **시각 없는 종일 일정은 아침이 아니다.** `protectAxis`는 종일을 `09:00`으로 읽는데
 *   (저쪽은 *보호할 시험*이라 그게 맞다) 같은 규칙을 여기 쓰면 **추석 전날 밤에 L2가 뜬다.**
 *   폰 캘린더가 실어 오는 것의 절반이 공휴일이라(9/4 실측: 8건 중 4건) 이 한 줄이 갈린다. */
const t60AllDay = addDays(D, 10);
await api("POST", "/api/events", { title: "종일-공휴일", date: t60AllDay });
const t60AfterAllDay = ((await api("GET", "/api/guard/schedule")).json.wake as any[])
  .find((w) => w.date === t60AllDay);
ok("3 ★ 시각 없는 종일 일정은 아침 재료가 아니다 (공휴일 밤에 안 뜬다)",
  t60Want.has(t60AllDay)
    ? !!t60AfterAllDay && t60AfterAllDay.title !== "종일-공휴일"
    : t60AfterAllDay === undefined,
  `그날기대=${JSON.stringify(t60Want.get(t60AllDay) ?? null)} 받음=${JSON.stringify(t60AfterAllDay ?? null)}`);

/* 4 ★ **없는 것을 세는 검사 · 3의 짝** — 아침 재료에 없는 일정이 예약 경로에는 그대로 선다.
 *   종일 시험은 위 3에서 `wake`에 안 실렸는데, **`fires`에는 Level 3이 있어야 한다.**
 *   L2를 고치다 L3까지 조건을 태우면 **시험 전날 밤에 Guard가 통째로 조용해진다** —
 *   그리고 그 밤이 하필 이 도구가 가장 필요한 밤이다.
 *   행동(그 일정의 `fires`)과 원문(알람 코드에 `wake`가 없다)을 **함께** 센다:
 *   앞만 보면 기기 쪽에서 조건을 태운 구현이 서버 검사를 그대로 통과한다. */
const ktWatch = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/GuardWatch.kt");
const ktSyncT60 = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/GuardSync.kt");
const ktAlarms = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/GuardAlarms.kt");
const ktRecv = ktCode("../android/app/src/main/java/dev/mond1424/personalos/guard/AlarmReceiver.kt");
const t60ProtId = (await api("POST", "/api/events",
  { title: "T-60 종일 시험", date: t60AllDay })).json.id;
await api("PUT", `/api/events/${t60ProtId}/protect`, { protect_from: "-1d 00:00", protect_level: 4 });
const t60Sched2 = (await api("GET", "/api/guard/schedule")).json;
const t60Plan = (t60Sched2.events as any[]).find((e) => e.event_id === t60ProtId);
const t60WakeHas = (t60Sched2.wake as any[]).some((w) => w.title === "T-60 종일 시험");
/* ⚠️ **`/wake/i`로 세지 않는다** — `RTC_WAKEUP`·`setAlarmClock`의 낱말이 걸려 이 검사가
 *   *구현과 무관하게* 늘 빨간불이었다. 겨누는 것은 **아침 재료를 보는 이름 셋**이다. */
const T60_MORNING = /nextWake|WakeState|wakeLookahead/;
const t60AlarmClean = !T60_MORNING.test(ktAlarms) && !T60_MORNING.test(ktRecv);
ok("4 ★ 아침 재료에 없는 종일 시험도 예약 경로에는 선다 (3의 짝 · 알람 코드에 wake 없음)",
  !!t60Plan && (t60Plan.fires ?? []).some((f: any) => f.level >= 3)
  && !t60WakeHas && t60AlarmClean,
  `L3이상=${(t60Plan?.fires ?? []).filter((f: any) => f.level >= 3).length}`
  + ` wake에있음=${t60WakeHas} 알람깨끗=${t60AlarmClean}`);

/* 5 ★ **아침을 보는 것은 Level 2 하나다.** 4의 짝 — 저쪽이 *"알람 경로에 없다"* 를 보고
 *   이쪽이 *"감지 경로 안에서도 L2 가지에만 있다"* 를 본다. 게이트가 `level` 분기 밖으로
 *   나오면 감지 L3까지 함께 조용해진다. */
const t60GateInL2 = /if\s*\(level\s*==\s*2\)[\s\S]{0,400}?GuardSync\.nextWake/.test(ktWatch);
ok("5 ★ 아침을 보는 것은 Level 2 가지 하나다 (4의 짝 · 스캐너)",
  t60GateInL2, `L2가지안=${t60GateInL2}`);

/* 6 ★ **일정이 없는 밤만 침묵한다** (티켓 ②). 재료를 *"못 읽었다"* 와 *"낡았다"* 는 **띄운다** —
 *   막으면 시간표가 깨진 밤이 공강 밤과 같은 모양이 되고, 그건 이 리포가 T-54·T-55·T-57에서
 *   세 번 물린 그 자리다. **결함일 때 개입을 없애면 결함이 조용해진다.** */
const t60States = ["OK", "NONE", "NO_DATA", "STALE"]
  .every((s) => new RegExp(`WakeState\\.${s}\\b`).test(ktSyncT60));
const t60OnlyNoneBlocks = /val fire = w\.state != GuardSync\.WakeState\.NONE/.test(ktWatch);
ok("6 ★ 말할 것이 없는 밤만 침묵한다 — 못 읽었거나 낡았으면 띄운다 (이유가 넷으로 갈린다)",
  t60States && t60OnlyNoneBlocks,
  `상태넷=${t60States} NONE만막음=${t60OnlyNoneBlocks}`);

/* 7 ★ **모든 출구가 기록을 지난다** (티켓 ③ · T-54의 `noteTry`와 같은 모양). 6의 짝이다:
 *   저쪽이 *"무엇이 막는가"* 를 보고 이쪽이 *"막은 사실이 남는가"* 를 본다.
 *   ⚠️ **T-53이 물린 자리다** — `no_target`은 *"실패가 아니라서"* 아무 자국도 안 남겼고,
 *      몇 번을 돌아도 화면도 로그도 그 사실을 못 읽었다. 안 뜬 이유가 안 남으면
 *      **다음에 시간표가 깨져도 그냥 조용한 밤으로 보인다.** */
const t60NoteBeforeReturn = /noteL2Gate\(ctx, w, now, fire\)\s*\n\s*if \(!fire\) return false/.test(ktWatch);
ok("7 ★ 띄운 밤도 안 띄운 밤도 기록을 지난다 (6의 짝 — 조용한 밤과 깨진 밤이 갈린다)",
  t60NoteBeforeReturn, `기록이먼저=${t60NoteBeforeReturn}`);

/* 8 남은 시간은 **발동 시점에** 계산된다 — 서버가 미리 접어 보내면 새벽 3시의 문구가
 *   저녁 6시 기준으로 굳는다. 기기가 `at - now`를 그 자리에서 잰다. */
const t60Span = /w\.at - nowMs/.test(ktWatch) && /지금 자면/.test(ktWatch);
ok("8 남은 시간을 발동 시점에 잰다 (문구에 시각과 남은 시간이 함께 들어간다)",
  t60Span, `발동시점계산=${t60Span}`);

// ── ④ 무시가 쌓이면 끄는 선택지를 준다 (ADR-047 ③) ──────────
//
// ⚠️ **기존 발동 뒤에 세운다.** 최근 순으로 세는 값이라 앞에 끼면 남의 밤이 섞인다 —
//    날짜는 **DB가 가진 마지막 발동에서 상대로** 잡는다(고정 날짜 금지 · 함정 12).
const t60Last = (raw.prepare("SELECT MAX(fired_at) AS m FROM guard_events").get() as any).m as string;
const t60Night = addDays(t60Last.slice(0, 10), 2);
const t60Nag = async () => (await api("GET", "/api/guard/l2-nag")).json;
const t60Fire = async (hm: string, cid: string, reaction: string | null) =>
  api("POST", "/api/guard/events", {
    cause: "watch:bedtime", level: 2, client_id: cid,
    fired_at: `${t60Night}T${hm}:00+09:00`,
    ...(reaction ? { reaction, reacted_at: `${t60Night}T${hm}:30+09:00` } : {}),
  });

const t60Before = await t60Nag();
await t60Fire("22:00", "t60-i1", "ignored");
await t60Fire("22:10", "t60-i2", "ignored");
await t60Fire("22:20", "t60-i3", "ignored");
const t60Three = await t60Nag();
/* ⚠️ **`reaction IS NULL`은 세지도 끊지도 않는다.** `finalizeIgnored`의 유예가 36시간이라
 *   어젯밤 발동은 오늘 구조적으로 NULL이다 — NULL이 끊으면 이 값은 **영원히 0에 가깝고
 *   카드가 한 번도 안 뜬다.** 아직 안 올라온 반응을 '무시'로도 '응답'으로도 읽지 않는다. */
await t60Fire("22:30", "t60-null", null);
const t60WithNull = await t60Nag();
ok("9 연속 무시를 센다 — 아직 반응이 안 온 발동은 세지도 끊지도 않는다",
  t60Three.streak === t60Before.streak + 3 && t60WithNull.streak === t60Three.streak,
  `${t60Before.streak} → ${t60Three.streak} → NULL뒤 ${t60WithNull.streak}`);

// 임계는 **설정값이다** — 코드에 박지 않는다. 여기서는 지금 값 기준으로 양쪽을 다 만든다.
const t60SetThreshold = (n: number) => raw.prepare(
  "INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
).run("guard_l2_ignore_threshold", String(n));

t60SetThreshold(t60WithNull.streak);
const t60Over = await t60Nag();
t60SetThreshold(t60WithNull.streak + 1);
const t60Under = await t60Nag();
ok("10 ★ 임계를 넘으면 물어보고, 아래면 안 묻는다 (같은 연속에서 임계만 움직였다)",
  t60Over.over === true && t60Under.over === false,
  `넘음=${t60Over.over}(임계 ${t60Over.threshold}) 아래=${t60Under.over}(임계 ${t60Under.threshold})`);

/* 10 ★ *"그대로"* 도 기록을 지난다 — 안 지나면 **같은 숫자로 매번 다시 묻고**, 그 카드가
 *    없애려던 잔소리와 같은 모양이 된다. ack 뒤에는 연속이 더 쌓여야 다시 묻는다. */
t60SetThreshold(t60WithNull.streak);
await api("POST", "/api/guard/l2-nag/ack");
const t60Acked = await t60Nag();
await t60Fire("22:40", "t60-i4", "ignored");
const t60Again = await t60Nag();
ok("11 ★ 한 번 답하면 같은 숫자로 다시 묻지 않는다 — 더 쌓이면 다시 묻는다",
  t60Acked.over === false && t60Again.over === true,
  `ack직후=${t60Acked.over}(연속 ${t60Acked.streak}/ack ${t60Acked.ack}) 한번더=${t60Again.over}`);

/* 12 ★ **한 번이라도 응답하면 연속이 끊긴다** (9의 짝). 이것이 없으면 *"무시를 안 세고
 *    발동 수만 세는 구현"*이 통과하고, 그러면 **매일 응답하는 사람에게도 끄기 카드가 뜬다.** */
await t60Fire("22:50", "t60-acc", "accepted");
const t60Reset = await t60Nag();
ok("12 ★ 한 번이라도 응답하면 연속이 0이 된다 (9의 짝)",
  t60Reset.streak === 0 && t60Reset.over === false,
  `연속=${t60Reset.streak} 물음=${t60Reset.over}`);

/* 13 ★ **무시 횟수는 파생이다 — 세는 것이지 저장하는 것이 아니다**(원칙 1 · `later_fires`와
 *    같은 모양). 저장하면 그 순간 append-only 트리거와 닫힌 `CHECK`를 상대해야 하는데
 *    얻는 것이 없다.
 *    ⚠️ **컬럼만 세지 않는다.** 이 리포에서 파생을 물화하는 더 싼 유혹은 컬럼이 아니라
 *       `settings`에 접어 두는 것이다 — 스캐너만 두면 그 구현이 그대로 통과한다.
 *       그래서 **조회가 아무것도 안 쓴다는 것**을 함께 센다(ack는 사용자의 결정이라 별개다). */
const t60Cols = (raw.prepare("SELECT * FROM pragma_table_info('guard_events')").all() as any[])
  .map((c) => String(c.name));
const t60NoCol = !t60Cols.some((c) => /ignore|streak|nag/i.test(c));
/* ⚠️ **값이 바뀌는 순간에 재야 한다.** 그냥 두 번 불러 비교하면 물화한 구현도 두 번째에
 *    같은 값을 쓰므로 **차이가 안 난다** — 실제로 그렇게 짰다가 이 변이를 놓쳤다.
 *    그래서 **연속을 한 칸 올려 놓고** 그 다음 조회가 무엇을 쓰는지 본다. */
const t60Dump = () => JSON.stringify(raw.prepare("SELECT key, value FROM settings ORDER BY key").all());
await t60Fire("23:00", "t60-pure", "ignored");   // 연속 0 → 1. 저장하는 구현이면 여기서 갈린다
const t60SetBefore = t60Dump();
const t60PureRead = await t60Nag();
const t60Pure = t60SetBefore === t60Dump();
ok("13 ★ 세기만 하고 저장하지 않는다 — 컬럼도 없고 조회가 아무것도 안 쓴다 (원칙 1)",
  t60NoCol && t60Pure && t60PureRead.streak === 1,
  `컬럼=${t60Cols.filter((c) => /ignore|streak|nag/i.test(c))} 조회순수=${t60Pure}`
  + ` 연속=${t60PureRead.streak}`);

// ── 결과 ─────────────────────────────────────────────────────
console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
console.log("전부 통과 — Worker는 스키마·설계 규칙과 정합.");
