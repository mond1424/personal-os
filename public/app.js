/* app.js — 상태 관리 + 렌더링. UI/동작은 목업 그대로, 데이터만 API.
 * 구조: 순수 헬퍼 → 상태(S) → 렌더 → 액션 → 부트.
 * 화면은 전부 원본의 조인 뷰(설계 1.1) — 여기서도 저장 없이 그리기만 한다. */

/* ── 순수 헬퍼 ─────────────────────────────────────────── */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function addDaysStr(d, n) {
  const t = new Date(d + "T00:00:00Z");
  // 날짜가 아직 없을 때 여기서 터지면 "Invalid time value"가 그대로 노출된다
  if (Number.isNaN(t.getTime())) throw new Error("날짜를 아직 못 받았어요 — 잠시 후 다시 시도해 주세요");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const diffDaysStr = (a, b) =>
  Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
const md = (d) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const dowIdx = (d) => new Date(d + "T00:00:00Z").getUTCDay();
const dlabel = (d) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일 ${"일월화수목금토"[dowIdx(d)]}`;
const DOW_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const hm = (ts) => (ts && ts.length >= 16 ? ts.slice(11, 16) : ts || "—");
function isoNowLocal() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset(), sg = off >= 0 ? "+" : "-", a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sg}${p(a / 60 | 0)}:${p(a % 60)}`;
}
const WAIT_LIMIT = 21;   // 대기 최대 체류 (1.4) — 연장은 여기 닿았을 때만 의미가 있다
const ageClass = (a) => (a >= 15 ? "age3" : a >= 8 ? "age2" : "age1");
/* 월 그리드의 주(일요일 시작) 배열 — 앞뒤 채움 포함 */
/* 달 그리드는 **항상 6주**로 고정한다. 실제 주 수는 4~6주로 들쭉날쭉해서
 * (2026년 2월은 4주다) 달을 넘길 때마다 높이가 튀었고, 옆으로 미는 전환은
 * 높이가 일정해야 성립한다. 남는 칸은 앞뒤 달 날짜로 채워 mut 처리된다. */
const WEEKS_IN_GRID = 6;
function weeksOf(y, m) {
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  let cur = addDaysStr(first, -dowIdx(first));
  const weeks = [];
  for (let w = 0; w < WEEKS_IN_GRID; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) { row.push(cur); cur = addDaysStr(cur, 1); }
    weeks.push(row);
  }
  return weeks;
}
/* 달 더하기 — 연도 넘김 포함 */
const addMonth = (y, m, n) => {
  const k = m - 1 + n;
  return { y: y + Math.floor(k / 12), m: ((k % 12) + 12) % 12 + 1 };
};

/* 경계선 모델 (2.2) — 규칙을 다시 세움.
 *  · 밴드는 셀 높이를 꽉 채운다 (아래 배경으로 깔리므로 흰 틈이 보이면 안 된다).
 *  · 활성 기간이 n개인 구간은 밴드를 n등분, created_at 순으로 위→아래.
 *  · 이웃 날과 배치가 달라지는 지점에서만 반 칸 폭의 S-곡선으로 이동한다.
 *  · 시작·끝에서 이웃이 없으면(그 날 다른 기간이 없으면) 곡선 없이 수직으로 잘라 칸을 채운다.
 *  · 이웃이 있으면 '그 기간이 끼어들 자리의 경계'로 수렴한다 — 이웃의 경계 곡선과
 *    같은 구간·같은 곡선을 쓰므로 두 밴드가 어긋나거나 교차하지 않는다. */
const H_BAND = 96, W_CELL = 100, HALF = 25;
/* 둥근 마감(cap) 반지름. viewBox가 preserveAspectRatio="none"으로 늘어나기 때문에
 * 세로는 그대로(96 ↔ 96px)지만 가로는 700 ↔ 실제 폭 비율만큼 키워야 원형으로 보인다.
 * 실제 폭을 못 재는 환경(jsdom 등)에서는 폰 기본 폭으로 근사한다. */
const CAP_RY = 7;
const capRx = (px) => CAP_RY * (700 / (px || 370));
const pkey = (p) => `${p.created_at || ""}|${p.id || ""}`;

function bandPaths(dates, periods, rx = capRx(0)) {
  const active = dates.map((d) =>
    periods.filter((p) => p.start_date <= d && d <= p.end_date)
      .sort((a, b) => (pkey(a) < pkey(b) ? -1 : pkey(a) > pkey(b) ? 1 : 0)));
  const S = (xa, ya, xb, yb) => ` C${(xa + xb) / 2},${ya} ${(xa + xb) / 2},${yb} ${xb},${yb}`;
  const out = [];

  for (const p of periods) {
    let a = -1, b = -1;
    dates.forEach((d, i) => { if (active[i].includes(p)) { if (a < 0) a = i; b = i; } });
    if (a < 0) continue;

    const top = [], bot = [];
    for (let i = a; i <= b; i++) {
      const n = active[i].length, k = active[i].indexOf(p);
      top[i] = (H_BAND * k) / n;
      bot[i] = (H_BAND * (k + 1)) / n;
    }
    // 이웃 날에서 이 기간이 들어갈 자리(경계 y). 그 날 기간이 없으면 null = 수직 절단.
    const collapseAt = (j) => {
      if (j < 0 || j >= dates.length || !active[j].length) return null;
      const above = active[j].filter((q) => pkey(q) < pkey(p)).length;
      return (H_BAND * above) / active[j].length;
    };
    const cl = collapseAt(a - 1), cr = collapseAt(b + 1);
    const xL = a * W_CELL, xR = (b + 1) * W_CELL;

    /* 수직 절단면을 둥글게 — 단 '기간이 실제로 시작·끝나는' 면에만.
     * 주(행) 경계에서 잘린 면은 다음 줄로 이어지는 중이므로 각지게 둔다.
     * 여기까지 둥글게 하면 배경이 아니라 매주 끊긴 알약처럼 보인다. */
    const rxc = Math.min(rx, (xR - xL) / 2);
    const cap = (i) => ({ x: rxc, y: Math.min(CAP_RY, (bot[i] - top[i]) / 2) });
    const rL = cl == null && dates[a] === p.start_date ? cap(a) : null;
    const rR = cr == null && dates[b] === p.end_date ? cap(b) : null;

    let d = cl != null ? `M${xL - HALF},${cl}` + S(xL - HALF, cl, xL + HALF, top[a])
      : rL ? `M${xL + rL.x},${top[a]}`
        : `M${xL},${top[a]}`;
    for (let i = a; i < b; i++) {                      // 위 가장자리 →
      const x = (i + 1) * W_CELL;
      d += ` L${x - HALF},${top[i]}`;
      d += top[i + 1] !== top[i] ? S(x - HALF, top[i], x + HALF, top[i + 1]) : ` L${x + HALF},${top[i + 1]}`;
    }
    if (cr != null) d += ` L${xR - HALF},${top[b]}` + S(xR - HALF, top[b], xR + HALF, cr) + S(xR + HALF, cr, xR - HALF, bot[b]);
    else if (rR) d += ` L${xR - rR.x},${top[b]} Q${xR},${top[b]} ${xR},${top[b] + rR.y}` +
                      ` L${xR},${bot[b] - rR.y} Q${xR},${bot[b]} ${xR - rR.x},${bot[b]}`;
    else d += ` L${xR},${top[b]} L${xR},${bot[b]}`;
    for (let i = b; i > a; i--) {                      // 아래 가장자리 ←
      const x = i * W_CELL;
      d += ` L${x + HALF},${bot[i]}`;
      d += bot[i - 1] !== bot[i] ? S(x + HALF, bot[i], x - HALF, bot[i - 1]) : ` L${x - HALF},${bot[i - 1]}`;
    }
    d += cl != null ? ` L${xL + HALF},${bot[a]}` + S(xL + HALF, bot[a], xL - HALF, cl) + " Z"
      : rL ? ` L${xL + rL.x},${bot[a]} Q${xL},${bot[a]} ${xL},${bot[a] - rL.y}` +
             ` L${xL},${top[a] + rL.y} Q${xL},${top[a]} ${xL + rL.x},${top[a]} Z`
        : ` L${xL},${bot[a]} Z`;
    out.push({ d, fill: p.color, id: p.id });
  }
  return out;
}


/* ── 트랙 전환 엔진 (탭·달력 공용) ──────────────────────────
 * 끄는 동안은 손가락을 1:1로 따라오고, 놓으면 이어서 미끄러진다.
 * 위치는 %, 손가락분만 px — calc로 섞는다. 폭을 재지 않으므로 회전·리사이즈에 강하고,
 * 레이아웃이 없는 환경에서도 인덱스 상태가 그대로 성립한다.
 * 판정은 거리(25%)와 속도(플릭) 둘 중 하나만 넘으면 된다 — 짧고 빠른 손짓도 넘어가야 한다. */
const TRACK_MS = 300, TRACK_EASE = "cubic-bezier(.22,.61,.36,1)";
const TRACK_RATIO = 0.35, FLICK_V = 0.5;   // 화면 폭 비율 · px/ms — 민감도 하향(A-5, 폰 실측 미세조정 예정)
const CAL_GAP = 20;   // 캘린더 달 사이 간격(px). 탭 트랙은 gap=0(불변), 캘린더만 gap 보정을 탄다

// gap>0이면 pane 사이 간격(px)을 위치 계산에 더한다 — %만으로는 gap이 어긋난다
function trackSet(el, i, animate, gap = 0) {
  if (!el) return;
  el.style.transition = animate ? `transform ${TRACK_MS}ms ${TRACK_EASE}` : "none";
  el.style.transform = gap ? `translateX(calc(${-i * 100}% - ${i * gap}px))` : `translateX(${-i * 100}%)`;
}
function trackDrag(el, i, dx, gap = 0) {
  if (!el) return;
  el.style.transition = "none";
  el.style.transform = `translateX(calc(${-i * 100}% - ${i * gap}px + ${dx}px))`;
}
/* 놓는 방향 — 속도가 충분하면 거리가 짧아도 넘긴다 */
function trackDir(dx, vel, width) {
  if (Math.abs(vel) > FLICK_V) return vel < 0 ? 1 : -1;
  if (Math.abs(dx) > width * TRACK_RATIO) return dx < 0 ? 1 : -1;
  return 0;
}
/* nav 표식 — 폭이 정확히 한 칸(20%)이라 소수 인덱스를 그대로 넣으면 된다 */
function navSlide(p, animate) {
  const d = $("#nav-dot");
  if (!d) return;
  d.style.transition = animate ? `transform ${TRACK_MS}ms ${TRACK_EASE}` : "none";
  d.style.transform = `translateX(${p * 100}%)`;
  const near = Math.max(0, Math.min(TAB_ORDER.length - 1, Math.round(p)));
  $$("nav button").forEach((b, i) => b.classList.toggle("on", i === near));
}

/* ── 상태 ──────────────────────────────────────────────── */
const S = {
  today: null,          // GET /api/today
  periods: [],          // GET /api/periods (달성률·경과 포함)
  settings: {},         // key→value
  cal: { y: 0, m: 0 },  // 표시 중인 달
  calData: null,
  pick: null,           // {mode:'defer'|'schedule', id, title, from?, origin}
  sheetTask: null,
  staleShown: false,
};
const periodInfo = (id) => S.periods.find((p) => p.id === id) || null;
const feelingsFields = () => {
  try { return JSON.parse(S.settings.feelings_fields || "[]"); } catch { return []; }
};

/* ── DOM ───────────────────────────────────────────────── */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let toastTimer = null;
/** kind: info(기본) · ok(성공) · warn(주의) · err(실패) */
function toast(msg, kind = "info") {
  const el = $("#toast");
  el.className = "lockbar toast " + kind;
  el.textContent = msg;
  el.style.display = "none";       // 애니메이션 재시작
  void el.offsetWidth;
  el.style.display = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), kind === "err" ? 4200 : 3000);
}
const run = (fn) => Promise.resolve().then(fn).catch((e) => toast(e.message, "err"));

/* 확인 모달 — 되돌릴 수 없는 동작 앞에 한 번 물어본다 */
function confirmAsk(title, text, okLabel = "확인", altLabel = null) {
  return new Promise((resolve) => {
    $("#cf-title").textContent = title;
    $("#cf-text").innerHTML = text;
    $("#cf-yes").textContent = okLabel;
    const alt = $("#cf-alt");
    alt.style.display = altLabel ? "" : "none";
    alt.textContent = altLabel || "";
    const done = (v) => { $("#confirm").classList.remove("on"); resolve(v); };
    $("#cf-yes").onclick = () => done("ok");
    $("#cf-alt").onclick = () => done("alt");
    $("#cf-no").onclick = () => done(false);
    $("#confirm").classList.add("on");
  });
}

/* 테마 — 기기 설정(localStorage). 'auto'면 OS를 따른다 */
function applyTheme(v) {
  const t = v || localStorage.getItem("theme") || "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content",
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() || "#FBFAF7");
}

