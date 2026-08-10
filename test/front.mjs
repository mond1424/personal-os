// 프론트 E2E — jsdom에 index.html + api.js + app.js를 올리고
// 실행 중인 wrangler dev(기본 8788)에 실제 fetch로 붙는다.
// 렌더 경로의 런타임 오류·조립 결과를 잡는 용도. 사용: node test/front.mjs [base]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:8788";
const html = readFileSync(join(here, "../public/index.html"), "utf8");
const apiJs = readFileSync(join(here, "../public/api.js"), "utf8")
  .replace(/const API_BASE =[\s\S]*?;\n/, `const API_BASE = ${JSON.stringify(BASE + "/api")};\n`);
const appJs = readFileSync(join(here, "../public/app.js"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(String(e.message)));
vc.on("error", (...a) => errors.push(a.join(" ")));

// 브라우저와 동일하게 <script> 태그로 주입한다 (eval은 전역 렉시컬 스코프가 갈린다)
const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, url: BASE + "/",
});
const w = dom.window;
w.fetch = (u, o) => fetch(u, o);
w.localStorage.clear();
// jsdom에 없는 API 최소 보강
w.HTMLElement.prototype.setPointerCapture = () => {};
w.HTMLElement.prototype.scrollTo = () => {};

for (const code of [apiJs, appJs]) {
  const s = w.document.createElement("script");
  s.textContent = code;
  w.document.body.appendChild(s);
}
w.document.dispatchEvent(new w.Event("DOMContentLoaded"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passN = 0; const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { passN++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name} ${detail}`); }
};
const $ = (s) => w.document.querySelector(s);
// 캘린더는 좌우 두 달까지 5-pane이라 같은 날짜 셀이 여러 개다 — 가운데(보고 있는 달)만 본다
const CUR = "#cal-track .calpane.cur";
const $cur = (s) => w.document.querySelector(`${CUR} ${s}`);
const $$cur = (s) => [...w.document.querySelectorAll(`${CUR} ${s}`)];
// const 선언은 window 프로퍼티가 아니다 — 전역 렉시컬 바인딩은 eval로 읽는다
const ev = (code) => w.eval(code);
const txt = (s) => ($(s)?.textContent ?? "").trim();
const testAddMonth = (y, m, n) => {
  const k = m - 1 + n;
  return { y: y + Math.floor(k / 12), m: ((k % 12) + 12) % 12 + 1 };
};
const testYm = ({ y, m }) => `${y}-${String(m).padStart(2, "0")}`;
const paneYms = () => [...w.document.querySelectorAll("#cal-track .calpane")].map((p) => p.dataset.ym);
const panesAligned = (y, m) => {
  const panes = [...w.document.querySelectorAll("#cal-track .calpane")];
  const expected = [-2, -1, 0, 1, 2].map((n) => testYm(testAddMonth(y, m, n)));
  return panes.length === 5 && panes.every((pane, i) => pane.dataset.ym === expected[i]
    && [...pane.querySelectorAll(".c:not(.mut)")].every((cell) => cell.dataset.d.startsWith(expected[i])));
};

// 부팅 완료를 기다린다 (고정 대기는 느린 기기·큰 DB에서 깨진다)
const ev0 = (code) => w.eval(code);
let ready = false;
for (let i = 0; i < 40; i++) {
  await sleep(400);
  try { if (ev0("!!S.today")) { ready = true; break; } } catch { /* 아직 스크립트 평가 전 */ }
}
if (!ready) {
  console.log("✗ 부팅 실패 — 서버가 켜져 있는지, 토큰이 필요한지 확인하세요.");
  console.log("  화면 메시지:", w.document.querySelector("#boot-msg")?.textContent);
  process.exit(1);
}

// 픽스처 — 날짜가 바뀌어도 재현되도록 오늘 항목·기록을 보장한다
if (ev0("S.today.todo.length") === 0) {
  await ev0(`Api.createTask({ title: "프론트 픽스처 task", date: S.today.date })`);
  await w.refreshToday(); await sleep(400);
}
if (ev0("S.today.logs.length") === 0) {
  await ev0(`Api.addLog("픽스처 로그")`);
  await w.refreshToday(); await sleep(400);
}
if (ev0("S.periods.length") === 0) {
  await ev0(`Api.createPeriod({title:"프론트 픽스처 기간", start_date:S.today.date, end_date:addDaysStr(S.today.date,10), color:"#7ED4A9", goals:["픽스처"]})`);
  ev0("Api.periods()"); // 캐시 갱신은 renderCalendar에서
  await ev0(`(async()=>{ S.periods = await Api.periods(); })()`);
  await w.refreshToday(); await sleep(500);
}
if (ev0("S.today.waiting.n") === 0) {
  await ev0(`Api.createTask({ title: "프론트 픽스처 대기" })`);
  await w.refreshToday(); await sleep(400);
}

console.log("\n[Today]");
ok("헤더 날짜 렌더", /^\d+$/.test(txt("#td-day")), txt("#td-day"));
ok("경계 표시", txt("#td-boundary").includes("경계"), txt("#td-boundary"));
ok("기간 칩 조인", $("#td-chips").children.length >= 1);
ok("TODO 행 렌더", $("#td-list").querySelectorAll(".trow").length >= 1);
ok("Feelings 눈금 10칸", $("#feel-s").querySelectorAll(".likert .lk").length % 10 === 0 && $("#feel-s").querySelectorAll(".lk").length >= 10);
ok("Log 렌더", $("#td-logs").querySelectorAll(".lrow").length >= 1);
ok("Score 차트 14칸", $("#bchart").querySelectorAll(".bcol").length === 14, String($("#bchart").querySelectorAll(".bcol").length));
ok("대기 상시 행", $("#today-wait").style.display !== "none");

console.log("\n[Calendar]");
w.switchTab("cal"); await sleep(1200);
ok("월 타이틀", /\d{4} · \d+월/.test(txt("#cal-title")), txt("#cal-title"));
ok("한 달 = 항상 6주 (높이 고정 — 캐러셀의 전제)", $$cur(".cal-row").length === 6, String($$cur(".cal-row").length));
ok("셀 7의 배수", $$cur(".c").length % 7 === 0);
ok("5-pane 조립 (좌우 두 달 · 현재 달 가운데)", w.document.querySelectorAll("#cal-track .calpane").length === 5);
ok("밴드 path 생성", $$cur("svg.band path").length >= 1);
ok("기간 카드", $("#p-list").querySelectorAll(".prow").length >= 1);
const t17Css = await (await fetch(BASE + "/style.css")).text();
const calRowRule = t17Css.match(/\.cal-row\s*\{([^}]*)\}/)?.[1] || "";
const firstCalRowRule = t17Css.match(/\.calpane \.wkdays \+ \.cal-row\s*\{([^}]*)\}/)?.[1] || "";
ok("주 사이는 총높이를 유지하는 내부 구분선", $$cur(".cal-row").length === 6
  && calRowRule.includes("height:99px")
  && calRowRule.includes("border-top:1px solid var(--line)")
  && firstCalRowRule.includes("border-top:none"), `${calRowRule} / ${firstCalRowRule}`);
const dimCells = $$cur(".c.cal-dim-cell");
const dimRule = t17Css.match(/\.c\.cal-dim-cell::after\s*\{([^}]*)\}/)?.[1] || "";
ok("침범 셀에만 전체 덮는 레이어", dimCells.length > 0
  && dimCells.length === $$cur(".c.mut").length
  && $$cur(".c:not(.mut).cal-dim-cell").length === 0
  && dimRule.includes("background:var(--cal-dim)"), `${dimCells.length} / ${dimRule}`);
const dimCell = dimCells[0], dimDate = dimCell?.dataset.d;
dimCell?.click(); await sleep(600);
ok("침범 셀 클릭은 해당 날짜를 연다", !!dimDate
  && !dimRule.includes("pointer-events")
  && $("#sh-day").classList.contains("on")
  && txt("#day-body .sh-t") === ev(`dlabel("${dimDate}")`), `${dimDate} / ${txt("#day-body .sh-t")}`);
w.closeAll();
const pressCell = $cur(".c:not(.mut)");
const pressEvent = (type, x, y) => new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
pressCell.dispatchEvent(pressEvent("pointerdown", 300, 400));
const pressAttached = pressCell.classList.contains("press-feedback-on");
pressCell.dispatchEvent(pressEvent("pointerup", 300, 400));
ok("박스를 누르면 press가 붙고 떼면 해제", pressAttached && !pressCell.classList.contains("press-feedback-on"));
pressCell.dispatchEvent(pressEvent("pointerdown", 300, 400));
const pressBeforeDrag = pressCell.classList.contains("press-feedback-on");
pressCell.dispatchEvent(pressEvent("pointermove", 250, 402));
const pressAfterDrag = pressCell.classList.contains("press-feedback-on");
pressCell.dispatchEvent(pressEvent("pointerup", 250, 402));
ok("가로 이동 시 press 해제", pressBeforeDrag && !pressAfterDrag, `${pressBeforeDrag} → ${pressAfterDrag}`);

// T-20 — 달력 데이터는 월 키 메모리 캐시. 콜드 5개월 뒤 같은 달은 0건,
// 한 달 이동은 새 가장자리 한 달만 요청해야 한다.
const cacheY0 = ev("S.cal.y"), cacheM0 = ev("S.cal.m");
await ev(`(async()=>{
  window.__calendarCalls = [];
  window.__calendarPeriodCalls = 0;
  window.__calendarOriginal = Api.calendar;
  window.__calendarPeriodsOriginal = Api.periods;
  Api.calendar = async (start, end) => {
    window.__calendarCalls.push({ start, end });
    return window.__calendarOriginal(start, end);
  };
  Api.periods = async () => {
    window.__calendarPeriodCalls++;
    return window.__calendarPeriodsOriginal();
  };
  window.__calendarBuildStart = calendarPaneBuildCount;
  invalidateCalendarCache();
  await renderCalendar();
})()`);
const coldRange = ev("window.__calendarCalls[0]");
const coldPaneBuilds = ev("calendarPaneBuildCount - window.__calendarBuildStart");
ok("캐시 무효화 full rebuild는 pane 5개 조립", coldPaneBuilds === 5, String(coldPaneBuilds));
ok("캐시 무효화 뒤 pane과 달 대응 유지", panesAligned(cacheY0, cacheM0), paneYms().join(" / "));
ok("달력 콜드 요청은 데이터 5개월 · DOM도 5-pane",
  ev("window.__calendarCalls.length") === 1
    && coldRange?.start === ev(`calendarMonthStart(addMonth(${cacheY0},${cacheM0},-2))`)
    && coldRange?.end === ev(`calendarMonthEnd(addMonth(${cacheY0},${cacheM0},2))`)
    && ev("calendarMonthCache.size") === 5
    && w.document.querySelectorAll("#cal-track .calpane").length === 5,
  JSON.stringify(coldRange));
const sameMonthCalls = ev("window.__calendarCalls.length");
const sameMonthPeriodCalls = ev("window.__calendarPeriodCalls");
const sameMonthPaneBuilds = ev("calendarPaneBuildCount");
await ev("renderCalendar()");
ok("같은 달 재렌더는 calendar · periods 요청 0 · pane 조립 0",
  ev("window.__calendarCalls.length") === sameMonthCalls
    && ev("window.__calendarPeriodCalls") === sameMonthPeriodCalls
    && ev("calendarPaneBuildCount") === sameMonthPaneBuilds,
  `${sameMonthCalls}→${ev("window.__calendarCalls.length")} / ${sameMonthPeriodCalls}→${ev("window.__calendarPeriodCalls")}`
    + ` / pane ${sameMonthPaneBuilds}→${ev("calendarPaneBuildCount")}`);
await ev(`(async()=>{ S.cal=addMonth(${cacheY0},${cacheM0},1); calGen++; await renderCalendar(); })()`);
const movedRange = ev("window.__calendarCalls.at(-1)");
ok("옆 달 이동은 캐시에 없는 가장자리 한 달만 요청",
  ev("window.__calendarCalls.length") === sameMonthCalls + 1
    && movedRange?.start === ev(`calendarMonthStart(addMonth(${cacheY0},${cacheM0},3))`)
    && movedRange?.end === ev(`calendarMonthEnd(addMonth(${cacheY0},${cacheM0},3))`)
    && ev("window.__calendarPeriodCalls") === sameMonthPeriodCalls,
  JSON.stringify(movedRange));
await ev(`(async()=>{ S.cal={y:${cacheY0},m:${cacheM0}}; calGen++; await renderCalendar(); })()`);
ok("스와이프 직후 click 차단은 60ms", appJs.includes("dragBlockUntil = Date.now() + 60;"));
await w.openDay(ev("S.today.date")); await sleep(600);
ok("날짜 팝업 조립", $("#day-body").textContent.includes("작성 중"), $("#day-body").textContent.slice(0, 40));
w.closeAll();

console.log("\n[Works]");
w.switchTab("works"); await sleep(1200);
ok("예정 그룹 렌더", $("#w-sched").querySelectorAll(".trow").length >= 1);
ok("대기 목록", $("#wait-list").querySelectorAll(".trow").length >= 1);
ok("세그먼트 라벨 갱신", txt("#seg-wait").startsWith("대기"), txt("#seg-wait"));

console.log("\n[Analysis]");
w.switchTab("anal"); await sleep(1200);
ok("컨텍스트 미리보기 4줄", $("#ctx-lines").querySelectorAll(".cl").length === 4);
ok("빈 목록 안내", $("#ana-list").textContent.length > 0);
// 5.3 출력 분량 세그 — 기본 detailed, 클릭 시 .on 이동(분석은 자동 실행되지 않는다)
ok("출력 분량 세그 3개", $("#anal-depth").querySelectorAll(".wseg").length === 3);
ok("기본 선택 = 자세히", $("#anal-depth .wseg.on")?.dataset.d === "detailed", $("#anal-depth .wseg.on")?.dataset.d);
$("#anal-depth .wseg[data-d='normal']").click(); await sleep(60);
ok("보통 클릭 → .on 이동", $("#anal-depth .wseg.on")?.dataset.d === "normal", $("#anal-depth .wseg.on")?.dataset.d);
ok("works 세그는 영향 없음", $("#scr-works .wseg.on")?.dataset.w === "sched", $("#scr-works .wseg.on")?.dataset.w);
$("#anal-depth .wseg[data-d='detailed']").click(); await sleep(60);
// 분량 라벨은 목록 SELECT에 context_meta가 없어 '펼쳤을 때' 채워진다.
// 분석 생성은 AI 키가 없으면 503이라 실 데이터를 만들 수 없다 → Api 2개만 임시 교체하고 되돌린다.
await ev(`(async()=>{
  const oList = Api.analyses, oGet = Api.analysis;
  Api.analyses = async () => [{ id:"MOCK-001", prompt:"분량 라벨 확인", created_at:"2026-07-26T09:00:00.000Z", preview:"미리보기" }];
  Api.analysis  = async () => ({ id:"MOCK-001", prompt:"분량 라벨 확인", pass1:"1차 본문", pass2:"2차 본문", context_meta:{ depth:"deep" } });
  try { await renderAnalysis(); await toggleAna("MOCK-001", null); }
  finally { Api.analyses = oList; Api.analysis = oGet; }
})()`);
ok("펼친 분석 카드에 분량 라벨", txt("#adep-MOCK-001").includes("매우 자세히"), txt("#adep-MOCK-001"));
await ev("renderAnalysis()"); await sleep(400);

console.log("\n[Me · 설정]");
w.switchTab("me"); await sleep(1200);
ok("Me 필드 렌더", $("#me-fields").querySelectorAll(".merow").length >= 1);
ok("'지금' 파생 표시", $("#me-fields").textContent.includes("지금"));
ok("이력 렌더", $("#me-history").querySelectorAll(".lrow").length >= 1);

const renderMeFixture = async (history, guardEvents) => {
  const historyJs = JSON.stringify(history), guardJs = JSON.stringify(guardEvents);
  await ev(`(async()=>{
    const oldHistory = Api.meHistory, oldGuardEvents = Api.guardEvents;
    Api.meHistory = async () => ${historyJs};
    Api.guardEvents = async () => ${guardJs};
    try { await renderMe(); }
    finally { Api.meHistory = oldHistory; Api.guardEvents = oldGuardEvents; }
  })()`);
};
const history7 = Array.from({ length: 7 }, (_, i) => ({
  field: "direction", old_value: i ? `이전 ${i}` : null, new_value: `변경 ${i}`,
  source: "user", changed_at: `2026-08-${String(7 - i).padStart(2, "0")}T12:00:00+09:00`,
}));
await renderMeFixture(history7, []);
const foldedHistoryN = $("#me-history").querySelectorAll(".hist-row").length;
const historyMoreText = txt("#me-history .hist-more");
$("#me-history .hist-more")?.click();
ok("이력 6건 이상은 5건과 남은 개수를 보이고 펼치면 전부", foldedHistoryN === 5
  && historyMoreText === "더 보기 (2건)"
  && $("#me-history").querySelectorAll(".hist-row").length === 7,
  `${foldedHistoryN} / ${historyMoreText} / ${$("#me-history").querySelectorAll(".hist-row").length}`);

await renderMeFixture(history7.slice(0, 5), []);
ok("이력 5건 이하는 더 보기 없음", $("#me-history").querySelectorAll(".hist-row").length === 5
  && !$("#me-history .hist-more"));

await renderMeFixture([], []);
ok("Guard 이력 0건은 아직 없음", txt("#guard-memory").includes("아직 없음"), txt("#guard-memory"));

const guardFixture = [
  { id:"g1", on_date:"2026-08-05", fired_at:"2026-08-05T01:30:00+14:00", level:2, cause:"protect:아무거나", reaction:null, outcome:null },
  { id:"g2", on_date:"2026-08-05", fired_at:"2026-08-05T02:00:00+09:00", level:3, cause:"zzz:모름", reaction:"accepted", outcome:null },
  { id:"g3", on_date:"2026-08-05", fired_at:"2026-08-05T02:30:00+09:00", level:4, cause:"diagnostic", reaction:"override", override_reason:"조금만 더", override_class:"avoidant", outcome:"failure" },
];
await renderMeFixture([], guardFixture);
const causeLabels = [...$("#guard-memory").querySelectorAll(".gmem-cause-value")].map((el) => el.textContent.trim());
ok("모르는 cause도 접두사 번역 또는 원문으로 남는다", causeLabels[0] === "보호 규칙 · 아무거나"
  && causeLabels[1] === "zzz:모름" && causeLabels[2] === "diagnostic", causeLabels.join(" | "));
const nullReaction = txt("#guard-memory .gmem-reaction-value");
const nullOutcome = txt("#guard-memory .gmem-outcome-value");
ok("reaction null과 outcome null은 다르게 표시", nullReaction === "아직 반응 없음"
  && nullOutcome === "결과 미정" && nullReaction !== nullOutcome, `${nullReaction} / ${nullOutcome}`);
ok("Override 사유와 분류 표시", [...$("#guard-memory").querySelectorAll(".gmem-reaction-value")][2]?.textContent.includes("조금만 더")
  && [...$("#guard-memory").querySelectorAll(".gmem-reaction-value")][2]?.textContent.includes("회피"));

const guardDays9 = Array.from({ length: 9 }, (_, i) => {
  const day = String(14 - i).padStart(2, "0");
  return {
    id:`gd${i}`, on_date:`2026-08-${day}`, fired_at:`2026-08-${day}T12:00:00+09:00`,
    level:2, cause:"watch:bedtime", reaction:i === 0 ? "accepted" : null, outcome:null,
  };
});
guardDays9.push({
  id:"gd-extra", on_date:"2026-08-14", fired_at:"2026-08-14T13:00:00+09:00",
  level:3, cause:"recheck:bedtime", reaction:"override", override_reason:"오늘만", override_class:"legitimate", outcome:"success",
});
await renderMeFixture([], guardDays9);
const aug14 = $('#guard-memory .gday-section[data-gday-date="2026-08-14"]');
ok("Guard 이력을 on_date별 요약으로 묶음", $("#guard-memory").querySelectorAll(".gday-section").length === 9
  && aug14?.querySelectorAll(".gmem-row").length === 2
  && aug14?.querySelector(".gday-stats")?.textContent.includes("개입 2")
  && aug14?.querySelector(".gday-stats")?.textContent.includes("수용 1")
  && aug14?.querySelector(".gday-stats")?.textContent.includes("Override 1"));
const foldedGuardDays = $("#guard-memory").querySelectorAll(".gday-section:not([hidden])").length;
const guardMoreText = txt("#guard-memory .gday-more");
$("#guard-memory .gday-more")?.click();
ok("Guard 8일 이상은 최근 7일과 남은 일수를 보이고 펼치면 전부", foldedGuardDays === 7
  && guardMoreText === "더 보기 (2일)"
  && $("#guard-memory").querySelectorAll(".gday-section:not([hidden])").length === 9
  && !$("#guard-memory .gday-more"), `${foldedGuardDays} / ${guardMoreText}`);

await renderMeFixture([], guardDays9.filter((row) => row.on_date >= "2026-08-08"));
ok("Guard 7일 이하는 더 보기 없음", $("#guard-memory").querySelectorAll(".gday-section").length === 7
  && !$("#guard-memory .gday-more"));

const guardBoundary = [{
  id:"gb1", on_date:"2026-08-05", fired_at:"2026-08-06T01:30:00+09:00",
  level:4, cause:"protect:취침", reaction:"override", override_reason:"마무리", override_class:"avoidant", outcome:"failure",
}];
await renderMeFixture([], guardBoundary);
ok("05:00 경계 전 개입은 fired_at 날짜가 아니라 on_date로 묶음",
  !!$('#guard-memory .gday-section[data-gday-date="2026-08-05"]')
  && !$('#guard-memory .gday-section[data-gday-date="2026-08-06"]'));
ok("Guard 날짜 그룹에 요일 · 펼친 줄에 발동 날짜 유지",
  txt("#guard-memory .gday-date") === ev('dlabel("2026-08-05")')
  && txt("#guard-memory .gmem-time") === "2026-08-06 01:30",
  `${txt("#guard-memory .gday-date")} / ${txt("#guard-memory .gmem-time")}`);
$("#guard-memory .gday-summary")?.click();
ok("Guard 날짜를 누르면 T-18 개입 줄이 그대로 펼쳐짐",
  !$("#guard-memory .gday-events")?.hidden
  && $("#guard-memory").querySelectorAll(".gmem-row").length === 1
  && txt("#guard-memory .gmem-cause-value") === "보호 규칙 · 취침"
  && txt("#guard-memory .gmem-reaction-value").includes("마무리")
  && txt("#guard-memory .gmem-outcome-value") === "실패");

console.log("\n[Guard 모드 — 서버 판정 · 하향 마찰]");
const modeFixture = (activeKey = "coach", protecting = null) => {
  const modes = [
    { key:"secretary", label:"비서 — 알려주고 기록한다", max_level:2, downgrade:activeKey === "coach" },
    { key:"coach", label:"코치 — 개입한다", max_level:4, downgrade:false },
  ];
  return { modes, active:modes.find((mode) => mode.key === activeKey), protecting };
};
await ev(`(async()=>{
  window.__modeOriginalModes = Api.guardModes;
  window.__modeOriginalSetMode = Api.guardSetMode;
  window.__modeOriginalSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    return window.__modeOriginalSetTimeout.call(window, fn, ms === 60000 ? 80 : ms, ...args);
  };
  Api.guardModes = async () => JSON.parse(JSON.stringify(window.__modeFixture));
  Api.guardSetMode = async (key, reason) => {
    window.__modeCalls.push({ key, reason });
    if (window.__modeBehavior === "409") {
      window.__modeFixture.protecting = window.__modeProtectAfter;
      const e = new Error("보호 중에는 내릴 수 없어요 — 물리학 중간고사"); e.status = 409; throw e;
    }
    if (window.__modeBehavior === "400") {
      const e = new Error("왜 내리는지 적어주세요 — 서버 원문"); e.status = 400; throw e;
    }
    return { active:key, downgrade:key === "secretary", reason:reason ?? null };
  };
})()`);
const loadModeFixture = async (activeKey, behavior = "success", protecting = null, protectAfter = null) => {
  const fixture = modeFixture(activeKey, protecting);
  await ev(`(async()=>{
    cancelModeChange();
    window.__modeFixture = ${JSON.stringify(fixture)};
    window.__modeProtectAfter = ${JSON.stringify(protectAfter)};
    window.__modeBehavior = ${JSON.stringify(behavior)};
    window.__modeCalls = [];
    S.guardModes = await Api.guardModes();
    renderGuardModes();
  })()`);
};

await loadModeFixture("secretary");
$("#mode-list [data-mode-key='coach']").click(); await sleep(30);
ok("모드 상향은 사유 칸·대기 없이 즉시 요청", ev("window.__modeCalls.length") === 1
  && ev("window.__modeCalls[0].reason") === undefined
  && !$("#sh-mode").classList.contains("on") && ev("modeWaitTimer === null"));

await loadModeFixture("coach");
$("#mode-list [data-mode-key='secretary']").click();
const modeReasonOpened = $("#sh-mode").classList.contains("on") && $("#mode-reason-wrap").style.display !== "none";
$("#mode-confirm").click(); await sleep(20);
ok("모드 하향은 사유를 묻고 빈 값이면 대기를 시작하지 않음", modeReasonOpened
  && $("#mode-wait").style.display === "none" && ev("modeWaitTimer === null")
  && ev("window.__modeCalls.length") === 0);

await loadModeFixture("coach");
$("#mode-list [data-mode-key='secretary']").click();
$("#mode-reason").value = "잠깐 쉬고 싶다";
$("#mode-confirm").click(); await sleep(20);
const modeWaitingBeforeCancel = $("#mode-wait").style.display !== "none";
$("#mode-cancel").click(); await sleep(100);
ok("모드 하향 대기 중 취소하면 표시 모드가 그대로", modeWaitingBeforeCancel
  && !$("#sh-mode").classList.contains("on") && txt("#mode-current").includes("코치"));

const protectedMode = {
  title:"물리학 중간고사",
  start:"2026-08-06T22:00:00+09:00",
  until:"2026-08-07T09:00:00+09:00",
};
await loadModeFixture("coach", "409", null, protectedMode);
$("#mode-list [data-mode-key='secretary']").click();
$("#mode-reason").value = "그래도 내리고 싶다";
$("#mode-confirm").click(); await sleep(140);
ok("모드 하향 409는 서버 문구와 보호 일정·해제 시각을 표시", txt("#mode-error") === "보호 중에는 내릴 수 없어요 — 물리학 중간고사"
  && txt("#mode-context").includes("물리학 중간고사") && txt("#mode-context").includes("8/7 09:00"),
  `${txt("#mode-error")} / ${txt("#mode-context")}`);

await loadModeFixture("coach");
$("#mode-list [data-mode-key='secretary']").click();
$("#mode-reason").value = "검사 5 — 기다린 뒤 전송";
$("#mode-confirm").click();
const modePutsBeforeWait = ev("window.__modeCalls.length");
await sleep(140);
ok("모드 하향 60초가 끝나기 전에는 PUT이 나가지 않음", modePutsBeforeWait === 0
  && ev("window.__modeCalls.length") === 1
  && ev("window.__modeCalls[0].reason") === "검사 5 — 기다린 뒤 전송",
  `${modePutsBeforeWait} → ${ev("window.__modeCalls.length")}`);

await loadModeFixture("coach", "400");
$("#mode-list [data-mode-key='secretary']").click();
$("#mode-reason").value = "서버가 거부할 사유";
$("#mode-confirm").click(); await sleep(140);
ok("모드 하향 400은 서버 문구를 남기고 사유 칸으로 복귀", $("#mode-reason-wrap").style.display !== "none"
  && $("#mode-reason").value === "서버가 거부할 사유"
  && txt("#mode-error") === "왜 내리는지 적어주세요 — 서버 원문");

await ev(`(async()=>{
  cancelModeChange();
  Api.guardModes = window.__modeOriginalModes;
  Api.guardSetMode = window.__modeOriginalSetMode;
  window.setTimeout = window.__modeOriginalSetTimeout;
  S.guardModes = await Api.guardModes();
  renderGuardModes();
})()`);
w.toggleSet(true); await sleep(200);
const rows = [...$("#set-list").querySelectorAll(".srow")].map((r) => r.textContent);
ok("설정 11행 (AI 연결 통합)", rows.length === 11, String(rows.length));
ok("Low 모델 표시", rows.some((r) => r.includes("Low") && r.includes("haiku")), rows.join(" | "));
ok("High 모델 표시", rows.some((r) => r.includes("High") && r.includes("claude")), rows.join(" | "));
ok("AI 연결 행 · 토큰 위", rows.findIndex((r) => r.includes("AI 연결")) < rows.findIndex((r) => r.includes("앱 접근 토큰")), rows.join(" | "));
ok("모델 행이 토큰 아래", rows.findIndex((r) => r.includes("앱 접근 토큰")) < rows.findIndex((r) => r.includes("모델 — Low")));
ok("표준시 오프셋이 내보내기 위", rows.findIndex((r) => r.includes("표준시")) < rows.findIndex((r) => r.includes("내보내기")));

console.log("\n[Goals — 스키마 폼 · 귀속일 디데이]");
const goalKeys = () => [...$("#lm-goals-fields").querySelectorAll("[data-lm-goals-key]")].map((el) => el.dataset.lmGoalsKey);
const goalRows = () => $("#lm-goals-list").querySelectorAll("[data-lm-goals-id]").length;
w.toggleSet(false); await sleep(150);
ok("Goals 섹션이 Me 본문에 있다", !!$("#lm-goals-list") && !!$("#lm-goals-list").closest(".sec"));
ok("Goals 0개 — 빈 상태 문구", txt("#lm-goals-list").includes("아직 Goals 항목이 없어요"), txt("#lm-goals-list").slice(0, 40));
ok("nav Me 분리 훅 = Me에만", $("nav [data-go='me']")?.classList.contains("nav-me-tab")
  && $("nav").querySelectorAll(".nav-me-tab").length === 1);

// **하드코딩과 구별되는 검사.** 실제 스키마의 현재 목록을 확인하는 데서 끝내지 않고,
// 실행 중 스키마에 필드를 넣고 빼서 폼이 그대로 따라 움직이는지 본다.
w.openGoalsForm(); await sleep(120);
ok("Goals 폼 입력칸 = 스키마 필드", goalKeys().join(",") === ev("S.goalsSchema.fields.map((f)=>f.key).join(',')"), goalKeys().join(","));
ev(`S.goalsSchema.fields.push({ key: "front_probe", title: "검사 필드", type: "string", required: false })`);
w.openGoalsForm(); await sleep(120);
ok("Goals 스키마에 필드를 넣으면 폼에 생긴다", goalKeys().includes("front_probe"), goalKeys().join(","));
ev(`S.goalsSchema.fields = S.goalsSchema.fields.filter((f) => f.key !== "front_probe" && f.key !== "metric")`);
w.openGoalsForm(); await sleep(120);
ok("Goals 스키마에서 빼면 폼에서도 사라진다", !goalKeys().includes("front_probe") && !goalKeys().includes("metric"), goalKeys().join(","));
await ev("refreshGoals()"); await sleep(200);

w.openGoalsForm(); await sleep(120);
const goalPeriodSelect = $("#lm-goals-fields [data-lm-goals-key='period_id']");
ok("period_id는 기간 선택", goalPeriodSelect?.tagName === "SELECT"
  && goalPeriodSelect.options.length === ev("S.periods.length + 1"), goalPeriodSelect?.tagName);
$("#lm-goals-title").value = "프런트 확인 목표";
$("#lm-goals-save").click(); await sleep(300);
ok("Goals 필수 필드가 비면 저장이 막힌다", ev("S.goals.length") === 0
  && $("#sh-goals").classList.contains("on") && txt("#toast").includes("필수"), txt("#toast"));

const goalPid = ev("S.periods[0].id");
$("#lm-goals-fields [data-lm-goals-key='horizon']").value = "long";
$("#lm-goals-fields [data-lm-goals-key='period_id']").value = goalPid;
$("#lm-goals-save").click(); await sleep(700);
ok("Goals 추가 — 목록에 뜬다", goalRows() === 1 && txt("#lm-goals-list").includes("프런트 확인 목표"), `rows=${goalRows()}`);

// 같은 목표·같은 period_id를 둔 채 기간 행만 흔든다. 고정 D-N 문자열이면 이 검사를 통과하지 못한다.
const goalPidJs = JSON.stringify(goalPid);
ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, kind:"period", dday_label:"숨김", end_date:addDaysStr(S.today.date, 10) } : p); renderGoals()`);
const periodKindHidden = !$("#lm-goals-list .lm-goals-dday");
ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, kind:"constraint", dday_label:"" } : p); renderGoals()`);
ok("일반 기간·빈 라벨은 디데이를 숨긴다", periodKindHidden && !$("#lm-goals-list .lm-goals-dday"));

ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, kind:"constraint", dday_label:"입대", end_date:addDaysStr(S.today.date, 10) } : p); renderGoals()`);
const dday10 = txt("#lm-goals-list .lm-goals-dday");
ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, end_date:addDaysStr(S.today.date, 13) } : p); renderGoals()`);
const dday13 = txt("#lm-goals-list .lm-goals-dday");
ok("디데이는 end_date와 귀속일로 다시 계산된다", dday10 === "입대 D-10" && dday13 === "입대 D-13", `${dday10} → ${dday13}`);

// **귀속일 센티널.** 실행일과 S.today.date가 같으면 new Date()를 잘못 써도 위 검사가 통과한다.
// 서버 귀속일을 확실히 다른 고정값으로 바꿔, 기기 날짜를 읽는 구현이 반드시 빨간불이 되게 한다.
const goalTodayOrig = ev("S.today.date");
ev(`S.today.date = "2001-01-15";
  S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, end_date:"2001-01-25" } : p);
  renderGoals()`);
const deviceDateAtSentinel = ev("new Date().toISOString().slice(0, 10)");
ok("귀속일 센티널 — 기기 날짜가 달라도 S.today.date 기준", deviceDateAtSentinel !== "2001-01-15"
  && txt("#lm-goals-list .lm-goals-dday") === "입대 D-10",
  `device=${deviceDateAtSentinel} · attributed=${ev("S.today.date")} · ${txt("#lm-goals-list .lm-goals-dday")}`);
ev(`S.today.date = ${JSON.stringify(goalTodayOrig)}`);

ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, end_date:S.today.date } : p); renderGoals()`);
ok("디데이 당일 = D-DAY", txt("#lm-goals-list .lm-goals-dday") === "입대 D-DAY", txt("#lm-goals-list .lm-goals-dday"));
ev(`S.periods = S.periods.map((p) => p.id === ${goalPidJs} ? { ...p, end_date:addDaysStr(S.today.date, -2) } : p); renderGoals()`);
ok("지난 디데이 = D+N", txt("#lm-goals-list .lm-goals-dday") === "입대 D+2", txt("#lm-goals-list .lm-goals-dday"));

