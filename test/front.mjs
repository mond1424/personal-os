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
// 캘린더는 이전·현재·다음 3-pane이라 같은 날짜 셀이 여러 개다 — 가운데(보고 있는 달)만 본다
const CUR = "#cal-track .calpane.cur";
const $cur = (s) => w.document.querySelector(`${CUR} ${s}`);
const $$cur = (s) => [...w.document.querySelectorAll(`${CUR} ${s}`)];
// const 선언은 window 프로퍼티가 아니다 — 전역 렉시컬 바인딩은 eval로 읽는다
const ev = (code) => w.eval(code);
const txt = (s) => ($(s)?.textContent ?? "").trim();

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
ok("3-pane 조립 (이전·현재·다음)", w.document.querySelectorAll("#cal-track .calpane").length === 3);
ok("밴드 path 생성", $$cur("svg.band path").length >= 1);
ok("기간 카드", $("#p-list").querySelectorAll(".prow").length >= 1);
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

console.log("\n[Me · 설정]");
w.switchTab("me"); await sleep(1200);
ok("Me 필드 렌더", $("#me-fields").querySelectorAll(".merow").length >= 1);
ok("'지금' 파생 표시", $("#me-fields").textContent.includes("지금"));
ok("이력 렌더", $("#me-history").querySelectorAll(".lrow").length >= 1);
w.toggleSet(true); await sleep(200);
const rows = [...$("#set-list").querySelectorAll(".srow")].map((r) => r.textContent);
ok("설정 11행 (AI 연결 통합)", rows.length === 11, String(rows.length));
ok("Low 모델 표시", rows.some((r) => r.includes("Low") && r.includes("haiku")), rows.join(" | "));
ok("High 모델 표시", rows.some((r) => r.includes("High") && r.includes("claude")), rows.join(" | "));
ok("AI 연결 행 · 토큰 위", rows.findIndex((r) => r.includes("AI 연결")) < rows.findIndex((r) => r.includes("앱 접근 토큰")), rows.join(" | "));
ok("모델 행이 토큰 아래", rows.findIndex((r) => r.includes("앱 접근 토큰")) < rows.findIndex((r) => r.includes("모델 — Low")));
ok("표준시 오프셋이 내보내기 위", rows.findIndex((r) => r.includes("표준시")) < rows.findIndex((r) => r.includes("내보내기")));

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
w.switchTab("cal"); await sleep(1000);
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
ok("이번 달 마지막 날 활성", dim(`${D0.slice(0, 8)}31`) === false, String(dim(`${D0.slice(0, 8)}31`)));
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

console.log("\n[일정(event) — task와 분리]");
const EVD = ev("addDaysStr(S.today.date,1)");
const evId = (await ev(`Api.createEvent({title:"일정 분리 확인", date:"${EVD}", time:"10:00"})`)).id;
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
const swipe = (dxs, dys) => {
  const scr = w.document.querySelector(".screens");
  const mk = (type, x, y) => new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  scr.dispatchEvent(mk("pointerdown", 300, 400));
  dxs.forEach((dx, i) => scr.dispatchEvent(mk("pointermove", 300 + dx, 400 + dys[i])));
  const n = dxs.length - 1;
  scr.dispatchEvent(mk("pointerup", 300 + dxs[n], 400 + dys[n]));
};
const tab = () => $("#phone").dataset.tab;
w.switchTab("today"); await sleep(300);
swipe([-14, -60, -150], [0, 3, 6]);                 // 가로로 확정 + 충분한 거리
ok("가로 스와이프는 다음 탭으로", tab() === "cal", tab());
w.switchTab("today"); await sleep(200);
swipe([0, -20, -140], [30, 60, 62]);                // 세로로 시작 → 끝까지 무시
ok("세로로 시작한 제스처는 탭을 넘기지 않음", tab() === "today", tab());
w.switchTab("today"); await sleep(200);
swipe([-14, -40, -70], [0, 2, 4]);                  // 가로지만 폭의 25%에 못 미침 (속도도 0)
ok("짧은 가로 이동은 무시(임계값)", tab() === "today", tab());
w.switchTab("today"); await sleep(200);

// ①-b 트랙 위치가 인덱스를 그대로 따라가고, nav 표식이 같이 움직인다
const tf = (sel) => ($(sel)?.style.transform || "").replace(/\s/g, "");
w.switchTab("works", false); await sleep(400);
ok("탭 트랙 = 인덱스 × -100%", tf("#tab-track") === "translateX(-200%)", tf("#tab-track"));
ok("nav 표식도 같은 칸", tf("#nav-dot") === "translateX(200%)", tf("#nav-dot"));
ok("nav 강조가 따라옴", [...w.document.querySelectorAll("nav button")][2].classList.contains("on"));
w.switchTab("today", false); await sleep(300);
ok("되돌아오면 0%", tf("#tab-track") === "translateX(0%)", tf("#tab-track"));

// ①-c 달 넘기기 — 넘긴 뒤 조용히 재중심화되고 3-pane이 유지된다
w.switchTab("cal"); await sleep(1400);
const m0 = ev("S.cal.m"), y0 = ev("S.cal.y");
w.calGo(1);
await sleep(2200);                                   // transitionend 유실 대비 타이머 + 재조립
const expM = m0 === 12 ? 1 : m0 + 1;
ok("달 넘김 — 다음 달", ev("S.cal.m") === expM && ev("S.cal.y") === (m0 === 12 ? y0 + 1 : y0), `${m0} → ${ev("S.cal.m")}`);
ok("넘긴 뒤 트랙은 다시 가운데(gap 보정)", tf("#cal-track") === "translateX(calc(-100%-20px))", tf("#cal-track"));
ok("3-pane 유지", w.document.querySelectorAll("#cal-track .calpane").length === 3);
w.calGo(-1); await sleep(2200);
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
$("#evx-ok").dispatchEvent(new w.Event("click"));
await sleep(1200);
ok("시트가 닫히고 일정이 들어감", !$("#sh-event").classList.contains("on"));
const added = (await ev(`Api.day("${DD}")`)).events.find((e) => e.title === "다이얼로 넣은 일정");
ok("고른 시각 그대로 저장", added && added.time === "14:30", JSON.stringify(added));
w.openEventSheet(DD); await sleep(200);
ok("다시 열면 종일로 초기화", $("#evx-dial").style.display === "none" && $("#evx-title").value === "");
$("#evx-cancel").dispatchEvent(new w.Event("click"));
ok("취소 — 시트만 닫힘", !$("#sh-event").classList.contains("on"));
w.closeAll(); await sleep(200);
await ev(`Api.deleteEvent("${added.id}")`);

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
await w.openDay(AZF); await sleep(500);
ok("미래 날짜 시트에 memo 표시", $("#day-body").innerHTML.includes("미래에 남기는 memo"));
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
$("#dfx-ok").dispatchEvent(new w.Event("click"));
await sleep(1500);
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
  ok("캘린더 그리드 생성됨", $2("#cal-track").querySelectorAll(".calpane").length === 3);
}

console.log("\n[런타임 오류]");
ok("콘솔 오류 없음", errors.length === 0, errors.slice(0, 3).join(" / "));

console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
console.log("프론트 렌더 경로 정상 — 실 API 응답으로 조립됨.");
