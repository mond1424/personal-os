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
const ageClass = (a) => (a >= 15 ? "age3" : a >= 8 ? "age2" : "age1");
const dial = (rate) =>
  `<svg class="dial" viewBox="0 0 24 24"><circle class="dt" cx="12" cy="12" r="9"/>` +
  `<circle class="dp" cx="12" cy="12" r="9" stroke-dasharray="${(rate * 0.565).toFixed(1)} 56.5" transform="rotate(-90 12 12)"/></svg>`;

/* 월 그리드의 주(일요일 시작) 배열 — 앞뒤 채움 포함 */
function weeksOf(y, m) {
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  let cur = addDaysStr(first, -dowIdx(first));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const weeks = [];
  while (cur <= last) {
    const row = [];
    for (let i = 0; i < 7; i++) { row.push(cur); cur = addDaysStr(cur, 1); }
    weeks.push(row);
  }
  return weeks;
}

/* 경계선 모델 (2.2) — 활성 n개 구간은 밴드 n등분(created_at 순 위→아래).
 * 경계는 시작·끝 전환점에서만 반 칸 폭의 가파른 S-곡선, 나머지는 수평.
 * 시작하는 기간은 두께 0에서 열리고 끝나는 기간은 0으로 닫힌다. */
function bandPaths(dates, periods) {
  const act = dates.map((d) => periods.filter((p) => p.start_date <= d && d <= p.end_date));
  const S_ = (xa, ya, xb, yb) => ` C${(xa + xb) / 2},${ya} ${(xa + xb) / 2},${yb} ${xb},${yb}`;
  const out = [];
  for (const p of periods) {
    let a = -1, b = -1;
    dates.forEach((d, i) => {
      if (p.start_date <= d && d <= p.end_date) { if (a < 0) a = i; b = i; }
    });
    if (a < 0) continue;
    const top = [], bot = [];
    for (let i = a; i <= b; i++) {
      const list = act[i], n = list.length, idx = list.indexOf(p);
      top[i] = 6 + (84 * idx) / n;
      bot[i] = 6 + (84 * (idx + 1)) / n;
    }
    const openL = p.start_date >= dates[a];   // 진짜 시작이 이 행에 (아니면 이전 주에서 이어짐)
    const closeR = p.end_date <= dates[b];
    const x0 = a * 100, x1 = (b + 1) * 100;
    // 위 가장자리 L→R
    let d = openL ? `M${x0},${bot[a]}` + S_(x0, bot[a], x0 + 50, top[a]) : `M${x0},${top[a]}`;
    for (let i = a; i < b; i++) {
      const xb = (i + 1) * 100;
      d += ` H${xb - 25}`;
      d += top[i + 1] !== top[i] ? S_(xb - 25, top[i], xb + 25, top[i + 1]) : ` H${xb + 25}`;
    }
    if (closeR) d += ` H${x1 - 50}` + S_(x1 - 50, top[b], x1, bot[b]);
    else d += ` H${x1} L${x1},${bot[b]}`;
    // 아래 가장자리 R→L
    for (let i = b; i > a; i--) {
      const xb = i * 100;
      d += ` H${xb + 25}`;
      d += bot[i - 1] !== bot[i] ? S_(xb + 25, bot[i], xb - 25, bot[i - 1]) : ` H${xb - 25}`;
    }
    d += ` H${x0} Z`; // openL이면 시작점(바닥)과 만나고, 아니면 Z가 왼쪽 세로변을 만든다
    out.push({ d, fill: p.color });
  }
  return out;
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
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.style.display = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 3200);
}
const run = (fn) => Promise.resolve().then(fn).catch((e) => toast(e.message));

