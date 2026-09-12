// 프론트 E2E — jsdom에 index.html + api.js + app.js를 올리고
// 실행 중인 wrangler dev(기본 8788)에 실제 fetch로 붙는다.
// 렌더 경로의 런타임 오류·조립 결과를 잡는 용도. 사용: node test/front.mjs [base]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { EXIT_OK, EXIT_FAILED, EXIT_ABORTED } from "./runner-exit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:8788";
const html = readFileSync(join(here, "../public/index.html"), "utf8");
// ⚠️ **`\r?\n`이다.** LF만 받으면 **CRLF로 체크아웃된 트리에서 이 치환이 통째로 빗나가고**,
//    `API_BASE`가 상대 경로("/api")로 남아 node fetch가 URL을 못 만든다. 그 결과는
//    *"부팅 실패 — 서버가 켜져 있는지 확인하세요"* 라서 **서버 탓처럼 보인다**(실제로 그렇게 보였다).
//    Windows에서 `git stash`·`checkout` 한 번이면 재현된다 — autocrlf가 파일을 CRLF로 다시 쓴다.
const apiJs = readFileSync(join(here, "../public/api.js"), "utf8")
  .replace(/const API_BASE =[\s\S]*?;\r?\n/, `const API_BASE = ${JSON.stringify(BASE + "/api")};\n`);
// **치환이 빗나가면 여기서 이름을 말하고 죽는다.** 안 그러면 20초 뒤에 엉뚱한 곳을 가리킨다(T-06).
if (!apiJs.includes(JSON.stringify(BASE + "/api"))) {
  console.error("✗ api.js의 API_BASE 치환이 빗나갔다 — 선언 모양이 바뀌었거나 줄끝이 예상 밖이다.");
  process.exit(1);
}
const appJs = readFileSync(join(here, "../public/app.js"), "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(String(e.message)));
vc.on("error", (...a) => errors.push(a.join(" ")));
// 페이지 안에서 난 **처리되지 않은 거절**은 여기서 받지 않으면 node가 프로세스를 통째로 죽인다 —
// 그러면 통과/실패 요약이 아예 안 찍혀 **숫자를 잃는다.** 실패가 어디였는지도 안 남는다.
// (T-44 변이 D에서 실제로 그랬다: `renderToday`가 던지자 러너가 raw 스택만 남기고 끝났다.)
// **이름을 남기고 계속 간다** — 아래 '콘솔 오류 없음'이 그것을 센다(T-06의 방향).
process.on("unhandledRejection", (e) =>
  errors.push("처리되지 않은 거절: " + (e && e.message ? e.message : String(e))));

// 브라우저와 동일하게 <script> 태그로 주입한다 (eval은 전역 렉시컬 스코프가 갈린다)
const dom = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, url: BASE + "/",
});
const w = dom.window;
/** jsdom 창을 node 의 `fetch` 에 잇는다.
 *
 * ⚠️ **`fetch` 만 갈아 끼우면 안 된다** — jsdom 의 `AbortSignal` 은 node 의 것과 **다른 클래스**라
 * `api.js` 가 만든 signal 을 node fetch 가 통째로 거절한다(실측:
 * `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal`).
 * 브라우저에는 이 틈이 없다 — **하니스가 두 런타임을 이으면서 생긴 틈이라 하니스가 메운다.**
 */
const bridgeFetch = (win, impl) => {
  win.AbortController = AbortController;
  win.AbortSignal = AbortSignal;
  win.fetch = impl;
};
bridgeFetch(w, (u, o) => fetch(u, o));
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
/**
 * 조건이 참이 될 때까지 — **상한을 두고** 기다린다.
 *
 * 고정 `sleep(200)`은 상한이 아니라 **추측**이다: 그 사이에 실 API 왕복이 끼면 느린 실행에서
 * 거짓 실패가 난다(T-42 ④가 실제로 그랬다 — 같은 코드가 실행마다 갈렸다).
 * 빠른 실행에서는 첫 검사에서 바로 지나가므로 전체 시간은 오히려 준다.
 */
const until = async (fn, ms = 3000, step = 25) => {
  const started = Date.now();
  for (;;) {
    if (fn()) return true;
    if (Date.now() - started >= ms) return false;
    await sleep(step);
  }
};
let passN = 0; const fails = [];
const ok = (name, cond, detail = "") => {
  runner.last = name;   // 중단하면 **마지막으로 지난 검사**가 어디서 막혔는지를 가리킨다 (함정 8)
  if (cond) { passN++; console.log(`  ✓ ${name}`); }
  else { fails.push(name); console.log(`  ✗ ${name} ${detail}`); }
};

/* ── 러너는 무엇이 던져도 요약을 낸다 (T-67 · 함정 8) ─────────────────────────
 *
 * **T-66이 여기서 배터리를 못 믿게 됐다.** 워커가 응답을 놓치면 `api.js`의 15초 상한이
 * 거절하고, 그 거절이 **최상위 `await`** 를 타고 올라와 프로세스가 죽었다 — `통과 N · 실패 M`
 * 줄이 아예 안 찍히고, 배터리는 그것을 *"아무도 안 죽었다"* 로 읽었다(AGENT-CHAIN §8).
 *
 * ★ **실측 셋이 이 설계를 정했다** (2026-09-09 · 이 티켓에서 직접 재 봤다):
 * ```
 * jsdom 타이머가 throw   →  virtualConsole 의 jsdomError 로 간다. 프로세스는 산다
 * 떠돌이 Promise.reject  →  unhandledRejection (위 핸들러가 이미 받는다)
 * 최상위 await 거절      →  ★ uncaughtException 으로 온다 — T-66이 죽은 자리
 * ```
 * ⚠️ **그래서 *"받아서 기록하고 계속 간다"* 로는 안 된다.** 최상위 `await`가 거절하면
 * **모듈 본문은 이미 끝난 것**이라 계속 갈 곳이 없다. 핸들러만 달면 프로세스가
 * **exit 0으로 조용히 끝나거나**(잰 값이다) jsdom rAF 때문에 **420초 hang**이 된다 —
 * 둘 다 *"요약 없음"* 이고, **앞은 초록으로 보여서 더 나쁘다.**
 *
 * **그래서 가드는 계속 가는 장치가 아니라 요약을 내는 장치다:**
 *   ① 사유를 남긴다(`errors`) — 조용히 지나가지 않는다
 *   ② 종료 코드를 '중단'으로 못 박는다 — 나중에 정상 종료해도 초록이 안 된다
 *   ③ 러너가 정말 죽었으면 요약을 내고 끝낸다. 살아 있으면 아무것도 안 한다
 *      (판정은 **검사 수가 늘었는가** — 남의 관측이 아니라 러너 자신의 계수다)
 */
const runner = { aborted: null, watch: null, emitted: false, last: "(아직 없음)" };
const errText = (e) => {
  const msg = e && e.message ? e.message : String(e);
  const at = String((e && e.stack) || "").split("\n")[1];
  return at ? `${msg} @${at.trim()}` : msg;
};
const SUMMARY_RULE = "=".repeat(46);
const summaryBody = () => {
  let out = `\n${SUMMARY_RULE}\n통과 ${passN} · 실패 ${fails.length}\n`;
  if (fails.length) out += "실패:\n  - " + fails.join("\n  - ") + "\n";
  return out;
};
/** 요약을 낸다. **어디로 끝나든 여기 하나를 지난다** — 두 벌이 되면 한쪽만 낡는다.
 *  파이프로 나가는 stdout은 비동기라 **write 콜백에서** 끝낸다(요약이 잘리면 숫자를 잃는다). */
const emitSummary = (why = null) => {
  if (runner.emitted) return;
  runner.emitted = true;
  let out = summaryBody();
  if (why) {
    out += `★ 중단 — ${why}\n`
      + `  마지막으로 지난 검사: ${runner.last}\n`
      + "  위 숫자는 도중까지의 것이다. **요약 없는 런과 실패 0인 런은 다른 것이다.**\n";
  } else if (!fails.length) {
    out += "프론트 렌더 경로 정상 — 실 API 응답으로 조립됨.\n";
  }
  const code = why ? EXIT_ABORTED : (fails.length ? EXIT_FAILED : EXIT_OK);
  process.stdout.write(out, () => process.exit(code));
};
/** 마지막 방벽 — **죽어서 나가든 살아서 나가든 요약은 남는다.**
 *  `exit` 핸들러에서는 동기 출력만 산다(콜백을 기다려 줄 루프가 이미 없다). */
process.on("exit", () => {
  if (runner.emitted) return;
  runner.emitted = true;
  process.stdout.write(summaryBody()
    + `★ 중단 — ${runner.aborted ?? "러너가 요약 전에 끝났다"}\n`
    + `  마지막으로 지난 검사: ${runner.last}\n`);
});
/** 러너가 죽었는지 살았는지 기다려 보는 창. **앱의 상한(15초)보다 넉넉히 길어야**
 *  느린 왕복 하나를 죽음으로 오해하지 않는다. e2e 안전망(420초)보다는 훨씬 짧다. */
const ABORT_IDLE_MS = 60_000;
process.on("uncaughtException", (e) => {
  const why = `잡히지 않은 예외 — ${errText(e)}`;
  runner.aborted = why;
  errors.push(why);                       // ① 사유가 남는다
  process.exitCode = EXIT_ABORTED;        // ② 나중에 정상 종료해도 초록이 아니다
  const mark = passN + fails.length;
  clearTimeout(runner.watch);
  runner.watch = setTimeout(() => {       // ③ 검사가 하나도 안 늘었으면 러너가 죽은 것이다
    if (passN + fails.length === mark) emitSummary(why);
  }, ABORT_IDLE_MS);
});

/**
 * 상한을 둔 `await` — **러너의 모든 대기에 상한이 있다**(함정 8)의 그 상한이다.
 *
 * ⚠️ `until`과 다르다: `until`은 **조건**을 폴링하고 이것은 **프라미스**를 기다린다.
 * 프라미스가 영영 안 정산되면 `until`은 도움이 안 된다 — 그 자리가 T-66이 물린 곳이다.
 *
 * **상한은 30초**: 앱 자신의 상한(`api.js`의 `REQ_TIMEOUT_MS` 15초)의 두 배다. 그래야
 * **앱의 이름 붙은 거절이 항상 먼저 도착하고**(*"응답이 안 와요"*), 이 상한은 프라미스가
 * **아예 정산되지 않는** 경우만 잡는다. 앱보다 짧으면 이쪽이 먼저 터져 원인을 가린다.
 */
const CAP_MS = 30_000;
const capped = (name, p, ms = CAP_MS) => {
  let timer;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`상한 ${ms / 1000}초 초과 — 막힌 자리: ${name}`)), ms);
    }),
  ]);
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
  // **여기도 요약을 내고 끝낸다** (T-67) — 예전엔 `exit(1)`이라 *"요약 없이 죽은 런"* 과
  // 종료 코드가 같았고, e2e가 둘을 못 갈랐다. 사유는 이름으로 남는다.
  console.log("✗ 부팅 실패 — 서버가 켜져 있는지, 토큰이 필요한지 확인하세요.");
  emitSummary("부팅 실패 — 화면 메시지: "
    + (w.document.querySelector("#boot-msg")?.textContent ?? "(없음)"));
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

/* ── T-67 · 러너는 무엇이 던져도 요약을 낸다 ─────────────────────────────────
 *
 * **T-66에서 배터리가 거짓말을 했다.** 워커가 응답을 놓치자 러너가 `통과 N · 실패 M` 줄을
 * 못 내고 끝났고, 배터리는 **요약 없음을 *"아무도 안 죽었다"* 로** 읽었다 — 그 순간
 * 변이표 전체가 근거를 잃는다(AGENT-CHAIN §8).
 *
 * ⚠️ **환경을 기다리지 않는다**(함정 14). 일부러 던지는 타이머를 심어 **계약**을 만든다 —
 *    19:15의 그 실패는 이 계약의 한 사례일 뿐이다.
 * ★ **이 블록은 일부러 앞에 있다.** 뒤에 두면 러너가 죽는 그 런에서 **이 검사부터 사라진다** —
 *    자를 재는 검사가 대상보다 뒤에 있으면 안 된다.
 * ⚠️ **하네스를 최종 트리에 남긴다**(담당 결정). 두 경로(jsdom 타이머 · uncaughtException)는
 *    **node·jsdom 판이 바뀌면 갈라진다** — 실제로 이 티켓이 티켓의 전제 하나를 정정했다.
 *    빼면 그 정정을 아무도 다시 못 센다. 비용은 왕복 없는 0.3초다.
 */
console.log("\n[T-67] 러너 — 무엇이 던져도 요약을 낸다");

const T67_A = "T-67 하네스 A — jsdom 타이머가 던진다";
const T67_B = "T-67 하네스 B — 최상위 await 가 거절하는 그 자리";
const t67ErrBefore = errors.length, t67FailsBefore = fails.length;
const t67ExitBefore = process.exitCode;

/* 1 — **jsdom 타이머가 던지는 경로.** 실측으로 갈랐다(2026-09-09): 이것은
 *     `uncaughtException`이 아니라 **virtualConsole 의 `jsdomError`** 로 가고 **프로세스는 산다.**
 *     ⚠️ 티켓은 이 둘을 한 경로로 적었는데 **아니었다** — 그래서 둘을 따로 센다.
 *     증거는 *"이 검사가 실행됐다"* 가 아니라 **던진 뒤에 심은 타이머가 돌았는가**다. */
let t67Alive = false;
w.setTimeout(() => { throw new Error(T67_A); }, 0);
w.setTimeout(() => { t67Alive = true; }, 20);
await sleep(300);
ok("1 ★ 타이머 콜백에서 던져도 러너가 안 죽는다 — 그 뒤의 타이머가 계속 돈다",
  t67Alive === true, `살아있나=${t67Alive}`);

/* 1b — ★ **T-66이 실제로 죽은 자리.** 최상위 `await`가 거절하면 node 는 그것을
 *      `uncaughtException`으로 올린다(실측). 그때 **모듈 본문은 이미 끝난 것**이라
 *      *"기록하고 계속 간다"* 가 성립하지 않는다 — 가드가 **종료 코드를 못 박고 요약을 낼
 *      채비**를 해야 한다. 안 그러면 프로세스가 **exit 0으로 조용히** 끝난다(그것도 실측이다).
 *      여기서는 그 예외를 **직접 쏘아** 가드의 반응만 본다(러너는 안 죽인다). */
process.emit("uncaughtException", new Error(T67_B));
/* ⚠️ **`fails.length`를 여기서 찍는다 — 아래 검사들이 돌기 전에.** 6이 재려는 것은
 *   *"가드가 **스스로** 실패를 만들었는가"* 인데, 나중에 재면 **1b·3이 빨간불일 때 그 값이
 *   같이 움직여** 6이 딸려 죽는다(실측: M1에서 셋이 함께 죽었다). 남의 관측값을 자로 쓰는
 *   그 모양이고, T-64가 좁힌 자리와 같다. **자는 가드가 만지는 순간의 값이어야 한다.** */
const t67Guard = { code: process.exitCode, armed: !!runner.watch, why: runner.aborted,
  failsAfter: fails.length };
clearTimeout(runner.watch); runner.watch = null; runner.aborted = null;
process.exitCode = t67ExitBefore;          // 이 런은 중단된 것이 아니다 — 원복한다
ok("1b ★ 최상위 await 거절이 오는 자리를 가드가 받는다 — 종료 코드가 '중단'이 되고 감시가 걸린다",
  t67Guard.code === EXIT_ABORTED && t67Guard.armed === true,
  `코드=${t67Guard.code}(기대 ${EXIT_ABORTED}) 감시=${t67Guard.armed}`);

// 우리가 심은 것만 걷어낸다 — 아래 '콘솔 오류 없음'이 하네스를 회귀로 읽으면 안 된다.
const t67Planted = errors.splice(t67ErrBefore);

/* 3 — **조용히 지나가지 않는다.** 삼키면 T-54가 없앤 부류가 검사 층에 생긴다.
 *     ⚠️ 1·1b와 세는 것이 다르다: 저쪽은 **살아남았는가·코드가 바뀌었는가**이고
 *     여기는 **무엇이 던졌는지가 글자로 남았는가**다. 스택 첫 줄까지 본다 — 메시지만으론
 *     같은 문구를 내는 두 자리를 못 가른다. */
ok("3 ★ 던진 것의 사유가 남는다 — 메시지와 스택 첫 줄이 (조용히 안 지나간다)",
  t67Planted.some((e) => e.includes(T67_A))
  && t67Planted.some((e) => e.includes(T67_B) && /@\s*at /.test(e)),
  `${t67Planted.length}건: ${t67Planted.map((e) => e.slice(0, 60)).join(" | ")}`);

/* 6 — **회귀.** 가드가 정상 검사까지 실패로 세면 안 되고, 자기가 심지 않은 것을
 *     주워 담아도 안 된다. 종료 코드도 원래대로 돌아와 있어야 한다. */
ok("6 정상 런은 그대로다 — 가드가 심은 것만 먹고 검사·종료 코드를 안 건드린다",
  t67Guard.failsAfter === t67FailsBefore && errors.length === t67ErrBefore
  && process.exitCode === t67ExitBefore
  && t67Planted.length > 0
  && t67Planted.every((e) => e.includes(T67_A) || e.includes(T67_B)),
  `가드직후실패=${t67Guard.failsAfter}(전 ${t67FailsBefore}) errors=${errors.length}(전 ${t67ErrBefore})`
  + ` 코드=${process.exitCode} 심은것=${t67Planted.length}`);

/* 4 — **상한 없는 대기가 없다** (스캐너). 함정 8이 *"러너의 모든 대기에 상한이 있다"* 고
 *     적는데 T-47 ⑧ 앞의 한 자리가 비어 있었다. **소스를 읽어 센다** — 그 자리가 다시
 *     맨 `await` + `ev(`로 돌아가면 여기가 죽는다.
 *     ⚠️ **파일 전체를 재지 않는다.** 그 꼴은 85곳이고 대부분 렌더 호출이다 —
 *     전부 감싸는 것은 이 티켓의 범위가 아니다(§보고에 이름만 올렸다).
 *     ★ **찾을 꼴을 쪼개서 조립한다.** 통짜로 적으면 **바로 아래 짝의 합성 문자열을
 *     스캐너가 자기 소스에서 읽어** 늘 빨간불이다 — 실제로 한 번 그렇게 나왔다.
 *     검사가 자기 자신을 대상으로 읽는 자리이고, T-55(검사와 구현이 같은 이름을 공유한다)의
 *     사촌이다. 쪼개면 파일 어디에도 그 꼴이 연속으로 남지 않는다. */
const t67Src = readFileSync(join(here, "front.mjs"), "utf8");
const T67_BARE = "t47After = await " + "ev(";
const T67_CAP = "t47After = await " + "capped(";
const t67Capped = (src) => src.includes(T67_CAP) && !src.includes(T67_BARE);
ok("4 ★ T-47 ⑧ 앞의 대기가 상한을 지난다 (스캐너 — 함정 8의 빈칸이었다)",
  t67Capped(t67Src),
  `감쌈=${t67Src.includes(T67_CAP)} 맨대기=${t67Src.includes(T67_BARE)}`);

// 4의 짝 ★ 스캐너가 살아 있는가 — 합성 소스로 가른다(T-55 7의 짝과 같은 자리).
ok("4 ★ 4의 스캐너가 살아 있다 (맨 대기를 잡고 감싼 것은 안 잡는다)",
  !t67Capped("const " + T67_BARE + "`Api.task(x)`);")
  && t67Capped(T67_CAP + '"이름", ev(`Api.task(x)`));'));

/* 5 — **함정 8의 계약**: 막히면 **어디서** 막혔는지를 말한다. 이름 없는 상한은
 *     *"뭔가 느렸다"* 만 남기고, 그건 아무 데도 못 가리킨다. */
const t67Stuck = await capped("여기가 막혔다", new Promise(() => {}), 120)
  .then(() => null, (e) => e.message);
ok("5 ★ 상한에 걸리면 막힌 자리를 이름으로 말한다",
  typeof t67Stuck === "string" && t67Stuck.includes("여기가 막혔다") && /상한 .*초 초과/.test(t67Stuck),
  `${t67Stuck}`);

// 5의 짝 ★ 끝나는 프라미스는 안 자른다 — 이게 없으면 "항상 자르는 상한"이 5만으로 통과한다.
const t67Fast = await capped("빨리 끝나는 것", Promise.resolve("값"), 120);
ok("5 ★ 끝나는 프라미스는 안 자르고 값을 그대로 준다 (5의 짝)", t67Fast === "값", `${t67Fast}`);

console.log("\n[Today]");
ok("헤더 날짜 렌더", /^\d+$/.test(txt("#td-day")), txt("#td-day"));
ok("경계 표시", txt("#td-boundary").includes("경계"), txt("#td-boundary"));
ok("기간 칩 조인", $("#td-chips").children.length >= 1);
ok("TODO 행 렌더", $("#td-list").querySelectorAll(".trow").length >= 1);
ok("Feelings 눈금 10칸", $("#feel-s").querySelectorAll(".likert .lk").length % 10 === 0 && $("#feel-s").querySelectorAll(".lk").length >= 10);
ok("Log 렌더", $("#td-logs").querySelectorAll(".lrow").length >= 1);
ok("Score 차트 14칸", $("#bchart").querySelectorAll(".bcol").length === 14, String($("#bchart").querySelectorAll(".bcol").length));
ok("대기 상시 행", $("#today-wait").style.display !== "none");

// ── T-44 · ADR-040 — 마감 화면이 먼저 말한다 ──────────────────────────────
// ★ **금지어 목록의 자리는 `app.js` 하나다.** 검사는 그것을 읽어서 스캔한다 —
//   검사가 자기 목록을 들고 있으면 두 벌이 되고, **갈라진 쪽이 통과시킨다**.
const t44Banned = ev("CLOSE_JUDGING_WORDS");
const t44Scan = (s) => t44Banned.filter((word) => String(s).includes(word));
// 순수 함수라 직접 부른다(carryCandidate·handleBack과 같은 자리) — 재료를 합성해 갈래를 전부 태운다.
const t44Say = (done, todo, wait) => ev(`closeSummaryText(${JSON.stringify({
  done: Array.from({ length: done }, (_, i) => ({ id: `d${i}` })),
  todo: Array.from({ length: todo }, (_, i) => ({ id: `t${i}` })),
  reassign: Array.from({ length: wait }, (_, i) => ({ id: `r${i}` })),
})})`);

const t44Mixed = t44Say(3, 2, 1), t44Other = t44Say(5, 4, 0);
ok("① 한 것·남은 것·재배정 대기가 실제 숫자로 나온다",
  t44Mixed.includes("3") && t44Mixed.includes("2") && t44Mixed.includes("1")
  && t44Other.includes("5") && t44Other.includes("4") && !t44Other.includes("3"),
  `${t44Mixed} / ${t44Other}`);
ok("① 화면 한 줄이 실제 S.today 재료로 조립된다 (렌더 경로에 붙어 있다)",
  txt("#close-summary").length > 0
  && txt("#close-summary") === ev("closeSummaryText(S.today)")
  && txt("#close-summary").includes(String(ev("S.today.todo.length"))),
  txt("#close-summary"));

// ② 빈 날 — **순수 함수만이 아니라 렌더 경로까지** 본다. 화면이 백지로 돌아가는 것이 이 티켓이 없앤 것이다.
// `guard`도 함께 비운다 — T-45의 조각이 붙으면 이 검사가 재는 것이 흐려진다(여기는 **T-44 문장**만 본다).
ev(`window.__t44Real = { done: S.today.done, todo: S.today.todo, reassign: S.today.reassign, guard: S.today.guard };
    S.today.done = []; S.today.todo = []; S.today.reassign = []; S.today.guard = null;
    renderCloseSummary();`);
const t44EmptyLine = txt("#close-summary");
ev(`S.today.done = window.__t44Real.done; S.today.todo = window.__t44Real.todo;
    S.today.reassign = window.__t44Real.reassign; S.today.guard = window.__t44Real.guard;
    renderCloseSummary();`);
ok("② ★ 아무것도 없는 날에도 화면이 말한다 (침묵은 고장과 구별이 안 된다)",
  t44EmptyLine.length > 0 && t44EmptyLine === t44Say(0, 0, 0) && txt("#close-summary").length > 0,
  `빈 날 "${t44EmptyLine}" · 복구 "${txt("#close-summary")}"`);

// ③ 평가하지 않는다 — 갈래 전부를 app.js의 목록으로 스캔한다(없는 것을 세는 검사).
const t44Lines = [t44Say(0, 0, 0), t44Say(3, 2, 1), t44Say(3, 0, 0), t44Say(0, 2, 0),
  t44Say(0, 0, 2), t44Say(9, 9, 9), txt("#close-summary")];
const t44Hits = t44Lines.flatMap((s) => t44Scan(s).map((word) => `${word}@${s}`));
ok("③ 평가어가 없다 — 모든 갈래를 app.js의 금지어 목록으로 스캔", t44Hits.length === 0, t44Hits.join(" / "));

// ④ ★ ③의 스캐너가 살아 있는가. 목록을 비우면 ③은 초록인 채 **여기만** 죽는다.
const t44Fake = "오늘 3개 했고 2개 남았어요. 잘했어요 · 평소보다 적어요 · 힘내요.";
ok("④ ★ ③의 스캐너가 합성 평가 문구를 실제로 잡는다",
  Array.isArray(t44Banned) && t44Banned.length > 0 && t44Scan(t44Fake).length >= 3,
  `목록 ${t44Banned.length}개 · 적중 [${t44Scan(t44Fake).join(",")}]`);

// ── T-45 — 마감 요약이 Guard도 말한다 ────────────────────────────────────
// **주어 스캐너의 목록은 `CLOSE_USER_SUBJECT_MARKS` 하나**이고 여기서 읽는다.
// ⚠️ `CLOSE_JUDGING_WORDS`와 **별개다**: 그쪽은 어휘, 이쪽은 주어. 겹치지 않는 것을 ⑦이 센다.
const t45Marks = ev("CLOSE_USER_SUBJECT_MARKS");
const t45Scan = (s) => t45Marks.filter((m) => String(s).includes(m));
// 날짜는 `S.today.date`에서 상대로 잡는다 — 고정 날짜는 **언젠가 반드시 현재가 된다**(함정 12).
const t45At = (hhmm) => `${ev("S.today.date")}T${hhmm}:00+09:00`;
const t45Say = (done, todo, guard) => ev(`closeSummaryText(${JSON.stringify({
  done: Array.from({ length: done }, (_, i) => ({ id: `d${i}` })),
  todo: Array.from({ length: todo }, (_, i) => ({ id: `t${i}` })),
  reassign: [], guard,
})})`);

// ★ 기대값을 **함수를 거치지 않고** 적는다. `t44Say(3,2,0)`으로 잡으면 조각이 새는 변이에서
//   기준선까지 같이 오염돼 **④가 죽고 ⑤가 산다** — 실제로 그렇게 나왔다(T-43 ①과 같은 자리).
//   날짜가 아니라 문장이라 함정 12와 무관하다: T-44 ①이 이 문구를 따로 못 박고 있다.
const t45Base = "오늘 3개 했고 2개 남았어요.";
const t45Two = t45Say(3, 2, { fired: 2, last_at: t45At("02:10"), ignored: 0 });
const t45One = t45Say(0, 0, { fired: 1, last_at: t45At("23:40"), ignored: 0 });
// **자리와 재료를 본다 — 문구를 통째로 박지 않는다.** 주어만 바꾼 변이가 여기까지 죽이면
// 어느 결함이 무엇을 죽였는지 못 읽는다(주어는 ⑥이 센다 · T-43·T-44에서 같은 자리를 고쳤다).
ok("④ 개입이 있으면 T-44 문장 뒤에 조각이 붙는다 (앞이 아니다)",
  t45Two.startsWith(`${t45Base} `) && t45Two.includes("새벽 2시") && t45Two.includes("두 번")
  && t45One.startsWith("오늘 담긴 할 일이 없는 날이에요. ")
  && t45One.includes("밤 11시") && t45One.includes("한 번"),
  `${t45Two} / ${t45One}`);

// ⑤ ★ ④의 짝. 셋 다 조각이 없어야 한다: 개입 0 · 집계 실패(null) · **옛 배포**(키 자체가 없음).
const t45Zero = t45Say(3, 2, { fired: 0, last_at: null, ignored: 0 });
const t45Null = t45Say(3, 2, null);
const t45Old = ev(`closeSummaryText(${JSON.stringify({
  done: [{ id: "d0" }, { id: "d1" }, { id: "d2" }], todo: [{ id: "t0" }, { id: "t1" }], reassign: [],
})})`);
ok("⑤ ★ 개입이 0이면 조각이 없다 — T-44 문장만 남는다 (없는 것을 말하지 않는다)",
  t45Zero === t45Base && t45Null === t45Base && t45Old === t45Base,
  `0 "${t45Zero}" · null "${t45Null}" · 옛배포 "${t45Old}"`);

// ⑥ 주어가 시스템이다 — 갈래 전부 + 실제 화면 줄을 스캔한다.
const t45Lines = [t45Two, t45One, t45Zero, t45Base,
  t45Say(0, 2, { fired: 5, last_at: t45At("01:05"), ignored: 2 }),
  t45Say(3, 0, { fired: 1, last_at: t45At("13:00"), ignored: 0 }),
  t45Say(0, 0, { fired: 3, last_at: t45At("19:30"), ignored: 1 }),
  txt("#close-summary")];
const t45Hits = t45Lines.flatMap((s) => t45Scan(s).map((m) => `${m}@${s}`));
ok("⑥ ★ 주어가 시스템이다 — 사용자를 서술하는 표현이 없다", t45Hits.length === 0, t45Hits.join(" / "));

// ⑦ ★ ⑥의 스캐너가 살아 있는가. 평가어가 하나도 없는 문장들이라 ③의 목록으로는 안 잡힌다 —
//    그것이 두 목록을 **합치면 안 되는** 이유이고, 여기서 그 분리를 함께 센다.
const t45Fake = "어젯밤 늦게 주무셨네요. 새벽 2시까지 깨어 있었어요. 두 번은 답을 안 하셨어요.";
const t45Overlap = t45Marks.filter((m) => t44Banned.includes(m));
ok("⑦ ★ ⑥의 스캐너가 합성 사용자 서술을 잡는다 · 어휘 목록과 별개다",
  t45Marks.length > 0 && t45Scan(t45Fake).length >= 3 && t45Overlap.length === 0
  && t44Scan(t45Fake).length === 0,
  `주어 적중 [${t45Scan(t45Fake).join(",")}] · 어휘 적중 [${t44Scan(t45Fake).join(",")}] · 겹침 [${t45Overlap.join(",")}]`);

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
// ⚠️ **검사를 고쳤다** — T-43이 설정 맨 아래에 수집 상태 한 줄을 더한다(11 → 12).
//    이 검사는 "행이 조용히 늘거나 줄지 않는다"를 세는 것이므로, 늘린 티켓이 숫자를 옮긴다.
// ⚠️ **검사를 또 고쳤다** — T-53이 폰 캘린더 줄을 하나 더한다(12 → 13). 같은 이유다.
// ⚠️ **또 고쳤다** — T-58이 시간표 줄을 하나 더한다(13 → 14). 세는 것은 여전히
//    *"행이 조용히 늘거나 줄지 않는다"*이므로, 늘린 티켓이 숫자를 옮기는 것이 이 검사의 규칙이다.
// ⚠️ **또 고쳤다** — T-59가 장소 줄을 하나 더한다(14 → 15). 같은 규칙이다.
// ⚠️ **또 고쳤다** — T-61이 아침(이동·준비) 두 줄을 더한다(15 → 17). 같은 규칙이다.
// ⚠️ **또 고쳤다** — T-63이 밤 알림 줄을 하나 더한다(17 → 18). 같은 규칙이다.
ok("설정 18행 (AI 연결 통합 + 시간표 + 아침 두 줄 + 상태 네 줄)", rows.length === 18, String(rows.length));
// ⚠️ **"맨 아래가 수집 상태"에서 옮겼다.** 이 검사가 지키던 것은 *"그 줄이 사라지지 않는다"*이고,
//    이제 같은 자리에 줄이 둘이라 **둘 다** 봐야 그 뜻이 남는다. 순서까지 고정하는 이유는
//    **둘이 서로 다른 것**이기 때문이다: 학사 캘린더는 서버가 iCal을 긁는 것(T-41)이고,
//    폰 캘린더는 기기가 CalendarContract를 읽는 것(T-53)이다. 한 줄로 합치면 어느 쪽이
//    죽었는지 못 읽는다 — 이 티켓이 실패 문구를 셋으로 가른 것과 같은 규칙이다.
// ⚠️ **셋으로 늘렸다** — T-59의 장소 줄이 같은 자리에 선다. 이것도 서로 다른 것이다:
//    기기가 붙은 네트워크를 읽는 것(T-59)이라 앞 둘 중 어느 쪽이 죽어도 이것은 살아 있다.
// ⚠️ **넷으로 늘렸다** — T-63의 밤 알림 줄이 같은 자리에 선다. ★ **이것은 앞 셋과 종류가 다르다**:
//    앞 셋은 *"무엇이 죽었나"* 이고 이것은 *"내가 무엇을 골랐나"* 다. 그래도 같은 자리에 두는
//    이유는 **지금 어느 쪽인지 읽는 곳과 바꾸는 곳이 같아야 하기 때문**이다(ADR-047 ③).
ok("맨 아래 네 줄이 상태 줄이다 — 학사 캘린더 · 폰 캘린더 · 장소 · 밤 알림 (넷 다 안 사라진다)",
  rows[rows.length - 4]?.includes("학사 캘린더") && rows[rows.length - 3]?.includes("폰 캘린더")
  && rows[rows.length - 2]?.includes("장소") && rows[rows.length - 1]?.includes("밤 알림"),
  rows.slice(-4).join(" | "));