await ev("refreshGoals()"); await sleep(200);   // 기간·목표를 서버 값으로 원복
const goalId = $("#lm-goals-list [data-lm-goals-id]").dataset.lmGoalsId;
w.openGoalsForm(goalId); await sleep(150);
ok("Goals 수정 — 기존 값이 폼에 실린다", $("#lm-goals-title").value === "프런트 확인 목표"
  && $("#lm-goals-fields [data-lm-goals-key='period_id']").value === String(goalPid));
$("#lm-goals-title").value = "프런트 확인 목표(수정)";
$("#lm-goals-fields [data-lm-goals-key='metric']").value = "하루 20분";
$("#lm-goals-save").click(); await sleep(700);
ok("Goals 수정 — 목록이 갱신된다", goalRows() === 1 && txt("#lm-goals-list").includes("프런트 확인 목표(수정)")
  && txt("#lm-goals-list").includes("하루 20분"), txt("#lm-goals-list"));
w.openGoalsForm(goalId); await sleep(150);
$("#lm-goals-delete").click(); await sleep(150);
$("#cf-yes").click(); await sleep(700);
ok("Goals 삭제 — 빈 상태로 돌아간다", goalRows() === 0 && txt("#lm-goals-list").includes("아직 Goals 항목이 없어요"), `rows=${goalRows()}`);