/* 확인 모달 — 되돌릴 수 없는 동작 앞에 한 번 물어본다 */
function confirmAsk(title, text, okLabel = "확인") {
  return new Promise((resolve) => {
    $("#cf-title").textContent = title;
    $("#cf-text").innerHTML = text;
    $("#cf-yes").textContent = okLabel;
    const done = (v) => { $("#confirm").classList.remove("on"); resolve(v); };
    $("#cf-yes").onclick = () => done(true);
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
function closeAll() { $("#bk").classList.remove("on"); $$(".sheet").forEach((s) => s.classList.remove("on")); }

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

  // TODO / Done / 재배정 대기
  $("#td-cnt").textContent = `${T.todo.length} · tasks 조인 뷰`;
  let h = T.todo.map((t) => {
    const per = periodInfo(t.period_id);
    const meta = [
      per ? `<i class="pdot" style="background:${per.color}"></i>${esc(per.title)}` : "",
      t.defer_count > 0 ? `${t.defer_count}회 이월` : "오늘",
    ].filter(Boolean).join(" · ");
    return `<div class="trow">
      <button class="tk" onclick="cycleRate('${t.id}', ${t.rate})" title="완료율"></button>
      <button class="tbody" style="text-align:left" onclick="openTask('${t.id}')">
        <span class="tt">${esc(t.title)}${t.defer_count > 0 ? '<span class="warn">!</span>' : ""}</span>
        <span class="tmeta">${meta}</span></button>
      <button onclick="cycleRate('${t.id}', ${t.rate})">${dial(t.rate)}</button></div>`;
  }).join("");
  if (T.done.length) {
    h += `<details class="fold"><summary>Done ${T.done.length} — 오늘 완료</summary>` +
      T.done.map((t) =>
        `<div class="trow muted"><span class="tk done"></span>
          <span class="tbody"><span class="tt">${esc(t.title)}</span></span>${dial(100)}</div>`).join("") +
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
async function renderScore() {
  const D = S.today.date;
  const diary = await Api.diary(30);
  const map = Object.fromEntries(diary.map((r) => [r.date, r.score]));
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
        const inner = `<span class="ts mono">${t.rate != null && day.relation !== "past" ? "" : "—"}</span><span><i class="pdot" style="display:inline-block;background:${per ? per.color : "var(--faint)"};margin-right:6px"></i>${esc(t.title)}${tag ? ` <span class="cap">${tag}</span>` : ""}</span>`;
        return editable
          ? `<button class="lrow" style="width:100%" onclick="closeAll();openTask('${t.id}')">${inner}</button>`
          : `<div class="lrow">${inner}</div>`;
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
    if (day.relation !== "past")
      h += `<div class="memobox" style="margin-top:12px">
              <input type="text" id="day-add" placeholder="이 날 할 일 추가">
              <button class="mok" onclick="addTaskOn('${k}')">추가</button>
            </div>`;
    if (day.relation === "today")
      h += `<button class="btn ghost" style="margin-top:10px" onclick="closeAll();switchTab('today')">Today 탭 열기 — 기분·Log·마감</button>`;
    $("#day-body").innerHTML = h;
    openSheet("sh-day");
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
    toast("memo 추가 — summary는 stale 처리됐어요");
    openDay(k);
  });
}

/* ── Calendar ──────────────────────────────────────────── */
async function renderCalendar() {
  if (!S.today) return; // 부팅 전 — S.cal이 아직 비어 있다 (날짜 계산 불가)
  const { y, m } = S.cal;
  $("#cal-title").textContent = `${y} · ${m}월`;
  const weeks = weeksOf(y, m);
  const start = weeks[0][0], end = weeks[weeks.length - 1][6];
  const [cal, plist] = await Promise.all([Api.calendar(start, end), Api.periods()]);
  S.calData = cal;
  S.periods = plist;

  const D = S.today ? S.today.date : "";
  const diarySet = new Set(cal.diary.map((r) => r.date));
  // 미룬 항목: 지난 날에는 '옮겨감' 표시로 남고, 오늘·앞으로는 새 날짜에만 보인다
  const byDate = {};
  for (const e of cal.entries) {
    if (e.deferred_to && e.date >= D) continue;
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }

  $("#cal-rows").innerHTML = weeks.map((row) => {
    const paths = bandPaths(row, cal.periods)
      .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-opacity=".4"/>`).join("");
    const cells = row.map((d) => {
      const mut = +d.slice(5, 7) !== m ? " mut" : "";
      const today = d === D ? " today" : "";
      const evs = byDate[d] || [];
      let evHtml = evs.slice(0, 2).map((e) =>
        `<span class="ev${d < D ? " past" : ""}${e.deferred_to ? " moved" : ""}" style="border-left-color:${e.color || "var(--faint)"}">${esc(e.title)}</span>`).join("");
      if (evs.length > 2) evHtml += `<span class="ev more">+${evs.length - 2}</span>`;
      return `<button class="c${mut}${today}" data-d="${d}" onclick="openDay('${d}')">
        <span class="d serif">${+d.slice(8, 10)}</span>${diarySet.has(d) ? '<i class="dr"></i>' : ""}${evHtml}</button>`;
    }).join("");
    return `<div class="cal-row"><svg class="band" viewBox="0 0 700 96" preserveAspectRatio="none">${paths}</svg><div class="cells">${cells}</div></div>`;
  }).join("");

  $("#cal-leg").innerHTML = cal.periods.map((p) =>
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
  run(async () => {
    if (p.mode === "defer") await Api.defer(p.id, p.from, k);
    else await Api.schedule(p.id, k);
    exitPick();
    await Promise.all([refreshToday(), renderCalendar()]);
    openDay(k);
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

  // 세그먼트 라벨·경고색
  $("#seg-wait").textContent = waiting.length ? `대기 ${waiting.length}` : "대기";
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
        `<button class="trow" style="width:100%" onclick="openTask('${r.id}')"><span class="tk"></span>
          <span class="tbody"><span class="tt">${esc(r.title)}${r.defer_count > 0 ? '<span class="warn">!</span>' : ""}</span>
            <span class="tmeta">${r.color ? `<i class="pdot" style="background:${r.color}"></i>` : ""}${md(r.date)}${r.defer_count > 0 ? ` · ${r.defer_count}회 이월` : ""}</span></span>
          ${dial(r.rate)}</button>`).join("") + `</div>`;
  }).join("") || `<p class="cap" style="margin-top:14px">예정된 task가 없어요 — 아래 +로 추가.</p>`;

  // 대기
  $("#inbox-lock").style.display = waiting.some((w) => w.age > 21) ? "" : "none";
  $("#wait-list").innerHTML = waiting.map((w) =>
    `<div class="trow" onclick="openTask('${w.id}')" style="cursor:pointer"><span class="tk"></span>
      <span class="tbody"><span class="tt">${esc(w.title)}</span>
        <span class="tmeta">미배정 · <b class="${ageClass(w.age)}">${w.age}일째</b></span></span>
      <span style="display:flex;gap:6px;flex:none">
        <button class="deferchip" onclick="event.stopPropagation();pickSchedule('${w.id}')">일정 정하기</button>
        ${w.age >= 15 ? `<button class="deferchip" style="border-color:var(--line);color:var(--sub)" onclick="event.stopPropagation();extendTask('${w.id}')">연장</button>` : ""}
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
  $("#done-list").innerHTML = done.map((r) =>
    `<div class="trow muted"><span class="tk done"></span>
      <span class="tbody"><span class="tt">${esc(r.title)}</span><span class="tmeta">${md(r.finished_on)}</span></span>${dial(100)}</div>`).join("") ||
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
        if (t.status === "finished" && t.finished_on === e.date) return `<div class="te">${md(e.date)} · 완료</div>`;
        if (e.date === D) return `<div class="te" style="color:var(--ink);font-weight:600">${md(e.date)} · 예정 (오늘)</div>`;
        if (e.date > D) return `<div class="te">${md(e.date)} · 예정</div>`;
        return `<div class="te">${md(e.date)} · 완료율 ${e.rate}% — 미완료</div>`;
      }).join("");
    } else {
      tl = `<div class="te">대기 · ${t.wait_age}일째</div>`;
    }
    tl += t.extensions.map((x) => `<div class="te">연장 ${md(x.extended_at.slice(0, 10))}</div>`).join("");
    $("#tk-timeline").innerHTML = tl;

    // 완료율 — 오늘(또는 가장 최근 열린) 항목에 적용
    const openEntry = [...t.entries].reverse().find((e) => !e.deferred_to && e.date <= D);
    const rates = [0, 25, 50, 75];
    $("#tk-rates").innerHTML = t.status === "finished"
      ? `<span class="cap">완료된 task예요 — 완료율 100%.</span>`
      : openEntry
        ? rates.map((r) => `<button class="${(openEntry.rate ?? 0) === r ? "on" : ""}" onclick="setRateOn('${t.id}','${openEntry.date}',${r})">${r}%</button>`).join("") +
          `<button onclick="completeFromSheet('${t.id}')">100%</button>`
        : `<span class="cap">예정된 날이 없어요 — 일정을 정하면 완료율을 매길 수 있어요.</span>`;

    const fin = t.status === "finished";
    ["tk-defer", "tk-extend", "tk-complete"].forEach((i) => {
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
      const okd = await confirmAsk("이 일정을 삭제할까요?",
        `“${esc(t.title)}” — 계획을 지우는 거예요. 이미 마감된 날의 기록이 있으면 삭제되지 않아요.`, "삭제");
      if (!okd) return;
      await Api.deleteTask(t.id);
      closeAll();
      toast("삭제했어요");
      syncAll();
      if ($("#phone").dataset.tab === "cal") renderCalendar();
    });
  };
}

