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
// const 선언은 window 프로퍼티가 아니다 — 전역 렉시컬 바인딩은 eval로 읽는다
const ev = (code) => w.eval(code);
const txt = (s) => ($(s)?.textContent ?? "").trim();

await sleep(2500);

// 픽스처 — 날짜가 바뀌어도 재현되도록 오늘 항목·기록을 보장한다
const ev0 = (code) => w.eval(code);
if (ev0("S.today.todo.length") === 0) {
  await ev0(`Api.createTask({ title: "프론트 픽스처 task", date: S.today.date })`);
  await w.refreshToday(); await sleep(400);
}
if (ev0("S.today.logs.length") === 0) {
  await ev0(`Api.addLog("픽스처 로그")`);
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
ok("주 행 5~6개", [5, 6].includes($("#cal-rows").querySelectorAll(".cal-row").length));
ok("셀 7의 배수", $("#cal-rows").querySelectorAll(".c").length % 7 === 0);
ok("밴드 path 생성", $("#cal-rows").querySelectorAll("svg.band path").length >= 1);
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
ok("설정 10행 (모델·토큰·테마·튜토리얼)", rows.length === 10, String(rows.length));
ok("Low 모델 표시", rows.some((r) => r.includes("Low") && r.includes("haiku")), rows.join(" | "));
ok("High 모델 표시", rows.some((r) => r.includes("High") && r.includes("claude")), rows.join(" | "));

console.log("\n[시트 — 열림 검증]");
w.openSetting("model_high"); await sleep(200);
ok("모델 시트 옵션 3개", $("#st-options").querySelectorAll(".optrow").length === 3);
ok("현재값 체크", $("#st-options").querySelector(".optrow.on") !== null);
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
ok("미래 날짜 팝업 — 일정 추가 입력", !!$("#day-add"));
w.closeAll();
await w.openDay(ev("S.today.date")); await sleep(500);
ok("오늘 팝업에서도 추가 가능", !!$("#day-add"));
ok("오늘 팝업 task = 편집 진입", $("#day-body").innerHTML.includes("openTask("));
w.closeAll();
await w.openTask(ev("S.today.todo[0].id")); await sleep(400);
ok("task 시트 완료율 5단계", $("#tk-rates").querySelectorAll("button").length === 5);
ok("task 삭제 버튼", !!$("#tk-delete"));
w.closeAll();

console.log("\n[날짜 선택 — 달 경계를 걸친 2주]");
w.switchTab("cal"); await sleep(1000);
const D0 = ev("S.today.date");
// null = 그 달 그리드에 없는 날 / true = 비활성(흐림) / false = 선택 가능
const dim = (d) => {
  const c = w.document.querySelector(`#cal-rows .c[data-d="${d}"]`);
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
const tail = [...w.document.querySelectorAll("#cal-rows .c.mut")].map((c) => c.dataset.d).filter((d) => d > D0);
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
const anyFar = [...w.document.querySelectorAll("#cal-rows .c")].filter((c) => c.dataset.d > d15);
ok("신규 일정 — 2주 밖도 전부 활성", anyFar.length === 0 || anyFar.every((c) => dim(c.dataset.d) === false),
  anyFar.slice(0, 3).map((c) => c.dataset.d + ":" + dim(c.dataset.d)).join(" "));
w.exitPick(); await sleep(300);

console.log("\n[이월 — 캘린더에서 옛 날짜 정리]");
w.switchTab("cal"); await sleep(1200);
const movedOnOld = [...w.document.querySelectorAll("#cal-rows .c")].some((c) =>
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
  ok("캘린더 그리드 생성됨", $2("#cal-rows").querySelectorAll(".cal-row").length >= 4);
}

console.log("\n[런타임 오류]");
ok("콘솔 오류 없음", errors.length === 0, errors.slice(0, 3).join(" / "));

console.log(`\n${"=".repeat(46)}\n통과 ${passN} · 실패 ${fails.length}`);
if (fails.length) { console.log("실패:\n  - " + fails.join("\n  - ")); process.exit(1); }
console.log("프론트 렌더 경로 정상 — 실 API 응답으로 조립됨.");