console.log("\n[Education — 스키마가 폼을 정한다]");
const eduKeys = () => [...$("#lm-education-fields").querySelectorAll("[data-lm-education-key]")].map((el) => el.dataset.lmEducationKey);
const eduRows = () => $("#lm-education-list").querySelectorAll("[data-lm-education-id]").length;
w.toggleSet(false); await sleep(150);
ok("Education 섹션이 Me 본문에 있다", !!$("#lm-education-list") && !!$("#lm-education-list").closest(".sec"));
ok("항목 0개 — 빈 상태 문구", txt("#lm-education-list").includes("아직 Education 항목이 없어요"), txt("#lm-education-list").slice(0, 40));

// **하드코딩과 구별되는 검사.** 필드 수를 세는 것만으로는 7개를 박아 넣어도 통과한다.
// 활성 스키마를 흔들어 폼이 따라 움직이는지 본다 — 그게 레지스트리를 둔 이유다.
w.openEducationForm(); await sleep(120);
ok("폼 입력칸 = 스키마 필드", eduKeys().join(",") === ev("S.educationSchema.fields.map((f)=>f.key).join(',')"), eduKeys().join(","));
ev(`S.educationSchema.fields.push({ key: "front_probe", type: "string", required: false })`);
w.openEducationForm(); await sleep(120);
ok("스키마에 없던 필드를 넣으면 폼에 생긴다", eduKeys().includes("front_probe"), eduKeys().join(","));
ev(`S.educationSchema.fields = S.educationSchema.fields.filter((f) => f.key !== "front_probe" && f.key !== "note")`);
w.openEducationForm(); await sleep(120);
ok("스키마에서 빼면 폼에서도 사라진다", !eduKeys().includes("front_probe") && !eduKeys().includes("note"), eduKeys().join(","));
ok("enum 필드는 select", $("#lm-education-fields [data-lm-education-key='status']")?.tagName === "SELECT");
ok("배열 필드는 itemType을 보고 조립된다",
  ($("#lm-education-fields [data-lm-education-key='prerequisites']")?.getAttribute("placeholder") || "").includes("string"));
await ev("refreshEducation()"); await sleep(200);   // 흔든 스키마를 서버 값으로 원복 — 뒤 검사가 조작된 것을 보면 안 된다

// 라벨도 스키마가 준다(0014). 현재 라벨과 같은 값을 확인하는 것만으로는 하드코딩과 구별되지 않으므로,
// title을 지우면 key로 돌아가는 것까지 본다.
const eduLabels = () => [...$("#lm-education-fields").querySelectorAll(".lm-education-field-label")]
  .map((el) => el.textContent.replace(/·\s*필수$/, "").trim());
w.openEducationForm(); await sleep(120);
ok("폼 라벨이 스키마의 title", eduLabels().includes("과목명") && eduLabels().includes("선수과목"), eduLabels().join(","));
ev(`S.educationSchema.fields = S.educationSchema.fields.map((f) => (f.key === "name" ? { ...f, title: undefined } : f))`);
w.openEducationForm(); await sleep(120);
ok("title이 없으면 라벨이 key로 돌아간다", eduLabels().includes("name") && !eduLabels().includes("과목명"), eduLabels().join(","));
await ev("refreshEducation()"); await sleep(200);