function setRateOn(id, date, rate) {
  run(async () => {
    await Api.setRate(id, date, rate);
    await openTask(id);
    syncAll();
  });
}
function completeFromSheet(id) {
  run(async () => {
    await Api.complete(id);
    closeAll();
    toast("완료 100%");
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
    toast("대기에 담았어요");
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
  $("#set-list").innerHTML = [
    ["하루 경계 시각", `${S.settings.day_boundary || "05:00"} ›`, "day_boundary"],
    ["표준시 오프셋", `${S.settings.utc_offset || "+09:00"} ›`, "utc_offset"],
    ["Feelings 필드 구성", `${ff} ›`, "feelings_fields"],
    ["모델 — Low (일상)", `${S.settings.model_low || "—"} ›`, "model_low"],
    ["모델 — High (분석·Guard)", `${S.settings.model_high || "—"} ›`, "model_high"],
    ["API 토큰", `${tok ? "설정됨 ›" : "없음 ›"}`, "api_token"],
    ["테마", `${{ auto: "자동", light: "라이트", dark: "다크" }[localStorage.getItem("theme") || "auto"]} ›`, "theme"],
    ["튜토리얼 다시 보기", "5단계 ›", "tutorial"],
    ["Guard 규칙 · 이력", `규칙 0 · 이벤트 ${guard.length}`, ""],
    ["데이터 내보내기", "md 원본", ""],
  ].map(([k, v, key]) =>
    `<button class="srow"${key === "tutorial" ? ' onclick="showTutorial(0)"' : key ? ` onclick="openSetting('${key}')"` : ' style="opacity:.5"'}>${k}<em>${esc(v)}</em></button>`).join("");
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
    toast(pdCtx ? "기간을 수정했어요" : "기간을 만들었어요");
    S.periods = await Api.periods();
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
  $("#pd-delete").onclick = () => run(async () => {
    if (!pdCtx) return;
    await Api.deletePeriod(pdCtx.id);
    closeAll();
    toast("기간을 삭제했어요");
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
    toast("Me를 갱신했어요 — 변경 이력에 남아요");
    renderMe();
  });
}

/* ── 설정 편집 (모델 이원화 포함, 8장) ─────────────────────── */
const MODEL_OPTIONS = {
  model_low: ["claude-haiku-4-5-20251001", "claude-sonnet-5"],
  model_high: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
};
const SET_DESC = {
  day_boundary: "이 시각 이전의 새벽 기록은 전날로 귀속돼요 (예: 05:00이면 새벽 2시 기록은 어제). 바꿔도 이미 저장된 기록은 재해석되지 않아요.",
  utc_offset: "UTC(협정 세계시) 기준 시차예요. 한국 표준시(KST)는 +09:00. 이 값으로 기록 시각을 만들고 하루 경계를 판단해요.",
  feelings_fields: "쉼표로 구분해요 — 예: energy, stress, focus. 눈금 입력과 AI 분류가 이 목록을 그대로 따라가요. 이미 기록된 날의 값은 남아 있어요.",
  theme: "화면 테마 — '자동'은 기기(OS) 설정을 따라가요. 이 기기에만 적용돼요.",
  model_low: "일상 작업 — Feelings 서술 분류 등. 호출이 잦으니 소형 모델을 권해요.",
  model_high: "추론 작업 — 분석 2-pass, 이후 Guard 판단. 요청할 때만 호출돼요.",
  api_token: "이 기기에만 저장돼요(localStorage). 원격 배포에 API_TOKEN을 걸었다면 필요해요.",
};
let stCtx = null;
function openSetting(key) {
  stCtx = key;
  $("#st-head").textContent =
    { day_boundary: "하루 경계 시각", utc_offset: "표준시 오프셋", feelings_fields: "Feelings 필드",
      model_low: "모델 — Low", model_high: "모델 — High", api_token: "API 토큰" }[key] || key;
  $("#st-desc").textContent = SET_DESC[key] || "";
  const opts = key === "theme" ? ["auto", "light", "dark"] : MODEL_OPTIONS[key];
  const cur = key === "api_token" ? (localStorage.getItem("api_token") || "")
    : key === "theme" ? (localStorage.getItem("theme") || "auto")
    : (S.settings[key] || "");
  $("#st-options").innerHTML = opts
    ? opts.map((o) => `<button class="optrow${o === cur ? " on" : ""}" data-v="${o}">${o}<span class="ck">${o === cur ? "✓" : ""}</span></button>`).join("")
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
  $("#st-value").value = key === "feelings_fields" ? feelingsFields().join(", ") : cur;
  $("#st-value").type = key === "api_token" ? "password" : "text";
  // 토큰은 실수로 지워지지 않게 잠가 둔다 — [변경]을 눌러야 편집
  const locked = key === "api_token" && !!cur;
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
      toast(v ? "토큰을 저장했어요 — 이 기기에만" : "토큰을 지웠어요");
      renderMe();
      return syncAll();
    }
    if (stCtx === "feelings_fields")
      v = JSON.stringify(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean));
    await Api.putSetting(stCtx, v);
    S.settings = Object.fromEntries((await Api.settings()).map((r) => [r.key, r.value]));
    closeAll();
    toast("설정을 저장했어요");
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

/* ── 완료율 다이얼 — 0 → 25 → 50 → 75 → 100(완료) ─────────── */
function cycleRate(id, cur) {
  const next = [0, 25, 50, 75, 100];
  const v = next[(next.findIndex((x) => x >= cur) + 1) % next.length];
  run(async () => {
    if (v === 100) { await Api.complete(id); toast("완료 100%"); }
    else await Api.setRate(id, S.today.date, v);
    syncAll();
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
    toast("분석을 저장했어요 — 영구 보존");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "분석 실행";
  }
}

/* ── 탭 전환 · 동기화 ──────────────────────────────────── */
const TAB_SCREEN = { today: "scr-today", cal: "scr-cal", works: "scr-works", anal: "scr-anal", me: "scr-me" };
function switchTab(tab) {
  $("#phone").dataset.tab = tab;
  $$("nav button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
  $$(".screen").forEach((s) => s.classList.toggle("on", s.id === TAB_SCREEN[tab]));
  loadTab(tab);
}
function loadTab(tab) {
  if (!S.today) return; // 데이터 준비 전에는 부팅 오버레이가 화면을 덮고 있다
  if (tab === "today") run(refreshToday);
  else if (tab === "cal") run(renderCalendar);
  else if (tab === "works") run(renderWorks);
  else if (tab === "anal") run(renderAnalysis);
  else if (tab === "me") run(renderMe);
}
function syncAll() {
  run(refreshToday);
  const tab = $("#phone").dataset.tab;
  if (tab !== "today") loadTab(tab);
}

/* ── 스와이프 ───────────────────────────────────────────────
 * 화면 가로 스와이프 = 탭 이동. 단 캘린더 그리드 위에서는 '달 넘기기'가 먼저다.
 * 가로 스크롤 영역(점수 막대·세그먼트)과 세로 스크롤은 건드리지 않는다. */
const TAB_ORDER = ["today", "cal", "works", "anal", "me"];
function bindSwipe() {
  const scr = $(".screens");
  let x0 = 0, y0 = 0, tracking = false, onCal = false;
  const noSwipe = (el) => !!(el.closest && el.closest(".bchart, .wsegs, .seg, .likert, .sheet, .board, .modal, .tut, input, textarea"));

  scr.addEventListener("pointerdown", (e) => {
    if (noSwipe(e.target)) { tracking = false; return; }
    x0 = e.clientX; y0 = e.clientY; tracking = true;
    onCal = !!(e.target.closest && e.target.closest("#cal-rows, .wkdays"));
  }, { passive: true });

  scr.addEventListener("pointerup", (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return; // 세로 스크롤 우선
    if (S.pick) return;                                                 // 날짜 선택 중엔 무시
    if (onCal && $("#phone").dataset.tab === "cal") {                   // 캘린더 위 = 달 넘기기
      (dx < 0 ? $("#cal-next") : $("#cal-prev")).click();
      return;
    }
    const i = TAB_ORDER.indexOf($("#phone").dataset.tab);
    const next = TAB_ORDER[Math.min(TAB_ORDER.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))];
    if (next !== $("#phone").dataset.tab) switchTab(next);
  }, { passive: true });
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
    const [settings, periods] = await Promise.all([Api.settings(), Api.periods()]);
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

async function boot() {
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
      if (closed) { await Api.memo(S.today.date, isoNowLocal(), v); toast("memo를 남겼어요"); }
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
    toast(kind === "brief" ? "간략히 마감했어요" : "하루 마감 — 기록이 봉인됐어요");
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
  $("#tut-next").onclick = () => { tutStep++; if (tutStep >= TUT.length) endTutorial(); else renderTut(); };
  $("#tut-skip").onclick = endTutorial;

  bindTaskSheet();
  bindAddSheet();
  bindPeriodSheet();
  bindMeSheet();
  bindSettingSheet();
  bindLogSheet();

  $("#boot-retry").onclick = loadData;
  $("#boot-token").onclick = () => { bootUI("done"); switchTab("me"); toggleSet(true); openSetting("api_token"); };
  bindForegroundRefresh();

  await loadData();
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", boot);
if (typeof module !== "undefined" && module.exports)
  module.exports = { weeksOf, bandPaths, addDaysStr, diffDaysStr, md, dlabel };
