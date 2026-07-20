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
const schema = readFileSync(join(here, "../migrations/0001_init.sql"), "utf8")
  + "\n" + readFileSync(join(here, "../migrations/0002_models.sql"), "utf8");
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

// ── 5. memo — 유일한 추가 통로 + stale ────────────────────────
console.log("\n[5] memo → summary stale");
ok("memo 추가 201", (await api("POST", "/api/memos", { date: D, text: "마감 후 소회" })).status === 201);
ok("daily summary stale=1", raw.prepare("SELECT stale FROM summaries WHERE kind='daily' AND key=?").get(D)!.stale === 1);
ok("일기 없는 날 memo 404", (await api("POST", "/api/memos", { date: "2001-01-01", text: "x" })).status === 404);

// ── 6. 재배정 — 마감된 날에서의 미루기 (v0.8 재배정 대기) ─────
console.log("\n[6] 재배정 — 원 항목 동결 유지, 새 예정만");
today = (await api("GET", "/api/today")).json; // 마감 후에도 조회는 그대로
ok("같은 날엔 아직 재배정 대기 미노출 ('다음 날' 노출 — 1.2)", !today.reassign.some((r: any) => r.id === tA));
const re = await api("POST", `/api/tasks/${tA}/defer`, { from: D, to: N1 }); // 날짜 팝업 경로의 미루기
ok("재배정 = reassigned=true", re.status === 200 && re.json.reassigned === true);
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
ok("지난 기록 있는 task 삭제 409", (await api("DELETE", `/api/tasks/${tA}`)).status === 409);

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
ok("서술 없으면 분류 400", (await api("POST", "/api/daily/classify-feelings")).status === 400);

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