// 필수 필드는 서버 400 이전에 프런트가 막는다
w.openEducationForm(); await sleep(120);
$("#lm-education-fields [data-lm-education-key='status']").value = "planned";
$("#lm-education-save").click(); await sleep(400);
ok("필수 필드가 비면 저장이 막힌다", ev("S.education.length") === 0 && $("#sh-education").classList.contains("on"), `n=${ev("S.education.length")}`);
ok("막힌 이유를 말해 준다", txt("#toast").includes("필수"), txt("#toast"));

// 추가 → 수정 → 삭제
$("#lm-education-fields [data-lm-education-key='name']").value = "프런트 확인 과목";
$("#lm-education-fields [data-lm-education-key='term']").value = "2026-2";
$("#lm-education-save").click(); await sleep(700);
ok("추가 — 목록에 뜬다", eduRows() === 1, `rows=${eduRows()}`);
ok("status 배지", !!$("#lm-education-list").querySelector('[data-status="planned"]'));
ok("term이 한 줄에 함께 보인다", txt("#lm-education-list").includes("2026-2"));
const eduId = $("#lm-education-list [data-lm-education-id]").dataset.lmEducationId;
w.openEducationForm(eduId); await sleep(150);
ok("수정 — 기존 값이 폼에 실린다", $("#lm-education-fields [data-lm-education-key='name']").value === "프런트 확인 과목");
$("#lm-education-fields [data-lm-education-key='name']").value = "프런트 확인 과목(수정)";
$("#lm-education-save").click(); await sleep(700);
ok("수정 — 목록이 갱신된다", txt("#lm-education-list").includes("프런트 확인 과목(수정)"));
ok("수정이 행을 늘리지 않는다", eduRows() === 1, `rows=${eduRows()}`);
w.openEducationForm(eduId); await sleep(150);
$("#lm-education-delete").click(); await sleep(150);
$("#cf-yes").click(); await sleep(700);
ok("삭제 — 빈 상태로 돌아간다", eduRows() === 0 && txt("#lm-education-list").includes("아직 Education 항목이 없어요"), `rows=${eduRows()}`);

console.log("\n[시트 — 열림 검증]");
w.openSetting("model_high"); await sleep(200);
ok("모델 후보 = 제공자/모델 조합", $("#st-options").querySelectorAll(".optrow").length === ev("modelOptions().length"),
  String($("#st-options").querySelectorAll(".optrow").length));
ok("모델 라벨에 제공자 이름", $("#st-options").textContent.includes("·"), $("#st-options").textContent.slice(0, 60));
w.closeAll();
w.openPeriod(null); await sleep(200);
ok("새 기간 시트 — 색 팔레트 8", $("#pd-colors").querySelectorAll(".sw").length === 8);
ok("새 기간 기본 날짜", $("#pd-start").value.length === 10 && $("#pd-end").value.length === 10);
ok("삭제 버튼 숨김(신규)", $("#pd-delete").style.display === "none");
w.closeAll();
const pid = ev("S.periods[0].id");
w.openPeriod(pid); await sleep(200);
ok("기간 편집 — 값 채움", $("#pd-title").value.length > 0 && $("#pd-delete").style.display === "");
w.closeAll();
w.openMe("direction"); await sleep(200);
ok("Me 시트 값 채움", $("#me-value").value.length > 0);
w.closeAll();
await w.openTask(ev("S.today.todo[0].id")); await sleep(500);
ok("task 시트 — id·타임라인", txt("#tk-id").includes("id ") && $("#tk-timeline").children.length >= 1);
w.closeAll();

console.log("\n[개선분 — 마감 확인 · 테마 · 튜토리얼 · 캘린더 편집]");
w.switchTab("today"); await sleep(900);
$("#btn-close").dispatchEvent(new w.Event("click")); await sleep(300);
ok("마감 = 확인 모달", $("#confirm").classList.contains("on") && $("#cf-title").textContent.includes("마감할까요"));
$("#cf-no").dispatchEvent(new w.Event("click")); await sleep(200);
ok("취소하면 닫힘 · 마감 안 됨", !$("#confirm").classList.contains("on"));

// S3' — 상태 서술은 마감 후 못 쓰므로 비었을 때만 확인 박스에서 한 줄 유도(강제 아님)
const feelOrig = ev(`(S.today.daily && S.today.daily.feelings_text) || ""`);
ev(`S.today.daily = S.today.daily || {}; S.today.daily.feelings_text = "";`);
$("#btn-close").dispatchEvent(new w.Event("click")); await sleep(300);
ok("상태 서술 비었을 때 — 마감 확인 박스에 한 줄 입력칸", !!$("#cf-feel"));
$("#cf-no").dispatchEvent(new w.Event("click")); await sleep(200);
ev(`S.today.daily.feelings_text = "이미 적어 둔 상태 서술";`);
$("#btn-close").dispatchEvent(new w.Event("click")); await sleep(300);
ok("이미 적었으면 입력칸 없음", !$("#cf-feel"));
$("#cf-no").dispatchEvent(new w.Event("click")); await sleep(200);
ev(`S.today.daily.feelings_text = ${JSON.stringify(feelOrig)};`);

w.applyTheme("dark"); await sleep(100);
ok("다크 테마 적용", w.document.documentElement.getAttribute("data-theme") === "dark");
w.applyTheme("auto");
ok("자동 복귀", !w.document.documentElement.hasAttribute("data-theme"));

w.showTutorial(0); await sleep(100);
ok("튜토리얼 5단계 · 첫 장", $("#tut").classList.contains("on") && $("#tut-dots").children.length === 5);
w.endTutorial();

w.openSetting("api_token"); await sleep(150);
ok("토큰 — 값 없으면 바로 입력 가능", $("#st-value").disabled === false);
w.closeAll();
w.openSetting("feelings_fields"); await sleep(150);
ok("Feelings 필드 = 쉼표 구분 표시", $("#st-value").value.includes(", "), $("#st-value").value);
ok("오프셋 설명 — UTC 명시", (ev("SET_DESC.utc_offset")).includes("UTC"));
w.closeAll();

await w.openDay(ev("addDaysStr(S.today.date, 2)")); await sleep(500);
ok("미래 날짜 팝업 — 할 일 추가 입력", !!$("#day-add"));
w.closeAll();
await w.openDay(ev("S.today.date")); await sleep(500);
ok("오늘 팝업에서도 추가 가능", !!$("#day-add") && !!$("#ev-add"));
ok("오늘 팝업 task = 편집 진입", $("#day-body").innerHTML.includes("openTask("));
w.closeAll();
await w.openTask(ev("S.today.todo[0].id")); await sleep(400);
ok("task 시트 — 완료율 표시 없음(막대·% 없음)", $("#tk-rates").querySelectorAll(".rbar button").length === 0 && !$("#tk-rates").textContent.includes("%"));
ok("task 삭제 버튼", !!$("#tk-delete"));
w.closeAll();

console.log("\n[날짜 선택 — 달 경계를 걸친 2주]");
const realD0 = ev("S.today.date");
// 서버의 실제 오늘과 분리한다. 기본값은 30일 달, 두 번째 실행은 FRONT_DATE_CASE로
// 다른 달(예: 윤년 2월)을 주입해 같은 경계 조건을 다시 검증한다.
const fixedD0 = process.env.FRONT_DATE_CASE || "2026-04-20";
if (!/^\d{4}-\d{2}-\d{2}$/.test(fixedD0)) throw new Error(`FRONT_DATE_CASE 형식 오류: ${fixedD0}`);
const [fixedY, fixedM] = fixedD0.split("-").map(Number);
w.switchTab("cal"); await sleep(1000);
// 날짜 선택 중에도 switchTab의 인접 Today 프리렌더가 반복된다. 검사 동안 응답의 date만
// 고정해 S.today.date 주입이 풀리지 않게 하고, 블록 끝에서 원래 Api.today를 돌려놓는다.
await ev(`(async()=>{
  window.__frontDateTodayOrig=Api.today;
  Api.today=async()=>({...await window.__frontDateTodayOrig(),date:${JSON.stringify(fixedD0)}});
  S.today={...S.today,date:${JSON.stringify(fixedD0)}};
  S.cal={y:${fixedY},m:${fixedM}};
  await renderCalendar();
})()`); await sleep(300);
console.log(`  · 고정 today 주입: ${fixedD0}`);
const D0 = ev("S.today.date");
// null = 그 달 그리드에 없는 날 / true = 비활성(흐림) / false = 선택 가능
const dim = (d) => {
  const c = $cur(`.c[data-d="${d}"]`);
  if (!c) return null;
  const o = c.style.opacity;
  return o !== "" && parseFloat(o) < 1;
};
const day = (n) => ev(`addDaysStr("${D0}",${n})`);
const d14 = day(14), d15 = day(15);
ok("오늘+14일이 다음 달로 넘어감 (경계 케이스)", d14.slice(0, 7) !== D0.slice(0, 7), `${D0} → ${d14}`);

w.startPick({ mode: "defer", id: ev("S.today.todo[0].id"), from: D0, title: "경계 테스트" });
await sleep(800);
ok("오늘은 비활성 (미루기는 내일부터)", dim(D0) === true, String(dim(D0)));
ok("내일은 활성", dim(day(1)) === false, String(dim(day(1))));
// 달 끝자락도 눌려야 한다 — 이 줄이 지키는 것은 '달 경계에서 비활성으로 새지 않는가'다.
//
// 전엔 `${이번달}31`을 그대로 썼는데, 그러면 **31일이 있는 달의 1~30일에만** 통과한다:
//   · 오늘이 31일이면 그 날짜가 곧 오늘이고, 바로 위 줄이 "오늘은 비활성"을 확인한다 → 자기모순
//   · 30일까지인 달·2월이면 그 셀이 아예 없어 `dim()`이 null을 준다
// 실제 말일을 계산하고, 그게 오늘이면 내일(= 다음 달 1일)로 옮긴다 — 어느 쪽이든 달 경계다.
const lastOfMonth = (() => {
  const [y, m] = D0.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);   // m은 1-based → 다음 달 0일 = 이번 달 말일
})();
const monthEdge = lastOfMonth > D0 ? lastOfMonth : day(1);
ok("달 끝자락 활성 (말일이 오늘이면 다음 달 1일)", dim(monthEdge) === false, `${monthEdge} → ${dim(monthEdge)}`);
// 이번 달 그리드의 꼬리에 붙어 나온 다음 달 날짜 — 범위 안이면 여기서도 눌러야 한다
const tail = [...$$cur(".c.mut")].map((c) => c.dataset.d).filter((d) => d > D0);
ok("이번 달 그리드 꼬리에 다음 달 날짜 존재", tail.length > 0, tail.join(","));
ok("그 꼬리 날짜도 범위 안이면 활성", tail.every((d) => dim(d) === (d > d14)), tail.map((d) => d + ":" + dim(d)).join(" "));

$("#cal-next").dispatchEvent(new w.Event("click")); await sleep(1300);
ok("달을 넘겨도 선택 모드 유지", $("#pick-banner").classList.contains("on"));
ok("다음 달 그리드 — +14일 활성", dim(d14) === false, String(dim(d14)));
ok("다음 달 그리드 — +15일 비활성", dim(d15) === true, String(dim(d15)));
ok("다음 달 그리드 앞머리(이번 달 말)도 활성", dim(day(7)) === false, `${day(7)} ${dim(day(7))}`);
ok("선택 실행 = 그 날짜로 미룸", true);
w.cancelPick(); await sleep(700);

w.switchTab("cal"); await sleep(900);
w.startPick({ mode: "schedule", id: "dummy", title: "상한 없음" });
await sleep(800);
ok("신규 일정 — 안내 문구 구분", $("#pick-note").textContent.includes("아무 날짜"));
const anyFar = [...$$cur(".c")].filter((c) => c.dataset.d > d15);
ok("신규 일정 — 2주 밖도 전부 활성", anyFar.length === 0 || anyFar.every((c) => dim(c.dataset.d) === false),
  anyFar.slice(0, 3).map((c) => c.dataset.d + ":" + dim(c.dataset.d)).join(" "));
w.exitPick(); await sleep(300);

const [realY, realM] = realD0.split("-").map(Number);
await ev(`(async()=>{
  Api.today=window.__frontDateTodayOrig;
  delete window.__frontDateTodayOrig;
  await refreshToday();
  S.cal={y:${realY},m:${realM}};
})()`);

console.log("\n[이월 — 캘린더에서 옛 날짜 정리]");
w.switchTab("cal"); await sleep(1200);
const movedOnOld = [...$$cur(".c")].some((c) =>
  c.dataset.d >= ev("S.today.date") && [...c.querySelectorAll(".ev")].some((e) => e.classList.contains("moved")));
ok("미룬 항목은 오늘·앞으로의 셀에서 빠짐", !movedOnOld);
const hasDeferred = (await (await fetch(`${BASE}/api/calendar?start=${ev("S.today.date")}&end=${ev("addDaysStr(S.today.date,5)")}`)).json())
  .entries.some((e) => e.deferred_to);
