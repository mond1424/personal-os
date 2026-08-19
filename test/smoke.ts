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
import { attributionDate, isoNow, addDays, mondayOf, diffDays, loadTime } from "../src/lib/time";
import { buildCoreContext } from "../src/lib/context";
import type { Env } from "../src/types";
import { makeD1, rawOf } from "./d1shim";

const here = dirname(fileURLToPath(import.meta.url));
const schema = ["0001_init.sql", "0002_models.sql", "0003_ai_provider.sql", "0004_events.sql", "0005_delete_scope.sql", "0006_fix_model_high.sql", "0007_defer_reason.sql", "0008_cancel_task.sql", "0009_cancel_reason.sql", "0010_guard.sql", "0011_guard_sync.sql", "0012_life_model.sql", "0013_analysis_backfill.sql", "0014_schema_titles.sql", "0015_me_history_reason.sql", "0016_guard_unavailable_reason.sql", "0017_ai_reason.sql"]
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

ok("Log 추가 201", (await api("POST", "/api/logs", { text: "곡선 통일 결정." })).status === 201);
ok("빈 Log 400", (await api("POST", "/api/logs", { text: "  " })).status === 400);
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

// ── 결과 ─────────────────────────────────────────────────────
console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
console.log("전부 통과 — Worker는 스키마·설계 규칙과 정합.");