/* 첫 실행 튜토리얼 — 화면 이름이 아니라 '무엇을 위한 도구인지'를 먼저 말한다 */
const TUT = [
  ["기록이 아니라 판단을 돕는 도구", "일정과 일기를 남기는 건 수단이에요. 목적은 <b>장기 목표와 지금의 행동이 어긋나는 순간</b>을 알아차리는 것."],
  ["Today — 쓰는 곳", "할 일 체크, 기분 눈금, 그리고 <b>Log</b>. Log는 결과가 아니라 과정을 남겨요 — 나중에 패턴이 보이는 건 여기서예요. 하루가 끝나면 마감해서 기록을 봉인해요."],
  ["Calendar — 보는 곳", "기간은 형광펜처럼 깔리고, 날짜를 누르면 그날의 일정·일기가 열려요. 지난 날은 고쳐 쓸 수 없고 memo만 덧붙일 수 있어요."],
  ["Works — 정리하는 곳", "날짜를 안 정한 일은 <b>대기</b>에 담아요. 21일이 넘으면 결정을 요구해요. 미루기는 복사가 아니라 같은 일의 이동이라, 몇 번 미뤘는지가 그대로 신호가 돼요."],
  ["Analysis · Me", "분석은 자동으로 돌지 않아요 — 물어볼 때만. Me는 모든 분석의 장기 맥락이니 신중히 적어요."],
];
let tutStep = 0;
function showTutorial(from = 0) {
  tutStep = from;
  renderTut();
  $("#tut").classList.add("on");
}
function renderTut() {
  const [h, p] = TUT[tutStep];
  $("#tut-h").textContent = h;
  $("#tut-p").innerHTML = p;
  $("#tut-dots").innerHTML = TUT.map((_, i) => `<i class="${i === tutStep ? "on" : ""}"></i>`).join("");
  $("#tut-next").textContent = tutStep === TUT.length - 1 ? "시작하기" : "다음";
}
function endTutorial() {
  $("#tut").classList.remove("on");
  localStorage.setItem("tutorial_done", "1");
}

function openSheet(id) { $("#bk").classList.add("on"); $("#" + id).classList.add("on"); }
function closeSheet(id) { $("#" + id).classList.remove("on"); }   // 겹쳐 뜬 시트 하나만
function closeAll() {
  $("#bk").classList.remove("on");
  $$(".sheet").forEach((s) => s.classList.remove("on"));
  evxCtx = null; dfxCtx = null;   // 배경 탭으로 닫아도 진행 중인 입력은 버린다
}

/* ── Today ─────────────────────────────────────────────── */
async function refreshToday() {
  S.today = await Api.today();
  renderToday();
  loadNotice();
  if (!S.staleShown && S.today.overdue.length) { S.staleShown = true; showStale(S.today.overdue[0]); }
}

function renderToday() {
  const T = S.today, d = T.date;
  $("#td-month").textContent = `${d.slice(0, 4)} . ${d.slice(5, 7)}`;
  $("#td-day").textContent = +d.slice(8, 10);
  $("#td-dow").textContent = DOW_FULL[dowIdx(d)];
  $("#td-boundary").textContent = `경계 ${T.boundary}`;
  $("#log-cap").textContent = `${T.boundary} 이전 새벽 기록은 전날로`;
  $("#close-cap").textContent = `미마감 시 ${T.boundary} 자동 마감`;

  // 헤더 칩 = 활성 기간 조인
  $("#td-chips").innerHTML = T.periods.map((p) =>
    `<span class="chip"><i class="dot" style="background:${p.color}"></i>${esc(p.title)}` +
    (p.d_end === 0 ? " · 마지막 날" : "") + `</span>`).join("");

  // 오늘의 일정 — 할 일 위에, 사건으로 따로
  const evsToday = T.events || [];
  const evBox = $("#td-events");
  if (evsToday.length) {
    evBox.style.display = "";
    evBox.innerHTML = `<div class="sec-h"><span class="sec-t">일정</span><span class="cnt">${evsToday.length} · 캘린더에서 관리</span></div>
      <div class="card" style="padding:4px 14px">` + evsToday.map((e) =>
        `<div class="evrow"><span class="et mono">${e.time || "종일"}</span><span class="en">${esc(e.title)}</span></div>`).join("") + `</div>`;
  } else evBox.style.display = "none";

  // TODO / Done / 재배정 대기
  $("#td-cnt").textContent = `${T.todo.length} · tasks 조인 뷰`;
  let h = T.todo.map((t) => {
    const per = periodInfo(t.period_id);
    const meta = [
      per ? `<i class="pdot" style="background:${per.color}"></i>${esc(per.title)}` : "",
      t.defer_count > 0 ? `${t.defer_count}회 이월` : "오늘",
    ].filter(Boolean).join(" · ");
    return `<div class="trow">
      <button class="tk" onclick="completeRow('${t.id}')" title="완료"></button>
      <button class="tbody" style="text-align:left" onclick="openTask('${t.id}')">
        <span class="tt">${esc(t.title)}${t.defer_count > 0 ? '<span class="warn">!</span>' : ""}</span>
        <span class="tmeta">${meta}</span></button>
      ${t.rate ? `<span class="ratepct">${t.rate}%</span>` : ""}</div>`;
  }).join("");
  if (T.done.length) {
    h += `<details class="fold" open><summary>Done ${T.done.length} — 오늘 완료</summary>` +
      T.done.map((t) =>
        `<div class="trow muted"><span class="tk done"></span>
          <span class="tbody"><span class="tt">${esc(t.title)}</span></span></div>`).join("") +
      `</details>`;
  }
  h += T.reassign.map((r) =>
    `<div class="trow"><span class="tk"></span>
      <span class="tbody"><span class="tt" style="color:var(--sub)">${esc(r.title)}${r.defer_count > 0 ? '<span class="warn">!</span>' : ""}</span>
        <span class="tmeta">${md(r.latest_date)} Missed 확정${r.defer_count > 0 ? ` · ${r.defer_count}회 이월` : ""} — 재배정 대기</span></span>
      <button class="deferchip" onclick="pickReassign('${r.id}')">미루기 →</button></div>`).join("");
  if (!h) h = `<div class="trow"><span class="tbody"><span class="tmeta">오늘 예정이 없어요 — Works의 +로 추가</span></span></div>`;
  $("#td-list").innerHTML = h;

  // 대기 상시 행
  const W = T.waiting, tw = $("#today-wait");
  if (W.n) {
    tw.style.display = "flex";
    $("#tw-text").innerHTML =
      `<b style="color:var(--ink)">대기 ${W.n}</b> — ${esc(W.top.title)} <b class="${ageClass(W.max_age)}">${W.max_age}일째</b>`;
  } else tw.style.display = "none";

  renderFeelings();
  renderLogs();
  renderScore();

  const closed = T.daily && T.daily.status === "closed";
  const bc = $("#btn-close");
  bc.disabled = !!closed;
  bc.style.opacity = closed ? ".45" : "";
  $("#btn-close-brief").style.display = closed ? "none" : "";
  if (closed) $("#close-cap").textContent = "마감됨 — memo만 추가";
  // 마감 후에는 하단 입력줄이 memo 입력이 된다 (1.3 — 추가만 가능)
  $("#log-input").placeholder = closed ? "memo 추가…" : "지금 기록…";
  $("#log-send").textContent = closed ? "memo" : "기록";
}

function renderFeelings() {
  const vals = Object.fromEntries(S.today.feelings.map((f) => [f.field, f.value]));
  $("#feel-s").innerHTML = feelingsFields().map((f, i) => `
    <div class="frow"${i === 0 ? ' style="margin-top:2px"' : ""}>
      <span class="fl">${esc(f)}</span>
      <div class="likert" data-field="${esc(f)}"></div>
      <b>${vals[f] ?? "—"}</b>
    </div>`).join("");
  $$("#feel-s .likert").forEach((L) => {
    const field = L.dataset.field, cur = vals[field];
    for (let i = 1; i <= 10; i++) {
      const b = document.createElement("button");
      b.className = "lk" + (i === Math.round(cur) ? " on" : "");
      b.dataset.n = i;
      b.onclick = () => run(async () => {
        await Api.feelings({ [field]: i });
        L.querySelectorAll(".lk").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        L.parentElement.querySelector("b").textContent = i;
      });
      L.appendChild(b);
    }
  });
  const ta = $("#feel-text");
  if (document.activeElement !== ta) ta.value = (S.today.daily && S.today.daily.feelings_text) || "";
}

function renderLogs() {
  const closed = S.today.daily && S.today.daily.status === "closed";
  const rows = S.today.logs.map((l) => closed
    ? `<div class="lrow"><span class="ts mono">${hm(l.ts)}</span><span>${esc(l.text)}</span></div>`
    : `<button class="lrow" style="width:100%" onclick="openLog(${l.id})"><span class="ts mono">${hm(l.ts)}</span><span>${esc(l.text)}</span></button>`);
  $("#td-logs").innerHTML = rows.join("") ||
    `<div class="lrow"><span class="ts mono">—</span><span style="color:var(--faint)">아직 기록이 없어요 — 아래 입력줄로</span></div>`;
}

async function loadNotice() {
  const y = addDaysStr(S.today.date, -1);
  try {
    const day = await Api.day(y);
    if (day.daily && day.daily.close_kind === "auto") {
      $("#td-notice-text").textContent = `어제(${md(y)})는 ${S.today.boundary}에 자동 마감됐어요.`;
      $("#td-notice-btn").onclick = () => openDay(y);
      $("#td-notice").style.display = "";
      return;
    }
  } catch { /* 무시 */ }
  $("#td-notice").style.display = "none";
}

/* Score 막대 — 최근 2주 + 오늘 칸 탭·드래그 */
let scoreDirty = null;
/* 막대는 즉시 그리고, 지난 점수는 도착하는 대로 채운다 (빈 칸이 잠깐 보이지 않게) */
function renderScore() {
  paintScore();
  Api.diary(30)
    .then((rows) => { S.diaryCache = Object.fromEntries(rows.map((r) => [r.date, r.score])); paintScore(); })
    .catch(() => { /* 조용히 — 점수 막대는 보조 정보 */ });
}

function paintScore() {
  const D = S.today.date;
  const map = S.diaryCache || {};
  let h = "";
  for (let i = 13; i >= 1; i--) {
    const d = addDaysStr(D, -i), v = map[d] ?? 0;
    h += `<div class="bcol"><span class="bwrap"><i class="bbar" style="height:${v * 10}%"></i></span><span class="bl">${+d.slice(8, 10)}</span></div>`;
  }
  const today = (S.today.daily && S.today.daily.score) || 0;
  h += `<div class="bcol today"><button class="bwrap" id="bc-wrap"><i class="bbar" id="bc-bar" style="height:${today * 10}%"></i></button><span class="bl">${+D.slice(8, 10)}</span></div>`;
  const bch = $("#bchart");
  bch.innerHTML = h;
  bch.scrollLeft = bch.scrollWidth;
  $("#sc-num").textContent = today || "—";

  const bw = $("#bc-wrap");
  const setScore = (e) => {
    const r = bw.getBoundingClientRect();
    const v = Math.min(10, Math.max(1, Math.round((1 - (e.clientY - r.top) / r.height) * 10)));
    $("#bc-bar").style.height = v * 10 + "%";
    $("#sc-num").textContent = v;
    scoreDirty = v;
  };
  bw.addEventListener("pointerdown", (e) => { bw.setPointerCapture(e.pointerId); setScore(e); });
  bw.addEventListener("pointermove", (e) => { if (e.buttons) setScore(e); });
  bw.addEventListener("pointerup", () => {
    if (scoreDirty == null) return;
    const v = scoreDirty; scoreDirty = null;
    run(async () => { await Api.score(v); S.today.daily = { ...(S.today.daily || {}), score: v, status: (S.today.daily && S.today.daily.status) || "open" }; });
  });
}