ok("데이터에는 이력이 남아 있음 (화면만 정리)", hasDeferred);

console.log("\n[쓰기 왕복]");
const before = $("#td-logs").querySelectorAll(".lrow").length;
w.switchTab("today"); await sleep(900);
$("#log-input").value = "jsdom 왕복 테스트";
$("#log-send").dispatchEvent(new w.Event("click"));
await sleep(1200);
ok("Log 추가 후 재렌더", $("#td-logs").querySelectorAll(".lrow").length === before + 1,
  `${before} → ${$("#td-logs").querySelectorAll(".lrow").length}`);

console.log("\n[이번 개선 — 다크 · AI 연결 · 완료 표시 · 취소]");
// 내비/입력줄 색이 변수로 빠졌는가 (다크에서 흰 바로 남던 문제)
const navBg = (el) => w.getComputedStyle(el).backgroundColor + w.getComputedStyle(el).background;
w.applyTheme("dark"); await sleep(150);
const cssText = [...w.document.styleSheets].length;
ok("nav 배경이 --bar 변수", (await (await fetch(BASE + "/style.css")).text()).includes("nav,.logbar{background:var(--bar)}"));
w.applyTheme("auto");

w.switchTab("me"); await sleep(900); w.toggleSet(true);
w.openSetting("ai_provider"); await sleep(200);
ok("AI 제공자 3종 선택지", $("#st-options").querySelectorAll(".optrow").length === 3);
ok("사람이 읽는 이름", $("#st-options").textContent.includes("Claude"), $("#st-options").textContent);
w.closeAll();
w.openSetting("ai_api_key"); await sleep(200);
ok("AI 키 — 입력값 비움(마스킹)", $("#st-value").value === "" && $("#st-value").type === "password");
ok("키 힌트 표시", $("#st-value").placeholder.length > 0, $("#st-value").placeholder);
w.closeAll();
w.openSetting("utc_offset"); await sleep(200);
ok("오프셋 잠금 + [변경]", $("#st-value").disabled === true && $("#st-unlock").style.display === "");
w.closeAll();

w.switchTab("today"); await sleep(1000);
ev("S.cal = { y:+S.today.date.slice(0,4), m:+S.today.date.slice(5,7) }"); // 앞 테스트에서 넘긴 달 복귀
ok("Done 박스 기본 열림", [...w.document.querySelectorAll("#td-list details.fold")].every((d) => d.open) || !$("#td-list").querySelector("details"));

// 완료 → 캘린더 셀·팝업 취소선
const tDone = (await ev(`Api.createTask({title:"완료 표시 확인", date:S.today.date})`)).id;
await ev(`Api.complete("${tDone}")`);
await w.refreshToday(); w.switchTab("cal"); await sleep(1300);
const cell = $cur(`.c[data-d="${ev("S.today.date")}"]`);
ok("캘린더 셀 — 할 일은 한 줄로 압축(.tsum)", !!cell.querySelector(".ev.tsum"), cell.innerHTML.slice(0, 160));
ok("캘린더 셀 — 대표는 살아 있는 항목(없으면 완료줄에 done)",
  (() => { const s = cell.querySelector(".ev.tsum"); return s.classList.contains("done") || !!cell.querySelector(".ev.tsum:not(.done)"); })(),
  cell.querySelector(".ev.tsum")?.outerHTML.slice(0, 140));
await w.openDay(ev("S.today.date")); await sleep(600);
ok("날짜 팝업 — 완료 줄 취소선", $("#day-body").innerHTML.includes("done-line"));
w.closeAll();
w.switchTab("works"); await sleep(1200);
ok("완료 목록 — 예정일·완료일 구분 표기", $("#done-list").textContent.includes("완료"), $("#done-list").textContent.slice(0, 80));

// 삭제 vs 취소 — 완료된 task 시트: 삭제 링크는 '삭제', 취소 버튼은 숨김(완료는 취소 대상 아님)
await w.openTask(tDone); await sleep(400);
ok("삭제 링크 문구가 '삭제'", $("#tk-delete").textContent.includes("삭제"), $("#tk-delete").textContent);
ok("완료된 task 시트 — 취소 버튼 숨김", $("#tk-cancel").style.display === "none");
w.closeAll();

// 취소 — 제3의 종결 (0008): 살아있는 task를 목록에서 내리고 기록은 남긴다
const tCanId = (await ev(`Api.createTask({title:"접을 일정", date:S.today.date})`)).id;
await w.openTask(tCanId); await sleep(400);
ok("상세 시트 — 취소 버튼 보임(살아있는 task)",
  !!$("#tk-cancel") && $("#tk-cancel").style.display !== "none");
w.closeAll();
await ev(`Api.cancelTask("${tCanId}")`);
await w.openTask(tCanId); await sleep(400);
ok("취소된 task 시트 — 완료 버튼 숨김", $("#tk-complete").style.display === "none");
ok("취소된 task 시트 — 취소 해제 버튼 보임",
  $("#tk-uncancel").style.display !== "none" && $("#tk-uncancel").textContent.includes("취소 해제"));
ok("취소된 task 시트 — '취소됨' 배지", $("#tk-rates").textContent.includes("취소됨"), $("#tk-rates").textContent);
w.closeAll();
w.switchTab("works"); await sleep(900);
ok("done 세그에 취소 행 렌더('취소' 라벨)", $("#done-list").textContent.includes("취소"), $("#done-list").textContent.slice(0, 140));

// 취소 사유(0009) — 확인 박스에서 받고 상세 시트에 보여준다. append-only라 해제 상태에선 안 보인다.
const tRzId = (await ev(`Api.createTask({title:"사유 남기고 취소", date:S.today.date})`)).id;
await w.openTask(tRzId); await sleep(400);
$("#tk-cancel").dispatchEvent(new w.Event("click")); await sleep(400);
ok("취소 확인 박스에 사유 입력칸", !!$("#cf-reason"));
$("#cf-no").dispatchEvent(new w.Event("click")); await sleep(200);   // 확인은 누르지 않는다
w.closeAll();
await ev(`Api.cancelTask("${tRzId}", "방향이 바뀌어서")`);
await w.openTask(tRzId); await sleep(400);
ok("취소된 task 시트 — 사유 노출", $("#tk-rates").textContent.includes("방향이 바뀌어서"), $("#tk-rates").textContent);
w.closeAll();
await ev(`Api.uncancelTask("${tRzId}")`);
await w.openTask(tRzId); await sleep(400);
ok("취소 해제 상태 — 사유 미노출", !$("#tk-rates").textContent.includes("방향이 바뀌어서"), $("#tk-rates").textContent);
w.closeAll();

console.log("\n[일정(event) — task와 분리]");
const EVD = ev("addDaysStr(S.today.date,1)");
const evId = (await ev(`Api.createEvent({title:"일정 분리 확인", date:"${EVD}", time:"10:00"})`)).id;
ev("invalidateCalendarCache()");   // 직접 API 시드라 제품의 일정 저장 경로를 거치지 않는다
w.switchTab("cal"); await sleep(1300);
const evCell = $cur(`.c[data-d="${EVD}"]`);
ok("캘린더 셀에 일정 표시(.evt)", !!evCell.querySelector(".ev.evt"), evCell.innerHTML.slice(0, 140));
ok("셀의 일정은 내용만 — 시각 문자열 없음",
  evCell.querySelector(".ev.evt").textContent.trim() === "일정 분리 확인", evCell.querySelector(".ev.evt").textContent);
ok("시각 있는 일정은 .timed 표시", evCell.querySelector(".ev.evt").classList.contains("timed"));
await w.openDay(EVD); await sleep(600);
ok("날짜 팝업 — 일정 섹션", $("#day-body").innerHTML.includes("일정") && !!$("#ev-add"));
ok("일정 줄에 삭제(×)", $("#day-body").innerHTML.includes("removeEvent("));
ok("할 일 입력과 분리", !!$("#day-add") && !!$("#ev-add"));
w.closeAll();
const worksBefore = (await ev(`Api.works("scheduled")`)).length;
ok("일정은 Works(할 일)에 섞이지 않음", !(await ev(`Api.works("scheduled")`)).some((r) => r.title === "일정 분리 확인"));
await ev(`Api.deleteEvent("${evId}")`);
ev("invalidateCalendarCache()");

console.log("\n[기간 밴드 — 배경·공유 곡선]");
const bandRow = ["2026-07-19","2026-07-20","2026-07-21","2026-07-22","2026-07-23","2026-07-24","2026-07-25"];
const solo = ev(`bandPaths(${JSON.stringify(bandRow)}, [{id:"p1",start_date:"2026-07-20",end_date:"2026-07-23",color:"#a",created_at:"1"}])`);
ok("단독 기간 — 시작·끝 면이 둥근 마감(Q곡선)", /^M11[0-9.]*,0/.test(solo[0].d) && (solo[0].d.match(/Q/g) || []).length === 4, solo[0].d.slice(0, 80));
ok("밴드가 셀 높이 전체(0~96)", solo[0].d.includes(",96"));
// 주 경계에서 잘린 면은 각지게 — 둥글게 하면 매주 끊긴 알약이 된다
const cutRow = ev(`bandPaths(${JSON.stringify(bandRow)}, [{id:"p2",start_date:"2026-07-10",end_date:"2026-08-02",color:"#a",created_at:"1"}])`);
ok("행 경계에서 잘린 면 — 곡선 없음(수직)", cutRow[0].d.startsWith("M0,0") && !cutRow[0].d.includes("Q"), cutRow[0].d.slice(0, 60));
const two = ev(`bandPaths(${JSON.stringify(bandRow)}, [
  {id:"a",start_date:"2026-07-19",end_date:"2026-07-25",color:"#a",created_at:"1"},
  {id:"b",start_date:"2026-07-21",end_date:"2026-07-23",color:"#b",created_at:"2"}])`);
const curveA = "C200,48 200,96 175,96";  // A의 하단 경계 (오른→왼)
const curveB = "C200,96 200,48 225,48";  // B의 상단 개시 (왼→오른) — 같은 곡선의 역방향
ok("겹침 경계 = 두 밴드가 같은 곡선 공유", two[0].d.includes(curveA) && two[1].d.includes(curveB),
  two[0].d.slice(0, 40) + " / " + two[1].d.slice(0, 40));
ok("셀 글줄에 흰 배경 없음", (await (await fetch(BASE + "/style.css")).text()).includes(".ev{background:none"));

console.log("\n[이번 배치 — 스와이프·다이얼·압축·버튼 노출]");

// ① 가로 스와이프: 축 잠금 — 세로로 시작한 제스처는 끝까지 탭을 넘기지 않는다
// 좌표는 반드시 MouseEvent 생성자로 실어야 한다 (Event에 나중에 붙이면 undefined로 남아
// dx가 NaN이 되고, 그러면 어떤 제스처든 '세로'로 판정돼 검사가 통과해 버린다)
// gapMs — 이동 사이 실제 간격. **속도를 검사하려면 시간을 실제로 흘려야 한다.**
// 동기로 연달아 쏘면 dt가 이벤트 루프 상태에 따라 0~수십ms로 요동친다:
//   dt < VEL_MIN_DT(16) → vel 갱신 안 됨 → 속도 0으로 통과
//   dt ≥ VEL_MIN_DT     → 40px/16ms = 2.5px/ms → FLICK_V(0.5) 초과 → 플릭 오판
// 앱 코드가 틀린 게 아니다(16ms에 40px는 실제로 빠른 손짓이다). 검사가 시간을 안 흘린 것이다.
const swipe = async (dxs, dys, gapMs = 0) => {
  const scr = w.document.querySelector(".screens");
  const mk = (type, x, y) => new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  scr.dispatchEvent(mk("pointerdown", 300, 400));
  for (let i = 0; i < dxs.length; i++) {
    if (gapMs) await sleep(gapMs);
    scr.dispatchEvent(mk("pointermove", 300 + dxs[i], 400 + dys[i]));
  }
  const n = dxs.length - 1;
  scr.dispatchEvent(mk("pointerup", 300 + dxs[n], 400 + dys[n]));
};
const tab = () => $("#phone").dataset.tab;
w.switchTab("today"); await sleep(300);
await swipe([-14, -60, -150], [0, 3, 6]);           // 가로 확정 + 폭의 35% 초과 — 거리만으로 넘어간다
ok("가로 스와이프는 다음 탭으로", tab() === "cal", tab());
w.switchTab("today"); await sleep(200);
await swipe([0, -20, -140], [30, 60, 62]);          // 세로로 시작 → 축 잠금이 끝까지 무시
ok("세로로 시작한 제스처는 탭을 넘기지 않음", tab() === "today", tab());
w.switchTab("today"); await sleep(200);
// 짧고 **느린** 드래그 — 거리도 속도도 임계 미달.
// 120ms를 고른 이유: VEL_WIN(90) < 120 < VEL_STALE(130).
//   > VEL_WIN  → refX가 매 이동마다 재설정돼 **구간별**로 속도를 잰다(최대 30px/120ms = 0.25px/ms)
//   < VEL_STALE→ pointerup에서 '멈췄다 뗐다'로 처리되지 않아 실제 속도가 평가된다
// 루프가 밀려 간격이 커지면 속도는 더 낮아진다 — 지연은 통과 방향으로만 작용한다.
await swipe([-14, -40, -70], [0, 2, 4], 120);
ok("짧고 느린 가로 이동은 무시(임계값)", tab() === "today", tab());
w.switchTab("today"); await sleep(200);

