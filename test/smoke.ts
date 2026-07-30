/* Personal OS · Worker 스모크 테스트
 * HTTP 계층(Hono)까지 통째로 태운다 — 라우팅·검증·트리거 에러 번역 전부.
 * 시나리오는 목업의 플로우: 생성 → 기록 → 미루기 → 마감 → memo →
 * 재배정 → 자동 마감(Cron 경로) → 대기 연장.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../src/index";
import { autoClose } from "../src/scheduled";
import { attributionDate, isoNow, addDays, mondayOf, diffDays, loadTime } from "../src/lib/time";
import type { Env } from "../src/types";
import { makeD1, rawOf } from "./d1shim";

const here = dirname(fileURLToPath(import.meta.url));
const schema = ["0001_init.sql", "0002_models.sql", "0003_ai_provider.sql", "0004_events.sql", "0005_delete_scope.sql", "0006_fix_model_high.sql", "0007_defer_reason.sql", "0008_cancel_task.sql", "0009_cancel_reason.sql", "0010_guard.sql", "0011_guard_sync.sql", "0012_life_model.sql", "0013_analysis_backfill.sql", "0014_schema_titles.sql"]
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
const gEv = (await api("POST", "/api/events", { title: "정보처리기사 실기", date: "2026-08-15", time: "09:00" })).json.id as string;
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
await api("PUT", "/api/guard/modes/active", { key: "secretary" });
const sec = (await api("GET", "/api/guard/schedule")).json;
const secPlan = (sec.events as any[]).find((e) => e.event_id === gEv);
ok("secretary 모드는 Level 2로 상한 — L3·L4 발동 없음",
  !!secPlan && secPlan.max_level === 2 && secPlan.fires.every((f: any) => f.level <= 2));
ok("없는 모드 404", (await api("PUT", "/api/guard/modes/active", { key: "없음" })).status === 404);
await api("PUT", "/api/guard/modes/active", { key: "coach" });

// (4) 발동 기록 — 기기가 밀어 올린다
const gRec = await api("POST", "/api/guard/events", {
  cause: "protect:sleep-deadline", level: 3, event_id: gEv,
  fired_at: "2026-08-15T01:30:00+09:00", foreground_app: "com.android.chrome",
  risk_score: 62, risk_snapshot: { hour: 1.5, sleepEst: 3.2, logsLastHour: 4 },
});
ok("발동 기록 201", gRec.status === 201);
const gId = gRec.json.id as string;
ok("귀속일이 기기 시각 기준 (01:30 → 전날 08-14)", gRec.json.on_date === "2026-08-14", gRec.json.on_date);
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
const cidBody = { cause: "protect:test", level: 3, client_id: "dev-uuid-1", fired_at: "2026-08-15T02:00:00+09:00" };
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
  fired_at: "2026-08-15T05:00:00Z", reaction: "accepted", reacted_at: "2026-08-15T05:00:30Z",
});
ok("UTC 발동이 올바른 날에 귀속 (KST 14:00 → 당일)", utcFire.json.on_date === "2026-08-15", utcFire.json.on_date);
const utcRow = ((await api("GET", "/api/guard/events")).json as any[]).find((r) => r.client_id === "dev-uuid-utc");
ok("fired_at·reacted_at이 로컬 오프셋 표기로 저장",
  !!utcRow && utcRow.fired_at === "2026-08-15T14:00:00+09:00" && utcRow.reacted_at === "2026-08-15T14:00:30+09:00",
  `${utcRow?.fired_at} / ${utcRow?.reacted_at}`);

// (7.6) 반응 없는 발동의 'ignored' 확정 (ADR-025 — 루프의 닫는 쪽)
// 유예 36시간: 기기가 오프라인이면 발동과 반응을 함께 늦게 올린다. 먼저 박으면 진짜 반응이 막힌다.
const oldFire = await api("POST", "/api/guard/events", {
  cause: "watch:bedtime", level: 2, client_id: "dev-uuid-old",
  fired_at: "2026-06-01T02:00:00+09:00",
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

// ── 결과 ─────────────────────────────────────────────────────
console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
console.log("전부 통과 — Worker는 스키마·설계 규칙과 정합.");