/* ── 날짜 팝업 (E — 조인 조립) ─────────────────────────── */
async function openDay(k) {
  if (S.pick) { if (pickable(k)) assignDate(k); return; }
  await run(async () => {
    const day = await Api.day(k);
    const D = S.today.date;
    let h = `<div class="sh-t">${dlabel(k)}</div>`;
    const st = day.relation === "today" ? "작성 중"
      : day.relation === "future" ? "예정"
      : day.daily ? (day.daily.close_kind === "auto" ? `${S.today.boundary} 자동 마감` : "확정 기록") : "";
    if (st) h += `<p class="cap" style="margin-top:3px">${st}</p>`;

    if (day.periods.length)
      h += `<div class="dchips" style="margin-top:10px">` + day.periods.map((p) =>
        `<span class="chip"><i class="dot" style="background:${p.color}"></i>${esc(p.title)}</span>`).join("") + `</div>`;

    if (day.tasks.length) {
      // 지난 날은 읽기, 오늘·앞으로는 눌러서 바로 편집 (Today 탭까지 가지 않아도 된다)
      const editable = day.relation !== "past";
      h += `<div class="card" style="margin-top:12px;padding:6px 14px">` + day.tasks.map((t) => {
        const per = periodInfo(t.period_id);
        const tag = day.relation === "past"
          ? { done: "완료", deferred: `→ ${t.deferred_to ? md(t.deferred_to) : "미룸"}`, missed: "missed", todo: "" }[t.class]
          : t.class === "done" ? "완료" : t.deferred_to ? `→ ${md(t.deferred_to)}` : `${t.rate ?? 0}%`;
        const fin = t.class === "done" || t.status === "finished";
        const inner = `<span class="ts mono">${t.rate != null && day.relation !== "past" ? "" : "—"}</span><span><i class="pdot" style="display:inline-block;background:${per ? per.color : "var(--faint)"};margin-right:6px"></i>${esc(t.title)}${tag ? ` <span class="cap">${tag}</span>` : ""}</span>`;
        const cls = "lrow" + (fin ? " done-line" : "");
        return editable
          ? `<button class="${cls}" style="width:100%" onclick="closeAll();openTask('${t.id}')">${inner}</button>`
          : `<div class="${cls}">${inner}</div>`;
      }).join("") + `</div>`;
    } else if (!day.daily && day.relation !== "today") {
      h += `<div class="card" style="margin-top:12px"><p class="abody" style="margin:0">${day.relation === "future" ? "이 날의 일정이 없어요" : "이 날의 일기·일정이 없어요"}</p></div>`;
    }

    if (day.relation === "past" && day.daily) {
      const done = day.tasks.filter((t) => t.class === "done").length;
      const missed = day.tasks.filter((t) => t.class === "missed").length;
      const fl = day.feelings.map((f) => `${f.field[0].toUpperCase()}${f.value}`).join(" · ");
      h += `<div class="card" style="margin-top:10px"><p class="abody" style="margin:0">Done ${done} · Missed ${missed} · score ${day.daily.score ?? "—"}${fl ? "<br>" + fl : ""}</p></div>`;
      if (day.logs.length)
        h += `<div class="card" style="margin-top:9px;padding:6px 14px">` + day.logs.map((l) =>
          `<div class="lrow"><span class="ts mono">${hm(l.ts)}</span><span>${esc(l.text)}</span></div>`).join("") + `</div>`;
      if (day.memos.length)
        h += `<div class="card" style="margin-top:9px;padding:6px 14px">` + day.memos.map((m) =>
          `<div class="lrow"><span class="ts mono">${hm(m.ts)}</span><span>${esc(m.text)} <span class="cap">memo</span></span></div>`).join("") + `</div>`;
      h += `<div class="memobox">
          <span class="mtime mono">${hm(isoNowLocal())}</span>
          <input type="text" id="memo-input" placeholder="memo 추가">
          <button class="mok" onclick="sendMemo('${k}')">확인</button>
        </div>
        <p class="cap" style="margin-top:7px">확정 기록 — 수정 불가, memo만 추가. 추가 시 해당 summary는 stale 처리돼요.</p>`;
    }
    // 일정 — 캘린더에서만 다루는 사건 (할 일과 분리).
    // 마감된 날에도 일정은 추가할 수 있다 (1.3 "과거엔 추가만 가능") — 단 추가하면 수정·삭제가
    // 막히므로 시트에서 경고한다. 삭제(×)는 '마감 안 된 날'에만 보인다(마감된 날은 트리거가 막는다).
    const evs = day.events || [];
    const closed = !!(day.daily && day.daily.status === "closed");
    h += `<div class="sec-h" style="margin-top:16px"><span class="sec-t">일정</span><span class="cnt">${evs.length}</span></div>`;
    h += `<div class="card" style="padding:4px 14px">` + (evs.map((e) =>
      `<div class="evrow"><span class="et mono">${e.time || "종일"}</span><span class="en">${esc(e.title)}</span>` +
      (closed ? "" : `<button class="ex" onclick="removeEvent('${e.id}','${k}')">×</button>`) + `</div>`).join("")
      || `<div class="evrow"><span class="cap">이 날의 일정이 없어요</span></div>`) + `</div>`;
    h += `<button class="btn ghost" style="margin-top:10px" id="ev-add" onclick="openEventSheet('${k}',${closed})">+ 일정 추가</button>`;
    if (day.relation !== "past")
      h += `<div class="sec-h" style="margin-top:16px"><span class="sec-t">할 일</span><span class="cnt">완료율·미루기가 있는 항목</span></div>
            <div class="addrow">
              <input type="text" class="n" id="day-add" placeholder="할 일 추가">
              <button class="mok" onclick="addTaskOn('${k}')">추가</button>
            </div>`;
    if (day.relation === "today")
      h += `<button class="btn ghost" style="margin-top:10px" onclick="closeAll();switchTab('today')">Today 탭 열기 — 기분·Log·마감</button>`;
    $("#day-body").innerHTML = h;
    openSheet("sh-day");
  });
}

function removeEvent(id, k) {
  run(async () => {
    const r = await confirmAsk("이 일정을 지울까요?", "일정은 '있었던 일'이라 마감된 날에서는 지울 수 없어요.", "지우기");
    if (r !== "ok") return;
    await Api.deleteEvent(id);
    toast("일정을 지웠어요", "warn");
    await Promise.all([refreshToday(), renderCalendar()]);
    openDay(k);
  });
}

function addTaskOn(k) {
  const v = $("#day-add").value.trim();
  if (!v) return;
  run(async () => {
    await Api.createTask({ title: v, date: k });
    toast(`${md(k)}에 추가했어요`);
    await Promise.all([refreshToday(), renderCalendar()]);
    openDay(k);
  });
}

function sendMemo(k) {
  const v = $("#memo-input").value.trim();
  if (!v) return;
  run(async () => {
    await Api.memo(k, isoNowLocal(), v);
    toast("memo 추가 — summary는 stale 처리됐어요", "ok");
    openDay(k);
  });
}


/* ── 시각 드럼 (1.7) ──────────────────────────────────────
 * 폰에서 "09:00"을 타이핑하는 건 손이 많이 간다 — 돌리거나 눌러서 고른다.
 * 값은 스크롤 위치에서 읽지 않고 상태(dialSt)에 들고 있는다:
 *   · 탭으로도 고를 수 있어야 하고,
 *   · 레이아웃이 없는 환경에서는 scrollTop이 늘 0이라 위치가 값이 될 수 없다.
 * 위치는 scrollTop으로만 옮긴다 — scrollIntoView는 .phone(overflow:hidden)을 통째로 민다. */
const DIAL_H = 38;
let dialSt = null;   // { h, m }

const pad2 = (n) => String(n).padStart(2, "0");
const dialValue = () => `${pad2(dialSt.h)}:${pad2(dialSt.m)}`;

function buildDrum(el, n, label, key) {
  el.innerHTML = Array.from({ length: n }, (_, i) => `<button class="dopt" data-i="${i}">${label(i)}</button>`).join("");
  el.onclick = (e) => {
    const b = e.target.closest && e.target.closest(".dopt");
    if (!b) return;
    setDial(key, +b.dataset.i);
    markDial();
    scrollDial();
  };
  el.onscroll = () => {                       // 돌리는 중 — 위치는 사용자 것, 값만 따라간다
    setDial(key, Math.round(el.scrollTop / DIAL_H));
    markDial();
  };
}
function setDial(key, i) {
  if (!dialSt) return;
  if (key === "h") dialSt.h = Math.max(0, Math.min(23, i));
  else dialSt.m = Math.max(0, Math.min(11, i)) * 5;
}
function markDial() {
  if (!dialSt) return;
  const hi = dialSt.h, mi = dialSt.m / 5;
  $$("#dial-h .dopt").forEach((b, i) => b.classList.toggle("on", i === hi));
  $$("#dial-m .dopt").forEach((b, i) => b.classList.toggle("on", i === mi));
  const pv = $("#evx-preview");
  if (pv) pv.textContent = dialSt ? dialValue() : "";
}
function scrollDial() {
  if (!dialSt) return;
  $("#dial-h").scrollTop = dialSt.h * DIAL_H;
  $("#dial-m").scrollTop = (dialSt.m / 5) * DIAL_H;
}

/* ── 일정 추가 시트 ────────────────────────────────────────
 * 인라인 한 줄이던 걸 팝업으로 뺐다. 드럼은 별도 시트가 아니라 이 안에 들어 있다 —
 * 시트를 세 겹 쌓으면 뒤로 가기가 어디로 가는지 알 수 없어진다. */
let evxCtx = null;   // { date, allday }

function openEventSheet(k, closed) {
  evxCtx = { date: k, allday: true };
  dialSt = { h: 9, m: 0 };
  $("#evx-date").textContent = dlabel(k);
  // 마감된 날에 추가하면 그 일정은 수정·삭제가 막힌다 — 미리 알린다 (1.3)
  const warn = $("#evx-warn"); if (warn) warn.style.display = closed ? "" : "none";
  $("#evx-title").value = "";
  buildDrum($("#dial-h"), 24, (i) => pad2(i), "h");
  buildDrum($("#dial-m"), 12, (i) => pad2(i * 5), "m");
  markDial();
  evxMode(true);
  openSheet("sh-event");
}
function evxMode(allday) {
  if (!evxCtx) return;
  evxCtx.allday = allday;
  $$("#evx-seg button").forEach((b) => b.classList.toggle("on", (b.dataset.t === "all") === allday));
  $("#evx-dial").style.display = allday ? "none" : "";
  if (!allday) scrollDial();
}
function bindEventSheet() {
  $$("#evx-seg button").forEach((b) => (b.onclick = () => evxMode(b.dataset.t === "all")));
  $("#evx-cancel").onclick = () => { closeSheet("sh-event"); evxCtx = null; };
  $("#evx-ok").onclick = () => {
    if (!evxCtx) return;
    const title = $("#evx-title").value.trim();
    if (!title) return toast("일정 내용을 적어 주세요", "warn");
    const k = evxCtx.date, time = evxCtx.allday ? null : dialValue();
    closeSheet("sh-event");
    evxCtx = null;
    run(async () => {
      await Api.createEvent({ title, date: k, time });
      toast(`${md(k)} 일정을 추가했어요`, "ok");
      await Promise.all([refreshToday(), renderCalendar()]);
      openDay(k);
    });
  };
}

/* ── 완료율 바 ─────────────────────────────────────────────
 * 4칸 = 25%씩. 칸을 누르면 그 값, 같은 칸을 다시 누르면 한 단계 내려간다 —
 * 도넛 사이클에서는 한 번 100에 닿으면 되돌릴 방법이 없었다.
 * 100%(완료)는 이 바에서 다루지 않는다. 완료는 상태 변경이라 전용 버튼의 몫이다. */
const RATE_STEPS = 4;
function rbar(rate, click, cls = "") {
  const on = (k) => (rate ?? 0) >= k * 25;
  const seg = (k) => click
    ? `<button class="${on(k) ? "on" : ""}" onclick="${click.split("$K").join(k)}"></button>`
    : `<i class="${on(k) ? "on" : ""}"></i>`;
  let h = "";
  for (let k = 1; k <= RATE_STEPS; k++) h += seg(k);
  return `<span class="rbar${cls ? " " + cls : ""}">${h}</span>`;
}
/* 같은 칸을 다시 누르면 한 단계 내림 — 올리기와 내리기가 같은 제스처 안에 있다 */
const rateOf = (k, cur) => ((cur ?? 0) === k * 25 ? (k - 1) * 25 : k * 25);