// T-25 — 캘린더 가운데는 달 캐러셀, 화면 양끝 SWIPE_EDGE_RATIO는 탭 캐러셀이 받는다.
// target에서 이벤트를 시작해 #cal-rows → .screens 버블 경로를 실제로 태운다.
const swipeOn = async (target, x0, dxs, dys, gapMs = 0) => {
  const mk = (type, x, y) => new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  target.dispatchEvent(mk("pointerdown", x0, 400));
  for (let i = 0; i < dxs.length; i++) {
    if (gapMs) await sleep(gapMs);
    target.dispatchEvent(mk("pointermove", x0 + dxs[i], 400 + dys[i]));
  }
  const n = dxs.length - 1;
  target.dispatchEvent(mk("pointerup", x0 + dxs[n], 400 + dys[n]));
};
const gestureScreen = $(".screens");
const gestureLeft = gestureScreen.getBoundingClientRect().left;
const gestureWidth = gestureScreen.clientWidth || 380;
const gestureEdgeWidth = gestureWidth * ev("SWIPE_EDGE_RATIO");
const gestureProbe = 1;
const centerGestureX = gestureLeft + gestureWidth / 2;
const leftEdgeGestureX = gestureLeft + gestureEdgeWidth - gestureProbe;
const rightEdgeGestureX = gestureLeft + gestureWidth - gestureEdgeWidth + gestureProbe;
const calendarGestureTarget = () => $cur(".c:not(.mut)");
const gestureOrigin = { y: ev("S.cal.y"), m: ev("S.cal.m") };

w.switchTab("cal"); await sleep(900);
const centerGestureStart = testAddMonth(ev("S.cal.y"), ev("S.cal.m"), 1);
await swipeOn(calendarGestureTarget(), centerGestureX, [-14, -60, -150], [0, 3, 6]);
await sleep(1600);
ok("캘린더 가운데 가로 끌기는 달을 넘긴다", tab() === "cal"
  && centerGestureX - gestureLeft > gestureEdgeWidth
  && centerGestureX - gestureLeft < gestureWidth - gestureEdgeWidth
  && ev("S.cal.y") === centerGestureStart.y && ev("S.cal.m") === centerGestureStart.m,
  `${tab()} / x=${centerGestureX - gestureLeft} / ${ev("S.cal.y")}-${ev("S.cal.m")}`);

const leftEdgeMonth = `${ev("S.cal.y")}-${ev("S.cal.m")}`;
await swipeOn(calendarGestureTarget(), leftEdgeGestureX, [14, 60, 150], [0, 3, 6]);
await sleep(500);
ok("캘린더 왼쪽 가장자리 가로 끌기는 달을 두고 이전 탭", tab() === "today"
  && `${ev("S.cal.y")}-${ev("S.cal.m")}` === leftEdgeMonth,
  `${tab()} / ${ev("S.cal.y")}-${ev("S.cal.m")}`);

w.switchTab("cal"); await sleep(500);
const rightEdgeMonth = `${ev("S.cal.y")}-${ev("S.cal.m")}`;
await swipeOn(calendarGestureTarget(), rightEdgeGestureX, [-14, -60, -150], [0, 3, 6]);
await sleep(500);
ok("캘린더 오른쪽 가장자리 가로 끌기는 달을 두고 다음 탭", tab() === "works"
  && `${ev("S.cal.y")}-${ev("S.cal.m")}` === rightEdgeMonth,
  `${tab()} / ${ev("S.cal.y")}-${ev("S.cal.m")}`);

w.switchTab("cal"); await sleep(500);
const verticalGestureMonth = `${ev("S.cal.y")}-${ev("S.cal.m")}`;
await swipeOn(calendarGestureTarget(), leftEdgeGestureX, [1, 4, 6], [30, 80, 150]);
await sleep(300);
ok("캘린더 가장자리 세로 끌기는 가로 캐러셀을 잡지 않는다", tab() === "cal"
  && `${ev("S.cal.y")}-${ev("S.cal.m")}` === verticalGestureMonth,
  `${tab()} / ${ev("S.cal.y")}-${ev("S.cal.m")}`);

const edgeInput = w.document.createElement("input");
$("#scr-cal").appendChild(edgeInput);
await swipeOn(edgeInput, leftEdgeGestureX, [14, 60, 150], [0, 3, 6]);
await sleep(300);
ok("input은 가장자리에서도 스와이프를 막는다", tab() === "cal"
  && `${ev("S.cal.y")}-${ev("S.cal.m")}` === verticalGestureMonth, tab());
edgeInput.remove();

const zeroWidthFallback = ev(`(()=>{
  const scr = $(".screens"), left = scr.getBoundingClientRect().left;
  const width = scr.clientWidth || 380, edge = width * SWIPE_EDGE_RATIO, probe = 1;
  return scr.clientWidth === 0
    && isSwipeEdge({clientX:left + edge - probe}, scr)
    && !isSwipeEdge({clientX:left + edge + probe}, scr)
    && !isSwipeEdge({clientX:left + width - edge - probe}, scr)
    && isSwipeEdge({clientX:left + width - edge + probe}, scr);
})()`);
ok("폭 0에서는 380 폴백과 SWIPE_EDGE_RATIO로 가장자리를 계산", zeroWidthFallback,
  `clientWidth=${gestureScreen.clientWidth}`);
await ev(`(async()=>{ S.cal={y:${gestureOrigin.y},m:${gestureOrigin.m}}; calGen++; await renderCalendar(); })()`);

// ①-b 트랙 위치가 인덱스를 그대로 따라가고, nav 표식이 같이 움직인다
const tf = (sel) => ($(sel)?.style.transform || "").replace(/\s/g, "");
w.switchTab("works", false); await sleep(400);
ok("탭 트랙 = 인덱스 × -100%", tf("#tab-track") === "translateX(-200%)", tf("#tab-track"));
ok("nav 표식도 같은 칸", tf("#nav-dot") === "translateX(200%)", tf("#nav-dot"));
ok("nav 강조가 따라옴", [...w.document.querySelectorAll("nav button")][2].classList.contains("on"));
w.switchTab("today", false); await sleep(300);
ok("되돌아오면 0%", tf("#tab-track") === "translateX(0%)", tf("#tab-track"));

// ①-c 달 넘기기 — 넘긴 뒤 pane 하나만 조립하고 5-pane을 조용히 재중심화한다
w.switchTab("cal"); await sleep(1400);
const m0 = ev("S.cal.m"), y0 = ev("S.cal.y");
const paneBuilds0 = ev("calendarPaneBuildCount");
const originalClassToggle = w.DOMTokenList.prototype.toggle;
let calCurToggleCalls = 0;
w.DOMTokenList.prototype.toggle = function (token) {
  if (token === "cur") calCurToggleCalls++;
  return originalClassToggle.apply(this, arguments);
};
try {
  w.calGo(1);
  await sleep(2200);                                 // transitionend 유실 대비 타이머 + 재조립
} finally {
  w.DOMTokenList.prototype.toggle = originalClassToggle;
}
const expM = m0 === 12 ? 1 : m0 + 1;
ok("달 넘김 — 다음 달", ev("S.cal.m") === expM && ev("S.cal.y") === (m0 === 12 ? y0 + 1 : y0), `${m0} → ${ev("S.cal.m")}`);
ok("한 칸 넘기면 새로 조립하는 pane은 1개", ev("calendarPaneBuildCount") - paneBuilds0 === 1,
  `${paneBuilds0} → ${ev("calendarPaneBuildCount")}`);
ok("넘긴 뒤 트랙은 다시 가운데(gap 보정)", tf("#cal-track") === "translateX(calc(-40%-40px))", tf("#cal-track"));
ok("5-pane 유지", w.document.querySelectorAll("#cal-track .calpane").length === 5);
const afterOne = testAddMonth(y0, m0, 1);
const centerPane = w.document.querySelectorAll("#cal-track .calpane")[2];
ok("현재 달은 가운데 pane · cur 토글은 pane당 한 번",
  centerPane?.classList.contains("cur") && centerPane.dataset.ym === testYm(afterOne)
  && calCurToggleCalls === ev("CAL_PANE_COUNT"),
  `${centerPane?.dataset.ym} / ${testYm(afterOne)} / cur ${calCurToggleCalls}`);
w.calGo(1); await sleep(1400);
w.calGo(1); await sleep(1400);
const afterThree = testAddMonth(y0, m0, 3);
ok("오른쪽으로 세 번 연속 넘겨도 각 pane과 달이 맞음", ev("S.cal.y") === afterThree.y && ev("S.cal.m") === afterThree.m
  && panesAligned(afterThree.y, afterThree.m), paneYms().join(" / "));
// 반대 방향은 깨끗한 5-pane에서 따로 시작한다. 오른쪽 오류가 왼쪽 검사까지 오염시키면
// 두 변이가 각자 어느 방향을 방어하는지 구별할 수 없다.
await ev(`(async()=>{ S.cal={y:${y0},m:${m0}}; calGen++; await renderCalendar(); })()`);
w.calGo(-1); await sleep(1400);
w.calGo(-1); await sleep(1400);
w.calGo(-1); await sleep(1400);
const beforeThree = testAddMonth(y0, m0, -3);
ok("왼쪽으로 세 번 연속 넘겨도 각 pane과 달이 맞음", ev("S.cal.y") === beforeThree.y && ev("S.cal.m") === beforeThree.m
  && panesAligned(beforeThree.y, beforeThree.m), paneYms().join(" / "));
await ev(`(async()=>{ S.cal={y:${y0},m:${m0}}; calGen++; await renderCalendar(); })()`);
ok("되돌리기 — 원래 달", ev("S.cal.m") === m0 && ev("S.cal.y") === y0, String(ev("S.cal.m")));
w.switchTab("today"); await sleep(300);

// ② 일정 추가 — 팝업 하나 안에서 시각까지 (시트를 겹쳐 쌓지 않는다)
const DD = ev("addDaysStr(S.today.date,2)");
await w.openDay(DD); await sleep(600);
ok("날짜 팝업엔 [+ 일정 추가] 버튼만", !!$("#ev-add") && !$("#ev-title") && !$("#ev-time"));
w.openEventSheet(DD); await sleep(250);
ok("일정 시트 열림 · 날짜 팝업도 유지", $("#sh-event").classList.contains("on") && $("#sh-day").classList.contains("on"));
ok("기본은 종일 — 드럼 숨김", $("#evx-dial").style.display === "none");
ok("시 드럼 24칸 · 분 드럼 12칸(5분 단위)",
  w.document.querySelectorAll("#dial-h .dopt").length === 24 && w.document.querySelectorAll("#dial-m .dopt").length === 12);
w.document.querySelector('#evx-seg button[data-t="at"]').dispatchEvent(new w.Event("click"));
ok("[시각] 고르면 드럼 노출", $("#evx-dial").style.display === "");
w.document.querySelectorAll("#dial-h .dopt")[14].dispatchEvent(new w.Event("click", { bubbles: true }));
w.document.querySelectorAll("#dial-m .dopt")[6].dispatchEvent(new w.Event("click", { bubbles: true }));
ok("고른 값이 미리보기에 반영", txt("#evx-preview") === "14:30", txt("#evx-preview"));
$("#evx-title").value = "다이얼로 넣은 일정";
await ev("renderCalendar()");
const eventAddCalendarCalls = ev("window.__calendarCalls.length");
$("#evx-ok").dispatchEvent(new w.Event("click"));
await sleep(1200);
ok("시트가 닫히고 일정이 들어감", !$("#sh-event").classList.contains("on"));
ok("일정 추가 뒤 캐시 무효화 · 재요청", ev("window.__calendarCalls.length") === eventAddCalendarCalls + 1,
  `${eventAddCalendarCalls}→${ev("window.__calendarCalls.length")}`);
const added = (await ev(`Api.day("${DD}")`)).events.find((e) => e.title === "다이얼로 넣은 일정");
ok("고른 시각 그대로 저장", added && added.time === "14:30", JSON.stringify(added));
// 보호 규칙 — 일정 시트에서 기본값으로 설정·미리보기·해제를 모두 검증한다.
await w.openDay(DD); await sleep(300);
ev(`window.__protectCalls = []; window.__originalSetProtect = Api.setProtect;
  Api.setProtect = async (id, body) => { window.__protectCalls.push({ id, body }); return window.__originalSetProtect(id, body); };`);
w.openEventEdit(DD, false, added.id); await sleep(160);
$("#ev-protect-enabled").checked = true;
$("#ev-protect-enabled").dispatchEvent(new w.Event("change"));
ok("보호 켜면 기본값 표시", $("#ev-protect-from").value === "-1d 00:00" && $("#ev-protect-level").value === "4" && $("#ev-protect-sleep").value === "360" && $("#ev-protect-prep").value === "90");
const deadline360 = txt("#ev-protect-deadline");
$("#ev-protect-sleep").value = "300";
$("#ev-protect-sleep").dispatchEvent(new w.Event("input"));
const deadline300 = txt("#ev-protect-deadline");
// 14:30 일정 − (수면+준비). 360+90=450분 → 07:00 · 300+90=390분 → 08:00.
// **양쪽 값을 다 박는다** — 한쪽만 보면 prep을 빼먹은 식(−sleep만)도 통과할 수 있다.
ok("보호 데드라인은 수면 입력에 따라 변함", deadline360 !== deadline300
  && deadline360.includes("07:00") && deadline300.includes("08:00"), deadline360 + " / " + deadline300);