ok("Low 모델 표시", rows.some((r) => r.includes("Low") && r.includes("haiku")), rows.join(" | "));
ok("High 모델 표시", rows.some((r) => r.includes("High") && r.includes("claude")), rows.join(" | "));
ok("AI 연결 행 · 토큰 위", rows.findIndex((r) => r.includes("AI 연결")) < rows.findIndex((r) => r.includes("앱 접근 토큰")), rows.join(" | "));
ok("모델 행이 토큰 아래", rows.findIndex((r) => r.includes("앱 접근 토큰")) < rows.findIndex((r) => r.includes("모델 — Low")));
ok("표준시 오프셋이 내보내기 위", rows.findIndex((r) => r.includes("표준시")) < rows.findIndex((r) => r.includes("내보내기")));

/* ── 아침 — 이동·준비 (T-61 · ADR-047 ① 정정) ────────────────
 *
 * 밤 문구가 *"지금 자면 N시간"* 을 **기상까지**로 말하려면 빼는 값이 있어야 하고,
 * ★ **그 값을 고칠 자리가 화면에 있어야 한다** — 없으면 사용자가 숫자가 틀렸다고 느낄 때
 * 할 수 있는 것이 없고, 그러면 틀린 사실이 그대로 남는다(티켓 ④). */
const setRow = (label) => [...$("#set-list").querySelectorAll(".srow")]
  .map((r) => r.textContent).find((t) => t.startsWith(label)) ?? "";
const t61Commute = "아침 — 이동 시간", t61Prep = "아침 — 준비 시간";
/* ⚠️ **기본값을 화면에 적지 않는다.** 적으면 서버 상수와 두 벌이 되고, 그 순간 화면이
 *   거짓말을 시작한다(기준선·하루 경계에서 이 리포가 물린 그 모양). 안 적힌 값은
 *   *"미설정"* 이라고 말한다 — 모르는 것을 아는 척하지 않는 쪽이다. */
ok("아침 두 칸이 하루 경계 아래에 있다 — 안 넣었으면 '미설정' (기본값을 화면에 안 적는다)",
  setRow(t61Commute).includes("미설정") && setRow(t61Prep).includes("미설정")
  && rows.findIndex((r) => r.startsWith("하루 경계")) < rows.findIndex((r) => r.startsWith(t61Commute)),
  `${setRow(t61Commute)} | ${setRow(t61Prep)}`);

w.openSetting("wake_commute_min"); await sleep(150);
ok("이동 시간 설명이 기상 시각을 말한다 — 왜 그 숫자인지 여기서 읽힌다",
  txt("#st-head") === t61Commute && txt("#st-desc").includes("기상 시각"),
  `${txt("#st-head")} / ${txt("#st-desc").slice(0, 40)}`);

/* ★ **핸들러가 프라미스를 주면 `await`한다**(함정 14). 토스트나 `until`로 *"끝났다"* 를
 *   관측하면 저장 왕복이 다음 검사의 스파이에 섞인다 — T-42·T-53·T-54가 그 자리다.
 * ⚠️ **저장 핸들러는 `renderMe()`를 `await`하지 않는다** — 그래서 여기서 다시 부른다.
 *    `sleep`으로 기다리면 그건 계약이 아니라 추측이고, 느린 실행에서 조용히 어긋난다. */
const t61Save = async (key, value) => {
  w.openSetting(key); await sleep(150);
  $("#st-value").value = value;
  await $("#st-save").onclick();
  await ev("renderMe()");
  w.toggleSet(true);
};
await t61Save("wake_commute_min", "45");
await t61Save("wake_prep_min", "30");
const t61Saved = (await ev("Api.settings()")).filter((r) => r.key.startsWith("wake_"));
/* ★ **화면과 서버를 함께 센다.** 화면만 보면 저장 없이 입력값을 그대로 그리는 구현이
 *   통과하고, 서버만 보면 저장은 됐는데 **고친 값이 화면에 안 돌아오는** 구현이 통과한다. */
ok("★ 넣은 값이 서버에 남고 화면이 그 값을 되돌려 준다 (값이 코드에 안 박혔다)",
  t61Saved.length === 2
  && t61Saved.find((r) => r.key === "wake_commute_min")?.value === "45"
  && t61Saved.find((r) => r.key === "wake_prep_min")?.value === "30"
  && setRow(t61Commute).includes("45분") && setRow(t61Prep).includes("30분"),
  `${JSON.stringify(t61Saved)} | ${setRow(t61Commute)} | ${setRow(t61Prep)}`);

/* ★ **짝 — 형식 밖은 화면에도 안 남는다.** 하루를 넘는 이동은 값이 아니라 오타이고,
 *   서버가 400으로 막는데 화면이 낙관적으로 그려 버리면 **사용자는 저장됐다고 믿는다.** */
await t61Save("wake_commute_min", "9999");
const t61After = (await ev("Api.settings()")).find((r) => r.key === "wake_commute_min")?.value;
ok("★ 하루를 넘는 값은 서버가 막고 화면도 옛 값 그대로다 (거절이 저장으로 안 보인다)",
  t61After === "45" && setRow(t61Commute).includes("45분"),
  `서버=${t61After} 화면=${setRow(t61Commute)}`);

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
// ⚠️ **`?.`가 없으면 memo가 간헐로 안 잡힐 때 여기서 던져 러너가 통째로 죽고 숫자를 잃는다**
//    (T-51의 변이 배터리에서 실제로 그랬다). 바로 위 `ok()`가 이미 그 존재를 세므로,
//    감싸면 같은 상황이 **검사 하나의 실패**로 남는다 — "검사가 죽는다"와 "검사가 안 돈다"는 다르다.
const addedMemoIso = addedMemo?.created_at ?? "";
const addedMemoDate = `${+addedMemoIso.slice(5, 7)}/${+addedMemoIso.slice(8, 10)}`;
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

// ⑧ (T-45) **집계가 던져도 T-44 문장과 마감 버튼이 살아 있다.**
//    조각 하나가 사용자가 넣은 것까지 데려가면 안 된다 — 그래서 ⑤와 따로 센다.
ev(`(() => { window.__t45Orig = guardFragment;
             window.guardFragment = () => { throw new Error("t45 — 집계가 던진다"); }; })()`);
$("#bchart").innerHTML = "";
let t45RenderAlive = true;
try { await w.refreshToday(); } catch { t45RenderAlive = false; }
await sleep(200);
const t45Line = txt("#close-summary");
const t45BtnAlive = !$("#btn-close").disabled && $("#bchart").querySelectorAll(".bcol").length === 14;
$("#btn-close").click(); await sleep(300);
const t45Confirm = $("#confirm").classList.contains("on");
$("#cf-no").click(); await sleep(200);
ok("⑧ ★ 집계가 던져도 T-44 문장과 마감 버튼이 살아 있다",
  t45RenderAlive && t45BtnAlive && t45Confirm
  && t45Line.length > 0 && !t45Line.includes("알렸어요") && t45Line === ev("closeSummaryText(S.today)"),
  `render ${t45RenderAlive} · btn ${t45BtnAlive} · 모달 ${t45Confirm} · 줄 "${t45Line}"`);
ev(`window.guardFragment = window.__t45Orig;`);
await w.refreshToday(); await sleep(200);

// ⑤ (T-44) **요약이 던져도 마감은 끝까지 간다** — 기록의 봉인이 우선이다(T-33 §금지 1행과 같은 자리).
//    확인 모달까지만 보면 "안 닫히는 마감"을 못 잡으므로 **실제 마감 경로에 태운다.**
//    `#bchart`를 비우고 재렌더하는 것이 핵심이다: 옛 막대가 남아 있으면
//    렌더가 요약에서 죽어도 14칸이 그대로 보여 검사가 거짓 통과한다.
ev(`(() => { window.__t44Orig = closeSummaryText;
             window.closeSummaryText = () => { throw new Error("t44 — 요약이 던진다"); }; })()`);
$("#bchart").innerHTML = "";
let t44RenderAlive = true;
try { await w.refreshToday(); } catch { t44RenderAlive = false; }   // 삼키지 않으면 렌더가 여기서 죽는다
await sleep(200);
const t44PastSummary = $("#bchart").querySelectorAll(".bcol").length === 14;   // 요약 뒤 단계가 돌았다
const t44SilentLine = txt("#close-summary") === "";                            // 요약만 비었다
$("#btn-close").click(); await sleep(300);
$("#cf-yes").click(); await sleep(1500);
await ev("renderCalendar()");
ok("마감 뒤 캐시 무효화 · 다음 렌더 재요청",
  ev("window.__calendarCalls.length") === closeCalendarCalls + 1,
  `${closeCalendarCalls}→${ev("window.__calendarCalls.length")}`);
const t44Closed = await until(() => ev(`!!(S.today.daily && S.today.daily.status === "closed")`), 3000);
ok("⑤ ★ 요약이 던져도 마감이 끝까지 간다 (요약 실패가 봉인을 막지 않는다)",
  t44RenderAlive && t44PastSummary && t44SilentLine && t44Closed,
  `render ${t44RenderAlive} · 이후단계 ${t44PastSummary} · 빈줄 ${t44SilentLine} · closed ${t44Closed}`);
ev(`window.closeSummaryText = window.__t44Orig;`);
await w.refreshToday(); await sleep(200);

console.log("\n[뒤로가기 — 맨 위 하나만 닫는다]");
// jsdom엔 Capacitor가 없다. 그래서 판단(`handleBack`)이 리스너 밖에 있어야 검사가 붙는다.
// 리스너 안에 넣었으면 여기가 통째로 0이 된다 — T-33이 고친 그 자리와 같은 종류다.
const t34Back = () => ev(`handleBack()`);
const t34Reset = () => ev(`(()=>{ closeAll(); S.pick = null; switchTab("today", false); })()`);
const t34Open = (id) => ev(`openSheet(${JSON.stringify(id)})`);
const t34Tab = () => $("#phone").dataset.tab;
const t34OpenN = () => w.document.querySelectorAll(".sheet.on").length;

// ① 시트 하나 — 그 시트만 닫히고 탭은 그대로다.
t34Reset();
t34Open("sh-log");
ok("① 시트가 열려 있으면 그 시트만 닫는다 · 탭은 그대로",
  t34Back() === "sheet" && !$("#sh-log").classList.contains("on") && t34Tab() === "today",
  `${t34Tab()} / ${$("#sh-log").className}`);

// ② 겹치면 **한 번에 하나만.** 사용자가 어디까지 닫았는지 알아야 한다.
//    '위'는 **DOM 순서**다(`syncOverlay`와 같은 기준 — z-index가 같아 나중 것이 위에 그려진다).
//    그래서 **연 순서를 일부러 뒤집어** 연다: sh-log(442줄)를 먼저 열고 sh-day(241줄)를 나중에.
//    닫히는 것이 sh-log면 DOM 순서를 따른 것이고, sh-day면 '마지막에 연 것'을 따른 것이다.
t34Reset();
t34Open("sh-log"); t34Open("sh-day");
const t34First = t34Back();
const t34On = (id) => $("#" + id).classList.contains("on");
ok("② 겹치면 한 번에 하나만 — 맨 위(DOM 나중)부터다, 연 순서가 아니다",
  t34First === "sheet" && !t34On("sh-log") && t34On("sh-day"),
  `${t34First} / log=${t34On("sh-log")} day=${t34On("sh-day")}`);
ok("겹친 둘째도 다음 뒤로가기에 닫힌다",
  t34Back() === "sheet" && !t34On("sh-day") && t34OpenN() === 0);

// ③ 피커 모드 — 원래 탭으로. 시트는 열려 있지 않았다(①보다 뒤 순서라는 것까지 본다).
t34Reset();
ev(`(()=>{ switchTab("cal", false); S.pick = { mode:"assign", origin:"works" }; })()`);
const t34Pick = t34Back();
ok("③ 날짜 선택 모드면 원래 탭으로 돌아온다 · 시트는 안 건드린다",
  t34Pick === "pick" && ev(`S.pick`) === null && t34Tab() === "works"
  && t34OpenN() === 0, `${t34Pick} / ${t34Tab()}`);

// ④ Today가 아닌 탭 → Today.
t34Reset();
ev(`switchTab("me", false)`);
ok("④ Today가 아닌 탭이면 Today로", t34Back() === "tab" && t34Tab() === "today", t34Tab());

// ⑤ ★ 짝 — 아무것도 안 닫았다고 **말해야** 앱이 나갈 수 있다.
//    ①~④만 보면 "항상 무언가를 닫는 구현"(= 앱을 영영 못 나감)도 전부 통과한다.
t34Reset();
const t34Exit = t34Back();
ok("⑤ ★ Today에서 아무것도 안 열려 있으면 null — 앱이 나갈 수 있다",
  t34Exit === null && t34Tab() === "today" && t34OpenN() === 0, String(t34Exit));
// 개입 화면의 차단은 안드로이드 쪽이고 여기서 볼 수 없다 — §확인 절차가 본다(감추지 않는다).
t34Reset();

console.log("\n[outcome 확정 카드 — 루프의 시작점]");
// 개입은 저절로 기록되지만 `outcome`은 사람이 붙여야만 생긴다. 카드가 안 뜨면 9~11월 내내
// outcome이 전부 NULL이고, 12월에 §6.5가 읽을 것이 절반만 남는다 — "개입했다"는 있고
// "그래서 어떻게 됐다"가 없다. **그리고 그 실패는 아무 소리도 내지 않는다.**
const t33Bar = $("#td-guard");
const t33Rows = [
  { id: "t33-a", on_date: "2026-08-05", reaction: "override", event_title: "확률론 시험", event_date: "2026-08-06" },
  { id: "t33-b", on_date: "2026-08-05", reaction: "accepted", event_title: null, event_date: null },
];
const t33Load = (body) => ev(`(async()=>{
  const oldPending = Api.guardPending, oldOutcome = Api.guardOutcome;
  try { ${body} } finally { Api.guardPending = oldPending; Api.guardOutcome = oldOutcome; }
})()`);
// 스텁을 남겨 둔 채 클릭까지 가야 하므로 복원은 마지막에 한 번 한다.
await ev(`(async()=>{
  window.__t33 = { pending: ${JSON.stringify(t33Rows)}, sent: [], old: [Api.guardPending, Api.guardOutcome] };
  Api.guardPending = async () => window.__t33.pending;
  Api.guardOutcome = async (id, outcome) => {
    window.__t33.sent.push(id + ":" + outcome);
    window.__t33.pending = window.__t33.pending.filter((r) => r.id !== id);
    return {};
  };
  await loadGuardOutcome();
})()`);
const t33Md = ev(`md("2026-08-06")`);
ok("① 대기가 있으면 카드가 뜬다 — 날짜와 제목이 문구에 든다",
  t33Bar.dataset.state === "ask" && t33Bar.style.display === "flex"
  && txt("#td-guard-text").includes("확률론 시험") && txt("#td-guard-text").includes(t33Md),
  `${t33Bar.dataset.state} / ${txt("#td-guard-text")}`);

// ② 계약은 "한 번에 하나만 묻고, 확정하면 이어서 묻는다"(app.js:452·:471)이다.
//    둘을 만들고 하나를 확정해 **다음 것이 뜨는지**까지 본다 — 버튼이 안 먹으면 여기서 죽는다.
$("#td-guard-ok").click();
await sleep(150);
ok("② 확정하면 다음 것을 이어 묻는다 — 한 번에 하나만",
  ev(`window.__t33.sent.join("|")`) === "t33-a:success"
  && t33Bar.dataset.state === "ask"
  && !txt("#td-guard-text").includes("확률론 시험")
  && txt("#td-guard-text").includes("그 일"),
  `${ev(`window.__t33.sent.join("|")`)} / ${txt("#td-guard-text")}`);
// 버튼 둘이 **서로 다른 값**을 보내는지. 한쪽만 보면 둘이 같은 값을 보내도 초록이다.
$("#td-guard-no").click();
await sleep(150);
ok("버튼 둘이 각각 success·failure로 간다",
  ev(`window.__t33.sent.join("|")`) === "t33-a:success|t33-b:failure", ev(`window.__t33.sent.join("|")`));

// ③ 대기가 없다 — **정상이다.** 안 뜨는 것이 맞다.
const t33None = { state: t33Bar.dataset.state, display: t33Bar.style.display };
ok("③ 대기가 없으면 안 뜬다 · 상태는 none (이어 묻기가 멈춘다)",
  t33None.state === "none" && t33None.display === "none", JSON.stringify(t33None));

// ④ 조회가 실패했다 — **회귀다.** 안 뜨는 것은 같지만 뜻이 다르다.
await t33Load(`
  Api.guardPending = async () => { throw new Error("t33 boom"); };
  await loadGuardOutcome();
`);
const t33Err = { state: t33Bar.dataset.state, display: t33Bar.style.display };
ok("④ 조회가 실패해도 화면을 막지 않는다 · 상태는 error",
  t33Err.state === "error" && t33Err.display === "none", JSON.stringify(t33Err));
/* ★ ③과 ④의 짝 — **none과 error는 화면에서 같고 기록에서만 다르다.** 그것이 이 카드의 요점이다
 *   ("안 뜬다"만 검사하면 조회가 항상 실패해도 초록이다 · AGENT-CHAIN §5).
 *   ⚠️ **그런데 그 관계는 위 둘의 계약값에서 연역된다** — ③이 `none/none`을, ④가 `error/none`을
 *   못 박으므로 display가 같고 state가 다른 것은 **반드시 참이다.** 거짓이 되려면 ③이나 ④가
 *   먼저 거짓이어야 하고, 그러면 **이 검사는 혼자 죽을 수가 없다** — 초록불은 하나 켜는데
 *   세는 것은 0이다(T-65 · AGENT-CHAIN §8). 그래서 `ok()`에서 뺐다.
 *   변이로 확인했다: err를 flex로 만들면 ④와 **함께** 죽고, 관계만 깨는 변이는 **구성 불가능**하다.
 *   ⚠️ **되살릴 조건** — ③ 또는 ④에서 `display` 단언이 빠지면 그 순간 이 관계를 **아무도 안 센다.**
 *   그때는 여기를 `ok()`로 되돌린다. */
await ev(`(async()=>{ Api.guardPending = window.__t33.old[0]; Api.guardOutcome = window.__t33.old[1]; })()`);

// ── T-56 · 뒤에 또 깨어 있었으면 묻지 않아도 안다 (ADR-044) ──────────────────
//
// ★ 추론은 **사용자의 답을 대체하지 않고 자리를 대신 채운다.** 그래서 화면 검사의 본체는
//   *"문구가 바뀌었다"* 가 아니라 **"버튼이 그대로 살아 있고 눌리면 그 답이 간다"** 다.
// ⚠️ 신호에 토스트도 `until`도 안 쓴다(함정 14) — `onclick()`이 `run(...)`의 프라미스를 준다.
console.log("\n[T-56] 추론은 자리를 채우되 답을 선점하지 않는다");

const t56Bar = $("#td-guard");
// 함정 12 — 고정 날짜를 안 쓴다. 서버가 준 오늘에서 잡는다(문구 조립에만 쓰인다).
const t56Day = ev(`S.today.date`);
const t56Row = (id, inferred) => ({
  id, on_date: t56Day, reaction: "accepted", event_title: "확률론 시험", event_date: t56Day,
  outcome: null, outcome_inferred: inferred,
});
await ev(`(async()=>{
  window.__t56 = { pending: [], sent: [], old: [Api.guardPending, Api.guardOutcome] };
  Api.guardPending = async () => window.__t56.pending;
  Api.guardOutcome = async (id, outcome) => {
    window.__t56.sent.push(id + ":" + outcome);
    window.__t56.pending = window.__t56.pending.filter((r) => r.id !== id);
    return {};
  };
})()`);
const t56Snap = () => ({
  state: t56Bar.dataset.state, inferred: t56Bar.dataset.inferred,
  display: t56Bar.style.display, text: txt("#td-guard-text"),
  wired: typeof $("#td-guard-ok").onclick === "function" && typeof $("#td-guard-no").onclick === "function",
});
const t56Load = async (rows) => {
  await ev(`(async()=>{
    window.__t56.pending = ${JSON.stringify(rows)}; window.__t56.sent = [];
    await loadGuardOutcome();
  })()`);
  return t56Snap();
};

const t56Inf = await t56Load([t56Row("t56-i", "failure")]);
ok("1 뒤에 발동이 있었으면 '못 한 것으로 보여요'로 자리를 채운다 · 버튼은 남는다",
  t56Inf.state === "ask" && t56Inf.display === "flex" && t56Inf.inferred === "failure"
  && /보여요/.test(t56Inf.text) && !/못 했어요/.test(t56Inf.text) && t56Inf.wired,
  JSON.stringify(t56Inf));

const t56Ask = await t56Load([t56Row("t56-a", null)]);
ok("2 ★ 뒤에 발동이 없으면 지금 모양 그대로 묻는다 (1의 짝 · 두 문구가 다르다)",
  t56Ask.state === "ask" && t56Ask.inferred === "" && !/보여요/.test(t56Ask.text)
  && t56Ask.text !== t56Inf.text && t56Ask.wired,
  JSON.stringify(t56Ask));

/* 3 ★ **이 티켓의 화면 쪽 본체.** 추론과 **반대되는** 답을 눌러 그것이 그대로 가는지 본다 —
 *   자리를 채운 것이지 답을 정한 것이 아니다. 버튼을 없애거나 추론값을 대신 보내는 구현이
 *   1·2를 전부 통과하므로, 이것이 없으면 그 셋이 아무것도 안 지킨다. */
await t56Load([t56Row("t56-w", "failure")]);
await $("#td-guard-ok").onclick();
ok("3 ★ 추론이 failure여도 사용자가 누른 success가 그대로 간다",
  ev(`window.__t56.sent.join("|")`) === "t56-w:success", ev(`window.__t56.sent.join("|")`));

/* 4 ★ **없는 것을 세는 검사** — 앞 줄의 추론이 다음 줄에 남으면 **남의 판정이 붙는다.**
 *   `set()`을 안 지나고 문구만 다시 쓰는 구현에서 정확히 그 모양이 난다(T-54가 겪은 자리). */
await t56Load([t56Row("t56-x", "failure"), t56Row("t56-y", null)]);
const t56First = t56Bar.dataset.inferred;
await $("#td-guard-no").onclick();          // 첫 줄을 답하면 둘째가 이어 뜬다
const t56Second = t56Snap();
ok("4 ★ 앞 줄의 추론이 다음 줄에 안 남는다 (없는 것을 세는 검사)",
  t56First === "failure" && t56Second.inferred === "" && t56Second.state === "ask"
  && !/보여요/.test(t56Second.text),
  `${t56First} → ${JSON.stringify(t56Second)}`);

await ev(`(async()=>{ Api.guardPending = window.__t56.old[0]; Api.guardOutcome = window.__t56.old[1]; })()`);

console.log("\n[수집 제안 카드 — 곧 닥치는 것만, 원문 그대로]");
// T-33의 카드와 **같은 모양**이라 검사도 같은 모양이다. ③(none)과 ④(error)가 화면에서
// 똑같이 안 보이므로, 여기서도 **둘을 가르는 것이 짝**이다 — 그 자리를 네 번 물렸다.
const t42Bar = $("#td-coll");
const t42Rows = [
  { id: "t42-a", source: "uclass", summary: "5주차 과제 (~9/3 23:00) 기한", starts_at: "2026-09-03T23:00:00+09:00" },
  { id: "t42-b", source: "uclass", summary: "실험2 결과보고서", starts_at: "2026-09-05T18:00:00+09:00" },
];
await ev(`(async()=>{
  window.__t42 = { pending: ${JSON.stringify(t42Rows)}, sent: [],
                   old: [Api.collectedPending, Api.collectedAccept, Api.collectedDismiss] };
  Api.collectedPending = async () => window.__t42.pending;
  Api.collectedAccept = async (id) => {
    window.__t42.sent.push("add:" + id);
    window.__t42.pending = window.__t42.pending.filter((r) => r.id !== id);
    return { event_id: "ev-" + id };
  };
  Api.collectedDismiss = async (id) => {
    window.__t42.sent.push("skip:" + id);
    window.__t42.pending = window.__t42.pending.filter((r) => r.id !== id);
    return {};
  };
  await loadCollected();
})()`);
ok("① 대기가 있으면 카드가 뜬다 · state='ask' · 건수가 문구에 든다",
  t42Bar.dataset.state === "ask" && t42Bar.style.display === "flex"
  && txt("#td-coll-text").includes("2건"),
  `${t42Bar.dataset.state} / ${txt("#td-coll-text")}`);
// ★ 결정 ②는 **문자열로만** 확인된다. 원문이 그대로 나오고, 우리가 뜻을 붙이지 않는다.
$("#td-coll-open").click();
await sleep(120);
ok("② 시트에 원문이 그대로 나온다 · '마감'·'제출'을 우리가 붙이지 않는다",
  txt("#coll-list").includes("5주차 과제 (~9/3 23:00) 기한")
  && !txt("#td-coll-text").includes("마감") && !txt("#td-coll-text").includes("제출"),
  txt("#coll-list").slice(0, 80));
// "전부 추가"가 없다 — 첫 수집에 무엇이 오는지 아직 못 봤다(§금지 3행).
ok("③ '전부 추가' 버튼이 없다",
  !/전부|모두/.test($("#sh-coll").textContent || ""), $("#sh-coll").textContent?.slice(0, 60));

// ⚠️ **여기는 두 번 고쳤다.** 처음엔 고정 200ms였고(바쁜 기계에서 4번 중 3번 빨간불),
//    다음엔 `until`이었다. `until`도 부족했다 — 문구는 `refreshToday()` **도중에** 바뀌므로
//    이 줄을 통과한 뒤에도 **핸들러는 아직 날고 있다.** 그 잔여가 아래 ★ 검사의 스파이에
//    섞여 `invalidate|render`가 두 벌로 찍혔다(T-54 변이 배터리가 그것을 드러냈다).
//    `onclick()`은 `run(...)`의 프라미스를 그대로 주므로 **끝난 것을 직접 안다** — 시계가 없다.
await $("#coll-list [data-cid='t42-a'] [data-act='add']").onclick();
ok("④ 하나를 처리하면 남은 수가 준다 — 카드가 1건으로",
  ev(`window.__t42.sent.join("|")`) === "add:t42-a" && txt("#td-coll-text").includes("1건"),
  `${ev(`window.__t42.sent.join("|")`)} / ${txt("#td-coll-text")}`);
// ★ **④는 처리 뒤의 캘린더 갱신을 안 본다** — 그래서 이 절은 T-42부터 `renderCal()`(없는
//    함수)을 부르며 초록이었다. 던진 자리가 `refreshToday()` **뒤**라 건수는 이미 줄어 있고,
//    ④는 그 앞에서 이미 만족된다.
// ⚠️ **토스트로 보면 안 된다** — 실제로 그렇게 짰다가 변이(옛 `renderCal()`)에서도 초록이었다.
//    `until`이 `refreshToday()`의 DOM 쓰기를 보고 먼저 빠져나와, 던지기 **전에** 토스트를 읽는다.
//    그래서 **호출 자체**를 센다: 캐시를 버리고 다시 그렸는가. 순서까지 본다 —
//    캐시를 안 버리면 방금 만든 event가 안 실린 채로 다시 그려진다(`calSyncNow`와 같은 짝).
await ev(`(async()=>{
  window.__t42.calls = [];
  window.__t42.oldRC = renderCalendar;
  window.__t42.oldIC = invalidateCalendarCache;
  renderCalendar = async (...a) => { window.__t42.calls.push("render"); return window.__t42.oldRC(...a); };
  invalidateCalendarCache = () => { window.__t42.calls.push("invalidate"); return window.__t42.oldIC(); };
  S.cal = S.cal || { y: +S.today.date.slice(0,4), m: +S.today.date.slice(5,7) };
})()`);
// ⚠️ **시계를 아예 안 쓴다.** 처음엔 `click()` + `until(4초)`였는데 부하가 걸린 기계에서
//    **이 절과 무관한 변이 셋(M2·M4·M7)에서 죽었다** — 처리 뒤 `refreshToday()`가 실 API를
//    한 번 왕복하고 invalidate·render는 그 뒤에 온다. **20초로 늘려도 M4에서 또 죽었다:**
//    대기를 늘리는 것은 경합을 없애는 것이 아니라 미루는 것이다.
//    `onclick()`은 `run(...)`의 프라미스를 그대로 돌려주므로 **핸들러가 끝난 것을 직접 안다.**
//    (`b`는 리스너 등록 때 클로저로 잡히므로 event 객체가 없어도 같은 경로다.)
await $("#coll-list [data-cid='t42-b'] [data-act='add']").onclick();
const t42Calls = ev(`window.__t42.calls.join("|")`);
await ev(`(async()=>{
  renderCalendar = window.__t42.oldRC; invalidateCalendarCache = window.__t42.oldIC;
})()`);
ok("★ [추가]가 조용히 실패하지 않는다 — 캐시를 버리고 캘린더를 다시 그린다 (T-53 진단)",
  t42Calls === "invalidate|render", t42Calls || "(아무것도 안 불렸다)");

await ev(`(async()=>{ window.__t42.pending = []; await loadCollected(); })()`);
const t42None = { state: t42Bar.dataset.state, display: t42Bar.style.display };
ok("⑤ 대기가 없으면 안 뜬다 · state='none'",
  t42None.state === "none" && t42None.display === "none", JSON.stringify(t42None));

await ev(`(async()=>{
  Api.collectedPending = async () => { throw new Error("t42 boom"); };
  await loadCollected();
})()`);
const t42Err = { state: t42Bar.dataset.state, display: t42Bar.style.display };
ok("⑥ 조회가 실패해도 Today를 막지 않는다 · state='error'",
  t42Err.state === "error" && t42Err.display === "none", JSON.stringify(t42Err));