function rateSet(id, date, k, cur) {
  run(async () => {
    const rate = rateOf(k, cur);
    // 완료율이 100에 닿으면 즉시 완료 처리한다 — 진행률 100과 '완료'를 따로 두지 않는다
    if (rate === 100) { await Api.complete(id); toast("완료", "ok"); }
    else await Api.setRate(id, date, rate);
    syncAll();
    if ($("#phone").dataset.tab === "works") renderWorks();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}
function completeRow(id) {
  run(async () => {
    await Api.complete(id);
    toast("완료", "ok");
    syncAll();
    if ($("#phone").dataset.tab === "works") renderWorks();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}

/* ── 미루기 확인 시트 ──────────────────────────────────────
 * 완료율은 '그 예정일까지 얼마나 갔나'라서, 미루는 순간이 그 값을 아는 유일한 시점이다.
 * 새 예정은 설계대로 0%에서 다시 시작한다 (v0.8). */
let dfxCtx = null;   // { id, title, from, to, rate, frozen }

function openDeferSheet(ctx) {
  dfxCtx = ctx;
  $("#dfx-what").innerHTML = `${esc(ctx.title)}<br>${md(ctx.from)} → <b style="color:var(--ink)">${md(ctx.to)}</b>`;
  $("#dfx-note").textContent = ctx.frozen
    ? "이미 마감된 날이라 완료율은 그때 기록대로 남아요 — 새 예정만 만들어집니다."
    : "여기서 정한 값은 원래 예정일에 남고, 옮겨 간 날은 0%에서 다시 시작해요.";
  paintDfx();
  openSheet("sh-defer");
}
function paintDfx() {
  if (!dfxCtx) return;
  $("#dfx-rate").innerHTML = dfxCtx.frozen
    ? rbar(dfxCtx.rate, null, "big lock")
    : rbar(dfxCtx.rate, "dfxRate($K)", "big");
}
function dfxRate(k) {
  if (!dfxCtx || dfxCtx.frozen) return;
  dfxCtx.rate = rateOf(k, dfxCtx.rate);
  paintDfx();
}
function bindDeferSheet() {
  $("#dfx-cancel").onclick = () => { closeSheet("sh-defer"); dfxCtx = null; };
  $("#dfx-ok").onclick = () => {
    const c = dfxCtx;
    if (!c) return;
    closeSheet("sh-defer");
    dfxCtx = null;
    run(async () => {
      await Api.defer(c.id, c.from, c.to, c.frozen ? undefined : c.rate);
      exitPick();
      await Promise.all([refreshToday(), renderCalendar()]);
      openDay(c.to);
    });
  };
}

/* ── Calendar ──────────────────────────────────────────── */
async function renderCalendar() {
  if (!S.today) return; // 부팅 전 — S.cal이 아직 비어 있다 (날짜 계산 불가)
  const gen = calGen;   // 이 조립을 시작할 때의 세대 — 도중에 달을 더 넘기면 버린다(최신 우선)
  const { y, m } = S.cal;
  $("#cal-title").textContent = `${y} · ${m}월`;
  /* 이전·현재·다음 달을 한 번에 만든다. 옆으로 밀 때 다음 달이 '이미 거기 있어야'
   * 끊기지 않기 때문이다. /calendar가 원래 범위 쿼리라 세 달치도 요청 한 번이다. */
  const months = [addMonth(y, m, -1), { y, m }, addMonth(y, m, 1)];
  const grids = months.map((o) => weeksOf(o.y, o.m));
  const start = grids[0][0][0], end = grids[2][WEEKS_IN_GRID - 1][6];
  const [cal, plist] = await Promise.all([Api.calendar(start, end), Api.periods()]);
  if (gen !== calGen) return;   // 더 새로운 달 넘김이 있었으면 이 3-pane 조립은 폐기(연속 스와이프 경합 방지)
  S.calData = cal;
  S.periods = plist;

  const D = S.today ? S.today.date : "";
  const diarySet = new Set(cal.diary.map((r) => r.date));
  /* 캘린더 탭은 캘린더다 — 셀의 주인은 '일정'이고, 할 일은 한 줄로 압축한다.
   * 그래서 둘을 한 배열에 섞지 않고 갈라 담는다.
   * 미룬 항목: 지난 날에는 '옮겨감' 표시로 남고, 오늘·앞으로는 새 날짜에만 보인다. */
  const evByDate = {}, tkByDate = {};
  for (const ev of cal.events || []) (evByDate[ev.date] = evByDate[ev.date] || []).push(ev);
  for (const e of cal.entries) {
    if (e.deferred_to && e.date >= D) continue;
    (tkByDate[e.date] = tkByDate[e.date] || []).push(e);
  }

  const rx = capRx($("#cal-rows").clientWidth);
  const rowHtml = (row, mm) => {
    const paths = bandPaths(row, cal.periods, rx)
      .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-opacity=".4"/>`).join("");
    const cells = row.map((d) => {
      const mut = +d.slice(5, 7) !== mm ? " mut" : "";
      const today = d === D ? " today" : "";
      const past = d < D ? " past" : "";
      const evs = evByDate[d] || [], tks = tkByDate[d] || [];

      // 일정 — 셀에서는 제목만 보인다. 시각을 앞에 붙이면 셀 폭(≈48px)에서 내용이 통째로
      // 잘려 나갔다. 시각이 '있다'는 사실만 앞의 점으로 남기고, 몇 시인지는 날짜 팝업에서.
      let h = evs.slice(0, 2).map((e) =>
        `<span class="ev evt${past}${e.time ? " timed" : ""}" style="border-left-color:${e.color || "var(--ink)"}">${esc(e.title)}</span>`).join("");

      // 할 일 — 한 줄로 압축 [제목 +n]. 대표는 아직 살아 있는 항목을 고른다
      // (완료·이동만 남은 날에 취소선 그은 제목이 그 날을 대표하면 오독한다).
      if (tks.length) {
        const head = tks.find((x) => x.status !== "finished" && !x.deferred_to) || tks[0];
        const rest = tks.length - 1;
        h += `<span class="ev tsum${past}${head.deferred_to ? " moved" : ""}${head.status === "finished" ? " done" : ""}"` +
          ` style="border-left-color:${head.color || "var(--faint)"}">${esc(head.title)}${rest ? `<b>+${rest}</b>` : ""}</span>`;
      }
      if (evs.length > 2) h += `<span class="ev more">일정 +${evs.length - 2}</span>`;

      return `<button class="c${mut}${today}" data-d="${d}" onclick="openDay('${d}')">
        <span class="d serif">${+d.slice(8, 10)}</span>${diarySet.has(d) ? '<i class="dr"></i>' : ""}${h}</button>`;
    }).join("");
    return `<div class="cal-row"><svg class="band" viewBox="0 0 700 96" preserveAspectRatio="none">${paths}</svg><div class="cells">${cells}</div></div>`;
  };

  $("#cal-track").innerHTML = months.map((o, k) =>
    `<div class="calpane${k === 1 ? " cur" : ""}" data-ym="${o.y}-${String(o.m).padStart(2, "0")}">` +
    grids[k].map((row) => rowHtml(row, o.m)).join("") + `</div>`).join("");
  trackSet($("#cal-track"), 1, false, CAL_GAP);   // 언제나 가운데 — 양옆이 이전·다음 달

  // 범례는 '지금 보고 있는 달'만 — 세 달치를 다 늘어놓으면 읽을 수 없다
  const curFrom = grids[1][0][0], curTo = grids[1][WEEKS_IN_GRID - 1][6];
  $("#cal-leg").innerHTML = cal.periods.filter((p) => p.start_date <= curTo && p.end_date >= curFrom).map((p) =>
    `<span><i class="lsw" style="background:${p.color};opacity:.6"></i>${esc(p.title)} ${md(p.start_date)}–${md(p.end_date)}</span>`).join("");

  $("#p-cnt").textContent = S.periods.length;
  $("#p-list").innerHTML = S.periods.map((p) => {
    const started = p.d_start <= 0;
    const ach = started && p.achievement != null ? p.achievement : null;
    return `<div class="prow" onclick="openPeriod('${p.id}')" style="cursor:pointer">
      <i class="pdot" style="width:9px;height:9px;background:${p.color}"></i>
      <div style="flex:1"><b style="font-size:14px">${esc(p.title)}</b>
        <div class="cap">${md(p.start_date)} – ${md(p.end_date)} · ${started ? `경과 ${p.elapsed_days}/${p.total_days}` : `D-${p.d_start} 시작`}</div>
        <div class="pbar"><i style="width:${ach ?? 0}%;background:${p.color}"></i></div></div>
      <span class="cap">${ach != null ? `달성률 ${ach}%` : "—"}</span>
    </div>`;
  }).join("") || `<div class="prow"><span class="cap">아직 기간이 없어요</span></div>`;

  applyPickDim();
}

async function renderDiaryList() {
  const rows = await Api.diary(30);
  $("#diary-list").innerHTML = rows.map((r) => {
    const fl = (r.feelings || "").split(",").filter(Boolean)
      .map((s) => { const [f, v] = s.split(":"); return f[0].toUpperCase() + Math.round(+v); }).join(" · ");
    const head = r.close_kind === "auto" ? `<b style="color:var(--ink)">${S.today.boundary} 자동 마감</b> · ` : "";
    return `<button class="lit" onclick="openDay('${r.date}')"><span class="dd serif">${+r.date.slice(8, 10)}</span>
      <span class="db">${head}score ${r.score ?? "—"}${fl ? " · " + fl : ""}${r.last_log ? "<br>" + esc(r.last_log) : ""}</span></button>`;
  }).join("") || `<p class="cap" style="padding:14px 2px">아직 확정된 일기가 없어요.</p>`;
}

/* ── 날짜 선택 모드 (미루기 · 일정 정하기) ─────────────── */
/* 2주 상한은 '미루기'에만 — 미루기가 무기한 연기가 되지 않게 하는 장치다.
 * 신규 일정(대기 확정·빠른 추가)은 상한 없이 앞날 아무 날짜나 고를 수 있다. */
function pickMinMax() {
  const D = S.today.date;
  if (S.pick.mode === "defer") {
    const min = S.pick.from >= D ? addDaysStr(D, 1) : D;
    return { min, max: addDaysStr(D, 14) };
  }
  return { min: D, max: null };
}
const pickable = (k) => {
  const { min, max } = pickMinMax();
  return k >= min && (!max || k <= max);
};

function startPick(p) {
  S.pick = { ...p, origin: $("#phone").dataset.tab };
  closeAll();
  switchTab("cal");
  $$("[data-cv]").forEach((b) => b.classList.toggle("on", b.dataset.cv === "grid"));
  $("#cal-grid").style.display = "";
  $("#cal-list").style.display = "none";
  $("#pick-title").textContent = p.title;
  $("#pick-note").textContent = p.mode === "defer" ? "(2주 이내)" : "(앞날 아무 날짜나)";
  $("#pick-banner").classList.add("on");
  applyPickDim();
}
function applyPickDim() {
  $$("#cal-rows .c").forEach((c) => {
    const on = S.pick && !pickable(c.dataset.d);
    c.style.opacity = on ? ".22" : "";
    c.style.pointerEvents = on ? "none" : "";
  });
}
function exitPick() {
  S.pick = null;
  $("#pick-banner").classList.remove("on");
  applyPickDim();
}
function cancelPick() { const o = S.pick.origin; exitPick(); switchTab(o); }

function assignDate(k) {
  const p = S.pick;
  if (p.mode !== "defer") {
    return run(async () => {
      await Api.schedule(p.id, k);
      exitPick();
      await Promise.all([refreshToday(), renderCalendar()]);
      openDay(k);
    });
  }
  // 미루기는 한 단계 더 — 원래 예정일의 완료율을 여기서 확정한다
  run(async () => {
    const t = await Api.task(p.id);
    const e = t.entries.find((x) => x.date === p.from);
    openDeferSheet({
      id: p.id, title: p.title || t.title, from: p.from, to: k,
      rate: e ? (e.rate ?? 0) : 0,
      frozen: !e || e.day_status === "closed",   // 마감된 날은 고칠 수 없다 (1.3)
    });
  });
}

function pickReassign(id) {
  const r = S.today.reassign.find((x) => x.id === id);
  if (r) startPick({ mode: "defer", id, from: r.latest_date, title: r.title });
}

/* ── Works ─────────────────────────────────────────────── */
let works = null;
async function renderWorks() {
  const [sched, waiting, deferring, byPeriod, done] = await Promise.all([
    Api.works("scheduled"), Api.works("waiting"), Api.works("deferring"),
    Api.works("periods"), Api.works("done"),
  ]);
  works = { sched, waiting, deferring, byPeriod, done };
  const D = S.today.date;

  // 세그먼트 라벨·경고색 — 대기는 '들어가 봐야 아는 곳'이라 건이 있으면 윤곽선으로 세운다
  const sw = $("#seg-wait");
  sw.textContent = waiting.length ? `대기 ${waiting.length}` : "대기";
  sw.classList.toggle("ring", waiting.length > 0);
  sw.classList.toggle("hot3", waiting.some((w) => w.age >= WAIT_LIMIT));   // 기한에 닿은 게 있으면 더 세게
  const sd = $("#seg-defer");
  sd.textContent = deferring.length ? `이월 중 ${deferring.length}` : "이월 중";
  sd.classList.remove("hot1", "hot2", "hot3");
  if (deferring.length >= 3) sd.classList.add("hot3");
  else if (deferring.length === 2) sd.classList.add("hot2");
  else if (deferring.length === 1) sd.classList.add("hot1");

  // 예정 — 오늘 / 이번 주 / 이후
  const groups = [["오늘", (r) => r.date === D], ["이번 주", (r) => r.date > D && r.date <= addDaysStr(D, 7)], ["이후", (r) => r.date > addDaysStr(D, 7)]];
  $("#w-sched").innerHTML = groups.map(([label, f]) => {
    const rows = sched.filter(f);
    if (!rows.length) return "";
    return `<div class="glab">${label}</div><div class="card" style="padding:2px 14px">` +
      rows.map((r) =>
        `<div class="trow">
          <button class="tk" onclick="completeRow('${r.id}')" title="완료"></button>
          <button class="tbody" style="text-align:left" onclick="openTask('${r.id}')">
            <span class="tt">${esc(r.title)}${r.defer_count > 0 ? '<span class="warn">!</span>' : ""}</span>
            <span class="tmeta">${r.color ? `<i class="pdot" style="background:${r.color}"></i>` : ""}${md(r.date)}${r.defer_count > 0 ? ` · ${r.defer_count}회 이월` : ""}</span></button>
          ${r.rate ? `<span class="ratepct">${r.rate}%</span>` : ""}</div>`).join("") + `</div>`;
  }).join("") || `<p class="cap" style="margin-top:14px">예정된 task가 없어요 — 아래 +로 추가.</p>`;

  // 대기
  $("#inbox-lock").style.display = waiting.some((w) => w.age > 21) ? "" : "none";
  $("#wait-list").innerHTML = waiting.map((w) =>
    `<div class="trow" onclick="openTask('${w.id}')" style="cursor:pointer"><span class="tk"></span>
      <span class="tbody"><span class="tt">${esc(w.title)}</span>
        <span class="tmeta">미배정 · <b class="${ageClass(w.age)}">${w.age}일째</b></span></span>
      <span style="display:flex;gap:6px;flex:none">
        <button class="deferchip" onclick="event.stopPropagation();pickSchedule('${w.id}')">일정 정하기</button>
        ${w.age >= WAIT_LIMIT ? `<button class="deferchip" style="border-color:var(--line);color:var(--sub)" onclick="event.stopPropagation();extendTask('${w.id}')">연장</button>` : ""}
      </span></div>`).join("") ||
    `<div class="trow"><span class="tbody"><span class="tmeta">대기 중인 task가 없어요</span></span></div>`;

  // 이월 중
  $("#defer-list").innerHTML = deferring.map((r) =>
    `<button class="trow" style="width:100%" onclick="openTask('${r.id}')"><span class="tk"></span>
      <span class="tbody"><span class="tt">${esc(r.title)}<span class="warn">!</span></span>
        <span class="tmeta">${r.defer_count}회 이월 · 첫 예정 ${md(r.first_date)}</span></span></button>`).join("") ||
    `<div class="trow"><span class="tbody"><span class="tmeta">이월 중인 task가 없어요</span></span></div>`;

  // 기간별
  const pg = {};
  for (const r of byPeriod) (pg[r.period_id] = pg[r.period_id] || { title: r.period_title, color: r.color, rows: [] }).rows.push(r);
  $("#pgroups").innerHTML = Object.values(pg).map((g) =>
    `<div class="glab" style="color:var(--ink)"><i class="pdot" style="display:inline-block;margin-right:5px;background:${g.color}"></i>${esc(g.title).toUpperCase()}</div>
     <div class="card" style="padding:2px 14px">` + g.rows.map((r) =>
      `<button class="trow" style="width:100%" onclick="openTask('${r.id}')"><span class="tk${r.status === "finished" ? " done" : ""}"></span>
        <span class="tbody"><span class="tt">${esc(r.title)}</span>
          <span class="tmeta">${r.is_waiting ? "대기" : r.latest_date ? md(r.latest_date) : ""}</span></span></button>`).join("") + `</div>`).join("") ||
    `<p class="cap" style="margin-top:14px">기간에 속한 task가 없어요.</p>`;

  // 완료
  $("#done-list").innerHTML = done.map((r) => {
    const meta = r.planned_on && r.planned_on !== r.finished_on
      ? `예정 ${md(r.planned_on)} · 완료 ${md(r.finished_on)}`
      : `${md(r.finished_on)} 완료`;
    return `<button class="trow muted" style="width:100%" onclick="openTask('${r.id}')"><span class="tk done"></span>
      <span class="tbody"><span class="tt">${esc(r.title)}</span><span class="tmeta">${meta}</span></span></button>`;
  }).join("") ||
    `<div class="trow"><span class="tbody"><span class="tmeta">아직 완료가 없어요</span></span></div>`;
}

function pickSchedule(id) {
  const w = (works ? works.waiting : []).find((x) => x.id === id) || S.today.waiting.top;
  startPick({ mode: "schedule", id, title: w ? w.title : "" });
}
function extendTask(id) {
  run(async () => {
    const r = await Api.extend(id);
    toast(`연장 — 다시 1일째, 다음 기한 ${md(r.deadline)}`);
    await Promise.all([renderWorks(), refreshToday()]);
  });
}
function goInbox() {
  switchTab("works");
  $$(".wseg").forEach((x) => x.classList.toggle("on", x.dataset.w === "inbox"));
  $$(".wview").forEach((v) => v.classList.toggle("on", v.id === "w-inbox"));
}

/* ── task 상세 시트 ────────────────────────────────────── */
async function openTask(id) {
  await run(async () => {
    const t = await Api.task(id);
    S.sheetTask = t;
    $("#tk-title").value = t.title;
    $("#tk-id").textContent = `id ${t.id} · 불변 — 참조는 id로, title은 자유 변경`;
    const D = S.today.date;
    let tl = "";
    if (t.entries.length) {
      tl = t.entries.map((e) => {
        if (e.deferred_to) return `<div class="te">${md(e.date)} · 완료율 ${e.rate}% → 미루기</div>`;
        if (t.status === "finished") return `<div class="te done-line">${md(e.date)} · 예정${e.rate ? ` · ${e.rate}%` : ""}</div>`;
        if (e.date === D) return `<div class="te" style="color:var(--ink);font-weight:600">${md(e.date)} · 예정 (오늘)</div>`;
        if (e.date > D) return `<div class="te">${md(e.date)} · 예정</div>`;
        return `<div class="te">${md(e.date)} · 완료율 ${e.rate}% — 미완료</div>`;
      }).join("");
    } else {
      tl = `<div class="te">대기 · ${t.wait_age}일째</div>`;
    }
    tl += t.extensions.map((x) => `<div class="te">연장 ${md(x.extended_at.slice(0, 10))}</div>`).join("");
    if (t.status === "finished" && t.finished_on)
      tl += `<div class="te" style="color:var(--ink);font-weight:600">${md(t.finished_on)} · 완료 처리</div>`;
    $("#tk-timeline").innerHTML = tl;

    /* 완료율 — '살아 있는(미뤄지지 않은) 마지막 예정'에 매긴다. 서버가 완료 100%를 붙이는 자리와 같다.
     * 예전에는 date <= 오늘인 항목만 찾았기 때문에, 내일 이후로 잡힌 일은
     * "예정된 날이 없어요"가 뜨고 완료율을 고를 방법이 아예 없었다.
     * 완료율은 "그 예정일까지 얼마나 진행했는가"이므로 미래 예정에도 매길 수 있어야 한다. */
    const live = [...t.entries].reverse().find((e) => !e.deferred_to);
    const locked = !!live && live.day_status === "closed";
    $("#tk-rate-head").textContent = live ? `완료율 — ${md(live.date)} 예정` : "완료율";
    // 완료율은 상시 인라인 입력을 걷어내고 읽기전용으로 표시한다(설계 §1.4 복귀).
    // 값 변경은 '미루기'(defer sheet)와 '하루 마감'(구현 2)에서만, 완료는 완료 버튼.
    $("#tk-rates").innerHTML = t.status === "finished"
      ? `<span class="ratebig done">완료 · 100%</span>`
      : !live
        ? `<span class="cap">대기 중이에요 — 일정을 정하면 완료율이 생겨요.</span>`
        : locked
          ? `<span class="ratebig">${live.rate}%</span>` +
            `<p class="cap" style="margin-top:8px">${md(live.date)}은 이미 마감됐어요 — 지난 기록은 고칠 수 없어요.</p>`
          : `<span class="ratebig">${live.rate}%</span>` +
            `<p class="cap" style="margin-top:8px">완료율은 <b>미루기</b>나 하루 마감 때 정해요. 다 했으면 아래 <b>완료</b>.</p>`;

    /* 버튼은 맥락에 맞는 것만 남긴다 —
     *  · 대기 중이면 미룰 예정 자체가 없다 → '미루기'가 아니라 '일정 정하기'
     *  · 대기 연장은 기한(21일)에 닿아야 뜻이 있다. 3일째에 누르는 연장은
     *    시계를 되감는 게 아니라 연장 이력만 남겨 신호를 흐린다 (1.4)
     *  · 완료된 일은 전부 잠금 */
    const fin = t.status === "finished";
    $("#tk-defer").textContent = t.is_waiting ? "일정 정하기" : "미루기";
    const canExtend = !fin && !!t.is_waiting && (t.wait_age ?? 0) >= WAIT_LIMIT;
    $("#tk-extend").style.display = canExtend ? "" : "none";
    ["tk-defer", "tk-complete"].forEach((i) => {
      const b = $("#" + i);
      b.disabled = fin;
      b.style.opacity = fin ? ".45" : "";
    });
    openSheet("sh-task");
  });
}

function bindTaskSheet() {
  $("#tk-title").addEventListener("change", () => {
    const t = S.sheetTask;
    if (!t) return;
    const v = $("#tk-title").value.trim();
    if (v && v !== t.title) run(async () => { await Api.patchTask(t.id, { title: v }); syncAll(); });
  });
  $("#tk-defer").onclick = () => {
    const t = S.sheetTask;
    if (!t) return;
    if (t.is_waiting) startPick({ mode: "schedule", id: t.id, title: t.title });
    else startPick({ mode: "defer", id: t.id, from: t.latest_date, title: t.title });
  };
  $("#tk-extend").onclick = () => { const t = S.sheetTask; if (t) { closeAll(); extendTask(t.id); } };
  $("#tk-complete").onclick = () => { const t = S.sheetTask; if (t) completeFromSheet(t.id); };
  $("#tk-delete").onclick = () => {
    const t = S.sheetTask;
    if (!t) return;
    run(async () => {
      const n = t.defer_count || 0;
      const body = n > 0
        ? `“${esc(t.title)}”은(는) 이미 <b>${n}번 미룬</b> 일이에요.<br>취소하면 기록에서 사라지고, 미룬 흔적도 함께 지워져요 — 하기 싫은 걸 없애는 중은 아닌지 한 번만 더 생각해요.`
        : `“${esc(t.title)}” — 계획을 지우는 거예요. 마감된 날의 기록이 있으면 취소되지 않아요.`;
      const r = await confirmAsk(
        n > 0 ? "정말 이 일을 취소할까요?" : "이 일정을 취소할까요?",
        body,
        n >= 2 ? "그래도 취소" : "취소하기",
        t.is_waiting ? null : "차라리 미루기");
      if (r === "alt") { closeAll(); return startPick({ mode: "defer", id: t.id, from: t.latest_date, title: t.title }); }
      if (r !== "ok") return;
      await Api.deleteTask(t.id);
      closeAll();
      toast("취소했어요", "warn");
      syncAll();
      if ($("#phone").dataset.tab === "cal") renderCalendar();
    });
  };
}

function setRateOn(id, date, k, cur) {
  run(async () => {
    const rate = rateOf(k, cur);
    // 100에 닿으면 완료 — 시트를 닫고 완료 상태로 넘긴다 (완료 버튼과 같은 결과)
    if (rate === 100) { await Api.complete(id); toast("완료", "ok"); closeAll(); }
    else { await Api.setRate(id, date, rate); await openTask(id); }
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}
function completeFromSheet(id) {
  run(async () => {
    await Api.complete(id);
    closeAll();
    toast("완료 100%", "ok");
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}

/* ── 빠른 추가 ─────────────────────────────────────────── */
function bindAddSheet() {
  $("#add-wait").onclick = () => run(async () => {
    const v = $("#add-title").value.trim();
    if (!v) return;
    await Api.createTask({ title: v });
    $("#add-title").value = "";
    closeAll();
    toast("대기에 담았어요", "ok");
    syncAll();
  });
  $("#add-date").onclick = () => run(async () => {
    const v = $("#add-title").value.trim();
    if (!v) return;
    const r = await Api.createTask({ title: v });
    $("#add-title").value = "";
    startPick({ mode: "schedule", id: r.id, title: v });
  });
}

/* ── 21일 초과 차단 팝업 ───────────────────────────────── */
function showStale(o) {
  $("#stale-text").innerHTML =
    `${esc(o.title)} — <b class="age3">${o.age}일째</b>.<br>일정을 정하거나 대기를 연장해야 계속할 수 있어요.`;
  $("#stale-go").onclick = () => {
    $("#stale").classList.remove("on");
    goInbox();
    renderWorks().then(() => openTask(o.id));
  };
  $("#stale").classList.add("on");
}
function staleClose() { $("#stale").classList.remove("on"); }

/* ── Analysis (조회 + 5.2 미리보기 — 생성은 구현 2) ────── */
async function renderAnalysis() {
  const [pv, list] = await Promise.all([Api.ctxPreview(), Api.analyses()]);
  $("#ctx-lines").innerHTML = [
    "Me — 장기 맥락 프레임",
    `raw ${pv.raw.days}일 (${md(pv.raw.start)} – ${md(pv.raw.end)})`,
    `그 앞 주 weekly summary (${md(pv.weekly_summary.start)} – ${md(pv.weekly_summary.end)}) · ${pv.weekly_summary.status}`,
    `Today 상태 — 총 ${pv.total_days}일 윈도우`,
  ].map((l) => `<div class="cl">${l}</div>`).join("");

  $("#ana-cnt").textContent = list.length ? `${list.length}건 · 영구 보존` : "아직 없음";
  $("#ana-list").innerHTML = list.slice(0, 3).map((a, i) =>
    `<div class="card"${i ? ' style="margin-top:8px"' : ""}>
      <button class="ahead" onclick="toggleAna('${a.id}',this)">
        <b>“${esc(a.prompt)}”</b>
        <span class="cap mono" style="flex:none">${md(a.created_at.slice(0, 10))} · <span class="tg">열기</span></span></button>
      <p class="abody" id="ana-${a.id}" style="display:none;margin:9px 0 0"></p>
    </div>`).join("") ||
    `<div class="card"><p class="cap" style="margin:0">아직 분석이 없어요 — 생성은 구현 2에서 연결돼요.</p></div>`;
  const more = $("#btn-board");
  more.style.display = list.length > 3 ? "" : "none";
  more.textContent = `더보기 — 전체 ${list.length}건`;
  $("#board-cnt").textContent = list.length;
  $("#board-list").innerHTML = list.map((a) =>
    `<button class="brow" onclick="closeBoard();toggleAna('${a.id}')">
      <span class="bt">“${esc(a.prompt)}”<span class="cap mono">${md(a.created_at.slice(0, 10))}</span></span>
      <span class="bp">${esc(a.preview)}</span></button>`).join("");
}
async function toggleAna(id, btn) {
  const el = $("#ana-" + id);
  if (!el) return;
  if (!el.dataset.loaded) {
    const a = await Api.analysis(id);
    el.textContent = a.pass1 + (a.pass2 ? "\n\n" + a.pass2 : ""); // 통합 산문 표시 (5.4)
    el.dataset.loaded = "1";
  }
  const open = el.style.display === "none";
  el.style.display = open ? "" : "none";
  if (btn) btn.querySelector(".tg").textContent = open ? "닫기" : "열기";
}
function openBoard() { $("#aboard").classList.add("on"); }
function closeBoard() { $("#aboard").classList.remove("on"); }

/* ── Me · 설정 ─────────────────────────────────────────── */
const ME_LABELS = { direction: "방향 — 장기", interests: "관심사", career: "진로", personality: "성격", life_pattern: "생활 패턴" };
async function renderMe() {
  const [me, hist, guard] = await Promise.all([Api.me(), Api.meHistory(), Api.guardEvents()]);
  S.me = me;
  let h = "";
  for (const f of me.fields)
    h += `<button class="merow" style="width:100%" onclick="openMe('${f.field}')">
      <span class="ml">${esc(ME_LABELS[f.field] || f.field)}</span>${esc(f.value)}</button>`;
  if (me.now.length)
    h += `<div class="merow"><span class="ml">지금 — 활성 기간에서 자동</span>` +
      me.now.map((n) => `<i class="pdot" style="display:inline-block;margin-right:5px;background:${n.color}"></i>${esc(n.goals.join(" · ") || n.title)}`).join('<span style="display:inline-block;width:10px"></span>') + `</div>`;
  if (!h) h = `<div class="merow"><span class="cap">아직 비어 있어요 — Me는 모든 분석의 장기 맥락이 돼요.</span></div>`;
  h += `<p class="cap" style="margin-top:9px">'지금' 줄은 periods의 목표를 조인한 파생 — Me에 중복 저장하지 않아요.</p>`;
  $("#me-fields").innerHTML = h;

  $("#me-history").innerHTML = hist.map((r) =>
    `<div class="lrow"><span class="ts mono">${md(r.changed_at.slice(0, 10))}</span>
      <span>${esc(ME_LABELS[r.field] || r.field)} — ${r.old_value ? `“${esc(r.old_value)}” → ` : ""}“${esc(r.new_value)}”${r.source === "ai" ? ' <span class="cap">AI 제안 승인</span>' : ""}</span></div>`).join("") ||
    `<div class="lrow"><span class="ts mono">—</span><span style="color:var(--faint)">아직 변경 이력이 없어요</span></div>`;

  const ff = feelingsFields().join(" · ");
  const tok = localStorage.getItem("api_token");
  const theme = { auto: "자동", light: "라이트", dark: "다크" }[localStorage.getItem("theme") || "auto"];
  const connSummary = () => {
    const on = ((S.conn && S.conn.connections) || []).filter((c) => c.has_key);
    return on.length ? on.map((c) => c.label.replace(/\s*\(.*\)/, "")).join(" · ") : "미연결";
  };
  // 자주 만지는 것 위 / 한 번 정하고 마는 것 아래
  const rows = [
    ["하루 경계 시각", `${S.settings.day_boundary || "05:00"} ›`, "day_boundary"],
    ["Feelings 필드 구성", `${ff} ›`, "feelings_fields"],
    ["테마", `${theme} ›`, "theme"],
    ["튜토리얼 다시 보기", "5단계 ›", "tutorial"],
    ["AI 연결 — 제공자·키", `${connSummary()} ›`, "ai"],
    ["앱 접근 토큰", `${tok ? "설정됨 ›" : "없음 ›"}`, "api_token"],
    ["모델 — Low (일상)", `${modelLabel(S.settings.model_low || "—")} ›`, "model_low"],
    ["모델 — High (분석·Guard)", `${modelLabel(S.settings.model_high || "—")} ›`, "model_high"],
    ["표준시 오프셋", `${S.settings.utc_offset || "+09:00"} ›`, "utc_offset"],
    ["데이터 내보내기", "md 원본", ""],
    ["Guard 규칙 · 이력", `규칙 0 · 이벤트 ${guard.length}`, ""],
  ];
  const act = (key) => key === "tutorial" ? 'onclick="showTutorial(0)"'
    : key === "ai" ? 'onclick="openAi()"'
    : key ? `onclick="openSetting('${key}')"` : 'style="opacity:.5"';
  $("#set-list").innerHTML = rows.map(([k, v, key]) =>
    `<button class="srow" ${act(key)}>${k}<em>${esc(v)}</em></button>`).join("");
}

function toggleSet(on) { $("#me-main").style.display = on ? "none" : ""; $("#me-set").style.display = on ? "" : "none"; }


/* ── 기간 추가·편집 (2장) ──────────────────────────────────── */
const PALETTE = ["#7ED4A9", "#F3C05F", "#B9A5EC", "#8FC7E8", "#E8A0A0", "#A9C77E", "#D9B08C", "#9AA5B1"];
let pdCtx = null; // {id?} — 없으면 신규

function openPeriod(id) {
  const p = id ? S.periods.find((x) => x.id === id) : null;
  pdCtx = p ? { id: p.id } : null;
  $("#pd-head").textContent = p ? "기간 편집" : "새 기간";
  $("#pd-title").value = p ? p.title : "";
  const D = S.today.date;
  $("#pd-start").value = p ? p.start_date : D;
  $("#pd-end").value = p ? p.end_date : addDaysStr(D, 13);
  $("#pd-goals").value = p ? (p.goals || []).join("\n") : "";
  const cur = p ? p.color : PALETTE[S.periods.length % PALETTE.length];
  $("#pd-colors").innerHTML = PALETTE.map((c) =>
    `<button class="sw${c.toLowerCase() === cur.toLowerCase() ? " on" : ""}" data-c="${c}" style="background:${c}"></button>`).join("");
  $$("#pd-colors .sw").forEach((b) => (b.onclick = () => {
    $$("#pd-colors .sw").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
  }));
  $("#pd-delete").style.display = p ? "" : "none";
  openSheet("sh-period");
}

function bindPeriodSheet() {
  $("#pd-save").onclick = () => run(async () => {
    const body = {
      title: $("#pd-title").value.trim(),
      start_date: $("#pd-start").value,
      end_date: $("#pd-end").value,
      color: ($("#pd-colors .sw.on") || {}).dataset?.c || PALETTE[0],
      goals: $("#pd-goals").value.split("\n").map((s) => s.trim()).filter(Boolean),
    };
    if (!body.title) return toast("이름을 적어 주세요");
    if (pdCtx) await Api.updatePeriod(pdCtx.id, body);
    else await Api.createPeriod(body);
    closeAll();
    toast(pdCtx ? "기간을 수정했어요" : "기간을 만들었어요", "ok");
    S.periods = await Api.periods();
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
  $("#pd-delete").onclick = () => run(async () => {
    if (!pdCtx) return;
    await Api.deletePeriod(pdCtx.id);
    closeAll();
    toast("기간을 삭제했어요", "warn");
    S.periods = await Api.periods();
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}

/* ── Me 필드 편집 (3장) ────────────────────────────────────── */
let meCtx = null;
function openMe(field) {
  meCtx = field;
  $("#me-head").textContent = ME_LABELS[field] || field;
  const row = (S.me && S.me.fields.find((f) => f.field === field)) || null;
  $("#me-value").value = row ? row.value : "";
  openSheet("sh-me");
}
function addMeField() {
  const known = Object.keys(ME_LABELS);
  const used = new Set((S.me ? S.me.fields : []).map((f) => f.field));
  const next = known.find((k) => !used.has(k));
  if (!next) return toast("기본 필드는 모두 채웠어요 — 값을 눌러 수정해요");
  openMe(next);
}
function bindMeSheet() {
  $("#me-save").onclick = () => run(async () => {
    const v = $("#me-value").value.trim();
    if (!v) return toast("내용을 적어 주세요");
    await Api.putMe(meCtx, v);
    closeAll();
    toast("Me를 갱신했어요 — 변경 이력에 남아요", "ok");
    renderMe();
  });
}

/* ── Feelings 필드 고르기 (1.5) ────────────────────────────
 * 축을 바꾸는 건 시계열을 바꾸는 일이다 — 추가는 쉽게, 제거는 경고와 함께. */
const FIELD_CATALOG = [
  ["energy", "기력"], ["stress", "스트레스"], ["focus", "집중"],
  ["sleep", "수면"], ["anxiety", "불안"], ["mood", "기분"], ["pain", "통증"],
];
let fieldSel = null, fieldUsage = {};
async function openFields() {
  fieldSel = new Set(feelingsFields());
  try {
    const rows = await Api.diary(90);
    fieldUsage = {};
    for (const r of rows) for (const s of (r.feelings || "").split(",").filter(Boolean)) {
      const f = s.split(":")[0];
      fieldUsage[f] = (fieldUsage[f] || 0) + 1;
    }
  } catch { fieldUsage = {}; }
  renderFieldList();
  openSheet("sh-fields");
}
function renderFieldList() {
  const extra = feelingsFields().filter((f) => !FIELD_CATALOG.some(([k]) => k === f)).map((f) => [f, ""]);
  $("#field-list").innerHTML = [...FIELD_CATALOG, ...extra].map(([k, ko]) => {
    const on = fieldSel.has(k), used = fieldUsage[k] || 0;
    return `<button class="${on ? "on" : ""}" onclick="toggleField('${k}')">
      <span class="bx">✓</span><span class="n">${esc(k)}${ko ? ` <span class="cap">${ko}</span>` : ""}</span>
      <span class="d">${used ? `${used}일 기록` : on ? "" : "새 축"}</span></button>`;
  }).join("");
}
function toggleField(k) {
  if (fieldSel.has(k)) {
    const used = fieldUsage[k] || 0;
    if (used) {
      run(async () => {
        const r = await confirmAsk("이 축을 뺄까요?",
          `<b>${esc(k)}</b>에는 <b>${used}일치</b> 기록이 있어요. 빼도 지난 기록은 남지만 오늘부터 끊겨서, 나중에 그래프와 분석에서 비교가 어려워져요.`, "그래도 빼기");
        if (r === "ok") { fieldSel.delete(k); renderFieldList(); }
      });
      return;
    }
    fieldSel.delete(k);
  } else {
    if (fieldSel.size >= 6) return toast("한 번에 매기기엔 너무 많아요 — 6개까지", "warn");
    fieldSel.add(k);
    if (!(fieldUsage[k] || 0)) toast("새 축은 오늘부터 쌓여요 — 나중에 빼면 그 구간이 끊겨요", "warn");
  }
  renderFieldList();
}
function bindFieldsSheet() {
  $("#feel-fields").onclick = () => run(openFields);
  $("#fields-save").onclick = () => run(async () => {
    const list = [...FIELD_CATALOG.map(([k]) => k), ...feelingsFields()].filter((k, i, a) => a.indexOf(k) === i)
      .filter((k) => fieldSel.has(k));
    if (!list.length) return toast("적어도 하나는 남겨 주세요", "warn");
    await Api.putSetting("feelings_fields", JSON.stringify(list));
    S.settings.feelings_fields = JSON.stringify(list);
    closeAll();
    toast("필드를 저장했어요", "ok");
    refreshToday();
  });
}

/* ── AI 연결 — 제공자를 여러 곳 등록 ───────────────────── */
let connPick = null;
async function openAi() {
  const c = await Api.connections();
  S.conn = c;
  connPick = connPick || c.connections.find((x) => x.has_key)?.provider || c.connections[0].provider;
  $("#conn-list").innerHTML = c.connections.map((x) =>
    `<div class="conn"><span class="nm">${esc(x.label)}</span>
      <span class="st ${x.has_key ? "on" : ""}">${x.has_key ? "연결됨" : "미연결"}</span></div>`).join("");
  $("#conn-pick").innerHTML = c.connections.map((x) =>
    `<button class="${x.provider === connPick ? "on" : ""}" onclick="pickConn('${x.provider}')">${esc(x.label)}</button>`).join("");
  $("#conn-key").placeholder = (S.providers?.[connPick]?.keyHint) || "키 입력";
  $("#conn-key").value = "";
  $("#conn-result").textContent = "";
  openSheet("sh-ai");
}
function pickConn(p) { connPick = p; openAi(); }
function bindAiSheet() {
  $("#conn-save").onclick = () => run(async () => {
    const v = $("#conn-key").value.trim();
    if (!v) return toast("키를 입력해 주세요", "warn");
    await Api.putSetting("ai_key_" + connPick, v);
    S.settings = Object.fromEntries((await Api.settings()).map((r) => [r.key, r.value]));
    toast(`${S.providers[connPick].label} 연결했어요`, "ok");
    openAi();
    renderMe();
  });
  $("#conn-clear").onclick = () => run(async () => {
    const r = await confirmAsk("키를 지울까요?", `${S.providers[connPick].label} 연결이 끊겨요.`, "지우기");
    if (r !== "ok") return;
    await Api.putSetting("ai_key_" + connPick, "");
    S.settings = Object.fromEntries((await Api.settings()).map((r2) => [r2.key, r2.value]));
    toast("키를 지웠어요", "warn");
    openAi();
    renderMe();
  });
  $("#conn-test").onclick = () => run(async () => {
    $("#conn-result").innerHTML = '<span class="spinner"></span> 호출 중…';
    const r = await Api.aiTest("high");
    $("#conn-result").innerHTML = r.ok
      ? `성공 — ${esc(r.provider)} / ${esc(r.model)} · ${r.ms}ms`
      : `실패 — ${esc(r.provider)} / ${esc(r.model)}<br><span style="color:var(--brick)">${esc(r.error)}</span>`;
  });
}

/* ── 설정 편집 (모델 이원화 포함, 8장) ─────────────────────── */
function providerInfo(p) {
  const key = p || S.settings.ai_provider || "anthropic";
  return (S.providers && S.providers[key]) || { label: key, keyHint: "", models: [] };
}
/** 연결된 제공자들의 모델을 'provider/model'로 전부 나열 (없으면 기본 제공자) */
function modelOptions() {
  const conns = (S.conn && S.conn.connections) || [];
  const usable = conns.filter((c) => c.has_key);
  const src = usable.length ? usable : conns;
  return src.flatMap((c) => c.models.map((m) => `${c.provider}/${m}`));
}
const modelLabel = (v) => {
  const i = v.indexOf("/");
  return i < 0 ? v : `${providerInfo(v.slice(0, i)).label} · ${v.slice(i + 1)}`;
};
const SET_DESC = {
  day_boundary: "이 시각 이전의 새벽 기록은 전날로 귀속돼요 (예: 05:00이면 새벽 2시 기록은 어제). 바꿔도 이미 저장된 기록은 재해석되지 않아요.",
  utc_offset: "UTC(협정 세계시) 기준 시차예요. 한국 표준시(KST)는 +09:00. 이 값으로 기록 시각을 만들고 하루 경계를 판단해요.",
  feelings_fields: "쉼표로 구분해요 — 예: energy, stress, focus. 눈금 입력과 AI 분류가 이 목록을 그대로 따라가요. 이미 기록된 날의 값은 남아 있어요.",
  theme: "화면 테마 — '자동'은 기기(OS) 설정을 따라가요. 이 기기에만 적용돼요.",
  model_low: "일상 작업 — Feelings 서술 분류 등. 호출이 잦으니 소형 모델을 권해요.",
  model_high: "추론 작업 — 분석 2-pass, 이후 Guard 판단. 요청할 때만 호출돼요.",
  api_token: "이 앱(서버)에 접속하기 위한 토큰이에요. AI 키와는 다른 것이고, 이 기기에만 저장돼요.",
  ai_provider: "어느 회사의 모델을 쓸지 골라요. 바꾸면 모델 후보도 그 회사 것으로 바뀌어요.",
  ai_api_key: "본인 계정의 AI 키를 넣으면 이 앱이 그 키로 모델을 불러요. 서버에 저장되고, 화면에는 다시 보이지 않아요(설정 여부만 표시). 비워 두면 서버에 등록된 키를 써요.",
};
let stCtx = null;
function openSetting(key) {
  stCtx = key;
  $("#st-head").textContent =
    { day_boundary: "하루 경계 시각", utc_offset: "표준시 오프셋", feelings_fields: "Feelings 필드",
      model_low: "모델 — Low", model_high: "모델 — High", api_token: "앱 접근 토큰",
      ai_provider: "AI 제공자", ai_api_key: "AI 키", theme: "테마" }[key] || key;
  $("#st-desc").textContent = SET_DESC[key] || "";
  const opts = key === "theme" ? ["auto", "light", "dark"]
    : key === "ai_provider" ? Object.keys(S.providers || {})
    : (key === "model_low" || key === "model_high") ? modelOptions()
    : null;
  const cur = key === "api_token" ? (localStorage.getItem("api_token") || "")
    : key === "theme" ? (localStorage.getItem("theme") || "auto")
    : (S.settings[key] || "");
  const label = (o) => key === "ai_provider" ? ((S.providers || {})[o]?.label || o)
    : key === "theme" ? ({ auto: "자동 (기기 설정)", light: "라이트", dark: "다크" }[o] || o)
    : (key === "model_low" || key === "model_high") ? modelLabel(o) : o;
  $("#st-options").innerHTML = opts
    ? opts.map((o) => `<button class="optrow${o === cur ? " on" : ""}" data-v="${o}">${esc(label(o))}<span class="ck">${o === cur ? "✓" : ""}</span></button>`).join("")
    : "";
  $$("#st-options .optrow").forEach((b) => (b.onclick = () => {
    $("#st-value").value = b.dataset.v;
    if (key === "theme") {
      localStorage.setItem("theme", b.dataset.v);
      applyTheme(b.dataset.v);
      renderMe();
    }
    $$("#st-options .optrow").forEach((x) => {
      x.classList.toggle("on", x === b);
      x.querySelector(".ck").textContent = x === b ? "✓" : "";
    });
  }));
  $("#st-value").value = key === "feelings_fields" ? feelingsFields().join(", ")
    : key === "ai_api_key" ? "" : cur;
  $("#st-value").type = (key === "api_token" || key === "ai_api_key") ? "password" : "text";
  $("#st-value").placeholder = key === "ai_api_key" ? (providerInfo().keyHint || "키 입력") : "";
  // 자주 바꾸지 않는 값은 잠가 둔다 — [변경]을 눌러야 편집 (실수 방지)
  const LOCKED = ["api_token", "ai_api_key", "utc_offset"];
  const locked = LOCKED.includes(key) && !!cur;
  $("#st-value").disabled = locked;
  $("#st-unlock").style.display = locked ? "" : "none";
  $("#st-unlock").onclick = () => {
    $("#st-value").disabled = false;
    $("#st-value").value = "";
    $("#st-value").focus();
    $("#st-unlock").style.display = "none";
  };
  $("#st-save").style.display = key === "theme" ? "none" : "";
  openSheet("sh-setting");
}
function bindSettingSheet() {
  $("#st-save").onclick = () => run(async () => {
    let v = $("#st-value").value.trim();
    if (stCtx === "api_token") {
      const okd = await confirmAsk("토큰을 저장할까요?",
        v ? "이 기기에만 저장돼요. 값이 틀리면 서버가 401로 막아요." : "토큰을 지우면 원격 서버에 접속할 수 없어요.", "저장");
      if (!okd) return;
      if (v) localStorage.setItem("api_token", v);
      else localStorage.removeItem("api_token");
      closeAll();
      toast(v ? "토큰을 저장했어요 — 이 기기에만" : "토큰을 지웠어요", v ? "ok" : "warn");
      // 토큰이 없어 부팅이 401로 멈춰 있었다면 여기서 처음부터 다시 — 설정·튜토리얼까지 로드된다
      return loadData();
    }
    if (stCtx === "ai_api_key") {
      const okd = await confirmAsk("AI 키를 저장할까요?",
        v ? "서버에 저장되고, 이후 화면에는 다시 보이지 않아요." : "키를 비우면 서버에 등록된 키(있다면)를 씁니다.", "저장");
      if (!okd) return;
    }
    if (stCtx === "feelings_fields")
      v = JSON.stringify(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean));
    await Api.putSetting(stCtx, v);
    if (stCtx === "ai_provider") {
      // 제공자를 바꾸면 이전 회사의 모델 이름은 통하지 않는다 — 그 회사 기본값으로 맞춰 준다
      S.settings.ai_provider = v;
      const ms = modelOptions();
      if (ms.length) {
        await Api.putSetting("model_low", ms[0]);
        await Api.putSetting("model_high", ms[1] || ms[0]);
        toast(`모델을 ${providerInfo().label} 기본값으로 맞췄어요`, "ok");
      }
    }
    S.settings = Object.fromEntries((await Api.settings()).map((r) => [r.key, r.value]));
    closeAll();
    toast("설정을 저장했어요", "ok");
    renderMe();
    if (stCtx === "feelings_fields" || stCtx === "day_boundary") refreshToday();
  });
}

/* ── Log 수정 (열린 날만) ──────────────────────────────────── */
let lgCtx = null;
function openLog(id) {
  const l = S.today.logs.find((x) => x.id === id);
  if (!l) return;
  lgCtx = l;
  $("#lg-ts").value = hm(l.ts);
  $("#lg-text").value = l.text;
  openSheet("sh-log");
}
function bindLogSheet() {
  $("#lg-save").onclick = () => run(async () => {
    const text = $("#lg-text").value.trim();
    const hhmm = $("#lg-ts").value.trim();
    if (!text) return toast("내용을 적어 주세요");
    const body = { text };
    if (/^\d{2}:\d{2}$/.test(hhmm) && hhmm !== hm(lgCtx.ts))
      body.ts = lgCtx.ts.slice(0, 11) + hhmm + ":00" + lgCtx.ts.slice(19);
    await Api.editLog(lgCtx.id, body);
    closeAll();
    refreshToday();
  });
}

/* ── 분석 실행 (5.3 2-pass) ────────────────────────────────── */
async function runAnalysis() {
  const q = $("#anal-q").value.trim();
  if (!q) return toast("무엇이 궁금한지 적어 주세요");
  const btn = $("#btn-run-anal");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 분석 중 — 2-pass';
  try {
    const a = await Api.runAnalysis(q);
    $("#anal-q").value = "";
    await renderAnalysis();
    toggleAna(a.id, document.querySelector(`[onclick="toggleAna('${a.id}',this)"]`));
    toast("분석을 저장했어요 — 영구 보존", "ok");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "분석 실행";
  }
}

/* ── 탭 전환 · 동기화 ──────────────────────────────────── */
const TAB_ORDER = ["today", "cal", "works", "anal", "me"];
const TAB_SCREEN = { today: "scr-today", cal: "scr-cal", works: "scr-works", anal: "scr-anal", me: "scr-me" };
// 인접 탭 프리렌더 대상 — anal은 렌더 비용이 커서 제외(빈칸 방지가 목적)
const TAB_RENDER = { today: refreshToday, cal: renderCalendar, works: renderWorks, me: renderMe };
function switchTab(tab, animate = true) {
  const i = TAB_ORDER.indexOf(tab);
  if (i < 0) return;
  $("#phone").dataset.tab = tab;
  $$(".screen").forEach((s) => s.classList.toggle("on", s.id === TAB_SCREEN[tab]));
  trackSet($("#tab-track"), i, animate);
  navSlide(i, animate);        // nav 표식도 같은 곡선으로 따라간다
  loadTab(tab);
  prerenderAdjacent(tab);      // 옆 탭 미리 렌더 (드럼 느낌 — 빈칸 방지)
}
function loadTab(tab) {
  if (!S.today) return; // 데이터 준비 전에는 부팅 오버레이가 화면을 덮고 있다
  if (tab === "today") run(refreshToday);
  else if (tab === "cal") run(renderCalendar);
  else if (tab === "works") run(renderWorks);
  else if (tab === "anal") run(renderAnalysis);
  else if (tab === "me") run(renderMe);
}
// 인접 탭을 idle에 미리 렌더 — 드래그 시작 시 옆 화면이 빈칸이 아니게(드럼 느낌).
// 데이터 최신성은 탭 진입 시 loadTab 재실행이 담당하고, 여기선 '빈칸 방지'만 한다.
function prerenderAdjacent(tab) {
  if (!S.today) return;
  const i = TAB_ORDER.indexOf(tab);
  const idle = typeof requestIdleCallback === "function" ? requestIdleCallback : (fn) => setTimeout(fn, 120);
  idle(() => {
    for (const j of [i - 1, i + 1]) {
      const t = TAB_ORDER[j], fn = t && TAB_RENDER[t];
      if (fn && t !== tab) run(fn);
    }
  });
}
function syncAll() {
  run(refreshToday);
  const tab = $("#phone").dataset.tab;
  if (tab !== "today") loadTab(tab);
}

/* ── 스와이프 ───────────────────────────────────────────────
 * 화면 가로 스와이프 = 탭 이동. 단 캘린더 그리드 위에서는 '달 넘기기'가 먼저다.
 * 가로 스크롤 영역(점수 막대·세그먼트)과 세로 스크롤은 건드리지 않는다.
 *
 * 축 잠금은 그대로 둔다 — 세로 스크롤 중 손가락이 옆으로 흐르는 것과 구분하는 유일한 장치다.
 * 다만 '얼마나 갔나'는 이제 손을 뗄 때가 아니라 끄는 내내 화면에 반영된다. */
const AXIS_LOCK = 20;   // 축 잠금 임계 — 하향(A-5, 폰 실측 미세조정 예정)

let dragBlockUntil = 0;

/* 두 캐러셀이 쓰는 공통 제스처. host 위에서 시작한 가로 끌기를 track에 그대로 전달하고,
 * 놓을 때 방향을 판정해 opt.commit(dir)에 넘긴다. */
// ms — 속도를 믿기 시작하는 최소 간격 · 측정 창 · 멈춘 뒤 놓으면 속도는 0
const VEL_MIN_DT = 16, VEL_WIN = 90, VEL_STALE = 130;

function bindCarousel(host, opt) {
  let x0 = 0, y0 = 0, axis = "", tracking = false;
  let refX = 0, refT = 0, moveT = 0, vel = 0;
  const stop = () => { tracking = false; axis = ""; host.classList.remove("dragging"); };

  host.addEventListener("pointerdown", (e) => {
    if (opt.blocked && opt.blocked(e)) { tracking = false; return; }
    x0 = e.clientX; y0 = e.clientY; refX = e.clientX; refT = moveT = Date.now();
    vel = 0; axis = ""; tracking = true;
  }, { passive: true });

  host.addEventListener("pointermove", (e) => {
    if (!tracking) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!axis) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      axis = Math.abs(dx) > Math.abs(dy) * 1.9 ? "x" : "y";   // 더 확실한 가로만(A-5)
      if (axis === "y") { tracking = false; return; }   // 세로 제스처 — 놓아준다
      host.classList.add("dragging");
      try { host.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    }
    /* 속도는 '최근 VEL_WIN 동안 얼마나 갔나'로 잰다. 이벤트 한 칸 차이로 재면
     * 화면 주사율(8~16ms)에 따라 값이 요동치고, 간격이 0인 경우 무한대가 된다. */
    const now = Date.now(), dt = now - refT;
    moveT = now;
    // 한 프레임(≈16ms)은 지나야 속도로 친다. 1ms 간격으로 들어온 값을 그대로 나누면
    // 70px 이동이 70px/ms가 되어 어떤 손짓이든 '던진 것'으로 판정된다.
    if (dt >= VEL_MIN_DT) vel = (e.clientX - refX) / dt;
    if (dt > VEL_WIN) { refX = e.clientX; refT = now; }
    opt.drag(dx);
  }, { passive: true });

  host.addEventListener("pointerup", (e) => {
    if (!tracking) return;
    const moved = axis === "x", dx = e.clientX - x0;
    stop();
    if (!moved) return;
    dragBlockUntil = Date.now() + 200;                  // 끌고 난 직후의 click은 삼킨다(짧게 — A-4)
    const v = Date.now() - moveT > VEL_STALE ? 0 : vel;  // 멈췄다가 뗐으면 던진 게 아니다
    opt.commit(trackDir(dx, v, host.clientWidth || 380));
  }, { passive: true });

  host.addEventListener("pointercancel", () => { if (axis === "x") opt.commit(0); stop(); }, { passive: true });
}

function bindSwipe() {
  const scr = $(".screens");
  const track = () => $("#tab-track");
  const idx = () => Math.max(0, TAB_ORDER.indexOf($("#phone").dataset.tab));
  const noSwipe = (el) => !!(el.closest && el.closest("#cal-rows, .bchart, .wsegs, .seg, .seg-mini, .likert, .dcol, .sheet, .board, .modal, .tut, input, textarea"));

  bindCarousel(scr, {
    blocked: (e) => noSwipe(e.target) || !!S.pick,
    drag: (dx) => {
      const i = idx(), w = scr.clientWidth || 380;
      // 양 끝에서는 저항 — 더 갈 데가 없다는 걸 손으로 알려 준다
      const d = (i === 0 && dx > 0) || (i === TAB_ORDER.length - 1 && dx < 0) ? dx * 0.35 : dx;
      trackDrag(track(), i, d);
      navSlide(i - d / w, false);
    },
    commit: (dir) => {
      const i = idx();
      const next = TAB_ORDER[Math.min(TAB_ORDER.length - 1, Math.max(0, i + dir))];
      if (next === $("#phone").dataset.tab) { trackSet(track(), i, true); navSlide(i, true); }
      else switchTab(next);
    },
  });
}

/* 캘린더 가로 드래그 — 달 넘기기. 항상 가운데(1)에 있고 양옆이 이전·다음 달이라
 * 끄는 동안 다음 달이 그대로 따라 들어온다. */
let calBusy = false, calGen = 0;
function calGo(dir) {
  const track = $("#cal-track");
  if (!dir) return trackSet(track, 1, true, CAL_GAP);
  if (calBusy || !S.today) return;
  calBusy = true;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    track.removeEventListener("transitionend", onEnd);
    clearTimeout(timer);
    S.cal = addMonth(S.cal.y, S.cal.m, dir);
    // 전환이 끝나면 보고 있던 달이 곧 새 '가운데'다 — 지금 있는 pane을 밀어 즉시 재중심화하고
    // calBusy를 바로 푼다(fetch를 기다리지 않아 연속 스와이프가 씹히지 않는다). 반대편으로 넘어간
    // pane은 비워 두고, 정식 3-pane 재조립(renderCalendar)이 뒤이어 비동기로 채운다.
    const panes = [...track.children];
    if (panes.length === 3) {
      if (dir > 0) { panes[0].innerHTML = ""; track.appendChild(panes[0]); }
      else { panes[2].innerHTML = ""; track.insertBefore(panes[2], panes[0]); }
      [...track.children].forEach((p, i) => p.classList.toggle("cur", i === 1));
    }
    trackSet(track, 1, false, CAL_GAP);
    calBusy = false;
    calGen++;                     // 세대 증가 — 이후 renderCalendar만 유효(경합 시 최신 우선)
    run(renderCalendar);
  };
  const onEnd = (e) => { if (e.target === track) finish(); };
  const timer = setTimeout(finish, TRACK_MS + 150);   // transitionend 유실 대비
  track.addEventListener("transitionend", onEnd);
  trackSet(track, 1 + dir, true, CAL_GAP);
}

function bindCalendarDrag() {
  const host = $("#cal-rows");
  bindCarousel(host, {
    blocked: () => !!S.pick || calBusy,   // 날짜 선택 중엔 탭만 받는다
    drag: (dx) => trackDrag($("#cal-track"), 1, dx, CAL_GAP),
    commit: (dir) => calGo(dir),
  });
  host.addEventListener("click", (e) => {
    if (Date.now() < dragBlockUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

/* ── 경계 스트레치 (A-6, #4) ───────────────────────────────
 * .screen이 최상단/최하단에서 더 당겨질 때만 감쇠 translateY + 스냅백.
 * 정통 러버밴드(preventDefault)가 아니다 — passive 유지, 네이티브 스크롤이 소비할 게 없는
 * '끝'에서만 관여한다. 가로 제스처(스와이프)·시트/보드·가로스크롤 영역은 건드리지 않는다.
 * ⚠️ 기기 실측 필요 — 이상하면 boot()의 bindEdgeStretch() 호출 한 줄만 지우면 꺼진다. */
const STRETCH_MAX = 48, STRETCH_K = 0.3;
function bindEdgeStretch() {
  const noStretch = (el) => !!(el && el.closest && el.closest(".bchart,.wsegs,.seg,.seg-mini,.likert,.dcol,input,textarea"));
  $$(".screen").forEach((sc) => {
    let y0 = 0, x0 = 0, on = false, cap = 0;
    sc.addEventListener("pointerdown", (e) => {
      if (noStretch(e.target)) { on = false; return; }
      y0 = e.clientY; x0 = e.clientX; on = true;
      cap = sc.scrollHeight - sc.clientHeight;   // 세로 스크롤 여유
    }, { passive: true });
    sc.addEventListener("pointermove", (e) => {
      if (!on) return;
      const dy = e.clientY - y0, dx = e.clientX - x0;
      if (Math.abs(dy) <= Math.abs(dx)) return;   // 가로 제스처는 스와이프 몫
      let s = 0;
      if (sc.scrollTop <= 0 && dy > 0) s = Math.min(dy * STRETCH_K, STRETCH_MAX);
      else if (sc.scrollTop >= cap - 1 && dy < 0) s = Math.max(dy * STRETCH_K, -STRETCH_MAX);
      if (s) { sc.style.transition = "none"; sc.style.transform = `translateY(${s}px)`; }
      else if (sc.style.transform) sc.style.transform = "";
    }, { passive: true });
    const release = () => {
      if (!on) return;
      on = false;
      if (sc.style.transform) {
        sc.style.transition = `transform ${TRACK_MS}ms ${TRACK_EASE}`;
        sc.style.transform = "";
      }
    };
    sc.addEventListener("pointerup", release, { passive: true });
    sc.addEventListener("pointercancel", release, { passive: true });
  });
}

/* ── 부트 ──────────────────────────────────────────────────
 * 바인딩은 한 번, 데이터 로드는 실패 시 재시도할 수 있게 분리한다.
 * 로드 전에는 오버레이가 화면을 덮어 조작(=날짜 없는 렌더)을 막는다. */
function bootUI(state, msg) {
  const el = $("#boot");
  if (state === "done") return el.classList.remove("on");
  el.classList.add("on");
  el.querySelector(".spinner").style.display = state === "loading" ? "" : "none";
  $("#boot-msg").innerHTML = msg;
  $("#boot-retry").style.display = state === "error" ? "" : "none";
  $("#boot-token").style.display = state === "auth" ? "" : "none";
}

async function loadData() {
  bootUI("loading", "불러오는 중…");
  try {
    const [settings, periods, providers, conn] = await Promise.all([
      Api.settings(), Api.periods(), Api.providers(), Api.connections()]);
    S.providers = providers;
    S.conn = conn;
    S.settings = Object.fromEntries(settings.map((r) => [r.key, r.value]));
    S.periods = periods;
    await refreshToday();
    S.cal = { y: +S.today.date.slice(0, 4), m: +S.today.date.slice(5, 7) };
    bootUI("done");
    loadTab($("#phone").dataset.tab);
    if (!localStorage.getItem("tutorial_done")) showTutorial(0);
  } catch (e) {
    if (e.status === 401) bootUI("auth", "인증이 필요해요.<br>이 기기에 API 토큰을 넣어 주세요.");
    else bootUI("error", `서버에 연결하지 못했어요.<br><span class="cap">${esc(e.message)}</span>`);
  }
}

/** 하루가 넘어갔거나 오래 떠 있던 화면 — 다시 볼 때 조용히 새로고침 */
function bindForegroundRefresh() {
  let last = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!S.today) return void loadData();
    if (Date.now() - last < 60_000) return;
    last = Date.now();
    run(async () => {
      const before = S.today.date;
      await refreshToday();
      if (S.today.date !== before) { // 귀속일이 바뀜 (05:00 경계 통과)
        S.cal = { y: +S.today.date.slice(0, 4), m: +S.today.date.slice(5, 7) };
        loadTab($("#phone").dataset.tab);
        toast(`${md(S.today.date)}로 넘어갔어요`);
      }
    });
  });
}

let booted = false;
async function boot() {
  // DOMContentLoaded가 두 번 오는 환경(테스트 하니스·일부 웹뷰)에서도 바인딩은 한 번만.
  // 두 번 걸리면 스와이프 한 번에 탭이 두 칸 넘어가는 식으로 조용히 어긋난다.
  if (booted) return;
  booted = true;
  // 목업 인터랙션 바인딩 (구조 동일)
  $$("nav button").forEach((b) => (b.onclick = () => switchTab(b.dataset.go)));
  $$("[data-f]").forEach((b) => (b.onclick = () => {
    $$("[data-f]").forEach((x) => x.classList.toggle("on", x === b));
    $("#feel-s").style.display = b.dataset.f === "s" ? "" : "none";
    $("#feel-m").style.display = b.dataset.f === "m" ? "" : "none";
  }));
  $$("[data-cv]").forEach((b) => (b.onclick = () => {
    $$("[data-cv]").forEach((x) => x.classList.toggle("on", x === b));
    $("#cal-grid").style.display = b.dataset.cv === "grid" ? "" : "none";
    $("#cal-list").style.display = b.dataset.cv === "list" ? "" : "none";
    if (b.dataset.cv === "list") run(renderDiaryList);
  }));
  $$(".wseg").forEach((b) => (b.onclick = () => {
    $$(".wseg").forEach((x) => x.classList.toggle("on", x === b));
    $$(".wview").forEach((v) => v.classList.toggle("on", v.id === "w-" + b.dataset.w));
  }));

  // Log 입력줄
  const send = () => {
    const v = $("#log-input").value.trim();
    if (!v) return;
    const closed = S.today && S.today.daily && S.today.daily.status === "closed";
    run(async () => {
      if (closed) { await Api.memo(S.today.date, isoNowLocal(), v); toast("memo를 남겼어요", "ok"); }
      else await Api.addLog(v);
      $("#log-input").value = "";
      refreshToday();
    });
  };
  $("#log-send").onclick = send;
  $("#log-input").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  const tick = () => ($("#log-ts").textContent = hm(isoNowLocal()));
  tick(); setInterval(tick, 20_000);

  // 마감
  const askClose = (kind) => run(async () => {
    const okd = await confirmAsk(
      kind === "brief" ? "간략히 마감할까요?" : "오늘 하루를 마감할까요?",
      kind === "brief"
        ? "Feelings만 확정하고 닫아요. 마감하면 오늘의 Log·점수는 더 이상 고칠 수 없고, memo만 덧붙일 수 있어요."
        : "마감하면 오늘의 기록이 봉인돼요 — 이후에는 memo만 추가할 수 있어요. 남은 할 일은 Missed로 확정돼요.",
      "마감하기");
    if (!okd) return;
    await Api.closeDay(kind);
    toast(kind === "brief" ? "간략히 마감했어요" : "하루 마감 — 기록이 봉인됐어요", "ok");
    refreshToday();
  });
  $("#btn-close").onclick = () => askClose("manual");
  $("#btn-close-brief").onclick = () => askClose("brief");

  // manual Feelings 자동 저장 (디바운스)
  let ftTimer = null;
  $("#feel-text").addEventListener("input", () => {
    clearTimeout(ftTimer);
    ftTimer = setTimeout(() => run(() => Api.feelingsText($("#feel-text").value)), 900);
  });

  // 캘린더 내비
  $("#cal-prev").onclick = () => { S.cal.m--; if (S.cal.m < 1) { S.cal.m = 12; S.cal.y--; } run(renderCalendar); };
  $("#cal-next").onclick = () => { S.cal.m++; if (S.cal.m > 12) { S.cal.m = 1; S.cal.y++; } run(renderCalendar); };
  $("#btn-add-period").onclick = () => openPeriod(null);
  $("#btn-run-anal").onclick = runAnalysis;
  $("#me-add").onclick = addMeField;
  $("#feel-classify").onclick = () => run(async () => {
    const r = await Api.classifyFeelings();
    toast(`분류 완료 — ${Object.entries(r.values).map(([k, v]) => k + " " + v).join(" · ")}`);
    refreshToday();
  });

  applyTheme();
  bindSwipe();
  bindCalendarDrag();
  bindEdgeStretch();       // 경계 스트레치 (A-6) — 문제 시 이 줄만 제거하면 꺼짐
  switchTab($("#phone").dataset.tab || "today", false);   // 트랙 초기 위치
  $("#tut-next").onclick = () => { tutStep++; if (tutStep >= TUT.length) endTutorial(); else renderTut(); };
  $("#tut-skip").onclick = endTutorial;

  bindTaskSheet();
  bindAddSheet();
  bindPeriodSheet();
  bindFieldsSheet();
  bindAiSheet();
  bindMeSheet();
  bindSettingSheet();
  bindLogSheet();
  bindEventSheet();
  bindDeferSheet();

  $("#boot-retry").onclick = loadData;
  $("#boot-token").onclick = () => { bootUI("done"); switchTab("me"); toggleSet(true); openSetting("api_token"); };
  bindForegroundRefresh();

  await loadData();
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", boot);
if (typeof module !== "undefined" && module.exports)
  module.exports = { weeksOf, bandPaths, addDaysStr, diffDaysStr, md, dlabel };