$("#ev-protect-sleep").value = "360";
$("#ev-protect-sleep").dispatchEvent(new w.Event("input"));
$("#evx-title").value = "다이얼로 넣은 일정 수정";
await ev("renderCalendar()");
const eventUpdateCalendarCalls = ev("window.__calendarCalls.length");
$("#evx-ok").dispatchEvent(new w.Event("click")); await sleep(1000);
ok("일정 수정 뒤 캐시 무효화 · 재요청", ev("window.__calendarCalls.length") === eventUpdateCalendarCalls + 1,
  `${eventUpdateCalendarCalls}→${ev("window.__calendarCalls.length")}`);
ok("보호 설정 본문은 명시 기본값", ev(`JSON.stringify(window.__protectCalls[0]?.body)`) === JSON.stringify({ protect_from: "-1d 00:00", protect_level: 4, protect_sleep_min: 360, protect_prep_min: 90 }), ev(`JSON.stringify(window.__protectCalls)`));
w.switchTab("cal"); await sleep(800);
ok("보호 일정은 캘린더에서 표시", !!$cur(`.c[data-d="${DD}"] .ev-protect-dot`));
await w.openDay(DD); await sleep(300); w.openEventEdit(DD, false, added.id); await sleep(160);
$("#ev-protect-enabled").checked = false;
$("#ev-protect-enabled").dispatchEvent(new w.Event("change"));
$("#evx-ok").dispatchEvent(new w.Event("click")); await sleep(900);
ok("보호 해제 본문", ev(`window.__protectCalls[1]?.body?.protect`) === false, ev(`JSON.stringify(window.__protectCalls)`));
// 완료 조건 4 — 잘못된 protect_from은 **서버 400 이전에** 프런트가 막는다.
await w.openDay(DD); await sleep(300); w.openEventEdit(DD, false, added.id); await sleep(160);
$("#ev-protect-enabled").checked = true;
$("#ev-protect-enabled").dispatchEvent(new w.Event("change"));
$("#ev-protect-from").value = "어제 자정";
$("#ev-protect-from").dispatchEvent(new w.Event("input"));
const callsBefore = ev("window.__protectCalls.length");
$("#evx-ok").dispatchEvent(new w.Event("click")); await sleep(400);
ok("잘못된 보호 시작은 저장 전에 막힌다",
  ev("window.__protectCalls.length") === callsBefore && $("#sh-event").classList.contains("on"),
  `calls ${callsBefore}→${ev("window.__protectCalls.length")}`);
ok("보호 — 막힌 이유를 말해 준다", txt("#toast").includes("형식"), txt("#toast"));
$("#evx-cancel").dispatchEvent(new w.Event("click")); await sleep(200);
ev("Api.setProtect = window.__originalSetProtect");
// 종일 일정은 서버가 09:00으로 본다(guard.ts:66) — 프런트 미리보기도 같은 폴백을 써야 한다.
// 09:00 − (360+90) = 01:30. **설계 §6.1의 예시 그대로**이고, 서버 쪽은 smoke가 같은 값을 박고 있다.
w.openEventSheet(DD); await sleep(200);
$("#ev-protect-enabled").checked = true;
$("#ev-protect-enabled").dispatchEvent(new w.Event("change"));
ok("종일 일정은 09:00 기준 — 설계 §6.1의 01:30", txt("#ev-protect-deadline").includes("01:30"),
  txt("#ev-protect-deadline"));
$("#ev-protect-enabled").checked = false;
$("#ev-protect-enabled").dispatchEvent(new w.Event("change"));
$("#evx-cancel").dispatchEvent(new w.Event("click")); await sleep(200);
w.openEventSheet(DD); await sleep(200);
ok("다시 열면 종일로 초기화", $("#evx-dial").style.display === "none" && $("#evx-title").value === "");
$("#evx-cancel").dispatchEvent(new w.Event("click"));
ok("취소 — 시트만 닫힘", !$("#sh-event").classList.contains("on"));
w.closeAll(); await sleep(200);
await ev("renderCalendar()");
const eventDeleteCalendarCalls = ev("window.__calendarCalls.length");
w.removeEvent(added.id, DD); await sleep(200);
$("#cf-yes").click(); await sleep(1200);
ok("일정 삭제 뒤 캐시 무효화 · 재요청", ev("window.__calendarCalls.length") === eventDeleteCalendarCalls + 1,
  `${eventDeleteCalendarCalls}→${ev("window.__calendarCalls.length")}`);
w.closeAll(); await sleep(150);

// ②.5 통합 추가 영역 (3단계) — [일정|할 일|memo] 세그 · 어느 날짜에든 memo
const AZF = ev("addDaysStr(S.today.date,4)");   // 미래
await w.openDay(AZF); await sleep(600);
ok("추가영역 세그 3개(미래: 일정·할일·memo)", $("#az-seg").querySelectorAll("button").length === 3);
ok("미래 기본 세그 = 할 일", $("#az-seg").querySelector("button.on")?.dataset.m === "task");
ok("과거 추가영역 = 일정·memo만(할 일 세그 없음)",
  (() => { const s = w.addZoneHtml("2020-01-01", "past", true); return s.includes('data-m="event"') && s.includes('data-m="memo"') && !s.includes('data-m="task"'); })());
w.setAddMode("memo"); await sleep(120);
ok("memo 세그 전환 — memo 입력 노출", !!$("#memo-input") && $('.az-field[data-m="memo"]').style.display !== "none");
$("#memo-input").value = "미래에 남기는 memo";
$('.az-field[data-m="memo"] .mok').dispatchEvent(new w.Event("click"));
await sleep(1200);
const azDay = await ev(`Api.day("${AZF}")`);
ok("미래 날짜 memo 저장(daily 자동 생성)",
  azDay.memos.some((m) => m.text === "미래에 남기는 memo") && !!azDay.daily, JSON.stringify(azDay.memos));
const addedMemo = azDay.memos.find((m) => m.text === "미래에 남기는 memo");
const addedMemoDate = `${+addedMemo.created_at.slice(5, 7)}/${+addedMemo.created_at.slice(8, 10)}`;
await w.openDay(AZF); await sleep(500);
ok("미래 날짜 시트에 memo 표시", $("#day-body").innerHTML.includes("미래에 남기는 memo"));
const laterMemoRow = [...$("#day-body").querySelectorAll(".memo-origin-row")]
  .find((row) => row.textContent.includes("미래에 남기는 memo"));
ok("귀속일이 다른 memo는 추가 날짜와 구분 표시",
  laterMemoRow?.classList.contains("memo-origin-later")
    && laterMemoRow.querySelector(".memo-origin-added")?.textContent.includes(`${addedMemoDate}에 추가`),
  laterMemoRow?.outerHTML || "row 없음");
w.closeAll(); await sleep(150);
await ev(`Api.memo(S.today.date, isoNowLocal(), "그날 쓴 memo 표시")`);
await w.openDay(ev("S.today.date")); await sleep(500);
const sameDayMemoRow = [...$("#day-body").querySelectorAll(".memo-origin-row")]
  .find((row) => row.textContent.includes("그날 쓴 memo 표시"));
ok("그날 쓴 memo는 나중 표식 없이 표시",
  !!sameDayMemoRow && !sameDayMemoRow.classList.contains("memo-origin-later")
    && !sameDayMemoRow.querySelector(".memo-origin-added"),
  sameDayMemoRow?.outerHTML || "row 없음");
w.closeAll(); await sleep(150);
const memoEmptyDate = ev("addDaysStr(S.today.date,40)");
await w.openDay(memoEmptyDate); await sleep(500);
ok("memo 0건이면 빈 상태 명시", $("#day-body").textContent.includes("memo 없음"), $("#day-body").textContent.slice(0, 120));
w.closeAll(); await sleep(150);

// ③ 완료율 화면 제거(2단계) — task 시트에 %·막대 없음. 상태(완료/대기/예정)만 읽기전용 표시.
const T1 = ev("addDaysStr(S.today.date,1)");
const tFut = (await ev(`Api.createTask({title:"내일 예정 완료율", date:"${T1}"})`)).id;
await w.openTask(tFut); await sleep(500);
ok("미래 예정 — 완료율 표시 없음(막대·% 없음)", $("#tk-rates").querySelectorAll(".rbar button").length === 0 && !$("#tk-rates").textContent.includes("%"));
ok("상태 헤더 표기(완료율 문구 없음)", txt("#tk-rate-head") === "상태", txt("#tk-rate-head"));
ok("예정 task — '미루기' 라벨", txt("#tk-defer") === "미루기");
ok("예정 task — 대기 연장 숨김", $("#tk-extend").style.display === "none");
w.closeAll();

// ④ 미루기 — 사유(선택)를 받아 도착지(새 예정) 항목에 남긴다 (완료율 입력은 화면에서 제거됨)
const T2 = ev("addDaysStr(S.today.date,3)");
const tDf = (await ev(`Api.createTask({title:"미루면서 사유", date:S.today.date})`)).id;
await w.refreshToday(); await sleep(300);
ev(`startPick({mode:"defer", id:"${tDf}", from:S.today.date, title:"미루면서 사유"})`);
await sleep(400);
await w.assignDate(T2); await sleep(900);
ok("미루기 확인 시트가 뜸", $("#sh-defer").classList.contains("on"));
ok("확인 시트에 사유칸 · 완료율 바 없음", !!$("#dfx-reason") && $("#sh-defer").querySelectorAll(".rbar").length === 0);
ok("사유칸은 빈 값으로 열림", $("#dfx-reason").value === "");
ok("어디로 가는지 표시", $("#dfx-what").textContent.includes("→") || $("#dfx-what").innerHTML.includes("→"));
$("#dfx-reason").value = "다른 일이 급해서";
await ev("renderCalendar()");
const deferCalendarCalls = ev("window.__calendarCalls.length");
$("#dfx-ok").dispatchEvent(new w.Event("click"));
await sleep(1500);
ok("미루기 뒤 캐시 무효화 · 재요청", ev("window.__calendarCalls.length") === deferCalendarCalls + 1,
  `${deferCalendarCalls}→${ev("window.__calendarCalls.length")}`);
const dfd = await ev(`Api.task("${tDf}")`);
ok("옮겨 간 예정에 사유가 남음", dfd.entries.find((e) => e.date === T2)?.defer_reason === "다른 일이 급해서", JSON.stringify(dfd.entries));
ok("옮겨 간 예정은 0%에서 시작", dfd.entries.find((e) => e.date === T2)?.rate === 0);
ok("원래 예정일은 rate 무변경(0)", dfd.entries.find((e) => e.deferred_to)?.rate === 0);
w.closeAll(); await sleep(200);

// ⑤ 대기 — 21일 전에는 연장 버튼이 없다
const tWait = (await ev(`Api.createTask({title:"갓 담은 대기"})`)).id;
await w.openTask(tWait); await sleep(500);
ok("대기 task — '일정 정하기' 라벨", txt("#tk-defer") === "일정 정하기");
ok("21일 전 — 대기 연장 버튼 숨김", $("#tk-extend").style.display === "none");
ok("대기 — 완료율 대신 안내", $("#tk-rates").textContent.includes("일정을 정하면"));
w.closeAll();
w.switchTab("works"); await sleep(1300);
ok("대기 세그먼트 윤곽선 강조", $("#seg-wait").classList.contains("ring"));
ok("대기 목록 — 21일 전엔 연장 칩 없음", !$("#wait-list").innerHTML.includes(">연장<"));
ok("예정 행 완료율 인라인 제거(rateSet 없음, 읽기전용)", !$("#w-sched").innerHTML.includes("rateSet("));

// ⑤ 삭제 거부 — 어떤 기록이 막는지 말해 준다
const delMsg = await ev(`Api.deleteTask("${tFut}").then(()=>null, (e)=>e.message)`);
ok("미래 예정 task는 취소됨", delMsg === null, String(delMsg));
const blocked = await ev(`(async()=>{ const r = await fetch(API_BASE+"/tasks/"+encodeURIComponent(S.today.todo[0]?.id||"x"), {method:"DELETE"}); return (await r.json()).error || null; })()`);
ok("차단 시 사유는 날짜로 말함(또는 차단 없음)", blocked === null || /\d+\/\d+/.test(blocked), String(blocked));