/* ★ ⑤와 ⑥의 짝 — **none과 error는 화면에서 같고 기록에서만 다르다.** 이게 없으면 조회가 항상
 *   실패해도 초록이다. ⚠️ **그런데 그 관계는 ⑤의 `none/none`과 ⑥의 `error/none`에서 연역된다** —
 *   둘이 참이면 반드시 참이고, 거짓이 되려면 둘 중 하나가 먼저 거짓이어야 한다.
 *   **혼자 죽을 수 없는 검사는 아무것도 안 센다**(T-65 · AGENT-CHAIN §8). 그래서 `ok()`에서 뺐다.
 *   위 T-33 자매와 **같은 모양·같은 판정**이다(변이도 같이 돌렸다: err를 flex로 → ⑥과 함께 죽는다).
 *   ⚠️ **되살릴 조건** — ⑤ 또는 ⑥에서 `display` 단언이 빠지면 이 관계를 아무도 안 센다. 그때 되돌린다. */
await ev(`(async()=>{
  Api.collectedPending = window.__t42.old[0];
  Api.collectedAccept = window.__t42.old[1];
  Api.collectedDismiss = window.__t42.old[2];
  closeAll();
})()`);

console.log("\n[수집 상태 한 줄 — 실패는 숨지 않는다]");
// ★ **위 두 카드와 반대다.** T-33·T-42는 none과 error가 화면에서 **같아야** 했다 —
//   사용자가 할 수 있는 일이 없으니 잔소리가 되기 때문이다. 여기는 할 일이 있다(토큰 재입력).
//   그래서 검사도 반대 모양이다: **어느 상태에서도 줄이 사라지지 않는다**를 센다.
// 시각은 **지금에서 상대로** 만든다 — 고정 날짜는 언젠가 반드시 현재가 된다(함정 12).
const t43At = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
const t43Set = async (st) => ev(`(async()=>{
  const old = Api.collectedStatus;
  Api.collectedStatus = ${st === null ? `async () => { throw new Error("t43 boom"); }` : `async () => (${JSON.stringify(st)})`};
  try { await renderMe(); } finally { Api.collectedStatus = old; }
})()`);
const t43Row = () => $("#set-collect");
const t43 = () => {
  const r = t43Row();
  return r
    ? { state: r.dataset.state, text: r.textContent || "", display: r.style.display || "",
        alert: r.classList.contains("srow-alert") }
    : { state: "GONE", text: "", display: "GONE", alert: false };
};
const t43Base = { configured: true, counts: { new: 3, accepted: 1, dismissed: 0 } };

await t43Set({ ...t43Base, last_collect_at: t43At(3), last_result: "ok", last_seen_count: 12 });
const t43Ok = t43();
ok("① 정상이면 조용한 한 줄 — 마지막 확인 시각과 건수",
  t43Ok.state === "ok" && t43Ok.text.includes("3시간 전 확인")
  && t43Ok.text.includes("12건 중 새로 3건") && !t43Ok.alert, JSON.stringify(t43Ok));

// ★ 이 티켓의 본체가 화면에서 갈리는 자리. **0건도 "확인했다"고 말한다.**
await t43Set({ ...t43Base, counts: { new: 0, accepted: 0, dismissed: 0 },
  last_collect_at: t43At(1), last_result: "ok", last_seen_count: 0 });
const t43Zero = t43();
await t43Set({ ...t43Base, counts: { new: 0, accepted: 0, dismissed: 0 },
  last_collect_at: null, last_result: null, last_seen_count: null });
const t43Never = t43();
ok("★② 돌았지만 0건과 한 번도 안 돌았음이 화면에서 다르다",
  t43Zero.state === "ok" && t43Zero.text.includes("0건 중 새로 0건")
  && t43Never.state === "never" && t43Never.text.includes("아직 확인 전")
  && t43Zero.text !== t43Never.text,
  `${t43Zero.text} vs ${t43Never.text}`);

await t43Set({ ...t43Base, last_collect_at: t43At(9), last_result: "http_403",
  last_error_at: t43At(1), last_seen_count: 12 });
const t43Err = t43();
ok("③ 실패하면 사유와 할 일이 그대로 뜬다",
  t43Err.state === "error" && t43Err.text.includes("연결 실패 (http_403)")
  && t43Err.text.includes("주소를 다시 넣어"), JSON.stringify(t43Err));
// ★ ①과 ③의 짝 — **T-33 패턴의 반대다.** 둘 다 보이고, 눈에 띄는 정도만 다르다.
//   "안 뜬다"를 기대하는 구현이 여기서 죽는다.
ok("★③ 실패를 숨기지 않는다 — 정상과 같은 자리에 있고 강조만 다르다",
  t43Err.display !== "none" && t43Err.display === t43Ok.display
  && t43Err.alert === true && t43Ok.alert === false,
  `${t43Err.display}/${t43Err.alert} vs ${t43Ok.display}/${t43Ok.alert}`);

await t43Set({ ...t43Base, configured: false, last_collect_at: null, last_result: null, last_seen_count: null });
const t43None = t43();
await t43Set(null);                       // 상태 조회 자체가 실패 — 옛 배포엔 라우트가 없다
const t43Boom = t43();
ok("④ 미설정·조회 실패에도 줄이 사라지지 않는다",
  t43None.state === "none" && t43None.text.includes("설정 안 됨")
  && t43Boom.state === "unknown" && t43Boom.display !== "none",
  `${JSON.stringify(t43None)} / ${JSON.stringify(t43Boom)}`);
// 다섯 상태가 **전부 서로 다른 이름**을 단다 — 하나라도 겹치면 그 둘은 화면에서 구별되지 않는다.
const t43States = [t43Ok, t43Zero, t43Never, t43Err, t43None, t43Boom].map((s) => s.state);
ok("★ 상태 이름이 겹치지 않는다 (ok·never·error·none·unknown)",
  new Set(t43States).size === 5 && !t43States.includes("GONE"), t43States.join("/"));
await ev(`(async()=>{ await renderMe(); })()`);   // 실제 서버 값으로 되돌린다

console.log("\n[세 번 밀린 일의 출구 — 팝업 · 2주 상한 해제]");
// 판단(`carryCandidate`·`maybeCarryPrompt`)이 리스너 밖 순수 함수라 여기서 **직접 부른다**(T-34의 그 자리).
// 날짜는 **고정 센티널**이다 — 기기 날짜를 쓰는 구현이 통과하지 못하게(T-12).
const T35_D = "2026-05-10";
const t35Set = (todo, reassign, d = T35_D) => ev(`(()=>{
  if (S.pick) exitPick();
  closeAll();
  S.today = { ...S.today, date: ${JSON.stringify(d)},
              todo: ${JSON.stringify(todo)}, reassign: ${JSON.stringify(reassign)}, overdue: [] };
  localStorage.removeItem("carry_seen");
})()`);
const t35Row = (id, title, n, extra = {}) => ({ id, title, defer_count: n, ...extra });
const t35On = () => $("#sh-carry").classList.contains("on");
const t35Prompt = () => ev(`(()=>{ const c = maybeCarryPrompt(); return c ? c.id : null; })()`);

// ① 조건 미달 — **안 뜨는 것이 기본 상태다.**
t35Set([t35Row("20260501-001", "두 번만 밀린 일", 2)], []);
const t35Under = t35Prompt();
ok("① defer_count가 N 미만이면 안 뜬다", t35Under === null && !t35On(), `${t35Under}`);

// ② ①의 짝. 이것이 없으면 **"항상 안 뜬다"가 통과한다** — 그리고 이 기능은
//    안 뜨는 것이 기본이라 그 실수가 특히 조용하다.
t35Set([t35Row("20260501-002", "세 번 밀린 일", 3)], []);
const t35Over = t35Prompt();
ok("② N 이상이면 뜬다 — ①의 짝",
  t35Over === "20260501-002" && t35On() && txt("#carry-text").includes("세 번 밀린 일"),
  `${t35Over} / ${txt("#carry-text")}`);

// ③ 하루 한 번 — 닫고 다시 불러도 안 뜬다. **귀속일이 바뀌면 다시 뜬다**(짝).
ev(`closeSheet("sh-carry")`);
const t35Again = t35Prompt(), t35AgainOn = t35On();
ev(`(()=>{ S.today = { ...S.today, date: "2026-05-11" }; })()`);   // 기기 날짜가 아니라 귀속일이다
const t35Next = t35Prompt();
ok("③ 오늘 이미 봤으면 안 뜬다 · 귀속일이 바뀌면 다시 뜬다 — 짝",
  t35Again === null && !t35AgainOn && t35Next === "20260501-002" && t35On(),
  `again=${t35Again}/${t35AgainOn} next=${t35Next}/${t35On()}`);

// ④ 여럿이 조건을 넘으면 **가장 많이 밀린 하나만**. 오늘 목록과 재배정 대기를 함께 본다 —
//    한쪽만 보면 다른 쪽의 더 밀린 일이 조용히 빠진다.
t35Set([t35Row("20260501-003", "덜 밀린 것", 3)],
       [t35Row("20260501-004", "가장 많이 밀린 것", 5, { latest_date: "2026-05-08" })]);
const t35Top = t35Prompt();
ok("④ 둘 이상이 조건을 넘으면 가장 많이 밀린 하나만",
  t35Top === "20260501-004" && txt("#carry-text").includes("가장 많이 밀린 것")
  && txt("#carry-text").includes("5회"), `${t35Top} / ${txt("#carry-text")}`);
// 동점 — **뒤에 놓인 이른 id**를 골라야 목록 순서가 아니라 규칙을 따른 것이다.
t35Set([t35Row("20260501-009", "나중 id", 4), t35Row("20260501-005", "이른 id", 4)], []);
const t35Tie = t35Prompt();
ok("동점이면 id가 이른 것 — 목록 순서가 아니다", t35Tie === "20260501-005", `${t35Tie}`);

// 선택지는 셋이다. **"0이 아니다"가 아니라 "몇이다"를 센다** — 넷째가 붙으면 여기서 죽는다.
ok("선택지가 셋이다 (넷째를 만들지 않았다)",
  w.document.querySelectorAll("#sh-carry button").length === 3,
  String(w.document.querySelectorAll("#sh-carry button").length));

// ⑤ ★ 이 티켓의 요점. '멀리 미룬다'로 연 피커는 2주 밖을 고를 수 있다.
t35Set([], [t35Row("20260501-006", "멀리 미룰 일", 4, { latest_date: "2026-05-01" })]);
if (t35Prompt()) $("#carry-far").click();
await sleep(60);
// ⚠️ 팝업이 안 뜨는 변이에서는 `S.pick`이 없다. **던지지 않고 빨간불이 되게** 읽는다 —
//    러너가 TypeError로 죽으면 이 뒤의 검사가 통째로 안 돌고, 그게 T-06이 없앤 실패 모양이다.
const t35FarRaw = ev(`JSON.stringify(S.pick ? {
  far: !!S.pick.far, max: pickMinMax().max,
  d20: pickable(addDaysStr(S.today.date, 20)),
  d40: pickable(addDaysStr(S.today.date, 40)),
  note: $("#pick-note").textContent,
} : null)`);
const t35Far = JSON.parse(t35FarRaw);
ok("⑤ '멀리 미룬다'가 연 피커는 2주 밖을 고르게 한다 (상한 없음)",
  !!t35Far && t35Far.far && t35Far.max === null && t35Far.d20 && t35Far.d40
  && t35Far.note.includes("상한 없음"), t35FarRaw);

// ★ ⑤의 짝 — **해제가 이 경로에서만 걸리는가.** 같은 항목을 평소 경로(재배정 대기의 '미루기 →')로
//   열면 상한이 그대로여야 한다. 이게 없으면 **모든 미루기에서 상한을 없앤 구현**도 ⑤를 통과한다.
//   ⚠️ `cancelPick()`으로 빠져나오면 안 된다 — 원래 탭이 Today라 `refreshToday()`가 돌고
//   **가짜 `S.today`가 실제 데이터로 덮인다**(그러면 아래 `pickReassign`이 항목을 못 찾는다).
//   `exitPick()`은 탭을 안 건드린다. t35Set이 그것까지 한다.
t35Set([], [t35Row("20260501-006", "멀리 미룰 일", 4, { latest_date: "2026-05-01" })]);
ev(`pickReassign("20260501-006")`);
await sleep(60);
const t35NormRaw = ev(`JSON.stringify(S.pick ? {
  far: !!S.pick.far, max: pickMinMax().max, cap: addDaysStr(S.today.date, 14),
  d20: pickable(addDaysStr(S.today.date, 20)),
  d14: pickable(addDaysStr(S.today.date, 14)),
  note: $("#pick-note").textContent,
} : null)`);
const t35Norm = JSON.parse(t35NormRaw);
ok("★ 평소 미루기는 여전히 D+14가 상한이다 — 해제가 그 경로로 새지 않는다",
  !!t35Norm && !t35Norm.far && t35Norm.max === t35Norm.cap
  && !t35Norm.d20 && t35Norm.d14 && t35Norm.note === "(2주 이내)", t35NormRaw);

await ev(`(async()=>{
  if (S.pick) exitPick();
  closeAll();
  localStorage.removeItem("carry_seen");
  await refreshToday();
  closeAll();
})()`);

// ── T-46 · ADR-041 — 홈 위젯 "+" → 딥링크 → 할 일 추가 입력창 ───────────────
//
// 위젯 자체는 jsdom이 못 본다(RemoteViews·Kotlin). 여기서 볼 수 있는 것은 **딥링크가
// 도착한 뒤**이고, 그 앞은 스캐너와 §확인 절차가 나눠 진다 — 감추지 않고 나눠 적는다.
console.log("\n[위젯 딥링크 — 찬 시작·더운 시작]");

/** 셸을 새로 띄운다 — `Capacitor.Plugins.App`을 **스크립트 주입 전에** 심는다.
 *  `boot()`가 그때 `globalThis.Capacitor`를 읽으므로 나중에 심으면 아무 배선도 안 걸린다. */
const t46Boot = async (fakeApp) => {
  const errs = [];
  const vcx = new VirtualConsole();
  vcx.on("jsdomError", (e) => errs.push(String(e.message)));
  const domx = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vcx, url: BASE + "/",
  });
  const wx = domx.window;
  bridgeFetch(wx, (u, o) => fetch(u, o));
  wx.HTMLElement.prototype.setPointerCapture = () => {};
  wx.HTMLElement.prototype.scrollTo = () => {};
  wx.Capacitor = { Plugins: { App: fakeApp } };
  for (const code of [apiJs, appJs]) {
    const s = wx.document.createElement("script");
    s.textContent = code;
    wx.document.body.appendChild(s);
  }
  wx.document.dispatchEvent(new wx.Event("DOMContentLoaded"));
  const up = await until(() => { try { return !!wx.eval("S.today"); } catch { return false; } }, 20_000);
  return { errs, up, $: (s) => wx.document.querySelector(s), heard: fakeApp.heard };
};
/** `@capacitor/app` 흉내. `heard`는 **무엇을 듣기로 했는지** 기록한다(더운 시작의 증거). */
const t46App = (getLaunchUrl) => {
  const heard = [];
  return { heard, getLaunchUrl, addListener: (n) => { heard.push(n); return { remove() {} }; } };
};

// ① 위젯이 앱을 띄웠다 — 도착하면 입력창이 **이미** 열려 있다.
const t46Cold = await t46Boot(t46App(async () => ({ url: "personalos://add-task" })));
const t46ColdOpen = await until(() => t46Cold.$("#sh-add").classList.contains("on"), 5000);
ok("① 위젯 딥링크로 뜨면 할 일 추가 입력창이 이미 열려 있다 (찬 시작)",
  t46Cold.up && t46ColdOpen && t46Cold.$("#phone").dataset.tab === "today"
  && !t46Cold.$("#boot").classList.contains("on"),
  `up=${t46Cold.up} sheet=${t46ColdOpen} tab=${t46Cold.$("#phone").dataset.tab}`);
// 같은 부팅에서 **더운 시작 리스너도 걸렸는가.** 찬 시작만 배선한 구현을 여기서 가른다.
ok("같은 부팅에서 appUrlOpen 리스너도 걸렸다 — 절반만 배선하지 않았다",
  (t46Cold.heard || []).includes("appUrlOpen"), JSON.stringify(t46Cold.heard));

// ② ★ ①의 짝. 딥링크 없이 그냥 실행한 앱 — **Today가 그대로 뜨고 입력창은 안 열린다.**
//    이게 없으면 *"딥링크가 없으면 흰 화면"* 인 구현도 ①을 통과한다.
const t46Plain = await t46Boot(t46App(async () => undefined));
await sleep(400);   // 늦게 열리는 것까지 본다 — 음성 판정이라 고정 대기가 필요하다
ok("② ★ 딥링크가 없으면 Today가 그대로 뜬다 — 입력창을 열지 않는다",
  t46Plain.up && !t46Plain.$("#boot").classList.contains("on")
  && t46Plain.$("#phone").style.display !== "none"     // 셸이 살아 있는가 — '흰 화면'의 가장 흔한 모양
  && /^\d+$/.test((t46Plain.$("#td-day").textContent || "").trim())
  && t46Plain.$("#td-list").querySelectorAll(".trow").length >= 1
  && !t46Plain.$("#sh-add").classList.contains("on")
  && !t46Plain.$("#bk").classList.contains("on"),
  `up=${t46Plain.up} day=${t46Plain.$("#td-day").textContent} `
  + `phone=${t46Plain.$("#phone").style.display} sheet=${t46Plain.$("#sh-add").className}`);

// ③ ★ ②의 짝. 딥링크 쪽이 **던져도** 앱은 뜬다 — 화면을 인질로 잡지 않는다.
//    ①·②만 보면 *"딥링크가 죽으면 앱도 죽는 구현"* 이 둘 다 통과한다.
//    두 갈래를 한꺼번에 본다: **여는 것**이 던질 때와 **묻는 것**(`getLaunchUrl`)이 던질 때.
const t46Boom = await t46Boot(t46App(() => { throw new Error("getLaunchUrl 폭발"); }));
const t46GuardRaw = await ev(`(async () => {
  const orig = DEEPLINK_ACTIONS["add-task"];
  DEEPLINK_ACTIONS["add-task"] = () => { throw new Error("여는 중 폭발"); };
  const out = {};
  try { out.open = await runDeepLink("personalos://add-task"); } catch (e) { out.open = "던졌다: " + e.message; }
  try { out.ask  = await runDeepLink(() => { throw new Error("묻는 중 폭발"); }); } catch (e) { out.ask = "던졌다: " + e.message; }
  DEEPLINK_ACTIONS["add-task"] = orig;
  closeAll();
  return JSON.stringify(out);
})()`);
const t46G = JSON.parse(t46GuardRaw);
ok("③ ★ 딥링크 처리가 던져도 앱이 뜬다 — 여는 것도 묻는 것도 null로 끝난다",
  t46G.open === null && t46G.ask === null
  && t46Boom.up && !t46Boom.$("#boot").classList.contains("on")
  && /^\d+$/.test((t46Boom.$("#td-day").textContent || "").trim()),
  `${t46GuardRaw} / up=${t46Boom.up} day=${t46Boom.$("#td-day").textContent}`);

// 표에 없는 것은 아무 일도 안 한다. **상속 키까지** 본다 — `in`으로 짰으면 `constructor`가 통과한다.
const t46Known = ev(`JSON.stringify([
  deepLinkAction("personalos://add-task"),
  deepLinkAction("personalos://nope"),
  deepLinkAction("personalos://constructor"),
  deepLinkAction("https://personal-os.mai-pos.workers.dev/add-task"),
  deepLinkAction(null),
])`);
ok("표에 없는 딥링크·다른 스킴은 아무것도 안 연다",
  t46Known === JSON.stringify(["add-task", null, null, null, null]), t46Known);

// ④ 찬 시작·더운 시작이 **둘 다** 배선돼 있다 — JS 한 쪽, Kotlin 한 쪽.
//    ⚠️ 주석을 걷어내고 본다(smoke의 `ktCode`와 같은 자리): 배선을 `//`로 막는 것이
//       검사를 지나가면, 배선을 끊는 가장 쉬운 방법이 초록이 된다.
/* ⚠️ **`\r`를 먼저 걷는다** (T-69에서 물렸다). 여기 스캐너 여럿이 `\n`으로 **줄이 붙어 있는지**를
 *    세는데, 파일이 CRLF로 저장되면 그 자리가 `)\r\n`이 되어 **구현이 그대로인데 빨간불**이 된다.
 *    윈도우 편집기·도구가 한 번 다시 쓰면 그만인 일이라 *"회귀했다"* 와 구별이 안 된다. */