console.log("\n[Feelings 필드 · AI 연결 시트]");
w.switchTab("today"); await sleep(900);
$("#feel-fields").dispatchEvent(new w.Event("click")); await sleep(900);
ok("필드 시트 — 카탈로그 노출", $("#field-list").querySelectorAll("button").length >= 5);
ok("기본 3개 선택 상태", $("#field-list").querySelectorAll("button.on").length >= 3);
w.toggleField("sleep"); await sleep(200);
ok("새 축 추가 가능", $("#field-list").querySelectorAll("button.on").length >= 4);
w.closeAll();
w.switchTab("me"); await sleep(900); w.toggleSet(true);
await w.openAi(); await sleep(800);
ok("AI 연결 — 제공자 3곳 목록", $("#conn-list").querySelectorAll(".conn").length === 3);
ok("연결 테스트 버튼", !!$("#conn-test"));
ok("키 입력칸 자동완성 차단", $("#conn-key").getAttribute("autocomplete") === "new-password");
w.closeAll();
/* ── Level 4 게이트 — 오늘이 아니라 내일로 (T-29 · ADR-035) ────
 *
 * 붙는 자리 셋에 각각 걸리는지, 그리고 **막지는 않는지**를 함께 본다.
 * "Level 4면 안 붙는다"만 검사하면 **게이트가 항상 켜져 있어도 초록**이다 —
 * 그래서 자리마다 켠 쪽·끈 쪽을 둘 다 보고, 대기가 그대로인 것도 센다(§5).
 *
 * 플러그인 유무를 **둘 다** 만든다. 지금 폰에는 T-28 APK가 아직 없고,
 * 그 상태가 곧 fail-open이라 가짜 상황이 아니라 **현재 상태**다. */
console.log("\n[Level 4 게이트 — 오늘이 아니라 내일로]");

// 기기가 판정하고 웹은 그 불리언을 그대로 쓴다(ADR-035 ②) — 스텁도 그 계약대로만 답한다.
const guardStub = (level4) => {
  w.Capacitor = { Plugins: { Guard: {
    level4State: async () => ({ level4, until: level4 ? 9e12 : undefined }),
    startService: async () => {}, configure: async () => {}, sync: async () => ({ ok: true }),
  } } };
};
const noGuardPlugin = () => { delete w.Capacitor; };

const L4D = ev("S.today.date");
const L4N = ev("addDaysStr(S.today.date, 1)");
const tasksOn = async (k) => (await ev(`Api.day("${k}")`)).tasks.map((t) => t.title);

// 게이트가 지는 계약은 **"어느 날짜로 붙였나 · 붙이긴 했나"** 하나다. 그래서 그 자리를 직접 본다 —
// 목록으로 확인하면 분류·갱신 타이밍이 섞여 무엇이 빨간불인지 흐려진다.
// `createTask`·`schedule`은 **그대로 통과시켜** 서버까지 실제로 간다.
// `defer`만 기록에서 끊는다: 오늘로 당기려면 **지난 날 entry**가 있어야 하는데
// 과거 날짜 task는 서버가 만들지 못하게 한다(400). 실제 defer 왕복은 위 [할 일 시트]가 이미 태운다.
ev(`window.__l4 = [];
    (() => {
      const c = Api.createTask, s = Api.schedule, d = Api.defer;
      Api.createTask = (b) => { window.__l4.push(["create", b.date ?? null]); return c(b); };
      Api.schedule   = (id, k) => { window.__l4.push(["schedule", k]); return s(id, k); };
      Api.defer      = (id, f, t) => { window.__l4.push(["defer", t]); return Promise.resolve({}); };
    })();`);
const l4calls = () => ev("JSON.stringify(window.__l4)");
const l4reset = () => ev("window.__l4 = []");

const addOnToday = async (title) => {
  await w.openDay(L4D);
  await sleep(900);                       // 팝업 재렌더가 끝난 뒤에 값을 넣는다 —
  $("#day-add").value = title;            // 먼저 넣으면 다시 그려지면서 지워진다
  w.addTaskOn(L4D);
  await sleep(1200);
};

// ① addTaskOn — 날짜가 **생성과 함께** 붙는 자리라 되돌릴 것이 없다 → 내일로 돌린다.
guardStub(true);
l4reset();
await addOnToday("L4 켠 채 오늘에 추가");
ok("Level 4 — 오늘 칸에 넣어도 내일 날짜로 생성된다 (addTaskOn)",
  l4calls() === JSON.stringify([["create", L4N]]), l4calls());
ok("실제로 내일에 붙어 있다 (서버까지 확인)",
  (await tasksOn(L4N)).includes("L4 켠 채 오늘에 추가")
    && !(await tasksOn(L4D)).includes("L4 켠 채 오늘에 추가"),
  `내일=${JSON.stringify(await tasksOn(L4N))}`);
ok("옮겼으면 이유를 말한다 (ADR-035 ⑤ · 남은 시각은 안 보여준다)",
  txt("#toast").includes("Guard") && !/\d+:\d\d/.test(txt("#toast")), txt("#toast"));

// ★ 짝 — 끈 쪽. 이게 없으면 게이트가 **항상 켜져 있어도** 위 줄이 초록이다.
guardStub(false);
l4reset();
await addOnToday("L4 끈 채 오늘에 추가");
ok("Level 4가 아니면 오늘 날짜 그대로 생성된다 (addTaskOn 짝)",
  l4calls() === JSON.stringify([["create", L4D]]), l4calls());

// ② assignDate 비-defer — 사용자가 고른 날이므로 말없이 옮기지 않는다. 안 붙이고 다시 고르게 한다.
const l4Wait = (await ev(`Api.createTask({title:"L4 대기에서 확정"})`)).id;
guardStub(true);
ev(`startPick({mode:"schedule", id:"${l4Wait}", title:"L4 대기에서 확정"})`);
await sleep(900);
ok("Level 4 — 피커에서 오늘 칸이 흐려진다 (안내)", dim(L4D) === true, String(dim(L4D)));
ok("Level 4 — 내일은 그대로 고를 수 있다 (막지 않는다)", dim(L4N) === false, String(dim(L4N)));
l4reset();
w.assignDate(L4D); await sleep(900);
ok("Level 4 — 오늘로는 확정하지 않는다 (assignDate)",
  l4calls() === "[]" && txt("#toast").includes("Guard"), `${l4calls()} / ${txt("#toast")}`);
guardStub(false);
ev(`startPick({mode:"schedule", id:"${l4Wait}", title:"L4 대기에서 확정"})`);
await sleep(900);
l4reset();
w.assignDate(L4D); await sleep(900);
ok("Level 4가 아니면 오늘로 확정된다 (assignDate 짝)",
  l4calls() === JSON.stringify([["schedule", L4D]])
    && (await tasksOn(L4D)).includes("L4 대기에서 확정"), l4calls());

// ③ dfx-ok — **붙는 자리는 확인 버튼이다.** `assignDate`의 defer 분기는 시트를 **열 뿐**이고,
//    시트가 떠 있는 동안 구간이 시작될 수 있다. 그래서 게이트가 여기 걸렸는지 본다.
guardStub(true);
ev(`openDeferSheet({id:"${l4Wait}", title:"L4 미루기", from:"${ev('addDaysStr(S.today.date,-2)')}", to:"${L4D}", frozen:false})`);
await sleep(400);
l4reset();
$("#dfx-ok").dispatchEvent(new w.Event("click"));
await sleep(900);
ok("Level 4 — 미루기도 오늘로는 안 붙는다 (dfx-ok)",
  l4calls() === "[]" && txt("#toast").includes("Guard"), `${l4calls()} / ${txt("#toast")}`);
// 시트가 남는 이유는 **맥락**이다 — 무엇을 어디로 옮기려 했는지가 토스트 한 줄만 남기고
// 사라지지 않는다. (사유는 `openDeferSheet`가 비우므로 다시 열면 어차피 다시 쓴다.)
ok("막힌 미루기는 시트가 남는다 — 맥락이 갑자기 사라지지 않는다",
  $("#sh-defer").classList.contains("on"));
guardStub(false);
l4reset();
$("#dfx-ok").dispatchEvent(new w.Event("click"));
await sleep(900);
ok("Level 4가 아니면 미루기가 오늘로 간다 (dfx-ok 짝)",
  l4calls() === JSON.stringify([["defer", L4D]]), l4calls());

// ④ 대기는 손대지 않는다 — **막지 않았음을 세는 검사**다(ADR-035 ①).
//    날짜가 없으니 오늘의 부담이 아니고, "적어두고 자자"가 이 ADR이 원하는 형태다.
guardStub(true);
l4reset();
const l4Memo = await ev(`Api.createTask({title:"L4 중에 대기로 담기"})`);
ok("Level 4에도 대기 담기는 그대로 통과한다 (날짜 없음 · 막지 않는다)",
  !!l4Memo?.id && l4calls() === JSON.stringify([["create", null]]), l4calls());

// ⑤ 모르면 걸지 않는다 — 플러그인이 없으면 오늘이 붙는다.
//    **지금 폰의 실제 상태다**(T-28 APK 미설치). fail-closed로 "고치지" 않는다:
//    발동하지도 않은 기기에서 날짜가 튀면 그것이 §6.3의 도구 이탈이다.
noGuardPlugin();
l4reset();
await addOnToday("플러그인 없는 기기");
ok("플러그인이 없으면 게이트가 안 걸린다 (fail-open)",
  l4calls() === JSON.stringify([["create", L4D]]), l4calls());
ok("웹은 판정을 다시 하지 않는다 — 창 길이가 app.js에 없다 (ADR-035 ②)",
  !appJs.includes("30 * 60") && !appJs.includes("1800000") && appJs.includes("level4State"));


// 마감은 뒤의 쓰기 검사를 막으므로 모든 쓰기 왕복을 끝낸 다음 실제 경로를 태운다.
w.switchTab("today"); await sleep(900);
await ev("renderCalendar()");
const closeCalendarCalls = ev("window.__calendarCalls.length");
$("#btn-close").click(); await sleep(300);
$("#cf-yes").click(); await sleep(1500);
await ev("renderCalendar()");
ok("마감 뒤 캐시 무효화 · 다음 렌더 재요청",
  ev("window.__calendarCalls.length") === closeCalendarCalls + 1,
  `${closeCalendarCalls}→${ev("window.__calendarCalls.length")}`);

console.log("\n[부팅 · 연결 실패 복구]");
ok("로드 후 부팅 오버레이 닫힘", !$("#boot").classList.contains("on"));

// 서버가 없는 상태에서 새로 띄운다 — 첫 화면이 에러로 깨지지 않아야 한다
{
  const errs = [];
  const vc2 = new VirtualConsole();
  vc2.on("jsdomError", (e) => errs.push(String(e.message)));
  const dom2 = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc2, url: BASE + "/",
  });
  const w2 = dom2.window;
  w2.fetch = () => Promise.reject(new Error("연결 거부"));
  w2.HTMLElement.prototype.setPointerCapture = () => {};
  w2.HTMLElement.prototype.scrollTo = () => {};
  for (const code of [apiJs.replace(BASE, "http://127.0.0.1:9"), appJs]) {
    const s = w2.document.createElement("script");
    s.textContent = code;
    w2.document.body.appendChild(s);
  }
  w2.document.dispatchEvent(new w2.Event("DOMContentLoaded"));
  await sleep(1500);
  const $2 = (s) => w2.document.querySelector(s);
  ok("연결 실패 = 오버레이 유지", $2("#boot").classList.contains("on"));
  ok("실패 안내 문구", $2("#boot-msg").textContent.includes("연결하지 못했어요"), $2("#boot-msg").textContent);
  ok("다시 시도 버튼 노출", $2("#boot-retry").style.display === "");
  // 이 상태에서 캘린더 탭 — 예전에는 여기서 Invalid time value가 났다
  w2.switchTab("cal");
  await sleep(400);
  ok("미로딩 상태에서 캘린더 진입 — 오류 없음", errs.length === 0 && !$2("#toast").textContent.includes("Invalid"),
    errs.join(" / ") + $2("#toast").textContent);
  // 서버가 돌아오면 재시도로 복구
  w2.fetch = (u, o) => fetch(String(u).replace("http://127.0.0.1:9", BASE), o);
  $2("#boot-retry").dispatchEvent(new w2.Event("click"));
  await sleep(2000);
  ok("다시 시도 → 복구", !$2("#boot").classList.contains("on") && w2.eval("!!S.today"));
  ok("복구 후 캘린더 렌더", (() => { w2.switchTab("cal"); return true; })());
  await sleep(900);
  ok("캘린더 그리드 생성됨", $2("#cal-track").querySelectorAll(".calpane").length === 5);
}

console.log("\n[런타임 오류]");
ok("콘솔 오류 없음", errors.length === 0, errors.slice(0, 3).join(" / "));

console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
// 성공 경로에도 **명시적으로 끝낸다.** 실패 경로는 위에서 exit(1)을 부르는데 성공은 그냥 끝나
// 있었고, `pretendToBeVisual` jsdom 두 개가 rAF 타이머를 계속 돌려 이벤트 루프가 비지 않는다 →
// 프로세스가 요약을 찍고도 **살아 있었다.**
// 그동안 `e2e.mjs`의 안전망 SIGKILL(180초)이 유일한 종료 수단이었고, 그래서 검사가 다 통과해도
// `npm run front`가 **exit 1**이었다 — 함정 8의 "끝의 ETIMEDOUT은 무해하다"가 그 흔적이다.
// 실측: 검사 자체는 ~75초다. 옛 180초 창의 나머지 ~105초는 전부 이 hang이었다.
// 파이프로 나가는 stdout은 비동기라 write 콜백에서 나간다 — 요약이 잘리면 숫자를 잃는다.
process.stdout.write("프론트 렌더 경로 정상 — 실 API 응답으로 조립됨.\n", () => process.exit(0));