const t46Bare = (s) => s.replace(/\r\n/g, "\n")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const t46NoXml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");
const T46_WARM = /addListener\s*\??\.?\s*\(\s*["']appUrlOpen["']/;   // 더운 시작
const T46_COLD = /getLaunchUrl\s*\(/;                                // 찬 시작
const t46AppBare = t46Bare(appJs);
ok("④ 찬 시작·더운 시작이 둘 다 배선돼 있다 (JS)",
  T46_WARM.test(t46AppBare) && T46_COLD.test(t46AppBare),
  `warm=${T46_WARM.test(t46AppBare)} cold=${T46_COLD.test(t46AppBare)}`);

const t46Kt = t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/widget/AddTaskWidget.kt"), "utf8"));
const t46Manifest = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/AndroidManifest.xml"), "utf8"));
ok("④ 위젯이 탭을 딥링크로 잇는다 (Kotlin — RemoteViews에 PendingIntent를 건다)",
  /setOnClickPendingIntent\s*\(/.test(t46Kt) && /PendingIntent\.getActivity\s*\(/.test(t46Kt)
  && /Intent\.ACTION_VIEW/.test(t46Kt) && /MainActivity::class\.java/.test(t46Kt),
  `click=${/setOnClickPendingIntent\s*\(/.test(t46Kt)} pi=${/PendingIntent\.getActivity\s*\(/.test(t46Kt)}`);
ok("④ Manifest가 위젯 receiver와 딥링크 스킴을 선언한다",
  /android:name="\.widget\.AddTaskWidget"/.test(t46Manifest)
  && /android\.appwidget\.action\.APPWIDGET_UPDATE/.test(t46Manifest)
  && /android:resource="@xml\/widget_add_task_info"/.test(t46Manifest)
  && /android:scheme="personalos"/.test(t46Manifest));

// ★ **대장이 둘이면 갈라진다.** Kotlin이 던지는 URL을 뽑아 **살아 있는 `deepLinkAction`에 먹인다** —
//   한쪽에서 스킴·경로를 고치면 여기서 죽는다. 두 문자열을 각자 정규식으로 보면 안 잡히는 자리다.
const t46KtUrl = (/DEEP_LINK\s*=\s*"([^"]+)"/.exec(t46Kt) || [])[1];
ok("★ Kotlin이 던지는 URL을 웹이 실제로 해석한다 (스킴·경로가 갈라지지 않았다)",
  ev(`deepLinkAction(${JSON.stringify(t46KtUrl || "")})`) === "add-task", String(t46KtUrl));

// ⑤ ★ ④의 짝 — **스캐너가 살아 있는가.** 스캐너가 눈멀면 ④는 배선과 무관하게 초록이 되고,
//    "배선이 끊겼다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다 —
//    **주석뿐이면 '안 배선됨'이어야 한다.**
const t46Fake = t46Bare([
  '  // capApp.addListener?.("appUrlOpen", (d) => runDeepLink(d && d.url));',
  "  // runDeepLink(() => capApp.getLaunchUrl());",
].join("\n"));
ok("⑤ ★ 스캐너가 주석을 걷어낸다 — 주석뿐이면 '안 배선됨'이다",
  !T46_WARM.test(t46Fake) && !T46_COLD.test(t46Fake)
  && T46_WARM.test('capApp.addListener?.("appUrlOpen", f)') && T46_COLD.test("capApp.getLaunchUrl()")
  && !T46_WARM.test('capApp.addListener?.("backButton", f)'),
  `fake=${JSON.stringify(t46Fake)}`);

// ⑥ 다크 짝 — **없는 것을 센다.** 한쪽에만 있는 이름은 그 모드에서 반대쪽 값이 그대로 쓰여
//    아무 소리 없이 배경과 같은 색이 된다(함정 5의 안드로이드판).
const t46Colors = (p) => new Set(
  [...readFileSync(join(here, p), "utf8").matchAll(/<color\s+name="([^"]+)"/g)].map((m) => m[1]));
const t46Light = t46Colors("../android/app/src/main/res/values/widget_colors.xml");
const t46Night = t46Colors("../android/app/src/main/res/values-night/widget_colors.xml");
const t46Orphan = [...t46Light].filter((n) => !t46Night.has(n))
  .concat([...t46Night].filter((n) => !t46Light.has(n)));
const t46Layout = readFileSync(join(here, "../android/app/src/main/res/layout/widget_add_task.xml"), "utf8");
ok("⑥ values-night 색이 짝으로 있다 — 한쪽에만 있는 이름이 0이고, 레이아웃이 그 이름만 쓴다",
  t46Light.size >= 2 && t46Orphan.length === 0
  && [...t46Light].every((n) => new RegExp(`@color/${n}\\b`).test(t46Layout))
  && !/(?:textColor|background)="#/.test(t46NoXml(t46Layout)),
  `light=${[...t46Light]} night=${[...t46Night]} orphan=${t46Orphan}`);

// ── T-47 · 미루기 말고도 나갈 문이 있다 (ADR-042) ─────────────────────────
console.log("\n[T-47] 날짜 선택 모드 — 다른 출구 · 대상이 사라지면 해제");
// **실물 task 하나로 끝까지 간다.** 가짜 id로는 ⑦에서 '대상이 사라진 자리'를 만들 수 없다 —
// 취소가 실제로 서버에서 성공해야 ⑧이 "없는 일을 미루는가"를 물을 수 있다.
// ⚠️ **오늘로 잡지 않는다** — 이 시점의 검사 DB는 앞 절이 오늘을 이미 마감해 뒀고,
//    마감된 날엔 예정 추가가 409다. 내일로 잡으면 실사용의 미루기와 같은 모양이 된다.
const t47Id = await ev(`(async () =>
  (await Api.createTask({ title: "T-47 나갈 문", date: addDaysStr(S.today.date, 1) })).id)()`);
const t47Start = () => ev(`startPick({ mode: "defer", id: ${JSON.stringify(t47Id)},
  from: addDaysStr(S.today.date, 1), title: "T-47 나갈 문" })`);
// 떠나온 탭을 Today로 둔다 — 해제가 **어디로 돌려보내는가**까지 보게 된다.
ev(`(() => { closeAll(); S.pick = null; switchTab("today", false); })()`);
await sleep(300);
t47Start();
await until(() => $("#pick-banner").classList.contains("on") && $$cur(".c").length > 0);

// ④ 미루기 모드에는 출구가 하나 더 있다.
const t47Link = $("#pick-open");
ok("④ 미루기 모드 배너에 '이 일 보기'가 있다",
  !!t47Link && t47Link.style.display !== "none" && t47Link.textContent.includes("이 일 보기"),
  t47Link ? `display="${t47Link.style.display}" text="${t47Link.textContent}"` : "요소 없음");
t47Link.dispatchEvent(new w.Event("click"));
await until(() => $("#sh-task").classList.contains("on"));
ok("④ 누르면 **그 일의** 상세 시트가 열린다",
  $("#sh-task").classList.contains("on") && ev("S.sheetTask && S.sheetTask.id") === t47Id,
  `${$("#sh-task").className} / ${ev("S.sheetTask && S.sheetTask.id")}`);

// ★⑥ ④의 짝 — 시트를 열면서 pick을 끝내 버리는 구현을 잡는다.
//    *"역시 미루자"* 가 한 단계도 안 늘어야 한다: 닫으면 캘린더이고 배너가 그대로 있다.
const t47Back = ev("handleBack()");
await sleep(200);
ok("★⑥ 시트를 닫으면 pick이 살아 있다 — 캘린더로 돌아와 계속 고른다",
  t47Back === "sheet" && !$("#sh-task").classList.contains("on")
  && ev("!!S.pick") && ev("S.pick.id") === t47Id
  && $("#pick-banner").classList.contains("on") && $("#phone").dataset.tab === "cal",
  `${t47Back} / pick=${ev("S.pick && S.pick.id")} / tab=${$("#phone").dataset.tab}`);

// ★⑤ ④의 짝 — 대기 → 첫 일정은 미룬 것이 아니다. 되돌릴 것이 없으니 출구도 다르다.
ev(`(() => { exitPick(); startPick({ mode: "schedule", id: ${JSON.stringify(t47Id)},
  title: "T-47 나갈 문" }); })()`);
await sleep(300);
ok("★⑤ 일정 정하기 모드에는 '이 일 보기'가 없다",
  $("#pick-banner").classList.contains("on") && $("#pick-open").style.display === "none",
  `display="${$("#pick-open").style.display}" note="${$("#pick-note").textContent}"`);

// ⑦·⑧ — 대상이 사라진 자리. **둘이 같은 결함의 두 증상이다.**
//   ⑦은 **보이는 것만** 본다(배너·시트·탭). 그래야 "배너만 지우고 `S.pick`은 남긴 구현"에서
//   ⑦은 초록이고 ⑧만 죽는다 — 그 대비가 없으면 상태가 진짜 없어졌는지 알 길이 없다.
ev(`(() => { exitPick(); switchTab("today", false); })()`);
await sleep(300);
t47Start();
await until(() => $("#pick-banner").classList.contains("on") && $$cur(".c").length > 0);
// 탭할 날짜는 **미루기 범위 안**에서 실제 그리드에 있는 것으로 고른다 —
// 범위 밖을 고르면 `pickable`이 막아 주므로 ⑧이 해제와 무관하게 통과한다(공회전).
// 상한·하한을 여기서 다시 계산하지 않고 **앱의 `pickable`에 직접 묻는다**(대장이 하나다).
const t47Target = ev(`(() => [...document.querySelectorAll("#cal-track .c")]
  .map((c) => c.dataset.d).find((d) => pickable(d)) || null)()`);
ev("openPickTask()");
await until(() => $("#sh-task").classList.contains("on") && ev("S.sheetTask && S.sheetTask.id") === t47Id);
$("#tk-cancel").dispatchEvent(new w.Event("click"));
await until(() => $("#confirm").classList.contains("on"));
$("#cf-yes").dispatchEvent(new w.Event("click"));
// ⚠️ **배너가 사라지기를 기다리면 안 된다** — 이미 사라져 있는 변이에서는 그 대기가 즉시 통과해
//    취소가 끝나기도 전에 판정한다(경합). 취소 성공의 공통 신호인 **시트 닫힘**을 기다린다.
await until(() => !$("#sh-task").classList.contains("on"), 5000);
await sleep(300);
ok("★⑦ 시트에서 취소가 성공하면 배너가 사라진다",
  !$("#pick-banner").classList.contains("on") && !$("#sh-task").classList.contains("on"),
  `banner=${$("#pick-banner").className} sheet=${$("#sh-task").className}`);
// ⑦′ 는 **따로 센다.** ⑦에 붙여 두면 "시트를 열 때 pick을 끝내는" 변이가 ⑥과 ⑦을 함께 죽여
// 어느 결함이 무엇을 죽였는지 못 읽는다(그 변이는 `origin`을 통째로 잃으므로 탭 복귀도 깨진다).
ok("⑦′ 떠나온 탭으로 돌려보낸다 — 대상이 없어진 캘린더에 남기지 않는다",
  $("#phone").dataset.tab === "today", $("#phone").dataset.tab);

// ★⑧ **실제로 날짜를 탭한다.** 상태가 진짜 없어졌는지는 그것으로만 갈린다 —
//    `S.pick`이 남아 있으면 `openDay`가 `assignDate`로 새고 미루기 확인 시트가 뜬다.
const t47Cell = t47Target && w.document.querySelector(`#cal-track .c[data-d="${t47Target}"]`);
if (t47Cell) t47Cell.dispatchEvent(new w.Event("click"));
await sleep(700);
/* ★ **상한 없는 대기를 메운다** (T-67 ②). 함정 8이 *"러너의 모든 대기에 상한이 있다"* 고
 * 적는데 **여기 하나가 비어 있었다** — 워커가 응답을 놓치면 이 `await`가 거절하면서
 * **모듈 본문이 통째로 끝나고 요약을 잃었다**(2026-09-09 T-66에서 실측한 그 자리).
 * ⚠️ **⑧의 단언은 한 글자도 안 고친다**(원인 미상인 실패를 지우면 원인을 잃는다).
 *    답이 안 오면 **조용히 통과하지 않도록** 이름 붙은 빨간불을 대신 세운다 —
 *    `{entries:[]}` 같은 값을 만들어 넘기면 ⑧이 *"안 옮겨갔다"* 로 **초록이 된다.** */
let t47After = null;
try {
  t47After = await capped("T-47 ⑧ — Api.task 응답", ev(`Api.task(${JSON.stringify(t47Id)})`));
} catch (e) {
  ok(`★⑧ 앞 대기가 상한에 걸렸다 — ${e.message}`, false);
}
if (t47After) {
  ok("★⑧ pick이 풀린 뒤 날짜를 탭해도 없는 일이 안 옮겨간다",
    !!t47Cell && !$("#sh-defer").classList.contains("on")
    && !t47After.entries.some((e) => e.date === t47Target),
    `target=${t47Target} cell=${!!t47Cell} deferSheet=${$("#sh-defer").classList.contains("on")}`
    + ` entries=${JSON.stringify(t47After.entries.map((e) => e.date))}`);
}

ev(`(() => { closeAll(); switchTab("today", false); })()`);
await sleep(200);

// ── T-48 · ADR-043 — 홈 "오늘 찍기" 위젯 ────────────────────────────────────
//
// ⚠️ **jsdom은 RemoteViews를 못 본다.** 여기서 진짜로 돌려 보는 것은 **웹이 건네는 것**이고,
//    Kotlin 쪽은 스캐너다. 무엇이 어디에 있는지 감추지 않고 나눠 적는다:
//      실측(§확인 절차) — 손가락으로 찍히는가 · 늘리면 켜지는가 · 마감 뒤에 되돌아오는가
//      smoke          — 위젯 상수로 조립한 본문이 200/409를 실제로 받는가 (①·②의 서버 쪽)
//      여기           — 문장이 한 곳에서 오는가 · 단계별로 무엇이 켜지는가 · 되돌림이 남는가
console.log("\n[T-48] 홈 위젯 — 문장 한 곳 · 단계 · 되돌림");

const t48Store = t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/widget/ScaleStore.kt"), "utf8"));
const t48Widget = t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/widget/ScaleWidget.kt"), "utf8"));
const t48LayoutRaw = readFileSync(
  join(here, "../android/app/src/main/res/layout/widget_scale.xml"), "utf8");
const t48Layout = t46NoXml(t48LayoutRaw);
const t48Dims = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/values/widget_scale_dims.xml"), "utf8"));
const t48Strings = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/values/strings.xml"), "utf8"));

/* ① ★ **문장을 만드는 곳이 한 곳인가** (티켓 ③·⑦).
 * 위젯이 앱과 같은 말을 하는 길은 둘뿐이다 — Kotlin에 옮겨 적거나, 만든 것을 건네받거나.
 * 여기서 뒤쪽을 **실제로 돌려서** 본다: 웹이 네이티브에 밀어 넣는 payload의 `summary`가
 * 살아 있는 `closeSummaryText(S.today)`와 **같은 글자**인가. */
ev(`(() => {
  globalThis.__wpush = [];
  globalThis.Capacitor = { Plugins: { Widget: {
    push: (p) => { globalThis.__wpush.push(p); return Promise.resolve({ ok: true }); },
  } } };
})()`);
const t48Sent = JSON.parse(ev(`JSON.stringify(pushWidget())`));
const t48Heard = JSON.parse(ev(`JSON.stringify(globalThis.__wpush)`));
const t48AppLine = ev(`closeSummaryText(S.today)`);
ok("① ★ 위젯이 받는 문장 = 앱이 그리는 문장 (만드는 곳이 한 곳이다)",
  !!t48Sent && t48Sent.summary === t48AppLine && t48AppLine.length > 0
  && t48Heard.length === 1 && t48Heard[0].summary === t48AppLine,
  `보낸것="${t48Sent && t48Sent.summary}" 앱="${t48AppLine}" 횟수=${t48Heard.length}`);

/* ② ★ ①의 짝 — **Kotlin이 문장을 만들지 않는다.**
 * ①만 보면 *"건네주기도 하고 Kotlin에도 복제해 둔 구현"* 이 통과한다. 그러면 한쪽을 고칠 때
 * 다른 쪽이 남고, 갈라진 쪽이 조용히 다른 말을 한다. `closeSummaryText`가 만드는 조각들이
 * 네이티브 어디에도 없어야 한다 — 문자열 리소스까지 함께 본다. */
const T48_SENTENCE_BITS = ["개 했고", "남은 것", "재배정 대기", "알렸어요", "담긴 할 일"];
const t48Leak = T48_SENTENCE_BITS.filter((b) =>
  t48Store.includes(b) || t48Widget.includes(b) || t48Strings.includes(b));
ok("② ★ 네이티브에 요약 문장이 없다 — 조각 하나도 새지 않았다 (두 벌이 아니다)",
  // 뒤 절이 **이 목록이 살아 있는지**를 센다: 지금 앱이 말하는 문장에 조각이 하나도 안 걸리면
  // 목록이 낡은 것이고, 그러면 앞 절은 무엇을 복제해도 초록이다.
  t48Leak.length === 0 && T48_SENTENCE_BITS.some((b) => t48AppLine.includes(b)),
  `샌 조각=${JSON.stringify(t48Leak)} / 앱 문장="${t48AppLine}"`);

/* ③ 경계는 **서버가 준다** (티켓 ⑤·⑧). 웹이 그대로 실어 보내는지 실제로 본다. */
const t48Boundary = ev(`S.today.boundary`);
ok("③ 경계·귀속일이 서버 응답 그대로 위젯에 간다 (코드에 시각을 안 적는다)",
  !!t48Sent && t48Sent.boundary === t48Boundary && /^\d{2}:\d{2}$/.test(t48Boundary)
  && t48Sent.date === ev(`S.today.date`),
  `boundary="${t48Sent && t48Sent.boundary}" date="${t48Sent && t48Sent.date}"`);

/* ③의 짝 — 네이티브에 **시각 리터럴이 하나도 없다.** `05:00`이라 적혀 있었는데 실제로는
 * `06:00`이었던 전례가 이 검사의 이유다. 그리고 경계를 넘으면 스스로 비우는 자리가 있는가. */
const T48_TIME_LIT = /\b\d{1,2}:\d{2}\b/;
const t48Clears = /fun readFresh\(/.test(t48Store) && /dayOf\(/.test(t48Store)
  && /stamped != today/.test(t48Store);
ok("③ ★ 네이티브에 하루 경계 시각이 안 적혀 있다 · 넘으면 스스로 비운다",
  !T48_TIME_LIT.test(t48Store) && !T48_TIME_LIT.test(t48Widget) && t48Clears,
  `store=${T48_TIME_LIT.exec(t48Store)} widget=${T48_TIME_LIT.exec(t48Widget)} clears=${t48Clears}`);

/* ④ ★ **찍힌 것처럼 보이고 안 찍히면 안 된다** (티켓 ④ · 이 티켓의 핵심).
 * 되돌리는 것과 남기는 것이 **한 함수 안**이어야 한다 — 나누면 한쪽만 지우기가 쉬워지고,
 * 그때 생기는 것이 *"되돌리긴 하는데 아무 표시가 없는 구현"* 이다. 그 함수 본문을 직접 본다. */
const t48Fn = (src, name) => {
  const i = src.indexOf(`fun ${name}(`);
  if (i < 0) return "";
  const rest = src.slice(i);
  const j = rest.slice(1).search(/\n {4}(fun |private fun |val |const |data class )/);
  return j < 0 ? rest : rest.slice(0, j + 1);
};
const t48Reject = t48Fn(t48Store, "reject");
const t48Reverts = /optJSONObject\(K_PENDING\)\?\.remove\(field\)/.test(t48Reject);
const t48Marks = /put\(K_NOTICE,/.test(t48Reject);
const t48CalledOnFail = /else ScaleStore\.reject\(/.test(t48Widget);
ok("④ ★ 서버가 거부하면 칠한 칸이 되돌아온다 (실패 분기가 되돌림을 부른다)",
  t48Reject.length > 0 && t48Reverts && t48CalledOnFail,
  `본문=${t48Reject.length}자 되돌림=${t48Reverts} 실패분기=${t48CalledOnFail}`);

/* ⑤ ★ ④의 짝 — **되돌림이 조용하지 않은가.** ④만 보면 *"되돌리되 아무 표시가 없는 구현"* 이
 * 통과한다. 위젯은 토스트를 못 띄우므로 그 표시는 **위젯 안에** 남아야 하고, feelings만 있는
 * 최소 크기에서도 보여야 한다 — 거기서 찍은 탭이 가장 자주 되돌아온다. */
const t48VisCalls = {};
for (const m of t48Widget.matchAll(/setViewVisibility\(\s*R\.id\.(\w+)\s*,([^\n]*)/g)) {
  (t48VisCalls[m[1]] = t48VisCalls[m[1]] || []).push(m[2]);
}
const t48Flag = (expr) =>
  /tier\.close/.test(expr) ? "close"
    : /tier\.log/.test(expr) ? "log"
      : /View\.VISIBLE/.test(expr) ? "always"
        : /View\.GONE/.test(expr) ? "never" : "dynamic";
ok("⑤ ★ 되돌린 사실이 위젯에 남는다 — 표시가 있고, 단계와 무관하게 보인다",
  t48Marks && (t48VisCalls.widget_scale_notice || []).length === 1
  && t48Flag(t48VisCalls.widget_scale_notice[0]) === "dynamic"
  && /widget_scale_notice_closed|widget_scale_notice_net/.test(t48Store),
  `표시=${t48Marks} 가시성=${JSON.stringify(t48VisCalls.widget_scale_notice)}`);

/* ⑥ 크기 3단계 — 무엇이 켜지는가. 표를 Kotlin에서 뽑아 **레이아웃의 포함 관계와 함께** 푼다.
 * (`setViewVisibility`가 없는 뷰는 조상이 정한다 — 그것이 "요약과 score가 한 덩어리"의 뜻이다.) */
const t48Tiers = [...t48Store.matchAll(/Tier\(name = "(\w+)", close = (true|false), log = (true|false)\)/g)]
  .map((m) => ({ name: m[1], close: m[2] === "true", log: m[3] === "true" }));
const t48Parent = (() => {
  const stack = [], parent = {};
  for (const m of t48Layout.matchAll(/<(\/?)([A-Za-z][\w.]*)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const [, closing, , attrs, self] = m;
    if (closing) { stack.pop(); continue; }
    const id = (/android:id="@\+?id\/(\w+)"/.exec(attrs) || [])[1] || null;
    if (id) parent[id] = [...stack].reverse().find(Boolean) ?? null;
    if (!self) stack.push(id);
  }
  return parent;
})();
/** 그 단계에서 이 뷰가 보이는가. `"multi"`·`"dynamic"`은 **읽을 수 없다**는 뜻이라 실패로 본다. */
const t48Visible = (id, tier) => {
  for (let node = id; node; node = t48Parent[node]) {
    const calls = t48VisCalls[node];
    if (!calls) continue;
    if (calls.length !== 1) return "multi";
    const f = t48Flag(calls[0]);
    if (f === "close" || f === "log") return !!tier[f];
    if (f === "always") return true;
    if (f === "never") return false;
    return "dynamic";
  }
  return true;   // 아무도 안 건드린다 — feelings 눈금이 여기다
};
const t48Show = (id) => t48Tiers.map((t) => t48Visible(id, t));
const t48Sum = t48Show("widget_scale_summary");
const t48Score = t48Show("widget_scale_score_0");
const t48Log = t48Show("widget_scale_log");
const t48Feel = t48Show("widget_scale_energy_0");
const t48Close = t48Show("widget_scale_close");
// ⚠️ 여기서 **요약 자체를 보지 않는다** — 요약과 score의 짝은 ⑦·⑧이 진다. 이 검사까지
//    요약을 보면 *"요약을 모든 단계에 켜는"* 변이가 둘을 한꺼번에 죽이고, 그러면 어느 결함이
//    무엇을 죽였는지 못 읽는다(T-47이 ⑦을 둘로 가른 것과 같은 이유).
ok("⑥ 크기 3단계가 각각 무엇을 켜는가 — 최소는 눈금만, 중간에 마감 블록, 최대에 로그",
  t48Tiers.length === 3
  && JSON.stringify(t48Tiers.map((t) => t.name)) === `["min","mid","max"]`
  && JSON.stringify(t48Feel) === "[true,true,true]"
  && JSON.stringify(t48Close) === "[false,true,true]"
  && JSON.stringify(t48Log) === "[false,false,true]",
  `tiers=${JSON.stringify(t48Tiers)} feel=${t48Feel} close=${t48Close} log=${t48Log}`);

/* ⑥의 짝 — **임계 dp가 레이아웃과 같은 곳에서 온다.** Kotlin은 숫자를 안 적고 dimen을 더한다.
 * 합이 어긋나면 블록을 늘렸는데 임계가 안 따라온 것이고, 그때 잘리는 것은 아래쪽 블록이다. */
const t48Dim = (n) => Number((new RegExp(`name="${n}">(\\d+)dp`).exec(t48Dims) || [])[1]);
const [t48Pad, t48Line, t48Row] = ["widget_scale_pad", "widget_scale_line", "widget_scale_row"].map(t48Dim);
ok("⑥ 임계 dp를 코드에 안 적는다 — dimen의 합이고, 합이 레이아웃과 맞다",
  /getDimension\(R\.dimen\.widget_scale_h_base\)/.test(t48Store)
  && !/availDp >= \d/.test(t48Store)
  && t48Dim("widget_scale_h_base") === t48Pad * 2 + t48Line + t48Row * 3
  && t48Dim("widget_scale_h_close") === t48Line + t48Row
  && t48Dim("widget_scale_h_log") === t48Row,
  `pad=${t48Pad} line=${t48Line} row=${t48Row} base=${t48Dim("widget_scale_h_base")} `
  + `close=${t48Dim("widget_scale_h_close")} log=${t48Dim("widget_scale_h_log")}`);

/* ⑦ ★ **score가 켜진 단계에는 요약도 켜져 있다** (ADR-040을 되돌리지 않는다 — 없는 것을 센다).
 * 이 둘이 갈리는 순간이 *"빈 칸에 점수를 매기는"* 그 모양이다. */
const t48Orphan = t48Tiers.filter((t, i) => t48Score[i] === true && t48Sum[i] !== true);
ok("⑦ ★ score가 켜진 단계에는 요약도 켜져 있다 — 한쪽만인 단계가 0이다",
  t48Orphan.length === 0 && t48Tiers.some((t, i) => t48Score[i] === true && t48Sum[i] === true),
  `한쪽만=${JSON.stringify(t48Orphan.map((t) => t.name))} score=${t48Score} sum=${t48Sum}`);

/* ⑧ ★ ⑦의 짝 — **feelings 단계에는 요약이 꺼져 있다.**
 * ⑦만 보면 *"모든 단계에 요약을 켜는 구현"* 이 통과한다. 그런데 지금 몸 상태는 하루의 결산이
 * 아니고, 매기기 전에 판단을 심지 않는 것이 T-44와 같은 방향이다. */
ok("⑧ ★ feelings만 있는 단계엔 요약이 없다 (매기기 전에 판단을 심지 않는다)",
  t48Sum[0] === false && t48Score[0] === false && t48Feel[0] === true
  && t48Tiers.some((t, i) => t48Sum[i] === false),
  `min: feel=${t48Feel[0]} sum=${t48Sum[0]} score=${t48Score[0]}`);

/* ⑨ ★ **크기 분기가 던져도 위젯이 빈 화면이 되지 않는다** — 성공처럼 보이는 실패.
 * 여기서 던지면 `updateAppWidget`이 아예 안 불려 위젯이 옛 그림이나 빈 틀로 남는다. */
const T48_TIER_GUARD = /runCatching\s*\{[\s\S]*?\}\.getOrDefault\(ScaleStore\.TIERS\.first\(\)\)/;
ok("⑨ ★ 크기 분기가 던져도 최소 단계로 접힌다 (빈 화면이 아니라 눈금은 남는다)",
  T48_TIER_GUARD.test(t48Widget) && /fun tierOf\(/.test(t48Widget),
  `guard=${T48_TIER_GUARD.test(t48Widget)}`);

/* ⑩ ★ ⑨의 짝 — **스캐너가 살아 있는가.** 눈멀면 ⑨는 가드와 무관하게 초록이 되고,
 * "가드가 없다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다. */
const t48FakeGuarded = "runCatching { tierFor(ctx, dp) }.getOrDefault(ScaleStore.TIERS.first())";
const t48FakeBare = "ScaleStore.tierFor(ctx, dp)";
ok("⑩ ★ ⑨의 스캐너가 살아 있다 — 가드는 잡고, 없거나 주석뿐이면 안 잡는다",
  T48_TIER_GUARD.test(t48FakeGuarded) && !T48_TIER_GUARD.test(t48FakeBare)
  && !T48_TIER_GUARD.test(t46Bare("  // " + t48FakeGuarded)),
  `guarded=${T48_TIER_GUARD.test(t48FakeGuarded)} bare=${T48_TIER_GUARD.test(t48FakeBare)}`);

/* ⑪ 로그 딥링크 — **대장은 웹 하나다**(T-46이 세운 규칙). Kotlin이 던지는 URL을
 * 살아 있는 `deepLinkAction`에 먹인다. 두 문자열을 각자 정규식으로 보면 갈라져도 둘 다 초록이다. */
const t48KtUrl = (/LOG_DEEP_LINK\s*=\s*"([^"]+)"/.exec(t48Widget) || [])[1];
ok("⑪ Kotlin이 던지는 로그 URL을 웹이 실제로 해석한다",
  ev(`deepLinkAction(${JSON.stringify(t48KtUrl || "")})`) === "add-log", String(t48KtUrl));
await ev(`runDeepLink(${JSON.stringify(t48KtUrl || "")})`);
await sleep(200);
ok("⑪ 로그 딥링크가 Today의 입력줄로 데려온다 (위젯 안에서는 못 친다)",
  $("#phone").dataset.tab === "today" && w.document.activeElement === $("#log-input"),
  `tab=${$("#phone").dataset.tab} focus=${w.document.activeElement && w.document.activeElement.id}`);

/* ⑫ 다크 짝 — **없는 것을 센다.** 한쪽에만 있는 이름은 그 모드에서 반대쪽 값이 그대로 쓰여
 * 아무 소리 없이 배경과 같은 색이 된다(함정 5의 안드로이드판).
 * ⚠️ T-46의 `widget_colors.xml`과 **파일을 나눴다** — 그 검사가 *"여기 색은 전부 그 레이아웃이
 *    쓴다"* 를 세므로, 한 파일에 두 위젯 색을 넣으면 T-46이 빨간불이 된다. */
const t48Colors = (p) => new Set(
  [...readFileSync(join(here, p), "utf8").matchAll(/<color\s+name="([^"]+)"/g)].map((m) => m[1]));
const t48Light = t48Colors("../android/app/src/main/res/values/widget_scale_colors.xml");
const t48Night = t48Colors("../android/app/src/main/res/values-night/widget_scale_colors.xml");
const t48OrphanColor = [...t48Light].filter((n) => !t48Night.has(n))
  .concat([...t48Night].filter((n) => !t48Light.has(n)));
const t48Styles = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/values/styles.xml"), "utf8"));
ok("⑫ values-night 색이 짝으로 있다 — 한쪽에만 있는 이름 0 · 리터럴 색 0",
  t48Light.size >= 4 && t48OrphanColor.length === 0
  && [...t48Light].every((n) => new RegExp(`@color/${n}\\b`).test(t48Layout + t48Styles))
  && !/(?:textColor|background)="#/.test(t48Layout),
  `light=${[...t48Light]} orphan=${t48OrphanColor}`);

/* ⑬ Manifest — 선언이 빠지면 위젯이 목록에 아예 안 뜨거나, 떠도 `onUpdate`가 안 와서
 * `initialLayout` 그대로 굳는다(T-46이 물린 자리). 그리고 **다리(plugin) 등록**이 빠지면
 * 웹이 조용히 건너뛰고 위젯은 요약도 값도 못 받는다. */
const t48Manifest = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/AndroidManifest.xml"), "utf8"));
const t48Main = readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/MainActivity.java"), "utf8");
ok("⑬ Manifest가 위젯을 선언하고, 다리가 등록돼 있다",
  /android:name="\.widget\.ScaleWidget"/.test(t48Manifest)
  && /android:resource="@xml\/widget_scale_info"/.test(t48Manifest)
  && /android\.appwidget\.action\.APPWIDGET_UPDATE/.test(t48Manifest)
  && !/SCALE_TAP/.test(t48Manifest)          // 우리 액션을 filter에 적으면 남이 눈금을 찍는다
  && /registerPlugin\(WidgetPlugin\.class\)/.test(t48Main),
  `receiver=${/android:name="\.widget\.ScaleWidget"/.test(t48Manifest)} plugin=${/registerPlugin\(WidgetPlugin\.class\)/.test(t48Main)}`);

/* ⑭ 네이티브가 없는 환경(브라우저·PWA)에서 **아무 일도 안 일어난다.** 화면을 인질로 잡지 않는다. */
ev(`(() => { delete globalThis.Capacitor; globalThis.__wpush = []; })()`);
ok("⑭ 네이티브가 없으면 조용히 지나간다 (브라우저·PWA에서 화면이 안 죽는다)",
  ev(`pushWidget()`) === null && ev(`globalThis.__wpush.length`) === 0);
ev(`(() => { closeAll(); switchTab("today", false); })()`);
await sleep(200);

// ── T-49 · 홈 3×1 "로그 쓰기" 위젯 ─────────────────────────────────────────
//
// **T-46의 "+"와 같은 물건에 다른 옷이다** — 탭 → 딥링크 → 앱 입력창. 그래서 여기서
// 새로 볼 것은 배선 하나뿐이고, `add-log` 액션 자체는 T-48이 이미 세웠다(이 티켓은 안 고친다).
console.log("\n[T-49] 로그 쓰기 위젯 — 딥링크 하나");

const t49Kt = t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/widget/LogWidget.kt"), "utf8"));
const t49Layout = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/layout/widget_log.xml"), "utf8"));
const t49Draw = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/drawable/widget_log_bg.xml"), "utf8"));

/** 탭이 딥링크로 이어져 있는가. ⑤가 **이 함수 자체**를 합성 줄로 검증한다. */
const T49_TAP = (src) =>
  /setOnClickPendingIntent\s*\(/.test(src) && /PendingIntent\.getActivity\s*\(/.test(src)
  && /Intent\.ACTION_VIEW/.test(src) && /MainActivity::class\.java/.test(src);

const t49Url = (/DEEP_LINK\s*=\s*"([^"]+)"/.exec(t49Kt) || [])[1];

// ① 배선 — RemoteViews에 PendingIntent를 걸고, 던지는 것이 우리 스킴의 딥링크다.
//    ⚠️ **여기서 액션 이름은 안 본다.** 이름의 옳고 그름은 ②가 대장에 물어서 가른다.
ok("① 위젯이 탭을 딥링크로 잇는다 (Kotlin — RemoteViews에 PendingIntent를 건다)",
  T49_TAP(t49Kt) && /^personalos:\/\/[a-z-]+$/.test(t49Url || ""),
  `wire=${T49_TAP(t49Kt)} url=${t49Url}`);

/* ② ★ ①의 짝 — **그 이름이 대장에 실제로 있는가.**
 * ①만 보면 `add-logs`처럼 **한 글자 틀린 딥링크**가 통과한다. 그러면 `deepLinkAction`이
 * `null`을 주고 T-46이 세운 폴백이 그냥 Today를 띄운다 — 위젯을 눌렀는데 *"앱이 열리긴 했다"* 로
 * 보여서 **결함이 조용해진다.** 그래서 두 문자열을 각자 정규식으로 보지 않고,
 * Kotlin이 던지는 URL을 **살아 있는 `deepLinkAction`에 먹인다.** */
ok("② ★ Kotlin이 던지는 URL을 웹의 대장이 실제로 해석한다 (한 글자도 안 틀렸다)",
  ev(`deepLinkAction(${JSON.stringify(t49Url || "")})`) === "add-log"
  && ev(`Object.prototype.hasOwnProperty.call(DEEPLINK_ACTIONS, "add-log")`) === true,
  `url=${t49Url} action=${ev(`deepLinkAction(${JSON.stringify(t49Url || "")})`)}`);

/* ③ 다크 짝 — **없는 것을 센다.** 한쪽에만 있는 이름은 그 모드에서 반대쪽 값이 그대로 쓰여
 * 아무 소리 없이 배경과 같은 색이 된다(함정 5의 Android판).
 * ⚠️ 파일이 통째로 없어도 **검사 하나만 죽어야 한다** — 여기서 던지면 러너가 통째로 멈춘다. */
const t49Colors = (p) => {
  try {
    return new Set([...readFileSync(join(here, p), "utf8").matchAll(/<color\s+name="([^"]+)"/g)]
      .map((m) => m[1]));
  } catch { return new Set(); }
};
const t49Light = t49Colors("../android/app/src/main/res/values/widget_log_colors.xml");
const t49Night = t49Colors("../android/app/src/main/res/values-night/widget_log_colors.xml");
const t49Orphan = [...t49Light].filter((n) => !t49Night.has(n))
  .concat([...t49Night].filter((n) => !t49Light.has(n)));
ok("③ values-night 색이 짝으로 있다 — 한쪽에만 있는 이름이 0이고, 레이아웃·배경이 그 이름만 쓴다",
  t49Light.size >= 3 && t49Orphan.length === 0
  && [...t49Light].every((n) => new RegExp(`@color/${n}\\b`).test(t49Layout + t49Draw)),
  `light=${[...t49Light]} night=${[...t49Night]} orphan=${t49Orphan}`);

/* ④ 리터럴 0 — 색은 `values-night`가 일해야 하고, 문구는 한 곳에서 고쳐야 한다.
 * 둥근 모서리 때문에 배경이 드로어블로 나갔으므로 **드로어블까지 함께 본다** —
 * 레이아웃만 보면 색을 드로어블에 박는 것이 통과한다. */
ok("④ 레이아웃·배경에 색 리터럴도 문자열 리터럴도 없다",
  !/="#[0-9A-Fa-f]{3,8}"/.test(t49Layout + t49Draw)
  && !/android:text="(?!@string\/)/.test(t49Layout)
  && /@string\/widget_log_hint/.test(t49Layout),
  `색=${/="#[0-9A-Fa-f]{3,8}"/.exec(t49Layout + t49Draw)} 글=${/android:text="(?!@string\/)/.exec(t49Layout)}`);

/* ⑤ ★ ①의 짝 — **스캐너가 살아 있는가.** 눈멀면 ①은 배선과 무관하게 초록이 되고,
 * "배선이 끊겼다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다 —
 * **주석뿐이면 '안 배선됨'이어야 한다.** */
const t49Real = [
  "RemoteViews(context.packageName, R.layout.widget_log).apply {",
  "    setOnClickPendingIntent(R.id.widget_log_root, tapIntent(context))",
  "val intent = Intent(Intent.ACTION_VIEW, Uri.parse(DEEP_LINK)).apply { setClass(context, MainActivity::class.java) }",
  "return PendingIntent.getActivity(context, REQ_TAP, intent, 0)",
].join("\n");
ok("⑤ ★ ①의 스캐너가 살아 있다 — 배선은 잡고, 주석뿐이면 안 잡는다",
  T49_TAP(t49Real) && !T49_TAP(t46Bare(t49Real.split("\n").map((l) => "// " + l).join("\n")))
  && !T49_TAP("setOnClickPendingIntent(R.id.x, y)"),
  `real=${T49_TAP(t49Real)}`);

/* ⑥ Manifest — 선언이 빠지면 위젯이 목록에 아예 안 뜨거나, 떠도 `onUpdate`가 안 와서
 * `initialLayout` 그대로 굳어 **눌러도 아무 일이 없다**(T-46이 물린 자리).
 * `exported="false"`가 그 실패를 만든다 — APPWIDGET_UPDATE는 system_server가 보낸다. */
const t49Manifest = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/AndroidManifest.xml"), "utf8"));
const t49Block = (/<receiver[^>]*\.widget\.LogWidget[\s\S]*?<\/receiver>/.exec(t49Manifest) || [])[0] || "";
ok("⑥ Manifest가 로그 위젯을 선언한다 — exported=true · APPWIDGET_UPDATE · 자기 메타",
  /android:exported="true"/.test(t49Block)
  && /android\.appwidget\.action\.APPWIDGET_UPDATE/.test(t49Block)
  && /android:resource="@xml\/widget_log_info"/.test(t49Block),
  `블록=${t49Block.length}자`);

// ── T-51 · 밤 개입이 더 일찍, 더 자주 ──────────────────────────────────────
//
// ⚠️ **jsdom은 Kotlin을 못 돌린다.** 여기 다섯은 전부 스캐너이고, **진짜 판정은 오늘 밤이다**
//    (§확인 절차 — 15분 만에 첫 알림이 오는가 · 그 뒤 15분 간격인가 · 새벽까지 남는가).
//    그래서 여기서 세는 것은 *"동작하는가"*가 아니라 **"값이 설정에 있는가"** 하나다.
console.log("\n[T-51] 밤 개입 — 간격이 설정으로 내려왔는가");

const t51Kt = (p) => t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/guard/" + p), "utf8"));
const t51Settings = t51Kt("GuardSettings.kt");
const t51Watch = t51Kt("GuardWatch.kt");
const t51Plugin = t51Kt("GuardPlugin.kt");

/** 프로퍼티 하나의 본문만. 옆 프로퍼티까지 흘러 들어가면 `coerceIn`을 빼도 이웃 것이 잡힌다. */
const t51Block = (name) => {
  const i = t51Settings.indexOf(`var ${name}: Int`);
  if (i < 0) return "";
  const rest = t51Settings.slice(i);
  const j = rest.slice(1).search(/\n {4}(var |fun |companion )/);
  return j < 0 ? rest : rest.slice(0, j + 1);
};
const t51Default = (name) => {
  const m = /getInt\(\w+,\s*(\d+)\)/.exec(t51Block(name));
  return m ? +m[1] : null;
};
const t51Range = (name) => {
  const m = /coerceIn\((\d+),\s*(\d+)\)/.exec(t51Block(name));
  return m ? `${m[1]}..${m[2]}` : null;
};

// ① 웹 → 플러그인 → 설정 → 상태. **네 마디가 다 이어져야** 폰 콘솔에서 한 줄로 덮을 수 있다.
ok("① setWatch가 refire 간격을 받아 저장하고 watchStatus가 돌려준다",
  /call\.getInt\("refireMinutes"\)\?\.let \{ s\.watchRefireMinutes = it \}/.test(t51Plugin)
  && /var watchRefireMinutes: Int/.test(t51Settings)
  && /\.put\("refireMin", s\.watchRefireMinutes\)/.test(t51Watch),
  `plugin=${/refireMinutes/.test(t51Plugin)} settings=${/watchRefireMinutes/.test(t51Settings)} status=${/refireMin/.test(t51Watch)}`);

/* ② ★ **간격이 코드 상수가 아니라 설정에서 온다.** 이 티켓의 본체다 —
 * 상수로 두면 9~11월에 이 값을 만질 때마다 APK를 새로 깔아야 하고,
 * `watchMinutes`(이미 설정)와 같은 규칙의 두 손잡이가 서로 다른 곳에 있게 된다. */
const T51_LITERAL_MIN = /\d+\s*\*\s*60_000/;              // 분을 상수로 박은 모양
const T51_FROM_SETTING = /watchRefireMinutes\s*\*\s*60_000/;
ok("② ★ 재발동 간격이 설정에서 온다 — GuardWatch에 리터럴 분(分)이 없다",
  !T51_LITERAL_MIN.test(t51Watch) && T51_FROM_SETTING.test(t51Watch),
  `리터럴=${T51_LITERAL_MIN.exec(t51Watch)} 설정=${T51_FROM_SETTING.test(t51Watch)}`);

/* ③ ★ ②의 짝 — 스캐너가 눈멀면 ②는 상수가 박혀 있어도 초록이 되고,
 * "설정에서 온다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다. */
const t51Old = "    private const val REFIRE_MS = 30 * 60_000L";
const t51New = "        if (l2done && now - last < s.watchRefireMinutes * 60_000L) return false";
ok("③ ★ ②의 스캐너가 살아 있다 — 옛 모양은 잡고, 새 모양은 안 잡는다",
  T51_LITERAL_MIN.test(t51Old) && !T51_FROM_SETTING.test(t51Old)
  && !T51_LITERAL_MIN.test(t51New) && T51_FROM_SETTING.test(t51New)
  && !T51_LITERAL_MIN.test(t46Bare("  // " + t51Old)),
  `옛=${T51_LITERAL_MIN.test(t51Old)} 새=${T51_FROM_SETTING.test(t51New)}`);

// ④ 기본값이 **둘 다** 15다. 하나만 바꾸면 새 기기에서 두 값이 어긋난다.
ok("④ 기본값이 둘 다 15다 (첫 발동 임계 · 재발동 간격)",
  t51Default("watchMinutes") === 15 && t51Default("watchRefireMinutes") === 15,
  `minutes=${t51Default("watchMinutes")} refire=${t51Default("watchRefireMinutes")}`);

/* ⑤ ★ 범위 밖 값이 coerce 된다 — **이웃과 같은 모양인가.**
 * 새 값만 상한이 다르면 0이나 거대값이 들어왔을 때 어느 쪽이 먼저 걸렸는지 못 읽는다.
 * ⚠️ 여기서 `watchMaxPerNight`도 함께 본다 — ③(밤 상한)을 5에서 9로 올렸고,
 *    그 값도 `coerceIn` 안에 있어야 폰 콘솔에서 잘못 넣어도 규칙이 안 깨진다. */
ok("⑤ ★ 범위 밖 값이 coerce 된다 — refire가 이웃(minutes)과 같은 범위다",
  t51Range("watchRefireMinutes") === "1..240"
  && t51Range("watchRefireMinutes") === t51Range("watchMinutes")
  && t51Range("watchMaxPerNight") === "1..20",
  `refire=${t51Range("watchRefireMinutes")} minutes=${t51Range("watchMinutes")} max=${t51Range("watchMaxPerNight")}`);

// ⑥ ③의 판단 — 밤 상한을 올린 것이 실제로 파일에 있는가. **근거는 보고에 있고 여기선 수를 센다.**
//    간격이 절반이 되면 상한도 두 배 빨리 닳는다: 5회 × 30분은 첫 발동 뒤 2시간을 덮었는데
//    5회 × 15분이면 1시간에 끝나고 취침 창(5.5시간)의 뒤쪽이 통째로 빈다.
//    9 = (5 − 1) × 30 ÷ 15 + 1 — **커버 시간을 그대로 유지하는 수**다.
ok("⑥ 밤 상한이 커버 시간을 유지하도록 올라갔다 (5 → 9)",
  t51Default("watchMaxPerNight") === 9
  && (t51Default("watchMaxPerNight") - 1) * t51Default("watchRefireMinutes") === (5 - 1) * 30,
  `max=${t51Default("watchMaxPerNight")} 커버=${(t51Default("watchMaxPerNight") - 1) * t51Default("watchRefireMinutes")}분`);

// ── T-53 · 폰 캘린더가 Today를 채운다 ──────────────────────────────────────
//
// ⚠️ **jsdom은 CalendarContract를 못 본다.** 여기서 진짜로 돌려 보는 것은 **웹이 세 실패를
//    가르는가**이고, 기기 쪽(Instances 전개·창 범위·순서)은 스캐너다. 무엇이 어디에 있는지
//    감추지 않고 나눠 적는다 — 진짜 판정은 §확인 절차(폰에 깔고 하루 살아 보기)다.
console.log("\n[T-53] 폰 캘린더 — 세 실패가 각자의 문구를 가진다");

const t53Kt = (p) => t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/" + p), "utf8"));
const t53Reader = t53Kt("cal/CalendarReader.kt");
const t53Send = t53Kt("cal/CalSync.kt");
const t53Plugin = t53Kt("cal/CalPlugin.kt");
const t53Main = t53Kt("MainActivity.java");
const t53GuardSync = t53Kt("guard/GuardSync.kt");
const t53Manifest = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/AndroidManifest.xml"), "utf8"));

/* ① 대상이 골라져 있으면 **창 범위를** 보낸다 — 기기 스캐너 + 웹 배선.
 *   ⚠️ 짝이 되는 절반은 *"선택 전에는 아무것도 안 가져온다"*(티켓 ③)이고, 그 방벽이
 *      읽기(`CalendarReader`)와 보내기(`CalSync`) **양쪽**에 있어야 한쪽을 지워도 새지 않는다. */
ok("① 대상이 있으면 창 범위를 보낸다 · 미선택이면 읽지도 보내지도 않는다",
  /\/api\/cal\/sync/.test(t53Send)
  && /put\("window"[\s\S]{0,90}"from"[\s\S]{0,40}"to"/.test(t53Send)
  && /windowDays\(ctx\)/.test(t53Send)
  && /ids\.isEmpty\(\)/.test(t53Send) && /calIds\.isEmpty\(\)/.test(t53Reader)
  && /setTargets\(\{\s*ids\s*\}\)/.test(t46AppBare),
  `sync=${/\/api\/cal\/sync/.test(t53Send)} window=${/put\("window"/.test(t53Send)}`
  + ` 방벽=${/ids\.isEmpty\(\)/.test(t53Send)}/${/calIds\.isEmpty\(\)/.test(t53Reader)}`);

/* ②③④ — 세 실패를 **각자의 문구로** 띄운다.
 *
 * 네이티브가 없는 jsdom에 `Capacitor.Plugins.Cal`을 심어 상태만 갈아 끼운다.
 * 이렇게 해야 순수 함수(`calStatusLine`)가 아니라 **배선까지** 지나간다 —
 * 문구가 맞아도 `loadCalStatus`가 바를 안 켜면 화면은 여전히 침묵한다. */
const t53Bar = $("#td-cal");
const t53Show = async (st) => {
  w.Capacitor = { Plugins: { Cal: { status: async () => st } } };
  await w.loadCalStatus();
  return {
    state: t53Bar.dataset.state, display: t53Bar.style.display,
    text: txt("#td-cal-text"), act: txt("#td-cal-act"),
  };
};
// 시각은 **지금에서 상대로** 만든다 — 고정 날짜는 언젠가 반드시 현재가 된다(함정 12).
const t53OkAt = new Date(Date.now() - 3600_000).toISOString();
const t53NoPerm = await t53Show({ permission: false, targets: [] });
const t53NoTarget = await t53Show({ permission: true, targets: [] });
const t53Failed = await t53Show({ permission: true, targets: [7], lastError: "HTTP 503 boom" });
const t53Synced = await t53Show({ permission: true, targets: [7], lastError: null, lastOkAt: t53OkAt, lastCount: 12 });

ok("② ★ 권한이 없으면 Today에 그 사실이 뜬다 (행동까지 붙는다)",
  t53NoPerm.state === "noperm" && t53NoPerm.display === "flex"
  && t53NoPerm.text.includes("권한") && t53NoPerm.act === "허용하기",
  JSON.stringify(t53NoPerm));

ok("③ ★ 대상 미선택도 뜬다 — 다른 상태 · 다른 문구 · 다른 행동",
  t53NoTarget.state === "notarget" && t53NoTarget.display === "flex"
  && t53NoTarget.act === "고르기" && t53NoTarget.text !== t53NoPerm.text,
  JSON.stringify(t53NoTarget));

ok("④ ★ 동기화 실패도 뜨고 사유가 남는다 · 성공하면 안 뜬다 (없는 것을 세는 검사)",
  t53Failed.state === "error" && t53Failed.display === "flex"
  && t53Failed.text.includes("HTTP 503 boom")
  && t53Synced.state === "ok" && t53Synced.display === "none" && t53Synced.text === "",
  `${JSON.stringify(t53Failed)} / ${JSON.stringify(t53Synced)}`);

/* ★ ②③④의 짝 — **셋이 서로 다른 문장인가.** 이 티켓의 본체가 여기다.
 *   하나로 뭉치면 *"뭔가 안 된다"*만 남고 무엇을 고칠지 화면이 말하지 않는다 —
 *   8/28에 알림 권한에서 겪은 것이 정확히 그 모양이다. 각각을 따로 보는 것만으로는
 *   **셋을 같은 문자열로 만드는 변이가 통과한다**(세 검사가 모두 '뜬다'만 세므로). */
const t53Three = [t53NoPerm, t53NoTarget, t53Failed];
ok("★ 셋이 서로 다른 상태·문구다 — 무엇을 고칠지가 화면에서 갈린다",
  new Set(t53Three.map((x) => x.state)).size === 3
  && new Set(t53Three.map((x) => x.text)).size === 3
  && t53Three.every((x) => x.text.length > 0),
  t53Three.map((x) => `${x.state}:${x.text}`).join(" | "));

// 브라우저(네이티브 없음)는 **실패가 아니다** — 없는 기능의 실패를 말하는 것은 잔소리다.
delete w.Capacitor;
await w.loadCalStatus();
/* ⚠️ **`t53Synced`와 비교하지 않는다**(AGENT-CHAIN §8 · T-64). 처음엔 `display === t53Synced.display`
 *   로 적었는데, 그것은 **④가 그때 관측한 값**이라 *"정상에도 행동을 붙이는"* 변이가 그 값을
 *   `flex`로 만들면 **④와 이 검사가 함께** 죽는다 — 이 검사는 자기 몫(네이티브 없음이 조용한가)을
 *   한 번도 못 세게 된다. T-59가 자매에서 같은 것을 고쳤고 원본인 여기가 남아 있었다.
 *   **관계는 두 검사가 한 끝씩 잡는다** — `ok`가 안 뜬다는 반대 끝은 위 ④가 계약값으로 센다. */
ok("★ 네이티브가 없으면 아무 말도 안 한다 — 화면은 조용하고 기록에만 'off'로 남는다",
  t53Bar.dataset.state === "off" && t53Bar.style.display === "none"
  && t53Bar.dataset.state !== "ok",
  `${t53Bar.dataset.state}/${t53Bar.style.display}`);

/* ⑤⑥ — devcal 일정은 읽기 전용, 앱 일정은 그대로.
 *
 * ⚠️ **⑤만 보면 "모든 일정의 수정을 막는 구현"이 통과한다.** 그래서 같은 날에 둘을 넣고
 *    **한 화면에서** 가른다. 날짜는 상대(D+25)이고, 끝나면 둘 다 치운다 —
 *    devcal 일정은 앱에서 못 지우므로 **빈 창을 한 번 더 보내** 서버가 지우게 한다. */
const t53Day = ev("addDaysStr(S.today.date, 25)");
const t53Post = (body) => ev(`_req("POST", "/cal/sync", ${JSON.stringify(body)})`);
const t53Sent = await t53Post({
  window: { from: t53Day, to: t53Day },
  items: [{ ext_uid: `t53-front:${t53Day}`, title: "폰 캘린더에서 온 일정", date: t53Day, time: "10:00" }],
});
const t53AppEv = await ev(`Api.createEvent({title:"앱이 만든 일정", date:"${t53Day}", time:"11:00"})`);
await w.openDay(t53Day);
await until(() => $("#day-body").textContent.includes("앱이 만든 일정"), 4000);
const t53Row = (needle) => [...$("#day-body").querySelectorAll(".evrow")]
  .find((r) => r.textContent.includes(needle));
const t53Ext = t53Row("폰 캘린더에서 온 일정");
const t53App = t53Row("앱이 만든 일정");

ok("⑤ ★ devcal 일정은 수정·삭제 버튼이 없다 (출처가 화면에 보인다)",
  !!t53Ext && !t53Ext.querySelector("button") && !t53Ext.querySelector(".ex")
  && !!t53Ext.querySelector(".ev-cal-badge"),
  `upserted=${t53Sent && t53Sent.upserted} row=${t53Ext ? t53Ext.outerHTML.slice(0, 120) : "없음"}`);

ok("⑥ ★ 앱이 만든 일정은 그대로 수정·삭제된다 (⑤의 짝)",
  !!t53App && !!t53App.querySelector("button.ev-protect-event-title") && !!t53App.querySelector(".ex"),
  t53App ? t53App.outerHTML.slice(0, 140) : "없음");

// 버튼을 지우는 것만으로 막으면 다음에 목록을 하나 더 만드는 사람이 그 사실을 모른다 —
// 경로가 새도 한 번 더 걸린다.
ok("★ 읽기 전용은 화면뿐 아니라 진입 함수에서도 막힌다",
  ev(`calReadOnlyGuard({ ext_src: "devcal" })`) === true
  && ev(`calReadOnlyGuard({ ext_src: null })`) === false
  && ev(`isExtEvent({ ext_src: "devcal" })`) === true);

w.closeAll();
await sleep(150);
await t53Post({ window: { from: t53Day, to: t53Day }, items: [] });   // 미러 치우기(서버가 지운다)
await ev(`Api.deleteEvent("${t53AppEv.id}")`);

/* ⑦ 반복은 **Instances로 전개**한다. 마스터 이벤트 1건으로 읽으면 RRULE이 문자열로만 오고
 *   **개강 후 주간 수업이 통째로 안 들어온다** — 이 티켓에서 값이 가장 큰 부분이다. */
const T53_INSTANCES = /CalendarContract\.Instances\.CONTENT_URI/;
const T53_EVENTS_URI = /CalendarContract\.Events\.CONTENT_URI/;
ok("⑦ ★ 반복을 Instances로 전개한다 (Events 마스터로 읽지 않는다) · uid는 인스턴스 단위다",
  T53_INSTANCES.test(t53Reader) && !T53_EVENTS_URI.test(t53Reader)
  && /appendPath/.test(t53Reader) && /"\$eventId:\$date"/.test(t53Reader),
  `instances=${T53_INSTANCES.test(t53Reader)} events=${T53_EVENTS_URI.test(t53Reader)}`);

/* ⑧ ★ ⑦의 짝 — 스캐너가 눈멀면 ⑦은 구현과 무관하게 초록이 되고,
 *   "Events로 읽는다"인지 "정규식이 낡았다"인지 구별이 안 된다. 합성 줄로 가른다. */
const t53Old = "        ctx.contentResolver.query(CalendarContract.Events.CONTENT_URI, cols, sel, null, null)";
const t53New = "        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon()";
ok("⑧ ★ ⑦의 스캐너가 살아 있다 — 옛 모양은 잡고, 주석은 안 잡는다",
  T53_EVENTS_URI.test(t53Old) && !T53_INSTANCES.test(t53Old)
  && T53_INSTANCES.test(t53New) && !T53_EVENTS_URI.test(t53New)
  && !T53_INSTANCES.test(t46Bare("  // " + t53New)),
  `옛=${T53_EVENTS_URI.test(t53Old)} 새=${T53_INSTANCES.test(t53New)}`);

/* ★ ⑤(시점) — **캘린더 동기화가 보호 일정 pull보다 먼저다.**
 *   순서가 뒤집히면 오늘 캘린더에서 옮겨 온 시험이 이번 응답의 `fires[]`에 없고,
 *   다음 동기화는 내일이라 **그날 알람 예약을 통째로 놓친다.**
 *   ⚠️ 위치로 센다 — 둘의 존재만 보면 순서가 뒤집혀도 초록이다. */
const t53CalAt = t53GuardSync.indexOf("CalSync.syncNow");
const t53PullAt = t53GuardSync.indexOf("/api/guard/schedule");
ok("★ 캘린더 동기화가 보호 일정 pull '직전'이다 (둘 다 있고, 순서가 이 순서다)",
  t53CalAt >= 0 && t53PullAt >= 0 && t53CalAt < t53PullAt,
  `cal@${t53CalAt} pull@${t53PullAt}`);

// 등록을 빼면 `Capacitor.Plugins.Cal`이 아예 없어 권한도 목록도 화면에 안 뜬다(T-48에서 배웠다).
ok("★ Manifest가 READ_CALENDAR만 선언하고 · MainActivity가 CalPlugin을 등록한다",
  /android\.permission\.READ_CALENDAR/.test(t53Manifest)
  && !/android\.permission\.WRITE_CALENDAR/.test(t53Manifest)
  && /registerPlugin\(CalPlugin\.class\)/.test(t53Main)
  && /@CapacitorPlugin\(\s*\n?\s*name = "Cal"/.test(t53Plugin),
  `read=${/READ_CALENDAR/.test(t53Manifest)} write=${/WRITE_CALENDAR/.test(t53Manifest)}`);

// ── T-54 · 캘린더가 아무것도 안 했으면 그렇게 말한다 ────────────────────────
//
// ⚠️ **신호에 토스트를 쓰지 않는다**(§금지). 직전 커밋에서 실측했다 — `until`이
//    `refreshToday()`의 DOM 쓰기를 보고 먼저 빠져나와 **던지기 전에** 토스트를 읽는다.
//    여기서 세는 것은 **`#cal-result`(사라지지 않는다)와 플러그인 호출**이다.
console.log("\n[T-54] 결과가 상태와 다른 자리에 남는다");

const t54Res = () => ({ kind: $("#cal-result").dataset.kind, text: txt("#cal-result") });
const t54Calls = [];
const t54Cal = (syncRet) => ({
  status: async () => ({ permission: true, targets: [], windowDays: 60 }),
  calendars: async () => ({
    permission: true, targets: [],
    calendars: [{ id: 7, name: "수업", account: "a@b" }, { id: 9, name: "휴일", account: "a@b" }],
  }),
  setTargets: async ({ ids }) => {
    t54Calls.push("set:" + ids.join(","));
    return { permission: true, targets: ids, windowDays: 60 };
  },
  sync: async () => { t54Calls.push("sync"); return syncRet; },
});
// ① 문구는 구현에서 가져온다 — 여기 다시 적으면 두 벌이 되고, 갈라진 쪽이 조용해진다.
const t54EmptyText = ev(`calResultLine({ blocked: "empty" }).text`);

/* 1 — 빈 선택으로 저장하면 **그 사실이 닿는다.** 지금까지는 시트가 조용히 닫혔고,
 *     닫히는 것이 성공 신호로 읽혔다. `setTargets`·`sync`가 **안 불린 것까지** 센다 —
 *     막았다고 말하려면 실제로 아무 일도 안 일어나야 한다. */
w.Capacitor = { Plugins: { Cal: t54Cal({ ok: true, sent: 2, status: { targets: [7], windowDays: 60 } }) } };
await w.openCalSheet();
const t54Before1 = t54Res();
// ⚠️ **시계를 안 쓴다** — `onclick()`이 `run(...)`의 프라미스를 그대로 준다(§금지: 경합 신호).
await $("#cal-save").onclick();              // 아무것도 안 고른 채
const t54Empty = { ...t54Res(), open: $("#sh-cal").classList.contains("on"), calls: t54Calls.join("|") };
ok("1 빈 선택으로 저장하면 그 사실이 사용자에게 닿는다",
  t54Empty.kind === "warn" && t54Empty.text === t54EmptyText
  && t54Empty.text !== t54Before1.text && t54Empty.open && t54Empty.calls === "",
  `${JSON.stringify(t54Empty)} ← 전: ${JSON.stringify(t54Before1)}`);

/* 2 ★ 1의 짝 — **하나 이상 고르면 그 경고가 안 나온다.** 1만 보면 *"항상 경고하는 구현"*이
 *     통과한다. 저장이 실제로 기기까지 갔는지(`set:7`)도 함께 센다. */
t54Calls.length = 0;
await w.openCalSheet();
// ⚠️ **`#cal-list`였다.** 그 선택자는 시트가 아니라 캘린더 화면의 숨은 칸을 가리켰고,
//    구현이 **같은 잘못된 칸에** 써 넣었기 때문에 이 검사는 초록인 채로 아무것도 안 봤다
//    (T-55). 검사와 구현이 같은 오타를 공유하면 검사는 오타를 못 센다.
$("#sh-cal #cal-targets [data-cid='7'] input").checked = true;
await $("#cal-save").onclick();
const t54Chosen = { ...t54Res(), calls: t54Calls.join("|") };
ok("2 ★ 하나 이상 고르면 그 경고가 안 닿는다 (1의 짝)",
  t54Chosen.calls === "set:7|sync" && t54Chosen.text !== t54EmptyText,
  JSON.stringify(t54Chosen));

/* 3·4 ★ **0건은 성공이 아니다**(T-43이 `0건`과 로그인 HTML을 가른 그 자리).
 *      0이 왜 0인지 — 대상 수와 창 — 를 함께 말해야 *"휴일 캘린더만 골랐다"*가 드러난다.
 *      3만 보면 *"성공도 실패처럼 말하는 구현"*이 통과하므로 4가 짝으로 선다. */
const t54Sync = async (ret) => {
  w.Capacitor = { Plugins: { Cal: t54Cal(ret) } };
  await w.calSyncNow();
  return t54Res();
};
const t54Zero = await t54Sync({ ok: true, sent: 0, status: { targets: [9], windowDays: 60 } });
ok("3 ★ sent === 0 이 성공 문구로 안 나온다 (0이 왜 0인지 함께 말한다)",
  t54Zero.kind !== "ok" && !/맞췄어요/.test(t54Zero.text)
  && /대상 1개/.test(t54Zero.text) && /60일/.test(t54Zero.text),
  JSON.stringify(t54Zero));

const t54Five = await t54Sync({ ok: true, sent: 5, status: { targets: [7], windowDays: 60 } });
ok("4 ★ sent > 0 은 성공 문구로 나온다 (3의 짝)",
  t54Five.kind === "ok" && /5/.test(t54Five.text) && t54Five.text !== t54Zero.text,
  JSON.stringify(t54Five));

/* 5 ★ **이 티켓의 본체.** `skipped`는 설계상 prefs에 흔적을 안 남기므로(*"실패가 아니다"*)
 *     상태 줄을 다시 그려도 **저장 전과 글자 하나 안 달랐다.** 전후를 직접 비교한다 —
 *     같으면 실패다. ⚠️ 화면이 달라졌다는 것을 **비어 있지 않다**로 대신 세면 안 된다:
 *     앞이 이미 차 있으면 그 검사는 아무것도 안 본다. */
await ev(`showCalResult({ kind: "", text: "" })`);
const t54Before5 = t54Res();
const t54Skip = await t54Sync({
  ok: false, sent: 0, skipped: "no_target",
  status: { permission: true, targets: [], windowDays: 60 },
});
ok("5 ★ skipped(no_target)가 화면까지 온다 — 저장 전후로 화면이 달라진다",
  t54Skip.text !== t54Before5.text && t54Skip.text.length > 0
  && t54Skip.kind === "warn" && t54Skip.text !== t54EmptyText,
  `전 ${JSON.stringify(t54Before5)} → 후 ${JSON.stringify(t54Skip)}`);

/* 6 — 기기 쪽. **`Log`만 늘리는 것은 답이 아니다**(§금지) — logcat은 개발자만 본다.
 *     사유가 `Cal.status()`에 실려야 화면이 안 보여도 CDP 한 줄로 갈린다.
 *
 * ⚠️ **출구를 하나라도 빼먹으면 그 출구만 조용해진다** — T-53이 정확히 그랬다.
 *    그래서 옛 모양(사유를 **리터럴로** 든 `Result`)이 남아 있지 않은지 함께 본다:
 *    사유 문자열은 이제 `skip(ctx, "…")`에만 있고, `Result`에는 변수로만 들어간다.
 *    (처음에 `return Result(false, 0, skipped =` 로 썼더니 **`skip` 헬퍼 자신이 걸렸다** —
 *     스캐너가 고친 코드를 옛 코드로 읽으면 6은 구현과 무관하게 빨간불이다.) */
const T54_OLD_SKIP = /Result\([^)]*skipped\s*=\s*"/;
ok("6 Cal.status()에 마지막 시도의 사유가 실린다 (스킵·실패·성공 셋 다)",
  /put\(\s*\n?\s*"lastTry"/.test(t53Send) && /fun noteTry\(/.test(t53Send)
  && /"outcome"/.test(t53Send) && /"reason"/.test(t53Send)
  && /noteTry\(ctx, "ok"/.test(t53Send) && /noteTry\(ctx, "skipped"/.test(t53Send)
  && /noteTry\(ctx, "error"/.test(t53Send)
  && /return skip\(ctx, "no_permission"\)/.test(t53Send)
  && /return skip\(ctx, "no_target"\)/.test(t53Send)
  && !T54_OLD_SKIP.test(t53Send),
  `lastTry=${/"lastTry"/.test(t53Send)} noteTry=${/fun noteTry\(/.test(t53Send)}`
  + ` 옛출구=${T54_OLD_SKIP.test(t53Send)}`);

/* 6의 짝 — ★ **스캐너가 살아 있는가.** 6이 초록인 것이 *"고쳤다"*인지 *"정규식이 눈멀었다"*인지
 *   구별이 안 되면 6은 아무것도 안 세는 검사다(T-53 ⑧이 같은 자리에 섰다). 합성 줄로 가른다. */
const t54OldLine = `        if (!hasPermission(ctx)) return Result(false, 0, skipped = "no_permission")`;
const t54NewLine = `        if (!hasPermission(ctx)) return skip(ctx, "no_permission")`;
const t54HelperLine = `        return Result(false, 0, skipped = reason)`;
ok("6 ★ 6의 스캐너가 살아 있다 — 옛 출구는 잡고, 새 출구와 헬퍼는 안 잡는다",
  T54_OLD_SKIP.test(t54OldLine) && !T54_OLD_SKIP.test(t54NewLine)
  && !T54_OLD_SKIP.test(t54HelperLine),
  `옛=${T54_OLD_SKIP.test(t54OldLine)} 새=${T54_OLD_SKIP.test(t54NewLine)}`
  + ` 헬퍼=${T54_OLD_SKIP.test(t54HelperLine)}`);

/* 7 ★ **없는 것을 세는 검사** — 결과가 상태로 새지 않았는가.
 *     `calStatusLine`의 넷은 곧 `CAL_ACT`의 행동이다. 다섯째가 생기면 그 상태에는 할 행동이
 *     없어 바가 뜨고도 아무 데도 안 데려간다. **결과 재료만 갈아 끼우고 상태가 안 움직이는지** 본다. */
const t54Base = { permission: true, targets: [7], lastError: null, lastOkAt: t53OkAt, lastCount: 3 };
const t54ByResult = [
  {},
  { lastTry: { outcome: "skipped", reason: "no_target", sent: 0 } },
  { lastTry: { outcome: "error", reason: "HTTP 503 boom", sent: 0 } },
  { lastTry: { outcome: "ok", reason: null, sent: 0 } },
].map((v) => ev(`calStatusLine(${JSON.stringify({ ...t54Base, ...v })}).state`));
const t54AllStates = [
  null, { unreadable: true }, { permission: false, targets: [] }, { permission: true, targets: [] },
  { permission: true, targets: [7], lastError: "boom" }, t54Base,
].map((s) => ev(`calStatusLine(${JSON.stringify(s)}).state`));
ok("7 ★ 상태 줄은 넷 그대로다 — 결과가 섞이지 않았다 (없는 것을 세는 검사)",
  new Set(t54ByResult).size === 1 && t54ByResult[0] === "ok"
  && new Set(t54AllStates).size === 5
  && t54AllStates.every((s) => ["off", "noperm", "notarget", "error", "ok"].includes(s))
  && ev(`Object.keys(CAL_ACT).length`) === 3,
  `결과별=${t54ByResult.join(",")} 전체=${[...new Set(t54AllStates)].join(",")}`);

// ── T-55 · 고를 것이 없으면 그렇게 말한다 (그리고 왜 없는지 밝힌다) ──────────
//
// ★ **진단이 (a)~(c) 어느 것도 아니었다.** 폰 실측(2026-09-03): `Cal.calendars()`는 **12개를
//   그대로 줬다.** 목록은 `#cal-list`라는 **중복 id** 때문에 캘린더 화면의 숨은 칸으로 갔고,
//   시트의 자리는 늘 비어 있었다. 네이티브를 재는 검사로는 절대 안 잡혔을 결함이다 —
//   그래서 아래 7이 **문서에 같은 id가 둘 있는지**를 센다.
//
// ⚠️ 신호에 토스트도 `until`도 안 쓴다(§함정 14) — `openCalSheet`이 주는 프라미스를 `await`한다.
console.log("\n[T-55] 목록이 비는 이유가 화면에 남는다");

const t55Body = () => $("#sh-cal #cal-targets");
const t55Open = async (r) => {
  w.Capacitor = { Plugins: { Cal: { ...t54Cal({ ok: true, sent: 0 }), calendars: async () => r } } };
  await w.openCalSheet();
  const b = t55Body();
  return {
    text: (b ? b.textContent : "").trim(),
    rows: b ? b.querySelectorAll("[data-cid]").length : -1,
  };
};
const t55Line = (o) => ev(`calListLine(${JSON.stringify(o)})`);

/* 1 — 비면 **그 사실이 화면에 뜬다.** 문구는 구현에서 가져온다(두 벌로 적으면 갈라진다). */
const t55Zero = await t55Open({ permission: true, targets: [], calendars: [], total: 0, hidden: 0 });
const t55L0 = t55Line({ calendars: [], total: 0, hidden: 0 });
ok("1 목록이 비면 그 사실이 화면에 뜬다",
  t55Zero.rows === 0 && t55Zero.text.length > 0 && t55Zero.text === t55L0,
  `${JSON.stringify(t55Zero)} ← 문구 ${JSON.stringify(t55L0)}`);

/* 2 ★ 1의 짝 — **목록이 있으면 안 뜬다.** 1만 보면 *"항상 비었다고 말하는 구현"*이 통과하고,
 *     그게 바로 옛 `이 기기에 캘린더가 없어요`였다(폰에는 12개가 있었다). */
const t55Some = await t55Open({
  permission: true, targets: [],
  calendars: [{ id: 7, name: "수업", account: "a@b" }, { id: 9, name: "휴일", account: "a@b" }],
  total: 3, hidden: 1,
});
ok("2 ★ 목록이 있으면 그 문구가 안 뜬다 (1의 짝)",
  t55Some.rows === 2 && t55Some.text !== t55Zero.text && !/없어요/.test(t55Some.text)
  && t55Line({ calendars: [{ id: 7 }], total: 3, hidden: 1 }) === null,
  JSON.stringify(t55Some));

/* 3 ★ 기기 쪽 — **몇 개 중 몇 개를 걸렀는지**가 응답에 실린다. 목록만 주면
 *     *"provider가 안 줬다"*와 *"우리가 다 걸렀다"*가 화면에서 같은 0이 된다. */
const T55_PUT_TOTAL = /\.put\("total", list\.total\)/;
const T55_PUT_HIDDEN = /\.put\("hidden", list\.hidden\)/;
ok("3 ★ total·hidden 이 네이티브 응답에 실린다 (센 자리는 커서다)",
  T55_PUT_TOTAL.test(t53Plugin) && T55_PUT_HIDDEN.test(t53Plugin)
  && /data class CalendarList\(/.test(t53Reader)
  && /total\+\+/.test(t53Reader) && /total - out\.size/.test(t53Reader),
  `plugin=${T55_PUT_TOTAL.test(t53Plugin)}/${T55_PUT_HIDDEN.test(t53Plugin)}`
  + ` reader=${/total - out\.size/.test(t53Reader)}`);

/* 4 ★ 3의 짝 · **이 티켓의 본체.** 3만 보면 *"숫자는 싣는데 화면이 안 쓰는 구현"*이 통과하고,
 *     그러면 다음에 0이 됐을 때 또 처음부터 진단한다. 셋이 서로 달라야 한다. */
const t55L8 = t55Line({ calendars: [], total: 8, hidden: 8 });
const t55LErr = t55Line({ calendars: [], total: 0, hidden: 0, error: "no_cursor" });
ok("4 ★ 'provider가 0'·'우리가 다 걸렀다'·'읽다 막혔다'가 서로 다른 문구다 (3의 짝)",
  new Set([t55L0, t55L8, t55LErr]).size === 3 && [t55L0, t55L8, t55LErr].every(Boolean)
  && /8/.test(t55L8) && !/8/.test(t55L0),
  `0=${t55L0} / 8=${t55L8} / err=${t55LErr}`);

/* 5 — 목록은 **Calendars**를 읽는다. 그리고 **selection을 좁히지 않는다**:
 *     `VISIBLE=1`로 거르면 캘린더 앱에서 체크를 꺼 둔 것이 목록에서 사라지는데,
 *     *"안 보이게 해 둔 것"*과 *"안 가져올 것"*은 사용자가 따로 정하는 값이다. */
const T55_OPEN_SEL = /Calendars\.CONTENT_URI, cols, null, null,/;
ok("5 목록 쿼리가 Calendars 를 읽고 selection 을 좁히지 않는다 (스캐너)",
  T55_OPEN_SEL.test(t53Reader) && /CalendarContract\.Calendars\.DELETED/.test(t53Reader)
  && !/Calendars\.VISIBLE\s*\+\s*"\s*=/.test(t53Reader),
  `열린selection=${T55_OPEN_SEL.test(t53Reader)}`);

/* 6 ★ 5의 짝 — 5가 초록인 것이 *"열려 있다"*인지 *"정규식이 눈멀었다"*인지 가른다. */
const t55Narrow = `                CalendarContract.Calendars.CONTENT_URI, cols, VISIBLE + "=1", null,`;
const t55Wide = `                CalendarContract.Calendars.CONTENT_URI, cols, null, null,`;
ok("6 ★ 5의 스캐너가 살아 있다 — 좁힌 selection 은 잡고, 주석은 안 잡는다",
  !T55_OPEN_SEL.test(t55Narrow) && T55_OPEN_SEL.test(t55Wide)
  && !T55_OPEN_SEL.test(t46Bare("  // " + t55Wide)),
  `좁힘=${T55_OPEN_SEL.test(t55Narrow)} 넓힘=${T55_OPEN_SEL.test(t55Wide)}`);

/* 7 ★ **진짜 원인을 세는 검사.** `querySelector`는 문서 순서로 앞의 것을 준다 —
 *     같은 id가 둘이면 뒤의 것은 **영영 안 잡히고 화면은 조용하다.** 전수로 센다. */
const t55DupOf = (s) => {
  const a = [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(a.filter((v, i) => a.indexOf(v) !== i))];
};
const t55Dup = t55DupOf(html);
ok("7 ★ index.html 에 같은 id 가 둘 없다 — T-55의 진짜 원인이었다",
  t55Dup.length === 0 && /\sid="cal-targets"/.test(html),
  `중복=${t55Dup.join(",") || "없음"}`);

/* 7의 짝 ★ 스캐너가 살아 있는가 — 합성 문서로 가른다. */
ok("7 ★ 7의 스캐너가 살아 있다 (합성 중복을 잡는다)",
  t55DupOf(`<div id="a"></div><i id="b"></i><p id="a"></p>`).join() === "a"
  && t55DupOf(`<div id="a"></div><i id="b"></i>`).length === 0);

/* ★ 중복 id 가 남긴 **두 번째 피해** — 시트를 열면 `innerHTML`이 그 숨은 칸을 덮어써
 *   `#diary-list`(몰아 읽기 뷰)가 통째로 사라졌다. 폰에서 실제로 사라져 있었다. */
ok("★ 시트를 열어도 '몰아 읽기' 뷰가 살아남는다 (같은 원인의 두 번째 피해)",
  !!$("#scr-cal #diary-list") && $("#scr-cal #cal-list").querySelectorAll("[data-cid]").length === 0,
  `diary=${!!$("#scr-cal #diary-list")}`);

delete w.Capacitor;
await w.loadCalStatus();
w.closeAll();
await sleep(120);

// ── T-57 · 앱의 기다림에도 상한이 있다 ────────────────────────────
//
// **러너의 안전망 420초는 마지막 방벽이지 설계가 아니다.** 워커가 응답을 한 번 놓치면
// `fetch`가 영원히 매달리고, 폰에서는 *"눌렀는데 아무 일도 안 일어남"*으로 보인다 —
// T-54·T-55가 두 티켓에 걸쳐 없앤 조용한 실패가 상한 하나가 없어 돌아오는 자리다.
console.log("\n[T-57 · fetch 상한]");

/** 관측된 hang 그대로 — **영영 정산되지 않는 프라미스**이고 abort도 안 지킨다.
 *  ⚠️ signal을 지키는 스텁을 쓰면 검사는 `AbortSignal`만 보고 **진짜 hang은 못 센다.** */
const t57Dead = () => new Promise(() => {});
const t57Ask = `Api.today().then((r) => ({ ok: !!(r && r.date) }),
  (e) => ({ ok: false, msg: e.message, status: e.status ?? null, timeout: !!e.timeout }))`;

const t57Real = w.fetch;
w.fetch = t57Dead;
const t57At = Date.now();
// ⚠️ 이 시계는 *"끝났다"*를 아는 장치가 아니다(함정 14) — **상한이 없을 때 러너가 안전망까지
//    끌려가 요약을 통째로 잃지 않게** 하는 것뿐이다. 통과를 정하는 것은 아래 `timeout` 계약이다.
const t57Cut = await Promise.race([ev(t57Ask), sleep(60_000).then(() => ({ hung: true }))]);
const t57CutMs = Date.now() - t57At;

w.fetch = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "서버가 터졌어요" }) });
const t57Http = await ev(t57Ask);
w.fetch = () => Promise.reject(new Error("연결 거부"));
const t57Refused = await ev(t57Ask);
w.fetch = t57Real;
const t57Live = await ev(t57Ask);

/** 셸을 새로 띄운다 — `fetch`를 통째로 갈아 끼운 채. `boot()`는 `loadData()`를 **await**하므로
 *  상한이 없으면 부팅이 거기서 멈추고 그 뒤의 `syncGuardNative()`가 **영영 안 돈다.** */
const t57Shell = async (fakeFetch) => {
  const errs = [];
  const vc7 = new VirtualConsole();
  vc7.on("jsdomError", (e) => errs.push(String(e.message)));
  const dom7 = new JSDOM(html.replace(/<script src="[^"]+"><\/script>/g, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc7, url: BASE + "/",
  });
  const w7 = dom7.window;
  bridgeFetch(w7, fakeFetch);
  w7.HTMLElement.prototype.setPointerCapture = () => {};
  w7.HTMLElement.prototype.scrollTo = () => {};
  const heard = [];
  w7.Capacitor = { Plugins: { Guard: {
    configure: async () => { heard.push("configure"); },
    sync: async () => { heard.push("sync"); return { ok: true }; },
  } } };
  for (const code of [apiJs, appJs]) {
    const s = w7.document.createElement("script");
    s.textContent = code;
    w7.document.body.appendChild(s);
  }
  w7.document.dispatchEvent(new w7.Event("DOMContentLoaded"));
  // **끝을 아는 것은 화면이 아니라 플러그인 계약이다** — 예약이 돌았는가가 곧 주장이다.
  const ran = await until(() => heard.includes("sync"), 60_000);
  return { ran, heard, errs, $: (s) => w7.document.querySelector(s) };
};
const t57ShellFail = await t57Shell(() => Promise.reject(new Error("연결 거부")));
const t57ShellCut = await t57Shell(t57Dead);
const t57BootFail = (t57ShellFail.$("#boot-msg").textContent || "").trim();
const t57BootCut = (t57ShellCut.$("#boot-msg").textContent || "").trim();

// ⚠️ **여기서 `timeout` 플래그를 같이 세면 안 된다** — 그 플래그는 3의 몫이고, 겹쳐 세면
//    3을 겨냥한 변이가 1까지 죽여 **1이 자기 몫을 못 센다**(T-56에서 겪은 그 모양이다).
//    안 정산되는 fetch에서 거절이 오는 길은 상한 하나뿐이라 이것만으로 충분하다.
ok("1 응답이 안 오면 상한에서 끊긴다 (영영 안 정산되는 fetch)",
  !t57Cut.hung && t57Cut.ok === false,
  `${t57CutMs}ms ${JSON.stringify(t57Cut)}`);

ok("2 ★ 정상 응답은 안 끊긴다 (1의 짝)",
  t57Live.ok === true && !t57Live.timeout, JSON.stringify(t57Live));

ok("3 ★ 상한에 걸린 것과 실패한 것이 다른 문구로 나온다 (사용자가 할 일이 다르다)",
  t57Cut.timeout === true && t57Http.timeout === false && t57Refused.timeout === false
  && !!t57Cut.msg && t57Cut.msg !== t57Http.msg && t57Cut.msg !== t57Refused.msg
  && !!t57BootCut && !!t57BootFail && t57BootCut !== t57BootFail,
  `상한="${t57Cut.msg}" HTTP="${t57Http.msg}" 거부="${t57Refused.msg}"`
  + ` · 부팅 상한="${t57BootCut}" 실패="${t57BootFail}"`);

/* 4 ★ **상한이 `_req` 한 곳에 있는가.** 1~3은 상한이 *있다*를 보고, 이것은 *한 곳에 있다*를 본다 —
 *   호출부마다 걸면 빠뜨린 곳이 조용히 남는다(T-52가 방벽을 SQL에 둔 것과 같은 판단). */
const t57ApiSrc = readFileSync(join(here, "../public/api.js"), "utf8");
const t57CapWords = /AbortSignal|setTimeout|REQ_TIMEOUT/;
/** `const Api = {` 아래 — 호출부 전부. 여기 상한 재료가 보이면 흩어진 것이다. */
const t57Callers = (src) => src.slice(src.indexOf("const Api = {"));
/** 원문에서 `fetch(`를 부르는 자리 (메서드 호출 `.fetch(`는 안 센다) */
const t57FetchSites = (src) => (src.match(/(?<![.\w$])fetch\s*\(/g) || []).length;
const t57AppFetch = /(?<![.\w$])fetch\s*\(/.test(appJs);
ok("4 ★ 상한이 _req 한 곳에 있다 — 호출부에 흩어져 있지 않다",
  t57FetchSites(t57ApiSrc) === 1 && !t57CapWords.test(t57Callers(t57ApiSrc)) && !t57AppFetch,
  `fetch자리=${t57FetchSites(t57ApiSrc)} 호출부상한=${t57CapWords.test(t57Callers(t57ApiSrc))}`
  + ` app직접fetch=${t57AppFetch}`);

/* 5 ★ **4의 스캐너가 살아 있는가.** 4가 초록인 것이 *"한 곳에 있다"*인지 *"정규식이 눈멀었다"*인지
 *   구별이 안 되면 4는 아무것도 안 세는 검사다(T-53 ⑧·T-54 6의 짝이 선 그 자리). */
const t57Scattered = `const Api = {\n  today: () => _req("GET", "/today", { signal: AbortSignal.timeout(9000) }),\n};`;
const t57Clean = `const Api = {\n  today: () => _req("GET", "/today"),\n};`;
const t57TwoFetch = `async function a(){ await fetch(x); }\nasync function b(){ await fetch(y); }`;
ok("5 ★ 4의 스캐너가 살아 있다 — 흩어진 상한은 잡고 깨끗한 호출부는 안 잡는다",
  t57CapWords.test(t57Callers(t57Scattered)) && !t57CapWords.test(t57Callers(t57Clean))
  && t57FetchSites(t57TwoFetch) === 2 && t57FetchSites(t57Clean) === 0,
  `흩어짐=${t57CapWords.test(t57Callers(t57Scattered))} 깨끗=${t57CapWords.test(t57Callers(t57Clean))}`
  + ` 둘=${t57FetchSites(t57TwoFetch)} 없음=${t57FetchSites(t57Clean)}`);

/* 6 ★ 티켓 ④ — **캘린더가 안 와도 보호 일정 예약은 돈다**(T-53 `runCatching`과 같은 원칙).
 *   `boot()`가 `await loadData()` **뒤에** `syncGuardNative()`를 부르므로, 상한이 없으면
 *   응답이 안 오는 것만으로 **Guard 예약이 인질이 된다.** 그 순서를 상한이 깨지 않는지 본다. */
ok("6 ★ 응답이 안 와도 Guard 예약은 돈다 — 부팅이 인질이 되지 않는다 (티켓 ④)",
  t57ShellCut.ran && t57ShellCut.heard.join("|") === "configure|sync"
  && t57ShellFail.ran && t57ShellCut.errs.length === 0,
  `안옴=${t57ShellCut.heard.join("|")}(${t57ShellCut.ran})`
  + ` 실패=${t57ShellFail.heard.join("|")}(${t57ShellFail.ran}) 오류=${t57ShellCut.errs.join("/")}`);

// ── T-58 · 시간표 — 한 번 붙여넣으면 학기가 채워진다 ──────────────
//
// 서버 쪽(파싱 수·전개·요일별 길이·학기 범위)은 `smoke.ts`가 센다. **여기가 지는 것은
// 화면이다**: 못 읽은 줄이 보이는가 · 표에서 고친 값이 저장되는가 · Today 에 수업이 뜨는가.
console.log("\n[T-58 · 시간표]");

// ⚠️ 고정 날짜를 쓰지 않는다(함정 12) — 학기 범위도 오늘에서 상대로 잡는다.
const t58Start = ev(`addDaysStr(S.today.date, -60)`);
const t58End = ev(`addDaysStr(S.today.date, 60)`);
const t58Cell = (i, cls) => w.document.querySelector(`#tt-rows [data-tt="${i}"] .${cls}`);

await w.openTimetable();
$("#tt-text").value = [
  "월요일 10시-13시 전자기및연습1, 14시-16시 역학및연습2",
  "화요일 공강",
  "목요일 10시-12시 전자기및연습1",
  "이건 무슨 줄이지",                       // ← 파서가 못 읽는 줄
].join("\n");
// ⚠️ **핸들러가 주는 프라미스를 그대로 기다린다**(함정 14) — 시계로 끝을 재지 않는다.
await $("#tt-read").onclick();
const t58Un = {
  보임: $("#tt-unread").style.display !== "none",
  글: $("#tt-unread").textContent,
  칸: w.document.querySelectorAll("#tt-rows [data-tt]").length,
};
ok("2 ★ 못 읽은 줄이 사용자에게 보인다 — 조용히 버리지 않는다",
  t58Un.보임 && t58Un.글.includes("이건 무슨 줄이지") && t58Un.칸 === 3,
  `보임=${t58Un.보임} 칸=${t58Un.칸} 글=${t58Un.글.slice(0, 60)}`);

/* 3 ★ 2의 짝 — **확인 화면이 장식이 아니다.** 표에서 고친 값이 그대로 저장돼야
 *   *"형식이 다음 학기에 바뀌어도 손으로 고친다"*가 성립한다. */
// ⚠️ **칸이 없으면 러너가 아니라 이 검사가 죽어야 한다.** 앞이 아무것도 못 읽은 변이에서
//    `null.value =`로 러너가 통째로 넘어가면 **요약 줄을 잃고**, 배터리가 그것을
//    *"아무도 안 죽었다"*로 읽는다 — T-55·T-56이 그 칸에서 두 번 물렸다.
// ⚠️ **시각이 아니라 과목을 고친다.** 시각까지 세면 *"시각을 다시 쓰는"* 변이(요일별 길이 통일)가
//    3의 몫을 가져가 3이 자기 것을 못 센다. 3이 지는 것은 **확인 화면의 수정이 저장으로 간다**
//    하나이고, 시각을 지키는 것은 smoke 6의 몫이다.
const t58N = t58Cell(0, "tt-n");
if (t58N) t58N.value = "고친과목";
$("#tt-start").value = t58Start;
$("#tt-end").value = t58End;
await $("#tt-save").onclick();
const t58Saved = await ev(`Api.timetable()`);
const t58Fixed = (t58Saved.rules || []).find((r) => r.subject === "고친과목");
ok("3 ★ 확인 화면에서 고친 값이 저장된다 (2의 짝)",
  !!t58Fixed && (t58Saved.rules || []).length === 3
  && t58Saved.term && t58Saved.term.start === t58Start,
  `${JSON.stringify(t58Fixed)} 칸=${t58Saved.rules?.length} 학기=${JSON.stringify(t58Saved.term)}`);

/* ★ **이 프로젝트가 8/19 이래 겨눠 온 것** — 아무것도 안 넣어도 볼 것이 있다.
 *   ⚠️ 요일에 기대지 않으려고 이레 전부를 채운다. *"오늘이 평일이면"* 으로 두면
 *   토·일에 도는 검사가 조용히 아무것도 안 본다(함정 12와 같은 종류의 시계 의존이다). */
await w.openTimetable();
$("#tt-text").value = ["월", "화", "수", "목", "금", "토", "일"]
  .map((d) => `${d}요일 09시-10시 매일수업`).join("\n");
await $("#tt-read").onclick();
$("#tt-start").value = t58Start;
$("#tt-end").value = t58End;
await $("#tt-save").onclick();
const t58Td = { disp: $("#td-classes").style.display, 글: $("#td-classes").textContent };
ok("★ 오늘이 어떤 요일이든 Today 에 수업이 뜬다 (T-52~55가 못 닿은 그 목적)",
  t58Td.disp !== "none" && t58Td.글.includes("매일수업") && t58Td.글.includes("09:00"),
  `disp=${t58Td.disp} 글=${t58Td.글.slice(0, 60)}`);

// ── T-60 · 무시가 쌓이면 끄는 길을 준다 (ADR-047 ③) ───────────
//
// ★ **더 세게 하는 것이 아니다.** 무시 횟수로 자동 강화하면 공강 전날의 무시가 쌓여
//   시험 전날 과잉 개입이 된다(②와 정면 충돌). 그리고 끌 수 없는 알림은 사용자가 OS에서
//   무음 처리하고, 그러면 개입뿐 아니라 **관측도 함께 잃는다.**
// ⚠️ 신호에 토스트도 `until`도 안 쓴다(함정 14) — `onclick()`이 `run(...)`의 프라미스를 준다.
console.log("\n[T-60 · 밤 개입이 그냥 지나갔다]");

const t60Bar = $("#td-nag");
await ev(`(async()=>{
  window.__t60 = { nag: null, acks: 0, off: 0,
    old: [Api.guardL2Nag, Api.guardL2NagAck, globalThis.Capacitor] };
  Api.guardL2Nag = async () => {
    if (window.__t60.nag === "boom") throw new Error("t60 boom");
    return window.__t60.nag;
  };
  Api.guardL2NagAck = async () => { window.__t60.acks++; return { over: false }; };
})()`);
const t60Load = (nag) => ev(`(async()=>{
  window.__t60.nag = ${JSON.stringify(nag)};
  await loadGuardNag();
})()`);
const t60Snap = () => ({ state: t60Bar.dataset.state, display: t60Bar.style.display });
/* ⚠️ **핸들러가 없으면 그 검사만 빨간불이 되게 한다.** 카드를 안 띄우는 변이에서
 *   `onclick()`을 바로 부르면 `null is not a function`으로 **러너가 죽고 요약을 통째로 잃는다** —
 *   배터리가 그것을 *"아무도 안 죽었다"* 로 읽는 것이 T-55·T-56·T-58에서 물린 그 칸이다. */
const t60Click = async (sel) => {
  const h = $(sel).onclick;
  if (typeof h !== "function") return "핸들러없음";
  await h();
  return "눌림";
};

// 5 — 임계를 넘었다. **횟수가 문구에 들어야 한다**: "몇 번"이 빠지면 이 카드도 매일 같은 말이 된다.
await t60Load({ streak: 6, threshold: 3, ack: 0, over: true });
const t60Over = t60Snap();
ok("5 연속 무시가 임계를 넘으면 끄기 카드가 뜬다 — 횟수가 문구에 든다",
  t60Over.state === "ask" && t60Over.display === "flex" && txt("#td-nag-text").includes("6"),
  `${JSON.stringify(t60Over)} / ${txt("#td-nag-text")}`);

/* 6 ★ **5의 짝** — 임계 아래면 안 뜬다. 이것이 없으면 *"항상 띄우는 구현"*이 5만으로 통과하고,
 *   그러면 이 카드가 고치려던 잔소리를 **카드가 다시 만든다.** */
await t60Load({ streak: 1, threshold: 3, ack: 0, over: false });
const t60Under = t60Snap();
ok("6 ★ 임계 아래면 안 뜬다 (5의 짝 — 카드가 새 잔소리가 되지 않는다)",
  t60Under.state === "none" && t60Under.display === "none", JSON.stringify(t60Under));

/* ★ **none과 error는 화면에서 같고 기록에서만 다르다**(T-33이 세운 자리).
 *   "안 뜬다"만 세면 조회가 **항상** 실패해도 초록이다 — 그 실패는 아무 소리도 안 낸다. */
await t60Load("boom");
const t60Err = t60Snap();
/* ⚠️ **`t60Under.display`와 비교하지 않는다.** 그러면 *"항상 띄우는 변이"* 가 6과 여기를
 *   **함께** 죽여, 이 검사가 자기 몫(실패가 이름을 갖는가)을 못 센다 — T-58에서 검사끼리
 *   몫을 먹던 자리 셋을 좁힌 것과 같은 이유다. 여기가 지는 것은 **계약값** 하나다.
 *   ★ **T-65가 세 자매에 같은 시험을 쳤고 이것만 남았다** — `t60Err`의 계약값을 **아무도 안 겹쳐
 *   세므로 혼자 죽을 수 있다.** 증거: `loadGuardNag`의 `catch`가 `set("none")`을 하면
 *   **이 검사만** 빨간불이 된다(6은 `t60Under`를 보므로 안 죽는다). 위 T-33·T-42 자매는
 *   같은 이름인데 연역이라 `ok()`에서 빠졌다 — **같은 이름이 같은 물건을 뜻하지 않는다.** */
ok("★ 조회가 실패해도 화면을 막지 않는다 · 안 뜨는 것은 같고 기록에서만 갈린다",
  t60Err.state === "error" && t60Err.display === "none" && t60Err.state !== t60Under.state,
  `${JSON.stringify(t60Err)} vs ${JSON.stringify(t60Under)}`);

/* ★ *"그대로"* 도 기록을 지난다. 안 지나면 같은 숫자로 매번 다시 물어
 *   **거절이 아무 뜻도 갖지 못한다** — 그 자체가 이 카드가 없애려는 모양이다. */
await t60Load({ streak: 6, threshold: 3, ack: 0, over: true });
const t60AckBefore = ev(`window.__t60.acks`);
const t60KeepHit = await t60Click("#td-nag-keep");
ok("★ '그대로'도 기록을 지난다 — 같은 숫자로 다시 묻지 않기 위해서다",
  t60KeepHit === "눌림" && ev(`window.__t60.acks`) === t60AckBefore + 1
  && t60Snap().state === "none",
  `${t60KeepHit} ack ${t60AckBefore}→${ev(`window.__t60.acks`)} / ${t60Snap().state}`);

/* ★ **스위치는 기기 prefs에 있다. 웹에는 끌 것이 없다** — 여기서 조용히 성공한 척하면
 *   사용자는 껐다고 믿는데 그 밤에 또 뜬다. T-54가 없앤 `sent 0`과 같은 모양이다.
 *   ⚠️ 카드가 **안 닫히는 것**까지 센다: 닫히면 그것이 성공 신호로 읽힌다(T-53 B-2). */
await t60Load({ streak: 6, threshold: 3, ack: 0, over: true });
const t60NoNative = ev(`window.__t60.acks`);
const t60OffHit1 = await t60Click("#td-nag-off");
ok("★ 네이티브가 없으면 껐다고 말하지 않는다 — 카드도 안 닫힌다",
  t60OffHit1 === "눌림" && ev(`window.__t60.acks`) === t60NoNative
  && t60Snap().state === "ask" && txt("#toast").includes("폰 앱"),
  `${t60OffHit1} ack=${ev(`window.__t60.acks`)} 상태=${t60Snap().state} 토스트=${txt("#toast")}`);

// ★ 짝 — 네이티브가 있으면 **실제로 끄고** 그 뒤에 기록한다. 순서가 뒤집히면 끄기가 실패해도 ack가 남는다.
await ev(`(async()=>{
  globalThis.Capacitor = { Plugins: { Guard: {
    setWatch: async (o) => { window.__t60.off++; window.__t60.lastSet = o; return {}; },
  } } };
})()`);
await t60Load({ streak: 6, threshold: 3, ack: 0, over: true });
const t60OffHit2 = await t60Click("#td-nag-off");
ok("★ 네이티브가 있으면 실제로 끄고(enabled=false) 그 뒤에 기록한다",
  t60OffHit2 === "눌림" && ev(`window.__t60.off`) === 1
  && ev(`window.__t60.lastSet.enabled`) === false
  && ev(`window.__t60.acks`) === t60NoNative + 1 && t60Snap().state === "none",
  `${t60OffHit2} off=${ev(`window.__t60.off`)} 값=${ev(`JSON.stringify(window.__t60.lastSet ?? null)`)}`
  + ` ack=${ev(`window.__t60.acks`)} 상태=${t60Snap().state}`);

await ev(`(async()=>{
  Api.guardL2Nag = window.__t60.old[0]; Api.guardL2NagAck = window.__t60.old[1];
  globalThis.Capacitor = window.__t60.old[2];
})()`);

// ── T-59 · 어디 있었는지는 WiFi가 말한다 (ADR-046) ─────────────────────────
//
// ⚠️ **jsdom은 WifiManager를 못 본다.** 여기서 진짜로 돌려 보는 것은 **화면이 다섯 실패를
//    가르는가**와 **이름을 붙이는 길이 이어져 있는가**이고, 기기 쪽(권한·읽기)은 스캐너다.
//    진짜 판정은 §확인 절차 — 집을 나갔다 학교 WiFi에 붙어 보는 것이다.
console.log("\n[T-59] 장소 — 다섯 실패가 각자의 문구를 가진다");

const t59Kt = (p) => t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/" + p), "utf8"));
const t59Plugin = t59Kt("place/PlacePlugin.kt");
const t59Watcher = t59Kt("place/PlaceWatcher.kt");
const t59Main = t59Kt("MainActivity.java");
const t59Manifest = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/AndroidManifest.xml"), "utf8"));

/* ★ 배선 — 등록을 빼면 `Capacitor.Plugins.Place`가 아예 없어 등록 화면도 권한 유도도 안 뜨고,
 *   콜백을 거는 `load()`가 안 돌아 **전이가 통째로 안 남는다**(T-48·T-53이 배운 실패 모양).
 *   ⚠️ `foregroundServiceType="location"`이 **없다는 것**을 함께 센다 — 진단 ③이 필요 없다고
 *      답한 자리이고, 그래서 이 티켓이 `guard/`를 한 줄도 안 건드렸다. 넣는 순간 그 사실이 깨진다. */
ok("★ Manifest가 WiFi·위치를 선언하고 · MainActivity가 PlacePlugin을 등록한다 (guard/는 그대로)",
  /android\.permission\.ACCESS_WIFI_STATE/.test(t59Manifest)
  && /android\.permission\.ACCESS_FINE_LOCATION/.test(t59Manifest)
  && /android\.permission\.ACCESS_BACKGROUND_LOCATION/.test(t59Manifest)
  && !/foregroundServiceType="[^"]*location/.test(t59Manifest)
  && /registerPlugin\(PlacePlugin\.class\)/.test(t59Main)
  && /@CapacitorPlugin\(\s*\n?\s*name = "Place"/.test(t59Plugin)
  && /\/api\/places\/observe/.test(t59Watcher),
  `wifi=${/ACCESS_WIFI_STATE/.test(t59Manifest)} bg=${/ACCESS_BACKGROUND_LOCATION/.test(t59Manifest)}`
  + ` fgLocation=${/foregroundServiceType="[^"]*location/.test(t59Manifest)}`
  + ` 등록=${/registerPlugin\(PlacePlugin\.class\)/.test(t59Main)}`);

/* 네이티브가 없는 jsdom에 `Capacitor.Plugins.Place`를 심어 **사실만** 갈아 끼운다.
 * 이렇게 해야 순수 함수(`placeStatusLine`)가 아니라 **배선까지** 지나간다 —
 * 문구가 맞아도 `loadPlaceStatus`가 바를 안 켜면 화면은 여전히 침묵한다. */
const t59Bar = $("#td-place");
const t59Calls = [];
const t59Native = (st) => ({
  status: async () => st,
  syncNow: async () => { t59Calls.push("sync"); return { outcome: "ok", reason: "same_place", place: "집", status: st }; },
  requestPermission: async () => { t59Calls.push("perm"); return st; },
  openSettings: async (o) => { t59Calls.push("open:" + ((o && o.which) || "?")); return st; },
});
const t59Show = async (st) => {
  w.Capacitor = { Plugins: { Place: t59Native(st) } };
  await w.loadPlaceStatus();
  return {
    state: t59Bar.dataset.state, display: t59Bar.style.display,
    text: txt("#td-place-text"), act: txt("#td-place-act"),
  };
};
// 시각은 **지금에서 상대로** 만든다 — 고정 날짜는 언젠가 반드시 현재가 된다(함정 12).
const T59_NET = "00ff11ee22dd33cc";
const t59Fresh = new Date(Date.now() - 3600_000).toISOString();
const t59Old = new Date(Date.now() - 72 * 3600_000).toISOString();
const t59Base = {
  permission: true, backgroundPermission: true, locationEnabled: true,
  wifiEnabled: true, netId: T59_NET, lastSeenAt: t59Fresh,
};

// 아직 이름 붙인 곳이 0인 상태 — 앞 셋이 여기서 갈린다.
const t59NoPerm = await t59Show({ ...t59Base, permission: false });
const t59NoLoc = await t59Show({ ...t59Base, locationEnabled: false });
const t59NoPlace = await t59Show({ ...t59Base });

ok("6 ★ 권한이 없으면 Today에 그 사실이 뜬다 (행동까지 붙는다)",
  t59NoPerm.state === "noperm" && t59NoPerm.display === "flex"
  && t59NoPerm.text.includes("권한") && t59NoPerm.act === "허용하기",
  JSON.stringify(t59NoPerm));

/* ★ **권한과 다른 축이다**(진단 ④). 권한이 다 있어도 시스템 토글이 꺼지면 못 읽고,
 *   그때 사용자가 갈 곳은 앱 설정이 아니라 시스템 설정이다. 뭉치면 없는 스위치를 찾는다. */
ok("6b ★ 위치 서비스 꺼짐은 권한 없음과 다른 상태·다른 문구다",
  t59NoLoc.state === "nolocation" && t59NoLoc.display === "flex"
  && t59NoLoc.text !== t59NoPerm.text && t59NoLoc.act !== t59NoPerm.act,
  `${JSON.stringify(t59NoLoc)} vs ${JSON.stringify(t59NoPerm)}`);

ok("6c ★ 이름 붙인 네트워크가 0이면 그 사실이 뜬다 — 읽어도 판정할 것이 없다",
  t59NoPlace.state === "noplace" && t59NoPlace.display === "flex"
  && t59NoPlace.act === "이름 붙이기",
  JSON.stringify(t59NoPlace));

/* ★ 등록 — **이름은 사용자가 붙인다**(ADR-046 ②). 시스템이 추측하지 않는다.
 *   ⚠️ 신호에 토스트를 쓰지 않는다(함정 14) — `#place-result`(사라지지 않는다)와 서버를 센다.
 *   ⚠️ `onclick()`이 `run(...)`의 프라미스를 그대로 주므로 **`await` 한다.** */
await w.openPlaceSheet();
const t59SheetHasInput = !!$("#place-name");
$("#place-name").value = "집";
await $("#place-save").onclick();
const t59Saved = await ev(`Api.places()`);
ok("★ 지금 붙은 네트워크에 이름을 붙이면 저장된다 (그 화면이 유일한 입구다)",
  t59SheetHasInput
  && ($("#place-result").textContent || "").includes("저장")
  && (t59Saved.places || []).some((p) => p.net_id === T59_NET && p.name === "집"),
  `입력칸=${t59SheetHasInput} 결과="${txt("#place-result")}" 저장=${JSON.stringify(t59Saved.places)}`);
w.closeAll();

// 이제 이름 붙인 곳이 1 — 뒤 둘과 정상이 여기서 갈린다.
const t59NoBg = await t59Show({ ...t59Base, backgroundPermission: false });
const t59Stale = await t59Show({ ...t59Base, lastSeenAt: t59Old });
const t59Ok = await t59Show({ ...t59Base });

/* ★ **실패가 아니라 반쪽이다**(ADR-046 ⑥). 기능을 끄지 않고 그 사실만 말한다 —
 *   2026-08-28에 알림 권한을 껐다가 Guard가 통째로 죽은 것이 강요의 대가였다. */
ok("6d ★ 배경 권한이 없으면 '반쪽'이라고 말한다 — 끄지는 않는다",
  t59NoBg.state === "nobg" && t59NoBg.display === "flex" && t59NoBg.act === "항상 허용",
  JSON.stringify(t59NoBg));

ok("6e ★ 관측이 오래되면 그 사실이 뜬다 — 돌던 것이 멈춘 것과 처음부터 안 돈 것이 같은 칸이다",
  t59Stale.state === "stale" && t59Stale.display === "flex",
  JSON.stringify(t59Stale));

/* 7 ★ 6의 짝 — **정상일 때는 안 뜬다.** 이것이 없으면 *"항상 띄우는 구현"*이 위 다섯을
 *   전부 통과하고, 그러면 이 줄은 배경이 되어 아무도 안 읽는다. */
ok("7 ★ 정상일 때는 안 뜬다 (6의 짝)",
  t59Ok.state === "ok" && t59Ok.display === "none" && t59Ok.text === "",
  JSON.stringify(t59Ok));

/* ★ 다섯의 짝 — **서로 다른 문장인가.** 각각을 따로 보는 것만으로는 다섯을 같은 문자열로
 *   만드는 변이가 통과한다(다섯 검사가 모두 '뜬다'만 세므로). T-53이 셋에서 배운 그 자리다. */
const t59Five = [t59NoPerm, t59NoLoc, t59NoPlace, t59NoBg, t59Stale];
ok("★ 다섯이 서로 다른 상태·문구다 — 무엇을 해야 할지가 화면에서 갈린다",
  new Set(t59Five.map((x) => x.state)).size === 5
  && new Set(t59Five.map((x) => x.text)).size === 5
  && t59Five.every((x) => x.text.length > 0 && x.display === "flex"),
  t59Five.map((x) => `${x.state}:${x.text}`).join(" | "));

/* ★ ⑥의 나머지 절반 — **배경 권한이 없을 때만 앱을 열며 줍는다.**
 *   없으면 그때가 *"그 사이 바뀐 것"*을 잡는 유일한 기회이고, 있으면 콜백이 이미 잡고 있어
 *   왕복을 더할 이유가 없다. **짝이 없으면 "늘 부르는 구현"도 "안 부르는 구현"도 통과한다.** */
t59Calls.length = 0;
await t59Show({ ...t59Base, backgroundPermission: false });
const t59BgPicked = t59Calls.join("|");
t59Calls.length = 0;
await t59Show({ ...t59Base });
const t59OkPicked = t59Calls.join("|");
ok("★ 배경 권한이 없을 때만 앱을 열며 한 번 줍는다 (있으면 안 부른다)",
  t59BgPicked.includes("sync") && !t59OkPicked.includes("sync"),
  `없을때="${t59BgPicked}" 있을때="${t59OkPicked}"`);

/* ★ 둘은 **서로 다른 화면**으로 보낸다(ADR-046 ⑤). 한 버튼으로 합치면 사용자가
 *   엉뚱한 화면에서 없는 스위치를 찾는다 — 상태를 다섯으로 가른 것이 거기서 무의미해진다. */
t59Calls.length = 0;
await t59Show({ ...t59Base, locationEnabled: false });
await $("#td-place-act").onclick();
await t59Show({ ...t59Base, backgroundPermission: false });
await $("#td-place-act").onclick();
ok("★ 위치 서비스와 배경 권한이 서로 다른 설정 화면으로 간다",
  t59Calls.includes("open:location") && t59Calls.includes("open:background"),
  t59Calls.join("|"));

/* ★ **모르는 곳에서 아무것도 안 남긴 것을 화면이 말한다**(ADR-046 ②의 화면 쪽).
 *   안 남기는 것은 맞지만, 말하지 않으면 *"안 남았다"*와 *"고장 났다"*가 같아 보인다.
 *   ⚠️ 문구는 **구현에서 가져온다** — 여기 다시 적으면 두 벌이 되고 갈라진 쪽이 조용해진다. */
const t59Unknown = ev(`placeResultLine({ outcome: "ok", reason: "unknown_network" })`);
const t59Recorded = ev(`placeResultLine({ outcome: "ok", reason: "recorded", place: "학교" })`);
const t59Same = ev(`placeResultLine({ outcome: "ok", reason: "same_place", place: "학교" })`);
ok("★ 남긴 것 · 안 남긴 것 · 모르는 곳이 서로 다른 결과 문구다",
  t59Unknown.kind === "warn" && t59Recorded.kind === "ok"
  && new Set([t59Unknown.text, t59Recorded.text, t59Same.text]).size === 3,
  `모름="${t59Unknown.text}" 남김="${t59Recorded.text}" 그대로="${t59Same.text}"`);

// 브라우저(네이티브 없음)는 **실패가 아니다** — 없는 기능의 실패를 말하는 것은 잔소리다.
await ev(`Api.placeDelete(${JSON.stringify((t59Saved.places.find((p) => p.net_id === T59_NET) || {}).id || "")})`)
  .catch(() => {});
delete w.Capacitor;
await w.loadPlaceStatus();
/* ⚠️ **`t59Ok`과 비교하지 않는다**(AGENT-CHAIN §8). 처음엔 `display === t59Ok.display`로 적었는데,
 *   *"정상에도 행동을 붙이는"* 변이가 `t59Ok.display`를 `flex`로 만들어 **7과 이 검사가 함께**
 *   빨간불이 됐다 — 이 검사가 자기 몫(네이티브 없음이 조용한가)을 못 센 것이다.
 *   **남의 관측값이 아니라 계약값과 비교한다**: `off`는 `PLACE_ACT`에 행동이 없어 안 뜨고,
 *   `ok`가 아니라는 것은 기록(`data-state`)에만 남는다. */
ok("★ 네이티브가 없으면 아무 말도 안 한다 — 화면은 조용하고 기록에만 'off'로 남는다",
  t59Bar.dataset.state === "off" && t59Bar.style.display === "none"
  && t59Bar.dataset.state !== "ok" && !ev(`PLACE_ACT.off`),
  `${t59Bar.dataset.state}/${t59Bar.style.display} · 행동=${ev(`PLACE_ACT.off ?? null`)}`);

/* ── T-63 · 끈 것을 켤 수 있어야 한다 (ADR-047 ③) ─────────────────────────
 *
 * 사용자가 껐고 **돌아오는 길이 없었다.** 끄기 토스트는 *"설정에서 다시 켤 수 있어요"* 라고
 * 말하는데 그 자리가 없었다 — **문구가 없는 곳을 가리켰다.**
 * ⚠️ **한 방향만 있는 문은 이탈 경로가 아니라 낭떠러지다.** 그리고 그 뒤의 침묵은
 *    공강 밤의 침묵과 화면에서 구별되지 않는다(ADR-047 ②가 만든 정당한 침묵). */
console.log("\n[T-63] 밤 알림 — 끈 것을 켤 수 있어야 한다");

/* ⚠️ **줄을 `id`로 찾지 않는다**(함정 15). `#set-watch`로 찾으면 **검사와 구현이 같은 이름을
 *   공유해**, 그 이름이 틀렸을 때 양쪽이 함께 틀린다 — T-55에서 캘린더 12개가 숨은 칸에
 *   쓰였는데 검사가 초록이던 것이 정확히 그 모양이다. **화면에 보이는 글자로 찾는다.** */
const t63Row = () => [...$("#set-list").querySelectorAll(".srow")]
  .find((r) => r.textContent.startsWith("밤 알림")) ?? null;

const t63Calls = [];
/** 스위치는 **기기 prefs 하나**다. 스텁도 그 계약대로 — 쓴 값이 다음 읽기에 보인다. */
const t63Guard = (init) => {
  let on = init;
  return {
    watchStatus: async () => ({ enabled: on }),
    setWatch: async (o) => { t63Calls.push(o.enabled); on = o.enabled; return {}; },
  };
};
/* ★ **`renderMe()`를 `await`한다**(함정 14) — 저장·재조립이 프라미스를 주므로 계약으로 기다린다.
 *   `sleep`이나 토스트로 *"끝났다"* 를 관측하면 그 왕복이 다음 검사에 섞인다. */
const t63Show = async (plugins) => {
  if (plugins) w.Capacitor = { Plugins: { Guard: plugins } };
  else delete w.Capacitor;
  await ev("renderMe()");
  w.toggleSet(true);
  return t63Row();
};
/** 줄을 눌러 본다. **핸들러가 없으면 그 검사만 빨간불**이 되게 한다(T-60이 배운 자리 —
 *  `onclick()`을 바로 부르면 러너가 죽고 요약을 통째로 잃는다). */
const t63Tap = async () => {
  const r = t63Row();
  if (!r || typeof r.onclick !== "function") return "핸들러없음";
  await r.onclick();
  return "눌림";
};

// 1 — 꺼진 것이 **읽힌다.** 지금의 결함이 정확히 이것이다: 껐는데 화면 어디에도 안 적힌다.
const t63Off = await t63Show(t63Guard(false));
ok("1 ★ 꺼져 있으면 줄이 '꺼짐'이라고 말한다 (꺼진 것이 화면에서 읽힌다)",
  !!t63Off && t63Off.textContent.includes("꺼짐") && t63Off.dataset.state === "off",
  `${t63Off?.textContent ?? "줄없음"} / ${t63Off?.dataset.state}`);

/* 6 ★ **꺼짐은 실패가 아니라 선택이다.** 경고색을 쓰면 다음에 `srow-alert`이
 *   *"고쳐야 할 것"* 을 뜻한다는 규칙이 흐려지고, `calStatusRow`의 뜻이 함께 낡는다. */
ok("6 ★ 꺼짐에 경고색이 안 붙는다 (실패가 아니라 선택이다)",
  !!t63Off && !t63Off.classList.contains("srow-alert"),
  `클래스=${t63Off?.className}`);

/* 3 ★ **이 티켓의 본체 — 켜는 길이 생겼는가.** 끄는 길만 있던 것이 결함이었다. */
const t63TapOn = await t63Tap();
const t63AfterOn = t63Row();
ok("3 ★ 꺼진 줄을 누르면 켜진다 — setWatch({enabled:true}) 가 불리고 줄이 따라 바뀐다",
  t63TapOn === "눌림" && t63Calls.at(-1) === true
  && !!t63AfterOn && t63AfterOn.textContent.includes("켜짐"),
  `탭=${t63TapOn} 부른값=${JSON.stringify(t63Calls)} 줄=${t63AfterOn?.textContent}`);

// 2 — 1의 짝. 없으면 *"항상 꺼짐이라 쓰는 구현"*이 1만으로 통과한다.
const t63On = await t63Show(t63Guard(true));
ok("2 ★ 켜져 있으면 '켜짐'이라고 말한다 (1의 짝)",
  !!t63On && t63On.textContent.includes("켜짐") && t63On.dataset.state === "on",
  `${t63On?.textContent ?? "줄없음"} / ${t63On?.dataset.state}`);

/* 4 ★ **3의 짝 — 두 방향이다.** *"한 방향뿐"* 이 결함이었으므로 **두 방향이 다 세어져야**
 *   고쳐진 것이다. 켜기만 되는 구현은 여기서 죽는다. */
const t63Before4 = t63Calls.length;
const t63TapOff = await t63Tap();
const t63AfterOff = t63Row();
ok("4 ★ 켜진 줄을 누르면 꺼진다 — 같은 줄이 두 방향으로 간다 (3의 짝)",
  t63TapOff === "눌림" && t63Calls.length === t63Before4 + 1 && t63Calls.at(-1) === false
  && !!t63AfterOff && t63AfterOff.textContent.includes("꺼짐"),
  `탭=${t63TapOff} 부른값=${t63Calls.at(-1)} 줄=${t63AfterOff?.textContent}`);

/* 5 ★ **조용히 성공한 척하지 않는다.** 나그 카드가 이미 옳게 지키는 자리이고, 여기서
 *   뒤집으면 사용자는 켰다고 믿는데 **그 밤에 안 뜬다** — T-54가 없앤 그 실패 모양이다. */
const t63NoPlug = await t63Show(null);
const t63Before5 = t63Calls.length;
const t63TapWeb = await t63Tap();
ok("5 ★ 플러그인이 없으면 안 부르고 그렇게 말한다 (조용한 성공이 없다)",
  !!t63NoPlug && t63NoPlug.textContent.includes("앱에서만")
  && t63TapWeb === "눌림" && t63Calls.length === t63Before5
  && txt("#toast").includes("앱에서만"),
  `줄=${t63NoPlug?.textContent} 탭=${t63TapWeb} 부른수=${t63Calls.length - t63Before5}`
  + ` 토스트="${txt("#toast")}"`);

/* 7 **두 벌 방지** (스캐너). 스위치를 서버 `settings`에도 두면 **발동 경로엔 네트워크가
 *   없어서**(ADR-021) 둘 중 기기 것만 실제로 쓰이고, 화면은 서버 것을 읽어 **끈 줄 알았는데
 *   그 밤에 또 뜨는** 상태가 만들어진다. 서버의 화이트리스트와 화면의 저장 경로를 함께 센다. */
const t63MeSrc = readFileSync(join(here, "../src/services/me.ts"), "utf8");
const t63Rules = /const RULES[\s\S]*?\n\};/.exec(t63MeSrc)?.[0] ?? "";
const t63ServerKey = /^\s*[a-z_]*(watch|night|bedtime)[a-z_]*\s*:/im.test(t63Rules);
const t63WebSaves = /putSetting\(\s*["'][a-z_]*(watch|night|bedtime)/i.test(appJs);
ok("7 서버 settings 에 스위치 키가 없다 — 화면도 거기로 저장하지 않는다 (스캐너 · 두 벌 방지)",
  t63Rules.length > 0 && !t63ServerKey && !t63WebSaves,
  `RULES=${t63Rules.length}자 서버키=${t63ServerKey} 웹저장=${t63WebSaves}`);

// 다음 블록이 네이티브 없는 상태를 전제한다 — 심어 둔 것을 치운다.
delete w.Capacitor;
await ev("renderMe()");
w.toggleSet(false);

/* ── T-66 · 대기 한 줄이 무엇을 하라는지 말하고, 그 자리에서 된다 (ADR-048) ────────
 *
 * **17일 동안 한 번도 안 눌린 버튼이 있었다.** 떠 있었고 색도 이미 최댓값이었다
 * (`ageClass`는 15일부터 `age3`) — **무엇이 일어날지 몰라서 안 눌렸다.**
 * 라벨은 *"일정 정하기"* 인데 실제로는 Works 대기 세그로 갈 뿐이었고 일정은 **거기서 두 걸음 더**였다.
 * ★ **본체는 걸음 수다** — 문구가 아니라 동작을 맞췄으므로 **한 걸음이 세어져야** 고쳐진 것이다.
 *
 * ⚠️ **줄을 `id`로 찾지 않는다**(함정 15). `#today-wait`으로 찾으면 검사와 구현이 같은 이름을
 *    공유해, 그 이름이 틀렸을 때 **양쪽이 함께 틀린다** — T-55에서 캘린더 12개가 숨은 칸에
 *    쓰였는데 검사가 초록이던 것이 정확히 그 모양이다. **화면에 보이는 글자로 찾는다** —
 *    앵커는 서버가 준 계약값(`waiting.top.title`)이지 구현이 고른 선택자가 아니다.
 * ⚠️ **고정 날짜를 안 쓴다**(함정 12). *"17일째"* 도 픽스처가 만든 실제 일수를 상대로 읽는다.
 */
console.log("\n[T-66] 대기 한 줄 — 그 자리에서 날짜가 정해진다");

await ev(`(async()=>{ await refreshToday(); closeAll(); })()`);
const t66Top = JSON.parse(ev(`JSON.stringify(S.today.waiting.top ?? null)`));
const t66N = ev(`S.today.waiting.n`), t66Age = ev(`S.today.waiting.max_age`);
const t66Tab = () => $("#phone").dataset.tab;
/** 줄은 **오늘 화면에서 top 의 제목이 보이는 카드**다 — 글자로 찾는다(함정 15). */
const t66Row = () => [...w.document.querySelectorAll("#scr-today .card")]
  .find((c) => t66Top && c.textContent.includes(t66Top.title)) ?? null;
const t66Btn = (pred) => [...(t66Row()?.querySelectorAll("button") ?? [])].find(pred) ?? null;
const t66Go = () => t66Btn((b) => t66Top && b.textContent.includes(t66Top.title));
const t66More = () => t66Btn((b) => /^대기\s*\d/.test(b.textContent.trim()));
/** **핸들러가 없으면 그 검사만 빨간불**이 되게 한다(T-60·T-63이 배운 자리 — 바로 부르면
 *  `null is not a function`으로 러너가 죽고 요약을 통째로 잃는다).
 *  ★ 인라인 `onclick`은 `return`이 붙어야 프라미스를 준다(함정 14 · T-63). */
const t66Tap = async (b) => {
  if (!b || typeof b.onclick !== "function") return "핸들러없음";
  await b.onclick();
  return "눌림";
};
// 문구는 **누르기 전에** 뜬 것으로 센다 — 3이 1의 왕복에 딸려 오지 않게.
const t66Say = (t66Row()?.textContent ?? "").replace(/\s+/g, " ").trim();

/* 1 ★ **이 티켓의 본체.** 누르면 **그 자리에서** 날짜 고르기가 열린다 — Works 로 안 간다.
 *   `mode`와 `id`까지 센다: 아무 pick 이나 열어도 되는 게 아니라 **줄이 이름을 부른 그 일**이어야 한다. */
const t66Hit1 = await t66Tap(t66Go());
const t66Pick = JSON.parse(ev(`JSON.stringify(S.pick ? { mode: S.pick.mode, id: S.pick.id } : null)`));
ok("1 ★ 대기 줄을 누르면 그 자리에서 날짜 고르기가 열린다 (Works 로 안 간다 — 세 걸음이 하나가 됐다)",
  t66Hit1 === "눌림" && !!t66Pick && t66Pick.mode === "schedule" && t66Pick.id === t66Top?.id
  && t66Tab() === "cal" && $("#pick-banner").classList.contains("on"),
  `탭침=${t66Hit1} pick=${JSON.stringify(t66Pick)} 대상=${t66Top?.id} 탭=${t66Tab()}`
  + ` 배너=${$("#pick-banner").classList.contains("on")}`);

/* 2 ★ **1의 짝** — 목록으로 가는 길이 남는다. 대기가 여럿이면 전체를 보고 골라야 한다.
 *   ★ **`대기 N`이 그 입구를 그대로 진다**(담당 결정): 원래 이 줄이 이미 들고 있던 글자라
 *   화면에 버튼이 늘지 않고, `W.n`을 조건으로 걸지 않아 **입구가 사라질 수가 없다.**
 *   (줄을 둘로 쪼개는 안은 버렸다 — 한 줄짜리 알림에 두 행은 위계를 다시 흐린다.) */
ev(`exitPick()`);
const t66Hit2 = await t66Tap(t66More());
ok("2 ★ 목록으로 가는 길이 남는다 — '대기 N'이 Works 대기 세그로 간다 (1의 짝)",
  t66Hit2 === "눌림" && t66Tab() === "works" && $("#w-inbox").classList.contains("on"),
  `탭침=${t66Hit2} 탭=${t66Tab()} inbox=${$("#w-inbox").classList.contains("on")} n=${t66N}`);

/* 3 ★ 문구가 **무엇을 하면 되는지** 말한다. 전에는 *"…17일째"* 까지만 말하고 그 뒤를
 *   흐린 라벨 하나에 맡겼다 — **상태로 끝내지 않는다**(ADR-048).
 *   ⚠️ **1과 같은 줄을 보지만 세는 것이 다르다**: 여기는 **글자만** 본다(핸들러도 탭도 안 만진다).
 *   라벨(*"날짜 정하기"*)만으로는 이 조건이 참이 될 수 없다 — *"정하면 … 없어져"* 는 본문에만 있다. */
ok("3 ★ 문구가 상태로 끝나지 않는다 — 무엇을 하면 이 줄이 없어지는지가 읽힌다",
  t66Age !== null && t66Say.includes(`${t66Age}일째`) && /정하면[\s\S]*없어져/.test(t66Say),
  `문구="${t66Say}" 일수=${t66Age}`);

/* 4 ★ **누를 곳이 읽을 곳보다 흐리지 않다**(ADR-048 ②) — 스캐너.
 *   `--faint`는 이 팔레트에서 가장 약한 색이고, 전에는 **행동에만** 그것이 붙어 있었다.
 *   ⚠️ 이것은 *"더 세게 하기"* 가 아니다 — ADR-047 ③이 막은 것은 **개입의 강도**(소리·진동·빈도)이고
 *   여기는 **한 화면 안의 위계**다. 소스와 **실제로 그려진 줄** 둘 다 본다:
 *   `app.js`가 인라인으로 흐린 색을 다시 넣어도 뒤쪽이 잡는다. */
const t66FaintIn = (src) => /id="today-wait"[\s\S]*?--faint/.test(src);
const t66Block = /<div class="card" id="today-wait"[\s\S]*?\n {4}<\/div>/.exec(html)?.[0] ?? "";
ok("4 ★ 대기 줄의 행동이 --faint 가 아니다 · 재배정 행과 같은 칩을 쓴다 (스캐너 · 위계)",
  t66Block.length > 0 && !t66FaintIn(t66Block) && t66Block.includes("deferchip")
  && !(t66Row()?.innerHTML ?? "--faint").includes("--faint"),
  `블록=${t66Block.length}자 faint(소스)=${t66FaintIn(t66Block)}`
  + ` faint(렌더)=${(t66Row()?.innerHTML ?? "").includes("--faint")}`);

// 4의 짝 ★ 스캐너가 살아 있는가 — 합성 소스로 가른다(T-55 7의 짝과 같은 자리).
ok("4 ★ 4의 스캐너가 살아 있다 (합성 --faint 를 잡는다)",
  t66FaintIn(`<div id="today-wait"><b style="color:var(--faint)">x</b></div>`)
  && !t66FaintIn(`<div id="today-wait"><b style="color:var(--sub)">x</b></div>`));

/* 5 회귀 — **대기가 0이면 줄이 안 뜬다.** 두 길로 쪼개면서 `if (W.n)` 갈래를 잃기 쉽다.
 *   재료만 갈아 끼우고 렌더 경로를 그대로 태운다. 다 세고 원래 재료로 되돌린다. */
const t66Keep = ev(`JSON.stringify(S.today.waiting)`);
/* ⚠️ **던지는 것까지 이 검사가 받는다.** `if (W.n)` 갈래를 잃으면 `W.top`이 `null`인데
 *   `W.top.title`을 읽어 `renderToday`가 **던지고**, 그 예외가 `ev()`를 타고 올라가
 *   **러너를 죽여 요약을 통째로 잃는다** — 배터리는 그것을 *"아무도 안 죽었다"* 로 읽는다
 *   (AGENT-CHAIN §8 · T-60·T-63이 핸들러에서 배운 그 자리. 실제로 M5가 여기서 한 번 그랬다).
 *   던진 것을 **문자열로 받아** 이 검사만 빨간불이 되게 한다. */
const t66Empty = ev(`(()=>{ try {
  S.today = { ...S.today, waiting: { n: 0, max_age: null, top: null, limit: S.today.waiting.limit } };
  renderToday();
  return document.querySelector("#today-wait").style.display;
} catch (e) { return "던졌다: " + e.message; } })()`);
ev(`(()=>{ S.today = { ...S.today, waiting: ${t66Keep} }; renderToday(); })()`);
ok("5 대기가 0이면 줄이 안 뜬다 (회귀 · 던지지도 않는다) · 되돌리면 다시 뜬다",
  t66Empty === "none" && $("#today-wait").style.display === "flex",
  `빈=${t66Empty} 복구=${$("#today-wait").style.display}`);

/* 6 ★ **원인이 아닌 곳을 안 고쳤다** — 스캐너. 17일에 색은 **이미 최댓값**이었으므로
 *   `WAIT_LIMIT`도 `ageClass`도 원인이 아니다(ADR-048 ③ · 티켓 §금지 1행).
 *   임계를 낮추면 화면은 더 시끄러워지고 **그 다음에도 안 눌린다.**
 *   ⚠️ 소스 문자열이 아니라 **살아 있는 값**을 부른다 — 주석을 고쳐도 안 죽고 숫자를 고치면 죽는다. */
const t66Ages = [1, 7, 8, 14, 15, 30].map((n) => ev(`ageClass(${n})`)).join(",");
ok("6 임계가 그대로다 — WAIT_LIMIT 21 · ageClass 8/15 (스캐너 · 원인이 아닌 곳)",
  ev(`WAIT_LIMIT`) === 21 && t66Ages === "age1,age1,age2,age2,age3,age3",
  `WAIT_LIMIT=${ev(`WAIT_LIMIT`)} ageClass=${t66Ages}`);

w.switchTab("today");
await sleep(300);

/* ── T-68 · 열한 번째가 첫 번째인 척하지 않는다 (ADR-049) ────────────────────
 *
 * **jsdom은 Kotlin을 못 돌린다**(T-51·T-60이 배운 자리). 여기 아홉은 전부 스캐너이고
 * **진짜 판정은 밤 실측**이다(티켓 §확인 절차 — 그 밤의 reaction 이 accepted 일색이 아닌가).
 *
 * 그래서 세는 방식을 하나 바꿨다: **정규식이 맞았는가**가 아니라
 * **Kotlin에서 뽑아 온 재료로 JS가 한 밤을 돌려 본다.** 문구도 임계도 비교 연산자도
 * 여기 안 적는다 — 적으면 구현이 틀릴 때 검사도 함께 틀린다(함정 15).
 */
console.log("\n[T-68] 밤 개입 — 문구가 오늘 밤 몇 번째인지 안다");

const t68Kt = (f) => t46Bare(readFileSync(
  join(here, "../android/app/src/main/java/dev/mond1424/personalos/guard/" + f), "utf8"));
const t68Watch = t68Kt("GuardWatch.kt");
const t68Alert = t68Kt("GuardAlertActivity.kt");
const t68Layout = t46NoXml(readFileSync(
  join(here, "../android/app/src/main/res/layout/activity_guard_alert.xml"), "utf8"));

/** 발동 한 번의 누적 조각을 **구현에서 뽑은 재료로** 만든다. 못 뽑으면 `null` — 1이 그걸 센다.
 *
 * ⚠️ `t51Default`를 다시 쓴다. 같은 파일을 두 번 파싱하면 **파서가 두 벌**이 되고,
 *    그게 이 리포가 파생에서 반복해 물린 모양이다(원칙 1의 사촌). */
const t68Render = (src) => {
  const fmt = /private const val (\w+) = "([^"]*%?[^"]*)"/.exec(src);
  const at = /if \(n (>=|>|<=|<|==) s\.(\w+)\) append\(String\.format\([\w.]+, (\w+), n\)\)/.exec(src);
  if (!fmt || !at || at[3] !== fmt[1]) return null;
  const from = t51Default(at[2]);
  if (from === null) return null;
  const cmp = {
    ">=": (a, b) => a >= b, ">": (a, b) => a > b, "<=": (a, b) => a <= b,
    "<": (a, b) => a < b, "==": (a, b) => a === b,
  }[at[1]];
  return (n) => (cmp(n, from) ? fmt[2].replace(/%d/g, String(n)) : "");
};
const t68Line = t68Render(t68Watch);
const t68Max = t51Default("watchMaxPerNight");
const t68Later = t68Line ? Array.from({ length: t68Max - 1 }, (_, i) => i + 2) : [];

/* 1 ★ **본체.** 두 번째부터 그 밤의 마지막까지, 순번이 문구 안에 **숫자 그대로** 있다.
 *   ⚠️ *"여러 번"* 처럼 뭉개면 `%d`가 없어 치환이 안 되고 여기서 죽는다 — 세는 것을 지우면
 *      열한 번째가 다시 첫 번째처럼 보이고, 그게 이 티켓이 고치는 결함이다. */
ok("1 ★ 두 번째 이후 발동의 문구에 그 밤의 누적이 수(數)로 들어간다 (재료로 한 밤을 돌린다)",
  !!t68Line && t68Later.length > 0 && t68Later.every((n) => t68Line(n).includes(String(n))),
  t68Line
    ? `n=2 "${t68Line(2)}" … n=${t68Max} "${t68Line(t68Max)}"`
    : "재료를 못 뽑았다 (문구 상수 또는 붙이는 자리가 없다)");

/* 1의 짝 ★ **뽑는 장치가 살아 있는가.** 1은 재료를 못 뽑으면 `null`로 죽는데, 그것이
 *   *"안 실었다"* 인지 *"파서가 낡았다"* 인지 구별이 안 된다. 합성 소스로 가른다
 *   (T-51 ③ · T-66 4의 짝과 같은 자리). ⚠️ **셋을 각각 흔든다** — 문구 · 게이트 · 재료 없음. */
const t68Syn = (fmt, op) =>
  `    private const val TALLY_FMT = "${fmt}"\n`
  + `            if (n ${op} s.watchMaxPerNight) append(String.format(java.util.Locale.US, TALLY_FMT, n))`;
const t68SynLine = t68Render(t68Syn("밤 %d회", ">="));
const t68SynMute = t68Render(t68Syn("여러 번", ">="));
ok("1 ★ 1의 파서가 살아 있다 — 수 있는 문구는 세고, 뭉갠 문구는 안 센다 · 게이트를 뒤집으면 따라간다",
  !!t68SynLine && t68SynLine(t68Max).includes(String(t68Max))
  && !!t68SynMute && !t68SynMute(t68Max).includes(String(t68Max))
  && t68Render(t68Syn("밤 %d회", "<"))(t68Max) === ""
  && t68Render('private const val X = "y"') === null,
  `수있음="${t68SynLine ? t68SynLine(t68Max) : null}" 뭉갬="${t68SynMute ? t68SynMute(t68Max) : null}"`);

/* 2 ★ **1의 짝 — 소음을 안 만들었는가.** 1번째에 *"1번째예요"* 는 앞이 없는데 앞을 세는 말이라
 *   아무것도 안 알린다. 세 자리를 함께 본다: ① 첫 발동의 조각이 **빈 문자열**이고
 *   ② 순번 `n`이 문구 조립에서 **그 한 줄 말고는 안 쓰이며**(다른 조각이 딸려 달라지면 죽는다)
 *   ③ **제목**도 순번을 안 본다.
 *   ★ **누적 줄 자체는 안 본다 — 그건 1의 몫이다.** 처음엔 `n`을 본문에서 **세었는데**,
 *   그러면 누적을 통째로 지우는 변이(M1)에 **1과 함께 죽어** 무엇이 틀렸는지 못 가른다
 *   (실측으로 그랬다 · AGENT-CHAIN §8 · T-64·T-67이 같은 자리에서 좁힌 그 모양).
 *   그래서 **누적 줄을 뺀 나머지**에 순번이 새는지만 본다 — M1에서는 나머지가 곧 전부이고,
 *   거기 `n`이 없으면 통과가 맞다. 2가 세는 것은 *"첫 번엔 그 말이 없다"* 하나다. */
const t68Body = /val body = buildString \{([\s\S]*?)\n {8}\}/.exec(t68Watch)?.[1] ?? "";
const t68Rest = t68Body.split("\n")
  .filter((l) => !/append\(String\.format\([\w.]+, \w+, n\)\)/.test(l)).join("\n");
const t68Leak = /\bn\b/.test(t68Rest);
const t68Title = /val title = if \(level == 2\)[^\n]*/.exec(t68Watch)?.[0] ?? "";
ok("2 ★ 첫 발동의 문구는 전과 같다 — 순번이 다른 조각으로 안 샌다 (1의 짝)",
  (t68Line ? t68Line(1) === "" : true)
  && t68Body.length > 0 && !t68Leak
  && t68Title.length > 0 && !/\bn\b/.test(t68Title),
  `첫조각="${t68Line ? t68Line(1) : "(재료 없음)"}" 나머지로샘=${t68Leak}`
  + ` 제목속n=${/\bn\b/.test(t68Title)}`);

/* 3 ★ **밤이 바뀌면 1부터 다시 센다.** 겨누는 것은 *"reset이라는 낱말이 있다"* 가 아니라
 *   **문구가 읽는 그 계수가 밤 키 불일치에서 0으로 돌아가는가**다 — 키 이름을 구현에서
 *   뽑아 그 이름으로 초기화 자리를 찾는다. 둘이 갈라지면 전날을 이어 센다.
 *
 *   ⚠️ **T-69가 그 계수를 옮겼다 — 검사도 따라간다**(CLAUDE.md §기준선: 검사가 옛 동작을
 *      검사하고 있으면 고치고 그 사실을 말한다). 문구가 읽는 것은 이제 감시 발동 수가 아니라
 *      **방해 수**(`GuardNight`)이고, 밤 키로 0이 되는 자리도 그 파일에 있다.
 *      ★ **주장은 그대로다** — *"문구가 읽는 그 계수가 밤이 바뀌면 0이다"*. 사는 곳만 옮겼다.
 *      ⚠️ 파일 이름도 여기 안 적는다 — `GuardWatch`가 부르는 이름을 뽑아 그 파일을 연다.
 *      ⚠️ **모양 둘을 다 읽는다.** 문구가 다시 `GuardWatch`의 계수를 읽게 되어도 이 주장은
 *         여전히 참이므로, 그때 빨간불이 되면 **참인데 우는 검사**가 된다. 그 자리는
 *         T-69 1의 몫이다 — *"세는 자리가 세 경로의 합류점인가"*. */
const t68Owner = /val n = (\w+)\.count\(ctx\) \+ 1/.exec(t68Watch)?.[1] ?? null;
const t68Local = /val n = pr\.getInt\((K_\w+), 0\) \+ 1/.exec(t68Watch)?.[1] ?? null;
/** 계수를 **올리는** 자리의 주인 — `fire()`가 부르는 이름. 4·7이 문구와 따로 이것을 쓴다. */
const t68Bumper = /(\w+)\.note\(ctx\)/.exec(t68Kt("GuardNotifications.kt"))?.[1] ?? null;
const t68OwnerSrc = t68Bumper ? t68Kt(`${t68Bumper}.kt`) : "";
const t68MsgSrc = t68Owner ? t68Kt(`${t68Owner}.kt`) : t68Watch;
const t68CountFn = /fun count\(ctx: Context\): Int[\s\S]*?\n {4}\}\.getOrDefault\(0\)/
  .exec(t68MsgSrc)?.[0] ?? "";
// 밤 키가 다르면 0 — 옮긴 모양은 `else 0`으로 읽고, 옛 모양은 `putInt(…, 0)`으로 쓴다.
const t68Src = t68Local
  ?? (/pr\.getInt\((K_\w+), 0\) else 0/.exec(t68CountFn)?.[1] ?? null);
const t68Zeroed = t68Src !== null && (t68Local
  ? new RegExp(
    `if \\(pr\\.getString\\(K_NIGHT_KEY, null\\) != night\\) \\{[\\s\\S]{0,300}?putInt\\(${t68Src}, 0\\)`,
  ).test(t68Watch)
  // 세는 쪽(note)도 같은 계수를 같은 밤 키로 연다 — 읽기만 0이면 다음 밤이 전날을 이어 쓴다.
  : /pr\.getString\(K_\w+, null\) == key\(/.test(t68CountFn) && new RegExp(
    `pr\\.getString\\(K_\\w+, null\\) == night\\) pr\\.getInt\\(${t68Src}, 0\\) else 0`,
  ).test(t68MsgSrc));
const t68NightFrom = /val night = (\w+\.key|nightKey)\(s\.bedFrom, s\.bedTo\)/.test(t68Watch);
ok("3 ★ 밤이 바뀌면 수가 0으로 돌아간다 — 문구가 읽는 계수와 초기화되는 계수가 같은 키다",
  !!t68Src && t68Zeroed && t68NightFrom,
  `주인=${t68Owner ?? "GuardWatch"} 문구가읽는키=${t68Src} 밤키에서0=${t68Zeroed}`
  + ` 밤이름=${t68NightFrom}`);

/* 4 ★ **누적은 저장되지 않는다** — 파생 금지(원칙 1). 밤마다 초기화되는 계수 하나뿐이어야 한다.
 *   ⚠️ *"새 키가 없다"* 를 **안 세는 방식으로 세지 않는다**: 쓰기 자체를 전부 뽑아
 *      ① 전부 선언된 상수 키이고 ② **정수로 쓰이는 키가 문구가 읽는 그 계수 하나뿐**임을 본다.
 *      정규식이 눈멀면 빈 배열이 되어 ②가 먼저 죽는다 — 조용히 통과하지 않는다.
 *   ★ **쓰기의 개수는 안 센다.** 처음엔 *"정수 쓰기가 둘"* 을 세었는데, 그러면 초기화를
 *   지우는 변이(M3)에 **3과 함께 죽는다**(실측으로 그랬다 · AGENT-CHAIN §8).
 *   *"0으로 돌아가는가"* 는 3의 몫이고, 여기는 **계수가 하나뿐인가**만 본다.
 *
 *   ⚠️ **T-69 뒤로는 파일이 둘이다** — 감시 발동 수(`GuardWatch`)와 방해 수(그 주인).
 *      **주장은 그대로다**: *"각자 정수 계수 하나뿐이고, 낯선 키를 쓰지 않는다."*
 *      둘을 합쳐 세지 않는다 — 합치면 한쪽이 둘이 되어도 통과한다. */
const t68DeclKeys = (s) => [...s.matchAll(/private const val (K_\w+) = "/g)].map((m) => m[1]);
const t68PutKeys = (s) => [...s.matchAll(/put(?:Int|Long|String|Boolean)\(\s*([^,]+),/g)]
  .map((m) => m[1].trim());
const t68IntKeys = (s) => [...new Set(
  [...s.matchAll(/putInt\(\s*([^,]+),/g)].map((m) => m[1].trim()),
)];
const t68Files = [t68Watch, t68OwnerSrc];
const t68Foreign = t68Files.flatMap((s) => t68PutKeys(s).filter((k) => !t68DeclKeys(s).includes(k)));
const t68IntW = t68Files.map(t68IntKeys);
const t68Sql = readdirSync(join(here, "../migrations"))
  .map((f) => readFileSync(join(here, "../migrations", f), "utf8")).join("\n");
const t68NoCol = !/(tally|night_count|fired_tonight|interrupt)/i.test(t68Sql);
ok("4 ★ 누적을 저장하는 키도 컬럼도 없다 — 밤마다 0으로 가는 계수 하나만 쓴다 (파생 금지)",
  t68Files.every((s) => t68PutKeys(s).length > 0) && t68Foreign.length === 0
  && t68IntW.every((ks) => ks.length === 1) && t68NoCol,
  `낯선키=${JSON.stringify(t68Foreign)} 정수쓰기=${JSON.stringify(t68IntW)} SQL컬럼없음=${t68NoCol}`);

/* 5 ★ **발동 경로에 네트워크가 없다** (ADR-021 회귀). 누적을 서버에서 받아 오면 오프라인인
 *   새벽이 통째로 조용해진다 — 재료는 이미 기기에 있다(ADR-049 ①).
 *   ⚠️ **낱말 하나가 아니라 이름 넷을 겨눈다**(T-60이 `/wake/i`로 물린 자리).
 *   짝으로 `nextWake`(캐시 읽기)가 **남아 있는지**도 본다 — 그것까지 지우면 아침 한 줄이 죽는다. */
const T68_NET = /HttpURLConnection|openConnection|GuardSync\.pull|GuardEventQueue\.flush/;
ok("5 ★ 발동 경로(GuardWatch)에 네트워크 호출이 없다 — 누적은 기기가 안다",
  !T68_NET.test(t68Watch) && /GuardSync\.nextWake/.test(t68Watch),
  `네트워크=${T68_NET.exec(t68Watch)} 캐시읽기=${/GuardSync\.nextWake/.test(t68Watch)}`);

// 5의 짝 ★ 스캐너가 살아 있다 — 넷 중 어느 이름이 들어와도 잡는다(안 잡으면 5는 늘 초록이다).
ok("5 ★ 5의 스캐너가 살아 있다 (합성 조회 셋을 각각 잡고, 캐시 읽기는 안 잡는다)",
  ["val c = (URL(x).openConnection() as HttpURLConnection)", "GuardSync.pull(ctx)",
    "runCatching { GuardEventQueue.flush(ctx) }"].every((l) => T68_NET.test(l))
  && !T68_NET.test("val w = GuardSync.nextWake(ctx, now, 18, 48)"));

/* 6 ★ **수락 버튼에 마찰을 안 붙였다** — 이 티켓의 경계(ADR-049 §기각한 대안 1행).
 *   대가는 누를 때가 아니라 **누적**에 붙는다. 여기에 대기·사유를 붙이면
 *   **처음 한 번에 자는 밤도 함께 벌하고**, 막으면 OS 무음 처리로 관측까지 잃는다(ADR-047 ③).
 *   핸들러 본문과 **레이아웃** 둘 다 본다 — 코드가 깨끗해도 XML이 버튼을 죽여 두면 같은 일이다. */
const t68AcceptBlk = /accept\.setOnClickListener \{([\s\S]*?)\n {8}\}/.exec(t68Alert)?.[1] ?? "";
const T68_FRICTION = /startWait|waitLeft|guard_reason|isEnabled|postDelayed|alpha/;
const t68AcceptXml = /<Button[^>]*?android:id="@\+id\/guard_accept"[\s\S]*?\/>/.exec(t68Layout)?.[0] ?? "";
ok("6 ★ [알겠습니다]에 대기도 사유도 안 붙었다 (②의 경계 · 핸들러와 레이아웃 둘 다)",
  /finishWith\("accepted", null\)/.test(t68AcceptBlk) && !T68_FRICTION.test(t68AcceptBlk)
  && t68AcceptXml.length > 0 && !/android:enabled="false"/.test(t68AcceptXml),
  `핸들러="${t68AcceptBlk.trim().replace(/\s+/g, " ")}"`
  + ` xml에서죽임=${/android:enabled="false"/.test(t68AcceptXml)}`);

// 6의 짝 ★ 스캐너가 살아 있다 — 대기를 붙인 합성 핸들러를 잡는다(안 잡으면 6은 늘 초록이다).
ok("6 ★ 6의 스캐너가 살아 있다 (합성 대기·사유를 잡고, 지금 모양은 안 잡는다)",
  T68_FRICTION.test('finishWith("accepted", null)\n            startWait(waitSec, go, note, reason)')
  && T68_FRICTION.test('accept.postDelayed({ finishWith("accepted", null) }, 60_000L)')
  && !T68_FRICTION.test('finishWith("accepted", null)\n            GuardRecheck.arm(this, level)'));

/* ── T-69 · 한 문장 안의 두 수가 서로를 반박한다 ────────────────────────────
 *
 * *"오늘 밤 3번째예요. 취침 창 안에서 15분째 화면을 보고 있어요."* — 3번째면 창 안에서
 * 최소 45분은 지났다. **한 값이 두 일을 하고 있었다**(발동 조건이자 문구의 재료).
 *
 * ★ **셋(3·4·5)은 스캐너가 아니다.** 티켓이 요구한 것은 *"관계를 재라"* 였고 **관계는
 *   정규식으로 못 잰다.** 그래서 `GuardActivityLog`의 두 함수를 **Kotlin 본문 그대로 옮겨
 *   한 밤을 돌린다** — 규칙을 검사에 다시 적지 않는다(함정 15). 옮기기가 실패하면 셋이 함께
 *   빨간불이고(조용히 통과하지 않는다), **`5의 짝`이 옛 규칙을 넣어 모순이 실제로 잡히는지**를 본다.
 * ⚠️ **나머지(1·2·6·7)는 스캐너다** — 세는 자리가 안드로이드 런타임이라 jsdom이 못 돈다.
 *    **진짜 판정은 밤 실측**이다(티켓 §확인 절차 — ★★ 그 밤의 발동 횟수·시각이 전과 같은가). */
console.log("\n[T-69] 한 문장의 두 수 — 무엇을 세는지가 갈렸는가");

const t69Watch = t68Watch;                       // 같은 파일을 두 번 파싱하지 않는다(T-68 §)
const t69Dir = join(here, "../android/app/src/main/java/dev/mond1424/personalos/guard");
const t69Raw = (f) => readFileSync(join(t69Dir, f), "utf8");
const t69Log = t68Kt("GuardActivityLog.kt");
const t69Notif = t68Kt("GuardNotifications.kt");
const t69Recheck = t68Kt("GuardRecheck.kt");
const t69Alarm = t68Kt("AlarmReceiver.kt");

/* 1 ★ **문구의 "N번째"가 재확인·경로 A까지 센다** (ADR-026 *"재확인도 하나의 발동"*).
 *   세는 자리를 **세 경로의 합류점**에 두었는가로 본다 — 경로마다 세면 넷째 경로가 생겼을 때
 *   조용히 빠진다(T-70이 `markAsked`를 발동 경로가 아니라 화면으로 옮긴 그 이유).
 *   ⚠️ **주인의 이름을 검사에 적지 않는다** — 양쪽에서 뽑아 **같은 것인지**를 본다:
 *      문구가 읽는 계수(`GuardWatch`)와 `fire()`가 올리는 계수. 둘이 갈라지면 문구는
 *      감시 발동만 세던 옛 수로 돌아간 것이다. */
const t69Note = t68Bumper ? new RegExp(`\\b${t68Bumper}\\.note\\(ctx\\)`) : null;
const t69Bump = !!t69Note && t69Note.test(t69Notif);
const t69Same = !!t68Owner && t68Owner === t68Bumper;
const t69Paths = [t69Watch, t69Recheck, t69Alarm]
  .filter((s) => /GuardNotifications\.fire\(/.test(s)).length;
const t69NotInPath = !!t69Note && ![t69Watch, t69Recheck, t69Alarm].some((s) => t69Note.test(s));
ok("1 ★ 문구의 순번이 재확인·경로 A까지 센다 — 세는 자리가 세 경로의 합류점 하나다",
  t69Same && t69Bump && t69Paths === 3 && t69NotInPath,
  `문구가읽는주인=${t68Owner} fire가올리는주인=${t68Bumper} 같다=${t69Same}`
  + ` fire를부르는경로=${t69Paths}/3 경로에서직접안센다=${t69NotInPath}`);

/* 2 ★ **1의 짝 — 동작이 안 바뀌었다.** 밤 상한이 읽는 계수에는 **감시 발동만** 들어간다.
 *   이 티켓의 약속이 *"문구만 고친다"* 이므로 **안 바뀐 것이 세어져야** 고쳐진 것이다.
 *   ★ 상한의 계수를 **게이트 줄에서** 뽑는다(위치가 아니라 뜻으로) — *"`watchMaxPerNight`와
 *     비교되는 그 계수"*. 그리고 **guard/ 전체에서** 그것을 만지는 파일을 센다:
 *     다른 파일이 한 줄만 올려도 밤마다 발동이 줄어드는데 `GuardWatch`만 보면 안 보인다. */
const t69CapK = /if \(pr\.getInt\((K_\w+), 0\) >= s\.watchMaxPerNight\) return false/
  .exec(t69Watch)?.[1] ?? null;
const t69CapVal = t69CapK
  ? (new RegExp(`const val ${t69CapK} = "(\\w+)"`).exec(t69Raw("GuardWatch.kt"))?.[1] ?? null)
  : null;
const t69Touching = t69CapVal
  ? readdirSync(t69Dir).filter((f) => f.endsWith(".kt"))
    .filter((f) => new RegExp(`\\b${t69CapK}\\b|"${t69CapVal}"`).test(t46Bare(t69Raw(f))))
  : [];
ok("2 ★ 밤 상한이 세는 수는 안 바뀐다 — 감시 발동만 (1의 짝 · 동작 불변)",
  !!t69CapVal && t69Touching.length === 1 && t69Touching[0] === "GuardWatch.kt",
  `상한계수=${t69CapK}("${t69CapVal}") 만지는파일=${JSON.stringify(t69Touching)}`);

/* ── 3·4·5의 재료: Kotlin 본문을 그대로 옮겨 돌린다 ──────────────────────────
 *
 * ★ **규칙을 검사에 다시 적지 않는다.** 구현이 틀리면 검사도 함께 틀리는 것이 T-55에서
 *   물린 모양이다(함정 15). 옮기다 막히면 `null`이 되고 **셋이 함께 빨간불**이 된다. */
const t69Body = (src, name) => {
  const i = src.indexOf(`fun ${name}(`);
  if (i < 0) return null;
  const rest = src.slice(i);
  const j = rest.indexOf("\n    }");                 // 함수의 닫는 괄호 — 안쪽은 더 깊다
  return j < 0 ? null : rest.slice(rest.indexOf("{") + 1, j);
};
/** Kotlin → JS. **이 두 함수가 쓰는 문법만** 옮긴다 — 모르는 것이 남으면 아래에서 던진다. */
const t69Js = (body) => body
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\bwhen \((.+)\) \{/g, "switch ($1) {")
  .replace(/^(\s*)("\w+") -> (\{[\s\S]*?\}|[^\n]+)$/gm, "$1case $2: $3; break;")
  .replace(/\bval\b|\bvar\b/g, "let")
  .replace(/(\d)_(?=\d)/g, "$1")
  .replace(/\b(\d+)L\b/g, "$1")
  .replace(/maxOf\(/g, "Math.max(")
  .replace(/o\.optLong\("at"\)/g, "o.at")
  .replace(/o\.optString\("kind"\)/g, "o.kind")
  .replace(/arr\.getJSONObject\(i\)/g, "arr[i]")
  .replace(/for \(i in 0 until arr\.length\(\)\)/g, "for (let i = 0; i < arr.length; i++)")
  .replace(/System\.currentTimeMillis\(\)/g, "NOW")
  .replace(/read\(ctx\)/g, "SAMPLES")
  // ⚠️ **한 줄 안에서만** 접는다. `[^;]`는 줄바꿈도 먹어서 앞의 `if (…)`부터 삼켰고,
  //    그러면 `if Math.trunc(…)`이라는 못 쓰는 문장이 나온다(실측으로 그랬다).
  .replace(/\(([^\n;]*?)\)\.toInt\(\)/g, "Math.trunc($1)");
const t69Fn = (src, name) => {
  const b = t69Body(src, name);
  if (b === null) return null;
  // eslint-disable-next-line no-new-func
  try {
    return new Function("SAMPLES", "NOW", "sinceMs", t69Js(b));
  } catch {
    return null;                                   // 옮기다 막혔다 — 3·4·5가 함께 빨간불이다
  }
};
const t69Gate0 = t69Fn(t69Log, "continuousScreenOnMin");      // 발동 조건이 읽는 값
const t69Msg0 = t69Fn(t69Log, "screenOnMinSince");            // 문구가 읽는 값

/** 한 밤. **고정 시각을 안 쓴다**(함정 12) — 전부 창 시작 W 로부터의 상대 분이다. */
const T69_MIN = 60_000;
const t69W = Date.now() - 200 * T69_MIN;           // 창이 200분 전에 시작했다
const t69At = (min) => t69W + min * T69_MIN;
/* 창 **10분 전**부터 화면을 켜고 있었고, 창 안 25·50·75분에 개입이 셋 있었다.
 * 개입은 각각 2분 화면을 붙잡았다 — `FLAG_KEEP_SCREEN_ON`이라 **Guard가 켠 화면**이다(T-30). */
const t69Fires = [25, 50, 75];
const t69Hold = 2;
const t69Pre = 10;
const t69Samples = [
  { at: t69At(-t69Pre), until: t69At(-t69Pre), kind: "screen_on", app: "" },
  ...t69Fires.flatMap((f) => [
    { at: t69At(f), until: t69At(f), kind: "intervene_on", app: "" },
    { at: t69At(f + t69Hold), until: t69At(f + t69Hold), kind: "intervene_off", app: "" },
  ]),
];
/* 발동 **시점**에서 본 값. ⚠️ **그 순간의 표본은 아직 없다** — `fire()`가 `startActivity`를
 * 부르고 `onCreate`가 `intervene_on`을 남기는 것은 그 뒤다. 같이 넣으면 게이트가 0이 되어
 * 검사가 실제와 다른 밤을 본다. */
const t69See = (fn, t, since) =>
  fn(t69Samples.filter((s) => s.at < t69At(t)), t69At(t), since);
const t69Ran = !!t69Gate0 && !!t69Msg0;
const t69MsgAt = t69Ran ? t69Fires.map((f) => t69See(t69Msg0, f, t69W)) : [];
const t69GateAt = t69Ran ? t69Fires.map((f) => t69See(t69Gate0, f, t69W)) : [];

/* 3 ★ **"N분"이 창에 들어온 뒤를 잰다.** 두 마디를 함께 본다:
 *   ① 값이 **창 시작에서부터**다 — 창 10분 전부터 켜 두었어도 첫 발동에서 25분이다.
 *      35분이면 창 밖을 실은 것이고, 그러면 *"창에 들어온 뒤"* 가 거짓이 된다.
 *   ② **문구가 그 함수를 읽는다** — 값이 맞아도 `GuardWatch`가 옛 값을 실으면 소용없다. */
const t69MsgReads = /val windowMin = GuardActivityLog\.screenOnMinSince\(/.test(t69Watch)
  && /\$\{windowMin\}분 화면을/.test(t69Watch);
ok("3 ★ 문구의 분이 창에 들어온 뒤를 잰다 (창 밖은 안 싣는다 · 문구가 그 값을 읽는다)",
  t69Ran && t69MsgAt[0] === t69Fires[0] && t69MsgReads,
  `첫발동분=${t69MsgAt[0]} (창밖 ${t69Pre}분을 실으면 ${t69Fires[0] + t69Pre})`
  + ` 문구가읽는다=${t69MsgReads} 옮기기=${t69Ran}`);

/* 4 ★ **3의 짝 — 발동 조건이 읽는 값은 안 바뀌었다.** 개입이 닫힐 때마다 0에서 다시 센다:
 *   두 번째 발동의 게이트는 `50 - (25+2) = 23`분이어야 한다. 이 값이 창 기준으로 바뀌면
 *   **임계를 한 번 넘은 밤은 내내 넘은 채로 있게 되고, 그건 발동 규칙이 바뀐 것이다.** */
const t69GateWant = [t69Fires[0] + t69Pre,
  ...t69Fires.slice(1).map((f, i) => f - (t69Fires[i] + t69Hold))];
const t69GateLine = /val usedMin = GuardActivityLog\.continuousScreenOnMin\(ctx\)\n\s*if \(usedMin < s\.watchMinutes\) return false/
  .test(t69Watch);
ok("4 ★ 발동 조건이 읽는 연속 값은 안 바뀐다 — 개입 뒤 0에서 다시 센다 (3의 짝 · 동작 불변)",
  t69Ran && JSON.stringify(t69GateAt) === JSON.stringify(t69GateWant) && t69GateLine,
  `게이트=${JSON.stringify(t69GateAt)} 기대=${JSON.stringify(t69GateWant)} 조건줄=${t69GateLine}`);

/* 5 ★ **본체 — 두 수가 서로를 반박하지 않는다.**
 *   ⚠️ *"두 수가 같다"* 로 세지 않는다(티켓이 막은 자리) — 다른 것을 세는 수라 같을 리 없다.
 *   ★ **세는 것은 관계다:** 화면을 끄지 않은 밤이라면 개입과 개입 사이에 **실제로 흐른 시간만큼**
 *     분 수가 늘어 있어야 한다(Guard 자신이 붙잡고 있던 몫만 빼고). 안 늘면
 *     *"3번째"* 와 *"15분째"* 가 한 문장에서 서로를 반박한다.
 *   ⚠️ **개수를 세지 않는다**(AGENT-CHAIN §8) — *"몇 번 커졌나"* 가 아니라
 *      **그 발동 하나에서 얼마나 커졌는가**를 본다. */
const t69Grew = t69Ran ? t69Fires.slice(1).map((f, i) => ({
  n: i + 2, 잰것: t69MsgAt[i + 1] - t69MsgAt[i], 흐른것: f - t69Fires[i] - t69Hold,
})) : [];
ok("5 ★ 한 문장의 두 수가 서로 모순되지 않는다 — 순번이 오르면 분도 흐른 만큼 오른다 (본체)",
  t69Grew.length > 0 && t69Grew.every((g) => g.잰것 >= g.흐른것),
  t69Grew.map((g) => `${g.n}번째 +${g.잰것}분(흐른것 ${g.흐른것})`).join(" · ") || "옮기기 실패");

/* 5의 짝 ★ **이 장치가 그 결함을 실제로 잡는가.** 3·4·5가 전부 옮겨 돌리므로, 옮기는 장치가
 *   눈멀면 셋이 조용히 초록이 된다. **옛 구현을 그대로 넣어** 본다 — 옛 문구가 실은 값은
 *   게이트의 그 값이었고, 그러면 *"3번째인데 23분째"* 가 나와야 한다.
 *   ⚠️ **여기서 *"새 값이 옛 값보다 크다"* 를 세지 않는다** — 그건 5의 주장이고, 함께 세면
 *      문구 값을 되돌리는 변이에 **5와 이 짝이 같이 죽어** 장치가 눈먼 것인지 값이 틀린
 *      것인지 못 가른다(AGENT-CHAIN §8 · T-68이 두 번 좁힌 그 모양). */
const t69OldAt = t69Ran ? t69Fires.map((f) => t69See(t69Gate0, f, t69W)) : [];
const t69OldGrew = t69Ran
  ? t69Fires.slice(1).map((f, i) => t69OldAt[i + 1] - t69OldAt[i] >= f - t69Fires[i] - t69Hold)
  : [];
ok("5 ★ 5의 장치가 살아 있다 — 옛 규칙(개입 뒤 0)을 넣으면 모순이 잡힌다",
  t69Ran && t69OldGrew.some((g) => g === false),
  `옛값=${JSON.stringify(t69OldAt)} 새값=${JSON.stringify(t69MsgAt)}`);

/* 6 ★ **재확인 문구가 그 레벨의 실제 버튼 이름을 말한다.** Level 2의 버튼은 [확인]인데
 *   문구는 [알겠습니다]라고 못 박고 있었다 — **사용자가 누른 적 없는 이름**이다.
 *   ★ 이름의 주인이 하나인지까지 본다: `acceptLabel`의 Level 3+ 값이 레이아웃의
 *     `android:text`와 같아야 하고(갈라지면 화면과 문구가 다른 말을 한다),
 *     재확인은 **리터럴을 안 든다**. */
const t69LabelFn = /fun acceptLabel\(level: Int\): String = if \(level < 3\) "([^"]+)" else "([^"]+)"/
  .exec(t46Bare(t69Raw("GuardAlertActivity.kt")));
const t69Xml = /android:id="@\+id\/guard_accept"[\s\S]*?android:text="([^"]+)"/
  .exec(t68Layout)?.[1] ?? null;
const t69Msg = /GuardNotifications\.fire\(([\s\S]*?)\n {8}\)/.exec(t69Recheck)?.[1] ?? "";
ok("6 재확인 문구가 그 레벨의 실제 버튼 이름을 말한다",
  !!t69LabelFn && t69LabelFn[1] !== t69LabelFn[2] && t69LabelFn[2] === t69Xml
  && /\[\$label\]/.test(t69Msg) && !/알겠습니다|확인\]/.test(t69Msg)
  && /val label = GuardAlertActivity\.acceptLabel\(level\)/.test(t69Recheck),
  `L2="${t69LabelFn?.[1]}" L3+="${t69LabelFn?.[2]}" xml="${t69Xml}"`
  + ` 문구="${t69Msg.trim().replace(/\s+/g, " ").slice(0, 64)}"`);

/* 7 ★ **두 계수가 서로 다른 이름을 갖고, 각 주석이 상대편을 가리킨다** (스캐너).
 *   ⚠️ 이름이 같거나 뜻이 안 적히면 **다음 사람이 둘을 합친다**(함정 15) — 그리고 합치는
 *      순간 밤 상한이 재확인까지 세어 **발동이 줄어든다.** 조용한 동작 변경이다.
 *   ★ *"뜻이 적혔는가"* 를 낱말로 안 센다: **선언 바로 위의 주석이 상대편 계수를 가리키는가**로
 *     본다. 서로를 가리키면 읽는 사람이 **둘이 있다는 것을 반드시 본다.**
 *   ⚠️ **문구가 지금 어느 쪽을 읽는지는 안 본다** — 그건 1의 몫이다. 여기가 세는 것은
 *      *"세는 자리가 둘이고 이름이 다르다"* 하나이고, 그래야 둘을 합치는 변이에 혼자 죽는다. */
const t69KeyVal = (src, k) => new RegExp(`const val ${k} = "(\\w+)"`).exec(src)?.[1] ?? null;
const t69MsgK = /putInt\((K_\w+), n \+ 1\)/.exec(t68OwnerSrc)?.[1] ?? null;
const t69MsgVal = t69MsgK ? t69KeyVal(t69Raw(`${t68Bumper}.kt`), t69MsgK) : null;
/** 선언 **바로 위**의 주석 덩어리. 멀리서 우연히 걸리지 않게 400자로 끊는다. */
const t69DocOf = (src, k) => {
  const i = src.indexOf(`const val ${k} =`);
  return i < 0 ? "" : src.slice(Math.max(0, i - 400), i);
};
const t69CapPointsMsg = !!t69CapK && !!t69MsgVal
  && new RegExp(`${t68Bumper}|${t69MsgVal}`).test(t69DocOf(t69Raw("GuardWatch.kt"), t69CapK));
const t69MsgPointsCap = !!t69MsgK && !!t69CapVal
  && new RegExp(`${t69CapK}|${t69CapVal}`).test(t69DocOf(t69Raw(`${t68Bumper}.kt`), t69MsgK));
ok("7 ★ 두 계수가 서로 다른 이름을 갖고, 각 주석이 상대편을 가리킨다 (스캐너 · 합치기 방지)",
  !!t69CapVal && !!t69MsgVal && t69CapVal !== t69MsgVal
  && t69CapPointsMsg && t69MsgPointsCap,
  `상한="${t69CapVal}" 문구="${t69MsgVal}"`
  + ` 상한→문구=${t69CapPointsMsg} 문구→상한=${t69MsgPointsCap}`);

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
  bridgeFetch(w2, () => Promise.reject(new Error("연결 거부")));
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

// **요약은 `emitSummary` 하나가 낸다** (T-67). 예전엔 여기서 직접 찍고 `process.exit(1)`을
// 불렀는데, 그러면 **요약을 내는 자리가 둘**(정상 끝 · 중단)이 되어 한쪽만 낡는다.
// 성공 경로에도 명시적으로 끝낸다 — `pretendToBeVisual` jsdom 두 개가 rAF 타이머를 계속
// 돌려 이벤트 루프가 안 비므로, 요약을 찍고도 프로세스가 살아 있었다(T-06이 없앤 그 hang).
// 파이프로 나가는 stdout은 비동기라 write 콜백에서 나간다 — 요약이 잘리면 숫자를 잃는다.
emitSummary();
