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
/* 세 번 밀린 일에 출구를 준다 (T-35 · ADR-036).
 * **N은 여기 한 자리뿐이다** — 실사용이 정한다. 잦으면 올리고 한 번도 안 뜨면 내린다.
 * 한 번은 흔하고 두 번도 있을 수 있어서 3에서 시작한다. */
const CARRY_N = 3;
const CARRY_SEEN = "carry_seen";   // 하루 한 번 — 귀속일 하나를 localStorage에 (§②)
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
const CAL_PANE_COUNT = 5, CAL_CENTER = 2, CAL_TRACK_STEP = 100 / CAL_PANE_COUNT;
// 요일 헤더는 각 '월 카드'(.calpane) 안에 들어간다 — 카드가 통째로 슬라이드하도록(고정 프레임 아님)
const CAL_WKDAYS = '<div class="wkdays"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div>';
/* 셀 공간 예산 — 셀 폭 ~48px · 폰트 9px이라 줄 수가 곧 정보량이다.
 * 총 CELL_MAX_LINES줄을 우선순위대로 동적 배분한다:
 *   일정(최대 CELL_EV_MAX + 초과 시 '일정 +N' 한 줄) → 할 일 1줄 → memo 1줄 → 남으면 할 일 2번째 줄
 * '할 일 > memo'이되 할 일 확장이 memo를 굶기지 않게 memo 자리를 먼저 비워둔다.
 * 넘치는 것은 전부 '+n'으로 접는다. 폰 실측 후 상수만 조정하면 된다(하드코딩 금지). */
const CELL_MAX_LINES = 4, CELL_EV_MAX = 2, CELL_TK_MAX = 2;

// gap>0이면 pane 사이 간격(px)을 위치 계산에 더한다 — %만으로는 gap이 어긋난다
function trackSet(el, i, animate, gap = 0, step = 100) {
  if (!el) return;
  el.style.transition = animate ? `transform ${TRACK_MS}ms ${TRACK_EASE}` : "none";
  el.style.transform = gap ? `translateX(calc(${-i * step}% - ${i * gap}px))` : `translateX(${-i * step}%)`;
}
function trackDrag(el, i, dx, gap = 0, step = 100) {
  if (!el) return;
  el.style.transition = "none";
  el.style.transform = `translateX(calc(${-i * step}% - ${i * gap}px + ${dx}px))`;
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
  goals: [],
  goalsSchema: null,
  education: [],
  educationSchema: null,
  guardModes: null,
  pick: null,           // {mode:'defer'|'schedule', id, title, from?, origin}
  sheetTask: null,
  staleShown: false,
  level4: false,        // 피커 **안내**용 (ADR-035) — 판정은 붙는 자리가 다시 묻는다
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
  // 종류 클래스는 t- 접두사 필수 — 무접두사 warn/ok는 전역 배지 클래스(.warn=15px 원형)와 충돌한다.
  el.className = "lockbar toast t-" + kind;
  el.textContent = msg;
  el.style.display = "none";       // 애니메이션 재시작
  void el.offsetWidth;
  el.style.display = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), kind === "err" ? 4200 : 3000);
}
const run = (fn) => Promise.resolve().then(fn).catch((e) => toast(e.message, "err"));

/* ── Level 4 게이트 (ADR-035) ──────────────────────────────
 *
 * Level 4 구간에는 **오늘 날짜가 붙지 않는다.** 막는 것이 아니다 — 적는 것도,
 * 대기에 담는 것도, 내일 이후 아무 날짜나 고르는 것도 전부 그대로다.
 * 바뀌는 것은 **그것이 어느 날에 놓이는가** 하나다.
 *
 * **판정은 기기가 한다**(ADR-035 ②). 여기서 창 길이를 다시 계산하지 않는다 —
 * 30분이 두 곳에 생기면 그 둘은 갈라진다. 받은 불리언을 그대로 쓴다.
 *
 * **모르면 걸지 않는다.** 플러그인이 없으면(브라우저 PWA · 구버전 APK) false다.
 * ADR-024의 fail-closed와 방향이 같다 — **모르면 덜 개입한다.**
 * 발동하지도 않은 기기에서 날짜가 튀면 그것이 §6.3의 도구 이탈이다.
 */
async function askLevel4() {
  const G = globalThis.Capacitor?.Plugins?.Guard;
  if (!G?.level4State) return false;
  try {
    const r = await G.level4State();
    return !!r?.level4;
  } catch {
    return false;   // 물어보다 실패한 것도 '모른다'다
  }
}

/** 옮겨졌으면 말한다 — 이유 없이 날짜가 바뀌면 고장으로 읽힌다(ADR-035 ⑤).
 *  **남은 시간을 시각으로 보여주지 않는다**: 카운트다운은 기다리라는 초대이고,
 *  발동이 이어지면 창이 갱신되므로 그 시각은 애초에 약속이 아니다. */
const LEVEL4_MOVED = (date) => `Guard 개입 중이라 ${md(date)}로 넣었어요`;
const LEVEL4_BLOCKED = "Guard 개입 중이에요 — 내일 이후로 골라주세요";

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

/* 열린 오버레이 상태를 셸에 반영한다 — 배경 on/off · 겹침 깊이 · 아래 시트 눌림.
   시트를 여닫는 모든 경로에서 호출한다. 깊이는 시트만 센다:
   모달은 자기 배경(.45)이 따로 있어 시트 위에 뜨면 이미 어두워진다.
   '위' 판정은 DOM 순서 — 시트끼리 z-index가 같아 나중 것이 위에 그려진다. */
function syncOverlay() {
  const open = $$(".sheet.on");            // NodeList — slice 없음. forEach 인덱스로 판정한다
  const bk = $("#bk"), ph = $("#phone");
  if (bk) bk.classList.toggle("on", open.length > 0);
  $$(".sheet").forEach((s) => s.classList.remove("under"));
  open.forEach((s, i) => { if (i < open.length - 1) s.classList.add("under"); });
  if (ph) ph.dataset.depth = Math.min(open.length, 3);   // 셸이 없어도 던지지 않는다(검사 하네스)
}

/* 하드웨어 뒤로가기 — **맨 위 하나만** 닫는다 (T-34).
 *
 * **판단과 리스너를 나눈다.** jsdom엔 Capacitor가 없으므로 판단을 리스너 안에 넣으면
 * 검사가 0이 된다 — T-33이 고친 그 자리와 같은 종류다. 이 함수는 순수하고
 * `front.mjs`가 직접 부른다.
 *
 * ★ **개입 화면의 뒤로가기 차단과 무관하다.** `GuardAlertActivity`는 `OnBackInvokedDispatcher`로
 *   뒤로가기를 **의도적으로 막는다** — 그게 ADR-026의 Override 마찰이고, 뒤로가기로 빠져나갈 수
 *   있으면 60초·180초 대기가 통째로 무의미해진다. **다른 액티비티이고 여기는 메인의 웹 화면만 본다.**
 *
 * @returns 무엇을 닫았는지. **`null`이면 아무것도 안 닫았다 — 앱이 나간다.**
 *   ④를 반드시 남긴다: 뒤로가기로 앱을 못 나가면 사용자가 갇히고, 그건 이 티켓이
 *   고치려는 것보다 나쁘다. "두 번 누르면 종료" 같은 것도 두지 않는다 —
 *   마찰은 Guard가 쓰는 도구이지 앱 전체가 쓰는 것이 아니다.
 */
function handleBack() {
  // ① 겹쳐 있으면 하나씩. '위' 판정은 DOM 순서다(syncOverlay와 같은 기준) —
  //    시트끼리 z-index가 같아 나중 것이 위에 그려진다.
  const open = $$(".sheet.on");
  if (open.length) { closeSheet(open[open.length - 1].id); return "sheet"; }
  // ② 날짜 선택 모드 — 원래 탭으로 되돌린다. 새 경로를 만들지 않고 cancelPick을 그대로 쓴다.
  if (S.pick) { cancelPick(); return "pick"; }
  // ③ Today가 아니면 Today로.
  if ($("#phone").dataset.tab !== "today") { switchTab("today"); return "tab"; }
  return null;   // ④ Today에서 아무것도 안 열려 있다 — 막지 않는다.
}

function openSheet(id) { $("#" + id).classList.add("on"); syncOverlay(); }
function closeSheet(id) { $("#" + id).classList.remove("on"); syncOverlay(); }   // 겹쳐 뜬 시트 하나만
function closeAll() {
  cancelModeChange(false);
  $$(".sheet").forEach((s) => s.classList.remove("on"));
  evxCtx = null; dfxCtx = null;   // 배경 탭으로 닫아도 진행 중인 입력은 버린다
  syncOverlay();
}

/* ── Today ─────────────────────────────────────────────── */
async function refreshToday() {
  S.today = await Api.today();
  renderToday();
  loadNotice();
  loadGuardOutcome();
  loadCollected();
  if (!S.staleShown && S.today.overdue.length) { S.staleShown = true; showStale(S.today.overdue[0]); }
  maybeCarryPrompt();   // 세 번 밀린 일의 출구 (T-35). 조건을 넘는 게 없으면 아무 일도 없다.
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
        `<div class="evrow"><span class="et mono">${e.time || "종일"}</span><span class="en">${esc(e.title)}</span>` +
        (e.protect_from ? '<span class="ev-protect-badge">보호</span>' : "") + `</div>`).join("") + `</div>`;
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
      </div>`;
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
  renderCloseSummary();   // 점수 앞 한 줄 (T-44) — 던져도 아래 마감 배선을 막지 않는다
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

/* Guard outcome 확정 (설계 §6.5) — 루프의 마지막 조각.
 *
 * "outcome 은 Guard 가 직접 판단하지 않는다. 이후 해당 task 또는 period 의
 *  실제 결과와 연결되어 사후 확정된다."
 *
 * 이게 없으면 `발동 → 반응 → 기록`까지만 돌고 닫히지 않는다. 그러면
 * 자기 보정이 "이 규칙이 과했나"를 판정할 재료가 없다 — 개입은 있었는데 결과를 모르니까.
 *
 * 한 번에 하나만 묻는다. 여러 개를 늘어놓으면 대충 눌러 치우게 되고,
 * 그렇게 들어온 outcome은 없는 것보다 나쁘다(보정을 잘못된 방향으로 끈다).
 */
async function loadGuardOutcome() {
  const bar = $("#td-guard");
  /* 세 상태를 남긴다 (T-33). **화면 동작은 하나도 안 바뀐다** — 여전히 `ask`만 뜬다.
   *
   * `display:none`이 두 가지를 뜻하고 있었다: *"물어볼 게 없다"*(정상)와
   * *"못 물어봤다"*(회귀). 화면에서 둘이 똑같이 보이고 **검사도 가를 수 없어서**,
   * 조회가 항상 실패해도 "안 뜬다"는 그대로 초록이었다(AGENT-CHAIN §5).
   *
   * 상태는 **DOM에만** 둔다 — 검사가 DOM으로 보고, 두 곳에 두면 갈라진다.
   * 사용자에게 보이는 것은 늘리지 않는다. 늘어나는 것은 기록뿐이다. */
  const set = (state) => {
    bar.dataset.state = state;
    bar.style.display = state === "ask" ? "flex" : "none";
  };
  try {
    const rows = await Api.guardPending();
    const r = rows?.[0];
    if (!r) return void set("none");

    const what = r.event_title || "그 일";
    const when = r.event_date ? md(r.event_date) : md(r.on_date);
    const lv = r.reaction === "override" ? "넘어갔던" : "받아들였던";
    $("#td-guard-text").innerHTML = `<b>${when} ${esc(what)}</b> — ${lv} 개입이었어요. 결과가 어땠나요?`;

    const send = (outcome) => run(async () => {
      await Api.guardOutcome(r.id, outcome);
      // **여기도 `set()`을 지난다.** 직접 `display`만 끄면 `data-state`가 `ask`에 남아
      // 상태와 화면이 갈린다 — 두 곳에 두면 갈라진다는 그 모양이 한 함수 안에서 생긴다.
      // 방금 하나를 답했으니 그 순간은 '물어볼 게 없다'가 맞고, 곧 아래가 다시 정한다.
      set("none");
      toast(outcome === "success" ? "기록했어요" : "기록했어요 — 다음 판단에 쓰여요");
      return loadGuardOutcome();   // 남은 게 또 있으면 이어서 묻는다
    });
    $("#td-guard-ok").onclick = () => send("success");
    $("#td-guard-no").onclick = () => send("failure");
    set("ask");
  } catch {
    // 화면은 막지 않는다 — Guard가 아직 없는 기기에서도 Today는 떠야 한다.
    // 그 판단은 옳았고, 바뀐 것은 **이 실패가 이제 이름을 갖는다**는 것뿐이다.
    set("error");
  }
}

/* 수집한 학사 일정 제안 (T-42 · ADR-030 본체 · ADR-037) ──────
 *
 * **T-33의 outcome 카드와 같은 모양이다** — 한 줄 · `data-state` 셋 · `catch`가 화면을 안 막는다.
 * 새 패턴을 만들지 않는다. `none`과 `error`가 화면에서 똑같이 안 보이는 것도 같고,
 * 그래서 **둘을 가르는 검사가 짝**이다(T-33에서 그것 때문에 조회 실패가 초록이었다).
 *
 * ★ **문구에 "마감"·"제출"을 쓰지 않는다.** `DTSTART`가 마감 시각인지 아직 모른다
 * (ADR-037 §실측). 이름을 믿는 순간 그것이 해석이고, 개강 첫날 틀린다 —
 * **원문과 시각만** 보여준다. `summary`를 다듬지도 않는다.
 *
 * **"전부 추가"를 두지 않는다.** 첫 수집에 무엇이 들어오는지 아직 아무도 못 봤다.
 * 지금 만들면 오수집을 한 번에 캘린더에 붓는 버튼이 된다 — 보고 나서 정한다.
 */
async function loadCollected() {
  const bar = $("#td-coll");
  const set = (state) => {
    bar.dataset.state = state;
    bar.style.display = state === "ask" ? "flex" : "none";
  };
  try {
    const rows = await Api.collectedPending();
    if (!rows?.length) return void set("none");

    $("#td-coll-text").innerHTML = `<b>새로 들어온 일정 ${rows.length}건</b> — 캘린더에 넣을까요?`;
    $("#td-coll-open").onclick = () => { renderCollected(rows); openSheet("sh-coll"); };
    set("ask");
  } catch {
    // Today를 막지 않는다 — 수집이 없는 상태에서도 화면은 떠야 한다(T-33 §금지 1행).
    set("error");
  }
}

/** 시트 본문 — 하나씩 [추가]/[무시]. 처리하면 그 줄만 빠지고 카드 수가 준다. */
function renderCollected(rows) {
  const body = $("#coll-list");
  body.innerHTML = rows.map((r) => {
    // `2026-09-03T23:00:00+09:00` → "9/3(수) 23:00". **원문은 그대로 붙인다.**
    const when = r.starts_at ? `${md(r.starts_at.slice(0, 10))} ${r.starts_at.slice(11, 16)}` : "";
    return `<div class="evrow" data-cid="${esc(r.id)}">
      <span class="en" style="flex:1">${esc(when)} · ${esc(r.summary)}</span>
      <button class="go" data-act="add">추가</button>
      <button class="go" data-act="skip" style="color:var(--sub)">무시</button>
    </div>`;
  }).join("");

  body.querySelectorAll("button").forEach((b) => {
    b.onclick = () => run(async () => {
      const row = b.closest("[data-cid]");
      const id = row.dataset.cid;
      if (b.dataset.act === "add") { await Api.collectedAccept(id); toast("캘린더에 넣었어요"); }
      else { await Api.collectedDismiss(id); toast("안 묻을게요"); }
      row.remove();
      if (!body.querySelector("[data-cid]")) closeSheet("sh-coll");
      await refreshToday();       // 카드 수가 줄고, 없으면 카드가 사라진다
      if (S.cal) renderCal();     // 추가된 일정이 캘린더에 보이게
    });
  });
}

/* 세 번 밀린 일의 출구 (T-35 · ADR-036) ─────────────────────
 *
 * **알림이 목적이 아니라 출구가 목적이다.** *"이거 세 번 미뤘어요"*만 말하면 잔소리이고,
 * 사용자는 이미 안다 — §6.3이 경고한 도구 이탈로 가는 길이다.
 *
 * **출구는 '대기로 되돌리기'가 아니다.** 그 간선은 없고 라우트 하나로 생기지도 않는다:
 * `is_waiting`(예정이 하나도 없음)과 `defer_count`(예정 수 − 1)가 **같은 것을 세므로**
 * 되돌리려면 그 항목들을 지워야 하는데, 지우면 팝업의 근거가 증발하고,
 * 그 항목들은 Missed 기록 그 자체이며(§1.2), 마감된 날의 것은 트리거가 삭제를 막는다.
 * **ADR-036이 그래서 `defer`의 2주 상한을 이 경우에만 푸는 쪽으로 정했다.**
 *
 * 조건 셋이 **함께** 좁힌다(하나라도 빠지면 잔소리가 된다):
 *   ① `defer_count ≥ CARRY_N`   ② 하루 한 번(귀속일)   ③ 가장 많이 밀린 하나만
 *
 * **판단을 여는 자리(리스너)와 분리한다** — 순수 함수라 `front.mjs`가 직접 부른다(T-34의 그 자리).
 */
function carryCandidate() {
  const T = S.today;
  if (!T) return null;
  // 오늘 목록과 재배정 대기 **둘 다** 본다 — 둘 다 `defer_count`를 싣고 둘 다 미루기 경로가 있다.
  // `from`은 미루기의 출발 항목이다: 오늘 것은 오늘, 재배정 대기는 마지막 예정일.
  const rows = [
    ...(T.todo || []).map((t) => ({ id: t.id, title: t.title, n: t.defer_count, from: T.date })),
    ...(T.reassign || []).map((r) => ({ id: r.id, title: r.title, n: r.defer_count, from: r.latest_date })),
  ].filter((r) => r.n >= CARRY_N);
  // ③ 가장 많이 밀린 하나. 동점이면 id가 이른 것 —
  //    id는 `YYYYMMDD-NNN`이고 불변이라 문자열 순서가 곧 생성 순서다.
  rows.sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows[0] || null;
}

/** 띄웠으면 그 항목을, 안 띄웠으면 `null`을 돌려준다.
 *  **`null`이 정상 상태다** — 조건을 넘는 게 없으면 아무 일도 없는 것이 맞다. */
function maybeCarryPrompt() {
  const T = S.today;
  if (!T) return null;
  if (S.pick) return null;                                   // 날짜를 고르는 중엔 덮지 않는다
  if ($("#stale").classList.contains("on")) return null;     // 차단 팝업 위에 쌓지 않는다
  if (localStorage.getItem(CARRY_SEEN) === T.date) return null;   // ② 오늘 몫은 이미 썼다
  const c = carryCandidate();
  if (!c) return null;
  // **띄우는 순간** 오늘 몫을 쓴다 — 어느 버튼을 눌러도 오늘은 다시 안 뜬다.
  // 귀속일이라 기기 날짜가 아니라 서버가 준 `S.today.date`다(경계를 바꿔도 과거는 불변).
  localStorage.setItem(CARRY_SEEN, T.date);
  $("#carry-text").innerHTML =
    `${esc(c.title)} — <b class="warn">${c.n}회 이월</b>.<br>오늘 할 게 아니면, 멀리 미루는 편이 정직해요.`;
  $("#carry-today").onclick = () => closeSheet("sh-carry");
  $("#carry-later").onclick = () => closeSheet("sh-carry");
  $("#carry-far").onclick = () => {
    closeSheet("sh-carry");
    // ★ **상한 해제는 이 경로에서만 걸린다.** `far`가 실리는 자리는 여기 하나뿐이고,
    //   `startPick`이 매번 `S.pick`을 새로 만들므로 다음 미루기로 새지 않는다(ADR-036).
    startPick({ mode: "defer", id: c.id, from: c.from, title: c.title, far: true });
  };
  openSheet("sh-carry");
  return c;
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

/* ── 마감 요약 — 화면이 먼저 말한다 (T-44 · ADR-040) ───────────────────
 * 마감이 밀리는 원인은 입력 비용이 아니다(`closeDay`는 score도 feelings도 요구하지 않는다).
 * **백지라서 밀린다** — 시스템이 그날을 이미 아는데 아무 말도 안 한다.
 *
 * 재료는 `S.today`에 **이미 와 있다**: 서버를 부르지 않는다.
 * 부르면 마감이 네트워크에 걸리고, AI를 부르면 매일 도는 것에 비용·지연이 붙는다(ADR-024와 같은 방향).
 *
 * ★ **판단하지 않는다 — 센 것만 말한다.** 평가어를 쓰는 순간 점수가 그 말에 오염되고,
 *   이 앱은 거울이지 심판이 아니다(§6.3의 이탈이 잔소리에서 온다는 것과 같은 자리).
 */

/**
 * 마감 요약에 **있어서는 안 되는 말**. ★ 이 목록의 자리는 여기 하나다 —
 * `front.mjs`의 스캐너가 이것을 읽어서 검사한다(두 벌이 되면 갈라지고, **갈라진 쪽이 통과시킨다**).
 *
 * 셋으로 나뉜다: ① 칭찬·질책 ② 비교(어제보다·평소보다 — 비교는 평가로 미끄러진다) ③ 독려.
 * 세는 말(`3개`·`남았어요`)은 여기 없고, 그것이 이 목록이 지키는 선이다.
 */
const CLOSE_JUDGING_WORDS = [
  "잘하", "잘했", "잘 했", "훌륭", "대단", "멋지", "최고", "뿌듯", "알차",
  "아쉬", "부족", "충분", "게으", "실망", "나쁘", "안타깝", "저조", "못했",
  "평소", "보다 많", "보다 적", "적어요", "많아요", "줄었", "늘었",
  "힘내", "화이팅", "파이팅", "노력", "열심", "괜찮아",
];

/**
 * 그날을 한 문장으로. **순수 함수라 `front.mjs`가 직접 부른다**(T-34·carryCandidate와 같은 자리).
 *
 * ★ **어떤 재료에서도 빈 문자열을 돌려주지 않는다.** 아무것도 안 담긴 날도 사실이고,
 *   *침묵은 고장과 구별이 안 된다* — 마감 화면이 백지로 돌아가는 것이 이 티켓이 없앤 바로 그것이다.
 *
 * '이월'이라는 말은 쓰지 않는다: 같은 화면의 TODO 행이 `defer_count`를 **`N회 이월`**로
 * 이미 부르고 있어서, `reassign`까지 이월이라 하면 한 화면에서 한 단어가 두 가지를 뜻하게 된다.
 * 재배정 대기는 화면이 이미 쓰는 이름 그대로 쓴다.
 */
function closeSummaryText(T) {
  const done = ((T && T.done) || []).length;
  const todo = ((T && T.todo) || []).length;
  const wait = ((T && T.reassign) || []).length;   // 지난 날 Missed 확정 — 재배정 대기

  let s;
  if (done && todo) s = `오늘 ${done}개 했고 ${todo}개 남았어요.`;
  else if (done) s = `오늘 ${done}개 했고 남은 것이 없어요.`;
  else if (todo) s = `오늘 한 것이 없어요. 남은 것 ${todo}개.`;
  else if (wait) s = `오늘 담긴 할 일이 없어요.`;
  else s = `오늘 담긴 할 일이 없는 날이에요.`;   // ★ 여기서도 말한다

  if (wait) s += ` 재배정 대기 ${wait}개.`;
  return s;
}

/** ★ **요약이 죽어도 마감은 살아 있어야 한다** — 기록의 봉인이 우선이다(T-33 §금지 1행과 같은 자리).
 *  그래서 이 한 줄은 `renderToday`의 흐름을 끊지 않는다: 여기서 삼키지 않으면
 *  아래 마감 버튼 상태 배선이 통째로 안 돈다. */
function renderCloseSummary() {
  const el = $("#close-summary");
  if (!el) return;
  try {
    el.textContent = closeSummaryText(S.today);
  } catch (e) {
    el.textContent = "";
    console.warn("마감 요약 실패 — 마감은 그대로 동작한다", e);
  }
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

/* ── 날짜 시트 통합 추가 영역 (3단계) ──────────────────────────
 * [일정 | 할 일 | memo] 세그로 하나의 추가 영역을 만든다. relation별 가용 세그:
 *   past  : [일정 | memo]        (지난 날엔 할 일을 새로 못 만든다)
 *   today : [일정 | 할 일 | memo]
 *   future: [일정 | 할 일 | memo]
 * 일정은 시각 드럼이 있는 기존 일정 시트(openEventSheet)를 재사용한다(마감된 날 경고 포함).
 * 할 일·memo는 인라인 — 기존 addTaskOn/sendMemo를 그대로 부른다. */
let azMode = "task", azKey = null;
const AZ_LABEL = { event: "일정", task: "할 일", memo: "memo" };
const azModesFor = (relation) => (relation === "past" ? ["event", "memo"] : ["event", "task", "memo"]);
function addZoneHtml(k, relation, closed) {
  const modes = azModesFor(relation);
  if (!modes.includes(azMode)) azMode = relation === "past" ? "memo" : "task";
  const seg = modes.map((m) =>
    `<button data-m="${m}" class="${m === azMode ? "on" : ""}" onclick="setAddMode('${m}')">${AZ_LABEL[m]}</button>`).join("");
  const field = (m, inner) => `<div class="az-field" data-m="${m}"${m === azMode ? "" : ' style="display:none"'}>${inner}</div>`;
  let h = `<div class="sec-h" style="margin-top:16px"><span class="sec-t">추가</span></div>`;
  h += `<div class="seg" id="az-seg" style="margin-top:8px">${seg}</div>`;
  h += field("event",
    `<button class="btn ghost" style="margin-top:10px" id="ev-add" onclick="openEventSheet('${k}',${closed})">+ 일정 추가 (시각·종일 선택)</button>`);
  if (modes.includes("task"))
    h += field("task",
      `<div class="addrow"><input type="text" class="n" id="day-add" placeholder="할 일 추가"><button class="mok" onclick="addTaskOn('${k}')">추가</button></div>`);
  h += field("memo",
    `<div class="memobox" style="margin-top:10px"><span class="mtime mono">${hm(isoNowLocal())}</span><input type="text" id="memo-input" placeholder="memo 추가"><button class="mok" onclick="sendMemo('${k}')">확인</button></div>` +
    `<p class="cap" style="margin-top:7px">${closed ? "확정 기록 — 수정 불가, memo만 추가돼요." : "memo는 어느 날짜에든 남길 수 있어요 — 나중에 분석에서 볼 수 있어요."}</p>`);
  return h;
}
function setAddMode(m) {
  azMode = m;
  $$("#az-seg button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $$(".az-field").forEach((f) => (f.style.display = f.dataset.m === m ? "" : "none"));
}

/* ── 날짜 팝업 (E — 조인 조립) ─────────────────────────── */
async function openDay(k) {
  if (S.pick) { if (pickable(k)) assignDate(k); return; }
  await run(async () => {
    const day = await Api.day(k);
    const D = S.today.date;
    if (azKey !== k) { azKey = k; azMode = day.relation === "past" ? "memo" : "task"; }
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
          : t.class === "done" ? "완료" : t.deferred_to ? `→ ${md(t.deferred_to)}` : "";
        const fin = t.class === "done" || t.status === "finished";
        const inner = `<span class="ts mono">—</span><span><i class="pdot" style="display:inline-block;background:${per ? per.color : "var(--faint)"};margin-right:6px"></i>${esc(t.title)}${tag ? ` <span class="cap">${tag}</span>` : ""}</span>`;
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
    }
    // memo 표시 — 어느 날짜에든(3단계): 과거·오늘·미래 모두. 추가는 아래 통합 영역에서.
    // 팝업은 memo 전문, 캘린더 셀은 대표 1건 + '+n'(calMemos) — 같은 memo의 두 시야.
    h += `<div class="card" style="margin-top:9px;padding:6px 14px">` + (day.memos.map((m) => {
      const added = m.same_day ? "" : `<span class="memo-origin-added">(${md(m.created_at)}에 추가)</span>`;
      return `<div class="lrow memo-origin-row${m.same_day ? "" : " memo-origin-later"}"><span class="ts mono">${hm(m.ts)}</span><span class="memo-origin-text">${added}${esc(m.text)}</span></div>`;
    }).join("") || `<div class="lrow memo-origin-empty"><span class="cap">memo 없음</span></div>`) + `</div>`;
    // 일정 — 캘린더에서만 다루는 사건 (할 일과 분리).
    // 마감된 날에도 일정은 추가할 수 있다 (1.3 "과거엔 추가만 가능") — 단 추가하면 수정·삭제가
    // 막히므로 시트에서 경고한다. 삭제(×)는 '마감 안 된 날'에만 보인다(마감된 날은 트리거가 막는다).
    const evs = day.events || [];
    const closed = !!(day.daily && day.daily.status === "closed");
    h += `<div class="sec-h" style="margin-top:16px"><span class="sec-t">일정</span><span class="cnt">${evs.length}</span></div>`;
    h += `<div class="card" style="padding:4px 14px">` + (evs.map((e) => {
      evxItems.set(e.id, e);
      return `<div class="evrow"><span class="et mono">${e.time || "종일"}</span><button class="ev-protect-event-title" onclick="openEventEdit('${k}',${closed},'${e.id}')">${esc(e.title)}</button>` +
      (e.protect_from ? '<span class="ev-protect-badge">보호</span>' : "") +
      (closed ? "" : `<button class="ex" onclick="removeEvent('${e.id}','${k}')">×</button>`) + `</div>`}).join("")
      || `<div class="evrow"><span class="cap">이 날의 일정이 없어요</span></div>`) + `</div>`;
    // 통합 추가 영역 — [일정 | 할 일 | memo] (relation별 가용 세그). 기존 함수 재사용.
    h += addZoneHtml(k, day.relation, closed);
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
    invalidateCalendarCache();
    toast("일정을 지웠어요", "warn");
    await Promise.all([refreshToday(), renderCalendar()]);
    openDay(k);
  });
}

function addTaskOn(k) {
  const v = $("#day-add").value.trim();
  if (!v) return;
  run(async () => {
    // 여기는 날짜가 **생성과 함께** 붙는 자리라 되돌릴 것이 없다 — 내일로 돌린다.
    // 오늘이 아니면 묻지 않는다: 앞날에 넣는 것은 Level 4와 무관하다.
    const moved = k === S.today.date && await askLevel4();
    const date = moved ? addDaysStr(k, 1) : k;
    await Api.createTask({ title: v, date });
    toast(moved ? LEVEL4_MOVED(date) : `${md(date)}에 추가했어요`);
    await Promise.all([refreshToday(), renderCalendar()]);
    openDay(date);
  });
}

function sendMemo(k) {
  const v = $("#memo-input").value.trim();
  if (!v) return;
  run(async () => {
    await Api.memo(k, isoNowLocal(), v);
    toast("memo 추가됨", "ok");
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
  updateEventProtectionPreview();
}
function scrollDial() {
  if (!dialSt) return;
  $("#dial-h").scrollTop = dialSt.h * DIAL_H;
  $("#dial-m").scrollTop = (dialSt.m / 5) * DIAL_H;
}

/* ── 일정 추가 시트 ────────────────────────────────────────
 * 인라인 한 줄이던 걸 팝업으로 뺐다. 드럼은 별도 시트가 아니라 이 안에 들어 있다 —
 * 시트를 세 겹 쌓으면 뒤로 가기가 어디로 가는지 알 수 없어진다. */
let evxCtx = null;   // { date, allday, item? }
const evxItems = new Map();

function protectionDeadline(date, time, sleepMin, prepMin) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = (time || "09:00").split(":").map(Number);
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi) - (Number(sleepMin) + Number(prepMin)) * 60_000);
  return `${at.getUTCMonth() + 1}/${at.getUTCDate()} ${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}`;
}

function updateEventProtectionPreview() {
  const enabled = $("#ev-protect-enabled");
  const fields = $("#ev-protect-fields");
  const preview = $("#ev-protect-deadline");
  if (!enabled || !fields || !preview) return;
  fields.style.display = enabled.checked ? "" : "none";
  if (!enabled.checked || !evxCtx) return;
  const sleep = Number($("#ev-protect-sleep").value);
  const prep = Number($("#ev-protect-prep").value);
  if (!Number.isFinite(sleep) || !Number.isFinite(prep)) {
    preview.textContent = "수면과 준비 시간을 분 단위로 적어 주세요.";
    return;
  }
  const time = evxCtx.allday ? "09:00" : dialValue();
  preview.textContent = `수면·준비를 채우려면 ${protectionDeadline(evxCtx.date, time, sleep, prep)}부터 자야 해요.`;
}

function protectionBody() {
  if (!$("#ev-protect-enabled").checked) return { protect: false };
  const from = $("#ev-protect-from").value.trim();
  const level = Number($("#ev-protect-level").value);
  const sleep = Number($("#ev-protect-sleep").value);
  const prep = Number($("#ev-protect-prep").value);
  if (!/^([+-]?\d+)d\s+([01]\d|2[0-3]):([0-5]\d)$/.test(from)) return { error: "보호 시작 형식은 '-1d 00:00'예요" };
  if (!Number.isInteger(level) || level < 1 || level > 4) return { error: "최대 Level은 1~4로 골라 주세요" };
  if (!Number.isInteger(sleep) || sleep < 0 || sleep > 1440 || !Number.isInteger(prep) || prep < 0 || prep > 1440) {
    return { error: "수면과 준비 시간은 0~1440분으로 적어 주세요" };
  }
  return { protect_from: from, protect_level: level, protect_sleep_min: sleep, protect_prep_min: prep };
}

function openEventEdit(k, closed, id) {
  const item = evxItems.get(id);
  if (!item) return toast("일정을 다시 불러와 주세요", "warn");
  openEventSheet(k, closed, item);
}

function openEventSheet(k, closed, item = null) {
  const eventTime = item?.time || "09:00";
  const [h, m] = eventTime.split(":").map(Number);
  evxCtx = { date: k, allday: !item?.time, item };
  dialSt = { h: Number.isInteger(h) ? h : 9, m: Number.isInteger(m) ? m : 0 };
  $("#evx-date").textContent = dlabel(k);
  // 마감된 날에 추가하면 그 일정은 수정·삭제가 막힌다 — 미리 알린다 (1.3)
  const warn = $("#evx-warn"); if (warn) warn.style.display = closed ? "" : "none";
  $("#evx-title").value = item?.title || "";
  $("#ev-protect-enabled").checked = !!item?.protect_from;
  $("#ev-protect-from").value = item?.protect_from || "-1d 00:00";
  $("#ev-protect-level").value = String(item?.protect_level ?? 4);
  $("#ev-protect-sleep").value = String(item?.protect_sleep_min ?? 360);
  $("#ev-protect-prep").value = String(item?.protect_prep_min ?? 90);
  buildDrum($("#dial-h"), 24, (i) => pad2(i), "h");
  buildDrum($("#dial-m"), 12, (i) => pad2(i * 5), "m");
  markDial();
  evxMode(true);
  if (item?.time) evxMode(false);
  updateEventProtectionPreview();
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
  $("#ev-protect-enabled").onchange = updateEventProtectionPreview;
  ["#ev-protect-from", "#ev-protect-level", "#ev-protect-sleep", "#ev-protect-prep"].forEach((sel) => {
    $(sel).oninput = updateEventProtectionPreview;
    $(sel).onchange = updateEventProtectionPreview;
  });
  $("#evx-cancel").onclick = () => { closeSheet("sh-event"); evxCtx = null; };
  $("#evx-ok").onclick = () => {
    if (!evxCtx) return;
    const title = $("#evx-title").value.trim();
    if (!title) return toast("일정 내용을 적어 주세요", "warn");
    const k = evxCtx.date, time = evxCtx.allday ? null : dialValue();
    const item = evxCtx.item;
    const protect = protectionBody();
    if (protect.error) return toast(protect.error, "warn");
    closeSheet("sh-event");
    evxCtx = null;
    run(async () => {
      const unchanged = item && item.title === title && item.date === k && item.time === time;
      let wrote = false;
      let saved = item;
      try {
        if (!unchanged) {
          saved = item ? await Api.updateEvent(item.id, { title, date: k, time }) : await Api.createEvent({ title, date: k, time });
          wrote = true;
        }
        if (protect.protect_from || (item?.protect_from && protect.protect === false)) {
          await Api.setProtect(saved.id, protect);
          wrote = true;
        }
      } finally {
        if (wrote) invalidateCalendarCache();
      }
      toast(item ? `${md(k)} 일정을 수정했어요` : `${md(k)} 일정을 추가했어요`, "ok");
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
 * 미루는 순간에 사유(선택)를 받아 도착지(새 예정) 항목에 남긴다.
 * 완료율 입력은 화면에서 제거됨 — 내부 rate=100 완료 신호는 그대로 유지(2단계). */
let dfxCtx = null;   // { id, title, from, to, frozen }

function openDeferSheet(ctx) {
  dfxCtx = ctx;
  $("#dfx-what").innerHTML = `${esc(ctx.title)}<br>${md(ctx.from)} → <b style="color:var(--ink)">${md(ctx.to)}</b>`;
  $("#dfx-note").textContent = ctx.frozen
    ? "이미 마감된 날이라 원래 기록은 그대로 남고, 새 예정만 만들어져요."
    : "옮겨 간 날로 새 예정이 생겨요.";
  $("#dfx-reason").value = "";
  openSheet("sh-defer");
}
function bindDeferSheet() {
  $("#dfx-cancel").onclick = () => { closeSheet("sh-defer"); dfxCtx = null; };
  $("#dfx-ok").onclick = () => {
    const c = dfxCtx;
    if (!c) return;
    const reason = $("#dfx-reason").value;
    run(async () => {
      // **여기가 붙는 자리다.** `assignDate`의 defer 분기는 이 시트를 열 뿐이고,
      // 시트가 떠 있는 동안 구간이 시작될 수 있다 — 그래서 확인 버튼에서 묻는다.
      //
      // 시트를 먼저 닫지 않는다: 막힌 순간에 화면이 사라지면 **맥락이 갑자기 없어진다.**
      // 무엇을 어디로 옮기려 했는지가 토스트 한 줄만 남기고 통째로 지워지는 것과,
      // 그대로 있는 채로 "오늘은 안 된다"는 말을 듣는 것은 다르다.
      // (여기서 `to`를 바꿀 수는 없으므로 결국 취소하고 날짜를 다시 골라야 하고,
      //  `openDeferSheet`가 사유를 비우므로 **사유는 어차피 다시 쓴다** — 남기는 것은 맥락이다.
      //  이 한 단계가 실사용에서 답답하면 막힐 때 닫고 피커로 돌려보낸다 — BACKLOG-0806.)
      if (c.to === S.today.date && await askLevel4()) {
        S.level4 = true;
        applyPickDim();
        return toast(LEVEL4_BLOCKED, "warn");
      }
      closeSheet("sh-defer");
      dfxCtx = null;
      await Api.defer(c.id, c.from, c.to, reason);
      invalidateCalendarCache();
      exitPick();
      await Promise.all([refreshToday(), renderCalendar()]);
      openDay(c.to);
    });
  };
}

/* ── Calendar ──────────────────────────────────────────── */
const calendarMonthCache = new Map();
let calendarPeriodListCache = null;
let calendarCacheEpoch = 0;

const calendarMonthKey = ({ y, m }) => `${y}-${pad2(m)}`;
const calendarMonthStart = (month) => `${calendarMonthKey(month)}-01`;
const calendarMonthEnd = (month) => addDaysStr(calendarMonthStart(addMonth(month.y, month.m, 1)), -1);

function invalidateCalendarCache() {
  calendarMonthCache.clear();
  calendarPeriodListCache = null;
  calendarCacheEpoch++;
}

function missingCalendarSegments(months) {
  const segments = [];
  let segment = [];
  for (const month of months) {
    if (!calendarMonthCache.has(calendarMonthKey(month))) segment.push(month);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return segments;
}

function cacheCalendarSegment(months, data) {
  for (const month of months) {
    const start = calendarMonthStart(month), end = calendarMonthEnd(month);
    const inMonth = (row) => row.date >= start && row.date <= end;
    calendarMonthCache.set(calendarMonthKey(month), {
      periods: (data.periods || []).filter((p) => p.start_date <= end && p.end_date >= start),
      entries: (data.entries || []).filter(inMonth),
      diary: (data.diary || []).filter(inMonth),
      events: (data.events || []).filter(inMonth),
      memos: (data.memos || []).filter(inMonth),
    });
  }
}

function mergeCalendarMonths(months) {
  const merged = { periods: [], entries: [], diary: [], events: [], memos: [] };
  const periodIds = new Set();
  for (const month of months) {
    const data = calendarMonthCache.get(calendarMonthKey(month));
    for (const p of data.periods) {
      if (periodIds.has(p.id)) continue;
      periodIds.add(p.id);
      merged.periods.push(p);
    }
    for (const key of ["entries", "diary", "events", "memos"]) merged[key].push(...data[key]);
  }
  merged.periods.sort((a, b) => pkey(a) < pkey(b) ? -1 : pkey(a) > pkey(b) ? 1 : 0);
  return merged;
}

async function calendarDataFor(months) {
  const epoch = calendarCacheEpoch;
  const segments = missingCalendarSegments(months);
  const periodRequest = calendarPeriodListCache ? null : Api.periods();
  const [segmentData, periodList] = await Promise.all([
    Promise.all(segments.map((segment) => Api.calendar(
      calendarMonthStart(segment[0]), calendarMonthEnd(segment[segment.length - 1])))),
    periodRequest || Promise.resolve(calendarPeriodListCache),
  ]);
  // 쓰기 뒤 늦게 도착한 읽기 응답은 캐시를 되살리지 않고 새 세대로 다시 받는다.
  if (epoch !== calendarCacheEpoch) return calendarDataFor(months);
  segments.forEach((segment, i) => cacheCalendarSegment(segment, segmentData[i]));
  if (periodRequest) calendarPeriodListCache = periodList;
  return [mergeCalendarMonths(months), calendarPeriodListCache];
}

let calendarPaneBuildCount = 0;   // front 검사: 한 칸 이동은 재사용 pane 하나만 다시 조립해야 한다
let calendarPaneRenderKey = "";   // 캐시 세대·귀속일·가운데 달이 같으면 이미 조립한 5-pane을 그대로 쓴다

async function renderCalendar(rotateDir = 0) {
  if (!S.today) return; // 부팅 전 — S.cal이 아직 비어 있다 (날짜 계산 불가)
  const gen = calGen;   // 이 조립을 시작할 때의 세대 — 도중에 달을 더 넘기면 버린다(최신 우선)
  const { y, m } = S.cal;
  $("#cal-title").textContent = `${y} · ${m}월`;
  /* DOM과 데이터 모두 좌우 두 달까지 유지한다. 달을 넘길 때는 기존 pane 네 개를
   * 그대로 돌려 쓰고 새 가장자리 pane 하나만 다시 조립한다. */
  const months = [-2, -1, 0, 1, 2].map((n) => addMonth(y, m, n));
  const dataMonths = months;
  const grids = months.map((o) => weeksOf(o.y, o.m));
  const [cal, plist] = await calendarDataFor(dataMonths);
  if (gen !== calGen) return;   // 폐기될 조립은 아래 pane 회전까지 닿지 않는다(연속 스와이프 경합 방지)
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
  // memo — 날짜별 대표 1건(+개수). 캐시된 구버전 응답 대비 || [] (없으면 셀에 memo 줄 없음).
  const memoByDate = {};
  for (const m of cal.memos || []) memoByDate[m.date] = m;

  const rx = capRx($("#cal-rows").clientWidth);
  const rowHtml = (row, mm) => {
    const paths = bandPaths(row, cal.periods, rx)
      .map((p) => `<path d="${p.d}" fill="${p.fill}" fill-opacity=".4"/>`).join("");
    const cells = row.map((d) => {
      const mut = +d.slice(5, 7) !== mm ? " mut cal-dim-cell" : "";
      const today = d === D ? " today" : "";
      const past = d < D ? " past" : "";
      const evs = evByDate[d] || [], tks = tkByDate[d] || [], mo = memoByDate[d]; // mo=memo (mm은 상위의 '월' 파라미터)

      // 공간 예산 동적 배분 (일정 → 할 일 1줄 → memo 1줄 → 남으면 할 일 2번째 줄)
      let room = CELL_MAX_LINES;
      const evShow = Math.min(evs.length, CELL_EV_MAX);   // 1) 일정
      const evOver = evs.length - evShow;
      room -= evShow + (evOver > 0 ? 1 : 0);              // 초과분 '일정 +N' 줄도 예산에 포함
      const memoNeed = mo ? 1 : 0;                        // 2) 할 일 — memo 자리를 먼저 비워두고 배분
      let tkShow = tks.length ? Math.min(1, room) : 0;
      room -= tkShow;
      if (tks.length > tkShow && room - memoNeed > 0 && tkShow < CELL_TK_MAX) { tkShow += 1; room -= 1; }
      const memoShow = mo && room > 0 ? 1 : 0;            // 3) memo

      // 일정 — 셀에서는 제목만. 시각·종일 구분은 날짜 팝업에서(1단계). 초과분은 '일정 +N' 한 줄.
      let h = evs.slice(0, evShow).map((e) =>
        `<span class="ev evt${past}${e.time ? " timed" : ""}${e.protect_from ? " ev-protect-calendar" : ""}" style="border-left-color:${e.color || "var(--ink)"}">${esc(e.title)}${e.protect_from ? '<i class="ev-protect-dot" title="보호 규칙 켜짐"></i>' : ""}</span>`).join("");
      if (evOver > 0) h += `<span class="ev more">일정 +${evOver}</span>`;

      // 할 일 — 살아 있는 항목(미완료·미이동)을 created_at 순으로 먼저 채운다
      // (완료·이동만 남은 항목이 그 날을 대표하면 오독한다). +n은 마지막 표시 줄에.
      if (tkShow) {
        const ordered = tks.filter((x) => x.status !== "finished" && !x.deferred_to)
          .concat(tks.filter((x) => x.status === "finished" || x.deferred_to));
        const shown = ordered.slice(0, tkShow);
        const restN = tks.length - shown.length;
        h += shown.map((t, i) =>
          `<span class="ev tsum${past}${t.deferred_to ? " moved" : ""}${t.status === "finished" ? " done" : ""}"` +
          ` style="border-left-color:${t.color || "var(--faint)"}">` +
          `<span class="etxt">${esc(t.title)}</span>${i === shown.length - 1 && restN ? `<b>+${restN}</b>` : ""}</span>`).join("");
      }

      // memo — '적어둔 것'. 보더 없이 글씨만(우선순위 최하위, 가장 아래). 셀은 대표 1건+n, 전문은 팝업.
      if (memoShow) h += `<span class="ev memo${past}"><span class="etxt">${esc(mo.text)}</span>${mo.n > 1 ? `<b>+${mo.n - 1}</b>` : ""}</span>`;

      return `<button class="c${mut}${today}" data-d="${d}" onclick="openDay('${d}')">
        <span class="d serif">${+d.slice(8, 10)}</span>${diarySet.has(d) ? '<i class="dr"></i>' : ""}${h}</button>`;
    }).join("");
    return `<div class="cal-row"><svg class="band" viewBox="0 0 700 96" preserveAspectRatio="none">${paths}</svg><div class="cells">${cells}</div></div>`;
  };

  const paneBody = (o, grid) => {
    calendarPaneBuildCount++;
    return CAL_WKDAYS + grid.map((row) => rowHtml(row, o.m)).join("");
  };
  const track = $("#cal-track");
  const paneRenderKey = `${calendarCacheEpoch}|${D}|${calendarMonthKey({ y, m })}`;
  const panesAlreadyCurrent = calendarPaneRenderKey === paneRenderKey
    && track.children.length === CAL_PANE_COUNT
    && [...track.children].every((p, i) => p.dataset.ym === calendarMonthKey(months[i]));
  if (rotateDir && track.children.length === CAL_PANE_COUNT) {
    // 반드시 세대 검사 뒤에서만 DOM 순서를 바꾼다. 버려진 조립이 회전하면 이후 대응이 전부 밀린다.
    const pane = rotateDir > 0 ? track.firstElementChild : track.lastElementChild;
    const targetIndex = rotateDir > 0 ? CAL_PANE_COUNT - 1 : 0;
    if (rotateDir > 0) track.appendChild(pane);
    else track.insertBefore(pane, track.firstElementChild);
    const target = months[targetIndex];
    pane.dataset.ym = calendarMonthKey(target);
    pane.innerHTML = paneBody(target, grids[targetIndex]);
  } else if (!panesAlreadyCurrent) {
    track.innerHTML = months.map((o, k) =>
      `<div class="calpane${k === CAL_CENTER ? " cur" : ""}" data-ym="${calendarMonthKey(o)}">` +
      paneBody(o, grids[k]) + `</div>`).join("");
  }
  [...track.children].forEach((p, i) => p.classList.toggle("cur", i === CAL_CENTER));
  calendarPaneRenderKey = paneRenderKey;
  trackSet(track, CAL_CENTER, false, CAL_GAP, CAL_TRACK_STEP);   // 언제나 5-pane의 가운데(index 2)

  // 범례는 '지금 보고 있는 달'만 — 세 달치를 다 늘어놓으면 읽을 수 없다
  const curFrom = grids[CAL_CENTER][0][0], curTo = grids[CAL_CENTER][WEEKS_IN_GRID - 1][6];
  $("#cal-leg").innerHTML = cal.periods.filter((p) => p.start_date <= curTo && p.end_date >= curFrom).map((p) =>
    `<span><i class="lsw" style="background:${p.color};opacity:.6"></i>${esc(p.title)} ${md(p.start_date)}–${md(p.end_date)}</span>`).join("");

  // '기간' 목록은 범례와 같은 기준으로 '이번 달과 겹치는 것'만 — 전체를 나열하면 캘린더 탭이 과해진다.
  // 다른 달 기간은 그 달로 넘기면 다시 뜬다(범례·밴드도 동일). 개수 라벨도 이번 달 기준으로 맞춘다.
  const inMonth = S.periods.filter((p) => p.start_date <= curTo && p.end_date >= curFrom);
  $("#p-cnt").textContent = inMonth.length;
  $("#p-list").innerHTML = inMonth.map((p) => {
    const started = p.d_start <= 0;
    const ach = started && p.achievement != null ? p.achievement : null;
    return `<div class="prow" onclick="openPeriod('${p.id}')" style="cursor:pointer">
      <i class="pdot" style="width:9px;height:9px;background:${p.color}"></i>
      <div style="flex:1"><b style="font-size:14px">${esc(p.title)}</b>
        <div class="cap">${md(p.start_date)} – ${md(p.end_date)} · ${started ? `경과 ${p.elapsed_days}/${p.total_days}` : `D-${p.d_start} 시작`}</div>
        <div class="pbar"><i style="width:${ach ?? 0}%;background:${p.color}"></i></div></div>
      <span class="cap">${ach != null ? `달성률 ${ach}%` : "—"}</span>
    </div>`;
  }).join("") || `<div class="prow"><span class="cap">이번 달엔 기간이 없어요</span></div>`;

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
  // Level 4 구간에는 오늘이 하한에서 빠진다 → `pickable`·`applyPickDim`이 따라와
  // 오늘 칸이 흐려지고 눌리지 않는다. **이건 안내다** — 판정은 붙는 자리 셋이 다시 묻는다.
  // 동기 함수라 여기서 플러그인을 부를 수 없어 `S.level4`(startPick이 담는다)를 읽는다.
  const floor = S.level4 ? addDaysStr(D, 1) : D;
  if (S.pick.mode === "defer") {
    const min = S.pick.from >= D ? addDaysStr(D, 1) : D;
    // ★ 2주 상한이 풀리는 것은 **`far`로 열린 피커 하나뿐이다** (T-35 · ADR-036).
    //   그 상한의 취지("미루기가 무기한 연기가 되지 않게")는 여전히 옳고,
    //   `defer_count ≥ CARRY_N`은 **그 취지가 이미 실패했다는 증거**일 때만 예외가 된다.
    //   `far`를 싣는 자리는 `maybeCarryPrompt` 하나이고, 평소 미루기는 그대로 D+14다.
    return { min: min > floor ? min : floor, max: S.pick.far ? null : addDaysStr(D, 14) };
  }
  return { min: floor, max: null };
}
const pickable = (k) => {
  const { min, max } = pickMinMax();
  return k >= min && (!max || k <= max);
};

function startPick(p) {
  S.pick = { ...p, origin: $("#phone").dataset.tab };
  // 관대한 값으로 먼저 그리고, 답이 오면 좁힌다 — **안내가 관대하고 판정이 엄하다.**
  // 반대로 만들면(안내가 엄하고 판정이 관대) 조용히 새는 구멍이 된다.
  S.level4 = false;
  askLevel4().then((on) => {
    if (!S.pick || !on) return;
    S.level4 = true;
    applyPickDim();
  });
  closeAll();
  switchTab("cal");
  $$("[data-cv]").forEach((b) => b.classList.toggle("on", b.dataset.cv === "grid"));
  $("#cal-grid").style.display = "";
  $("#cal-list").style.display = "none";
  $("#pick-title").textContent = p.title;
  $("#pick-note").textContent = p.mode === "defer"
    ? (p.far ? "(멀리 — 2주 상한 없음)" : "(2주 이내)")
    : "(앞날 아무 날짜나)";
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
      // 사용자가 고른 날이므로 말없이 옮기지 않는다 — 오늘이면 안 붙이고 다시 고르게 한다.
      // 03:29에 열고 03:31에 격상되면 dim이 낡는다. 그 경우가 여기로 들어오고,
      // **안내를 그 자리에서 좁힌다** — 다음 탭부터는 오늘 칸이 흐려져 있다.
      if (k === S.today.date && await askLevel4()) {
        S.level4 = true;
        applyPickDim();
        return toast(LEVEL4_BLOCKED, "warn");
      }
      await Api.schedule(p.id, k);
      exitPick();
      await Promise.all([refreshToday(), renderCalendar()]);
      openDay(k);
    });
  }
  // 미루기는 한 단계 더 — 도착지와 사유(선택)를 확인 시트에서 받는다
  run(async () => {
    const t = await Api.task(p.id);
    const e = t.entries.find((x) => x.date === p.from);
    openDeferSheet({
      id: p.id, title: p.title || t.title, from: p.from, to: k,
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
          </div>`).join("") + `</div>`;
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
      `<button class="trow" style="width:100%" onclick="openTask('${r.id}')"><span class="tk${r.state === "finished" ? " done" : ""}"></span>
        <span class="tbody"><span class="tt">${esc(r.title)}</span>
          <span class="tmeta">${r.is_waiting ? "대기" : r.latest_date ? md(r.latest_date) : ""}</span></span></button>`).join("") + `</div>`).join("") ||
    `<p class="cap" style="margin-top:14px">기간에 속한 task가 없어요.</p>`;

  // 완료
  $("#done-list").innerHTML = done.map((r) => {
    if (r.kind === "cancelled")   // 완료·취소를 한 목록에 — 취소는 흐리게+취소선, on_date 표시 (0008)
      return `<button class="trow muted" style="width:100%" onclick="openTask('${r.id}')"><span class="tk"></span>
        <span class="tbody"><span class="tt" style="color:var(--faint);text-decoration:line-through">${esc(r.title)}</span><span class="tmeta">${md(r.on_date)} · 취소</span></span></button>`;
    const meta = r.planned_on && r.planned_on !== r.on_date
      ? `예정 ${md(r.planned_on)} · 완료 ${md(r.on_date)}`
      : `${md(r.on_date)} 완료`;
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
  $$("#scr-works .wseg").forEach((x) => x.classList.toggle("on", x.dataset.w === "inbox"));
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
        if (e.deferred_to) return `<div class="te">${md(e.date)} → 미루기</div>`;
        if (t.state === "finished") return `<div class="te done-line">${md(e.date)} · 예정</div>`;
        if (e.date === D) return `<div class="te" style="color:var(--ink);font-weight:600">${md(e.date)} · 예정 (오늘)</div>`;
        if (e.date > D) return `<div class="te">${md(e.date)} · 예정</div>`;
        return `<div class="te">${md(e.date)} — 미완료</div>`;
      }).join("");
    } else {
      tl = `<div class="te">대기 · ${t.wait_age}일째</div>`;
    }
    tl += t.extensions.map((x) => `<div class="te">연장 ${md(x.extended_at.slice(0, 10))}</div>`).join("");
    if (t.state === "finished" && t.finished_on)
      tl += `<div class="te" style="color:var(--ink);font-weight:600">${md(t.finished_on)} · 완료 처리</div>`;
    if (t.state === "cancelled" && t.cancelled_on)
      tl += `<div class="te" style="color:var(--faint)">${md(t.cancelled_on)} · 취소</div>`;
    $("#tk-timeline").innerHTML = tl;

    /* 상태 — '살아 있는(미뤄지지 않은) 마지막 예정'을 기준으로 보여준다.
     * 완료율은 화면에서 제거(2단계) — 여기선 상태(완료/대기/예정)만 읽기전용으로 표시한다.
     * 내부 rate·완료(rate=100) 로직·DB는 그대로. 값 표시만 걷어냈다. */
    const live = [...t.entries].reverse().find((e) => !e.deferred_to);
    const locked = !!live && live.day_status === "closed";
    const fin = t.state === "finished";
    const cancelled = t.state === "cancelled";
    $("#tk-rates").innerHTML =
      // 사유는 취소 상태일 때만 — 해제하면 컬럼엔 남아 있어도 현재 상태가 아니다(append-only).
      cancelled ? `<span class="ratebig" style="color:var(--faint)">취소됨 · ${md(t.cancelled_on)}</span>`
        + (t.cancel_reason ? `<p class="cap" style="margin:6px 0 0">사유 — ${esc(t.cancel_reason)}</p>` : "")
      : fin ? `<span class="ratebig done">완료</span>`
      : !live ? `<span class="cap">대기 중이에요 — 일정을 정하면 예정이 생겨요.</span>`
      : locked ? `<p class="cap">${md(live.date)}은 이미 마감됐어요 — 지난 기록은 고칠 수 없어요.</p>`
      : `<p class="cap">${md(live.date)} 예정 — 다 했으면 아래 <b>완료</b>.</p>`;

    /* 버튼은 맥락에 맞는 것만 —
     *  · 취소된 일: 앞으로의 동작(완료·미루기·일정확정·연장)은 다 숨기고 '취소 해제'만.
     *  · 완료된 일: 완료·미루기 잠금, 취소 버튼도 숨김(완료는 취소 대상 아님).
     *  · 대기 연장은 기한(21일)에 닿아야 뜻이 있다 (1.4). */
    $("#tk-defer").textContent = t.is_waiting ? "일정 정하기" : "미루기";
    const canExtend = !fin && !cancelled && !!t.is_waiting && (t.wait_age ?? 0) >= WAIT_LIMIT;
    $("#tk-extend").style.display = canExtend ? "" : "none";
    $("#tk-defer").style.display = cancelled ? "none" : "";
    $("#tk-complete").style.display = cancelled ? "none" : "";
    $("#tk-cancel").style.display = (fin || cancelled) ? "none" : "";
    $("#tk-uncancel").style.display = cancelled ? "" : "none";
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
  $("#tk-cancel").onclick = () => {
    const t = S.sheetTask;
    if (!t) return;
    run(async () => {
      // kept: 마감된 날 항목 수 — 무엇이 남는지 알아야 안심하고 누른다 (day_status는 getTask에 실려온다).
      const kept = t.entries.filter((e) => e.day_status === "closed").length;
      // 사유는 append-only(0009) — 그래서 placeholder에 '나중에 고칠 수 없다'를 밝힌다.
      const body = (kept
        ? `“${esc(t.title)}” — 마감된 날 기록 <b>${kept}일</b>은 그대로 남고, 앞으로 잡힌 예정만 사라져요. 나중에 되돌릴 수 있어요.`
        : `“${esc(t.title)}” — 앞으로 잡힌 예정만 사라지고, 지난 기록은 남아요. 나중에 되돌릴 수 있어요.`)
        + `<textarea id="cf-reason" rows="2" style="margin-top:10px;width:100%;box-sizing:border-box"
             placeholder="취소하는 이유 (선택) — 나중에 고칠 수 없어요"></textarea>`;
      // confirmAsk resolve 직후 읽는다(요소는 DOM에 남아 있다).
      if (await confirmAsk("이 일을 취소할까요?", body, "취소하기") === "ok")
        await execCancel(t, ($("#cf-reason")?.value || "").trim());
    });
  };
  $("#tk-uncancel").onclick = () => {
    const t = S.sheetTask;
    if (!t) return;
    run(async () => {
      const res = await Api.uncancelTask(t.id);
      closeAll();
      toast(res.waiting ? "취소 해제 — 대기로 돌아왔어요" : "취소 해제했어요", "ok");
      syncAll();
      if ($("#phone").dataset.tab === "cal") renderCalendar();
    });
  };
  $("#tk-delete").onclick = () => {
    const t = S.sheetTask;
    if (!t) return;
    run(async () => {
      const n = t.defer_count || 0;
      const body = n > 0
        ? `“${esc(t.title)}”은(는) 이미 <b>${n}번 미룬</b> 일이에요.<br>삭제하면 기록도 미룬 흔적도 전부 사라져요 — 남기려면 '취소'를 쓰세요.`
        : `“${esc(t.title)}” — 기록까지 완전히 지워요. 되돌릴 수 없어요. 남기려면 '취소'를 쓰세요.`;
      if (await confirmAsk("이 일을 삭제할까요?", body, n >= 2 ? "그래도 삭제" : "삭제") !== "ok") return;
      try {
        await Api.deleteTask(t.id);
        closeAll();
        toast("삭제했어요", "warn");
        syncAll();
        if ($("#phone").dataset.tab === "cal") renderCalendar();
      } catch (e) {
        // 마감·Guard 기록이 막으면(409 suggest:"cancel") 삭제 대신 취소를 원탭으로 권한다.
        if (e && e.suggest === "cancel") {
          if (await confirmAsk("삭제할 수 없어요", esc(e.message), "대신 취소하기") === "ok") await execCancel(t);
        } else throw e;
      }
    });
  };
}

/** 취소 실행(확인은 호출부에서) — 성공 후 시트 닫고 남은 날을 알린다. */
async function execCancel(t, reason) {
  const res = await Api.cancelTask(t.id, reason);
  closeAll();
  const kn = (res.kept_dates || []).length;
  toast(kn ? `취소 — 마감된 날 기록 ${kn}일은 그대로 남아요` : "취소했어요", "warn");
  syncAll();
  if ($("#phone").dataset.tab === "cal") renderCalendar();
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
    toast("완료", "ok");
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
const DEPTH_LABEL = { normal: "보통", detailed: "자세히", deep: "매우 자세히" };
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
        <span class="cap mono" style="flex:none">${md(a.created_at.slice(0, 10))} · <span id="adep-${a.id}"></span><span class="tg">열기</span></span></button>
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
    // 출력 분량(5.3)은 목록 SELECT에 context_meta가 없어 못 싣는다 → 펼칠 때 헤더에 채운다.
    // board 경로는 4번째 이후도 열 수 있는데 #ana-list는 slice(0,3)이라 카드가 없다 → dEl 가드.
    const dp = a.context_meta && a.context_meta.depth;
    const dEl = $("#adep-" + id);
    if (dEl && dp) dEl.textContent = (DEPTH_LABEL[dp] || dp) + " · ";  // 없으면(S1 이전 분석) 아무것도 안 그린다
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
/* 필드별 입력 가이드 — desc는 시트에 상시 노출('무엇을 적나'), eg는 textarea placeholder(예시).
 * Me는 모든 analysis의 장기 맥락 프레임이라(design 3장) 필드는 고정 5개, 안내로 채우기를 돕는다. */
const ME_GUIDE = {
  direction:    { desc: "시한 없는 장기 방향을 한두 문장으로. 모든 분석의 장기 맥락이 돼요.", eg: "예: 데이터로 사람을 돕는 일을 오래 하고 싶다." },
  interests:    { desc: "요즘 끌리는 주제·활동.", eg: "예: 통계, 인지과학, 러닝" },
  career:       { desc: "지향하는 직업/역할과 그 이유.", eg: "예: 헬스케어 데이터 분석 — 결과가 눈에 보여서" },
  personality:  { desc: "스스로 보는 성향·강점·약점.", eg: "예: 몰입형. 시작은 느리지만 깊게 판다." },
  life_pattern: { desc: "수면·집중·기복 등 반복되는 하루 리듬.", eg: "예: 밤에 집중이 잘 되고 오전엔 느리다." },
};

function renderMeHistory(hist, expanded = false) {
  const box = $("#me-history");
  if (!hist.length) {
    box.innerHTML = `<div class="lrow hist-row"><span class="ts mono">—</span><span style="color:var(--faint)">아직 변경 이력이 없어요</span></div>`;
    return;
  }
  const shown = expanded ? hist : hist.slice(0, 5);
  box.innerHTML = shown.map((r) =>
    `<div class="lrow hist-row"><span class="ts mono">${md(r.changed_at.slice(0, 10))}</span>
      <span>${esc(ME_LABELS[r.field] || r.field)} — ${r.old_value ? `“${esc(r.old_value)}” → ` : ""}“${esc(r.new_value)}”${r.source === "ai" ? ' <span class="cap">AI 제안 승인</span>' : ""}</span></div>`).join("");
  if (!expanded && hist.length > 5) {
    const more = document.createElement("button");
    more.className = "hist-more";
    more.textContent = `더 보기 (${hist.length - 5}건)`;
    more.onclick = () => renderMeHistory(hist, true);
    box.appendChild(more);
  }
}

const GUARD_CAUSE_PREFIX = { watch: "감지", protect: "보호 규칙", recheck: "재확인" };
function guardCauseLabel(cause) {
  const raw = String(cause ?? "").trim();
  const colon = raw.indexOf(":");
  if (colon < 0) return raw;
  const label = GUARD_CAUSE_PREFIX[raw.slice(0, colon)];
  if (!label) return raw;
  const detail = raw.slice(colon + 1).trim();
  return detail ? `${label} · ${detail}` : label;
}

function guardReactionLabel(row) {
  if (row.reaction == null) return "아직 반응 없음";
  if (row.reaction === "accepted") return "수용";
  if (row.reaction === "ignored") return "무반응 확정";
  if (row.reaction !== "override") return String(row.reaction);
  const klass = { avoidant: "회피", legitimate: "정당" }[row.override_class] || row.override_class;
  return ["Override", row.override_reason ? `“${row.override_reason}”` : "", klass || ""].filter(Boolean).join(" · ");
}

function guardOutcomeLabel(outcome) {
  if (outcome == null) return "결과 미정";
  return { success: "성공", failure: "실패" }[outcome] || String(outcome);
}

function guardFiredLabel(firedAt) {
  const raw = String(firedAt ?? "");
  // 서버가 정규화한 로컬 표기의 자리만 줄인다. Date 파싱·오프셋 재계산은 하지 않는다.
  return raw.length >= 16 && raw[10] === "T" ? `${raw.slice(0, 10)} ${raw.slice(11, 16)}` : raw || "—";
}

function guardMemoryRow(row) {
  return `<div class="gmem-row">
      <span class="gmem-time mono">${esc(guardFiredLabel(row.fired_at))}</span>
      <span class="gmem-level">Level ${esc(row.level)}</span>
      <span class="gmem-cause"><b>원인</b> <span class="gmem-cause-value">${esc(guardCauseLabel(row.cause))}</span></span>
      <span class="gmem-reaction"><b>반응</b> <span class="gmem-reaction-value">${esc(guardReactionLabel(row))}</span></span>
      <span class="gmem-outcome"><b>결과</b> <span class="gmem-outcome-value">${esc(guardOutcomeLabel(row.outcome))}</span></span>
    </div>`;
}

function renderGuardMemory(events) {
  const box = $("#guard-memory");
  if (!events.length) {
    box.innerHTML = `<div class="gmem-empty">아직 없음 — Guard 개입 이력이 쌓이면 여기에 보여요.</div>`;
    return;
  }

  const days = new Map();
  for (const row of events) {
    const onDate = String(row.on_date ?? "");
    if (!days.has(onDate)) days.set(onDate, []);
    days.get(onDate).push(row);
  }
  const grouped = [...days.entries()].sort(([a], [b]) => b.localeCompare(a));
  box.innerHTML = grouped.map(([onDate, rows], index) => {
    const reactions = new Map();
    for (const row of rows) {
      const key = row.reaction == null ? "" : String(row.reaction);
      reactions.set(key, (reactions.get(key) || 0) + 1);
    }
    const reactionText = [...reactions.entries()].map(([reaction, count]) =>
      `${guardReactionLabel({ reaction: reaction || null })} ${count}`).join(" · ");
    return `<section class="gday-section" data-gday-date="${esc(onDate)}"${index >= 7 ? " hidden" : ""}>
      <button type="button" class="gday-summary" aria-expanded="false">
        <span class="gday-date">${esc(dlabel(onDate))}</span>
        <span class="gday-stats">개입 ${rows.length} · ${esc(reactionText)}</span>
      </button>
      <div class="gday-events" hidden>${rows.map(guardMemoryRow).join("")}</div>
    </section>`;
  }).join("") + (grouped.length > 7
    ? `<button type="button" class="gday-more">더 보기 (${grouped.length - 7}일)</button>` : "");

  box.querySelectorAll(".gday-summary").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.closest(".gday-section");
      const opening = !section.classList.contains("gday-open");
      box.querySelectorAll(".gday-section").forEach((item) => {
        item.classList.remove("gday-open");
        item.querySelector(".gday-summary").setAttribute("aria-expanded", "false");
        item.querySelector(".gday-events").hidden = true;
      });
      if (opening) {
        section.classList.add("gday-open");
        button.setAttribute("aria-expanded", "true");
        section.querySelector(".gday-events").hidden = false;
      }
    });
  });
  box.querySelector(".gday-more")?.addEventListener("click", (event) => {
    box.querySelectorAll(".gday-section[hidden]").forEach((section) => { section.hidden = false; });
    event.currentTarget.remove();
  });
}

const MODE_WAIT_MS = 60_000;
let modeCtx = null;
let modeWaitTimer = null;
let modeTickTimer = null;

function modeUntilLabel(value) {
  const raw = String(value ?? "");
  // protecting.until은 서버가 이미 로컬 오프셋으로 정규화했다. 자리만 줄이고 다시 계산하지 않는다.
  if (raw.length < 16 || raw[10] !== "T") return raw || "—";
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  return `${month}/${day} ${raw.slice(11, 16)}`;
}

function modeProtectionText(protecting) {
  if (!protecting) return "";
  return `“${protecting.title}” 보호 중 · ${modeUntilLabel(protecting.until)} 이후 해제`;
}

function renderGuardModes(data = S.guardModes) {
  const box = $("#mode-list");
  if (!box) return;
  const modes = data?.modes || [];
  const activeKey = data?.active?.key;
  $("#mode-current").textContent = data?.active?.label || activeKey || "";
  box.innerHTML = modes.map((mode) => {
    const active = mode.key === activeKey;
    return `<button class="mode-row${active ? " mode-active" : ""}" data-mode-key="${esc(mode.key)}">
      <span class="mode-copy-block"><span class="mode-label">${esc(mode.label || mode.key)}</span>
      <span class="mode-meta">최대 Level ${esc(mode.max_level)}</span></span>
      ${active ? '<span class="mode-badge">사용 중</span>' : ""}</button>`;
  }).join("");
  box.querySelectorAll("[data-mode-key]").forEach((button) => {
    button.onclick = () => chooseGuardMode(button.dataset.modeKey);
  });
  const protecting = $("#mode-protecting");
  protecting.textContent = modeProtectionText(data?.protecting);
  protecting.style.display = data?.protecting ? "" : "none";
}

async function refreshGuardModes() {
  S.guardModes = await Api.guardModes();
  renderGuardModes();
  return S.guardModes;
}

function clearModeWait() {
  clearTimeout(modeWaitTimer);
  clearInterval(modeTickTimer);
  modeWaitTimer = null;
  modeTickTimer = null;
}

function cancelModeChange(close = true) {
  clearModeWait();
  modeCtx = null;
  if (close && $("#sh-mode")) closeSheet("sh-mode");
}

function setModeError(message = "") {
  const box = $("#mode-error");
  box.textContent = message;
  box.style.display = message ? "" : "none";
}

function showModeReason(ctx, error = "") {
  modeCtx = ctx;
  clearModeWait();
  $("#mode-head").textContent = `${ctx.label}로 내리기`;
  $("#mode-copy").textContent = "강도를 낮추는 이유를 남기고 60초를 기다립니다.";
  $("#mode-reason-wrap").style.display = "";
  $("#mode-reason").value = ctx.reason || "";
  $("#mode-wait").style.display = "none";
  $("#mode-context").style.display = "none";
  setModeError(error);
  $("#mode-confirm").style.display = "";
  $("#mode-confirm").disabled = false;
  $("#mode-confirm").textContent = "60초 대기 시작";
  $("#mode-cancel").textContent = "취소";
  openSheet("sh-mode");
}

function showModeProtected(protecting, serverMessage = "") {
  clearModeWait();
  modeCtx = null;
  $("#mode-head").textContent = "지금은 모드를 내릴 수 없어요";
  $("#mode-copy").textContent = "사용자가 정한 보호 구간이 끝난 뒤 다시 시도할 수 있어요.";
  $("#mode-reason-wrap").style.display = "none";
  $("#mode-wait").style.display = "none";
  setModeError(serverMessage);
  const context = $("#mode-context");
  context.textContent = modeProtectionText(protecting);
  context.style.display = protecting ? "" : "none";
  $("#mode-confirm").style.display = "none";
  $("#mode-cancel").textContent = "닫기";
  openSheet("sh-mode");
}

async function submitModeChange(ctx) {
  if (modeCtx !== ctx) return;
  $("#mode-confirm").disabled = true;
  $("#mode-count").textContent = "변경 중…";
  try {
    await Api.guardSetMode(ctx.key, ctx.reason);
    cancelModeChange();
    await refreshGuardModes();
    toast(`${ctx.label} 모드로 바꿨어요`, "ok");
  } catch (e) {
    if (modeCtx !== ctx) return;
    if (e.status === 409) {
      let data = S.guardModes;
      try { data = await refreshGuardModes(); } catch { /* 서버 오류 문구는 아래에 그대로 남긴다 */ }
      showModeProtected(data?.protecting, e.message);
      return;
    }
    showModeReason(ctx, e.message);
  }
}

function beginModeWait() {
  if (!modeCtx) return;
  const reason = $("#mode-reason").value.trim();
  if (!reason) {
    setModeError("왜 내리는지 적어주세요");
    $("#mode-reason").focus();
    return;
  }
  const ctx = { ...modeCtx, reason };
  modeCtx = ctx;
  setModeError();
  $("#mode-reason-wrap").style.display = "none";
  $("#mode-wait").style.display = "";
  $("#mode-confirm").disabled = true;
  $("#mode-confirm").textContent = "기다리는 중";
  const started = Date.now();
  const paint = () => {
    const left = Math.max(0, Math.ceil((MODE_WAIT_MS - (Date.now() - started)) / 1000));
    $("#mode-count").textContent = `${left}초`;
  };
  paint();
  modeTickTimer = setInterval(paint, 250);
  // PUT은 반드시 이 완료 콜백 안에서만 보낸다. 타이머는 표시가 아니라 마찰 자체다.
  modeWaitTimer = setTimeout(() => {
    clearModeWait();
    void submitModeChange(ctx);
  }, MODE_WAIT_MS);
}

function chooseGuardMode(key) {
  const target = S.guardModes?.modes?.find((mode) => mode.key === key);
  if (!target || key === S.guardModes?.active?.key) return Promise.resolve();
  // 방향 판정은 modes[].downgrade 그대로다. 파라미터를 프런트에서 다시 비교하지 않는다.
  if (!target.downgrade) {
    return run(async () => {
      await Api.guardSetMode(key);
      await refreshGuardModes();
      toast(`${target.label || key} 모드로 바꿨어요`, "ok");
    });
  }
  if (S.guardModes.protecting) {
    showModeProtected(S.guardModes.protecting);
    return Promise.resolve();
  }
  showModeReason({ key, label: target.label || key, reason: "" });
  return Promise.resolve();
}

function bindModeSheet() {
  $("#mode-cancel").onclick = () => cancelModeChange();
  $("#mode-confirm").onclick = beginModeWait;
}

async function renderMe() {
  // Life Model 섹션은 덧붙은 화면이다 — 하나가 실패해도 Me 본문을 인질로 잡지 않는다.
  // lmSchema는 활성 행이 없으면 404를 던진다(lifemodel.ts). v2 전환·비활성화 중에
  // Promise.all이 그대로 거절되면 Me 탭이 통째로 안 그려진다.
  const [me, hist, guard, guardModes, goalsSchema, goals, educationSchema, education, periods, collectSt] =
    await Promise.all([
      Api.me(), Api.meHistory(), Api.guardEvents(), Api.guardModes(),
      Api.lmSchema("goals").catch(() => null), Api.lmItems("goals").catch(() => []),
      Api.lmSchema("education").catch(() => null), Api.lmItems("education").catch(() => []),
      Api.periods().catch(() => S.periods),
      // T-43. **`.catch`는 옛 배포를 위한 것**이다 — 이 라우트가 없는 Worker가 살아 있으면
      // 404가 오고, 그것이 Me 탭을 통째로 인질로 잡으면 안 된다(위 문단과 같은 이유).
      Api.collectedStatus().catch(() => null),
    ]);
  S.collectStatus = collectSt;
  S.me = me;
  S.guardModes = guardModes;
  S.goalsSchema = goalsSchema;
  S.goals = goals;
  S.educationSchema = educationSchema;
  S.education = education;
  if (Array.isArray(periods)) S.periods = periods;
  let h = "";
  // 기본 5필드는 값이 없어도 항상 노출 — 눌러 바로 입력하도록(직접입력 진입을 명시). 그 뒤에 5필드 밖의 값(있으면)을 잇는다.
  const byField = Object.fromEntries(me.fields.map((f) => [f.field, f.value]));
  const known = Object.keys(ME_LABELS);
  const order = [...known, ...me.fields.map((f) => f.field).filter((f) => !known.includes(f))];
  for (const field of order) {
    const val = byField[field];
    h += `<button class="merow" style="width:100%" onclick="openMe('${field}')">
      <span class="ml">${esc(ME_LABELS[field] || field)}</span>${val ? esc(val) : `<span class="cap">아직 없음 — 눌러서 입력해요</span>`}</button>`;
  }
  if (me.now.length)
    h += `<div class="merow"><span class="ml">지금 — 활성 기간에서 자동</span>` +
      me.now.map((n) => `<i class="pdot" style="display:inline-block;margin-right:5px;background:${n.color}"></i>${esc(n.goals.join(" · ") || n.title)}`).join('<span style="display:inline-block;width:10px"></span>') + `</div>`;
  h += `<p class="cap" style="margin-top:9px">'지금' 줄은 periods의 목표를 조인한 파생 — Me에 중복 저장하지 않아요.</p>`;
  $("#me-fields").innerHTML = h;

  renderMeHistory(hist);
  renderGuardModes();
  renderGuardMemory(guard);

  renderGoals();
  renderEducation();

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
    `<button class="srow" ${act(key)}>${k}<em>${esc(v)}</em></button>`).join("")
    + collectStatusRow(S.collectStatus);
}

/* 학사 캘린더 수집 상태 — 설정 안 한 줄 (T-43) ────────────────
 *
 * ★ **T-33의 §금지와 충돌하지 않는다.** T-33이 실패를 숨기라 한 근거는
 * *"사용자가 할 수 있는 일이 없다"*였다(Guard 조회 실패는 기록만 늘린다).
 * **수집 실패는 할 일이 있다 — 토큰을 다시 넣어야 한다.** 행동이 가능한 실패는 보인다.
 * 이 문단이 없으면 다음 사람이 T-33을 근거로 이 줄을 지운다.
 *
 * **그래서 여기는 안 숨는다.** 제안 카드(`#td-coll`)는 없으면 사라지는 것이 맞지만,
 * 이 줄이 사라지면 *"수집이 죽은 채로 학기가 지나간다"*가 그대로 돌아온다.
 * 정상일 때는 조용한 한 줄이고 **실패일 때만** 눈에 띈다(§금지 3행).
 *
 * ★ **"마감"·"제출"을 쓰지 않는다** — T-42와 같은 이유다. 여기는 수집이 언제 돌았는지만 말한다.
 */
function collectAgo(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}시간 전` : `${Math.floor(hr / 24)}일 전`;
}

function collectStatusLine(st) {
  if (!st) return { state: "unknown", text: "상태를 못 읽었어요" };
  if (!st.configured) return { state: "none", text: "설정 안 됨" };
  // 마지막 시도가 실패였다 — 성공하면 서버가 사유를 지운다. **사유를 그대로 보여준다**:
  // `http_401`(토큰 만료)과 `not_calendar`(로그인 페이지)는 사용자가 할 일이 같지만,
  // 우리가 문장으로 뭉뚱그리면 다음에 다른 사유가 왔을 때 그것도 같은 문장이 된다.
  if (st.last_result && st.last_result !== "ok")
    return { state: "error", bad: true, text: `연결 실패 (${st.last_result}) · 주소를 다시 넣어 주세요` };
  if (!st.last_collect_at) return { state: "never", text: "아직 확인 전" };
  // ★ **0건과 '안 돌았다'가 여기서 갈린다.** 0이면 그대로 "0건"이라 쓴다 — 방학의 정상이다.
  //   `null`은 T-43 이전에 수집한 것이라 건수 기록이 없는 경우다(있는 척하지 않는다).
  const seen = st.last_seen_count == null
    ? "건수 기록 전" : `${st.last_seen_count}건 중 새로 ${st.counts?.new ?? 0}건`;
  return { state: "ok", text: `${collectAgo(st.last_collect_at)} 확인 · ${seen}` };
}

function collectStatusRow(st) {
  const v = collectStatusLine(st);
  return `<div class="srow${v.bad ? " srow-alert" : ""}" id="set-collect" data-state="${v.state}">`
    + `학사 캘린더<em>${esc(v.text)}</em></div>`;
}

function toggleSet(on) { $("#me-main").style.display = on ? "none" : ""; $("#me-set").style.display = on ? "" : "none"; }

/* ── Goals (Life Model) ─────────────────────────────────── */
let goalsCtx = null;

function goalDday(item) {
  const periodId = item?.data && typeof item.data === "object" ? item.data.period_id : null;
  const period = periodId ? S.periods.find((p) => String(p.id) === String(periodId)) : null;
  const label = String(period?.dday_label || "").trim();
  if (!period || period.kind !== "constraint" || !label || !S.today?.date || !period.end_date) return "";
  const days = diffDaysStr(period.end_date, S.today.date);   // 기기 날짜가 아니라 서버가 준 현재 귀속일
  if (!Number.isFinite(days)) return "";
  const value = days === 0 ? "D-DAY" : days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
  return `${label} ${value}`;
}

function renderGoals() {
  const box = $("#lm-goals-list");
  if (!box) return;
  const items = S.goals || [];
  if (!items.length) {
    box.innerHTML = '<div class="lrow"><span class="ts mono">—</span><span style="color:var(--faint)">아직 Goals 항목이 없어요 — 방향이 생기면 하나씩 적어 봐요.</span></div>';
    return;
  }
  box.innerHTML = items.map((item) => {
    const data = item.data && typeof item.data === "object" ? item.data : {};
    const meta = [data.horizon, data.metric].filter((v) => v !== null && v !== undefined && String(v).trim()).join(" · ");
    const dday = goalDday(item);
    return '<button class="lm-goals-row" data-lm-goals-id="' + esc(item.id) + '">' +
      '<span class="lm-goals-copy"><span class="lm-goals-title">' + esc(item.title) + '</span>' +
      (meta ? '<span class="lm-goals-meta">' + esc(meta) + '</span>' : "") + '</span>' +
      (dday ? '<span class="lm-goals-dday">' + esc(dday) + '</span>' : "") +
      '</button>';
  }).join("");
  $$("#lm-goals-list [data-lm-goals-id]").forEach((b) => {
    b.onclick = () => openGoalsForm(b.dataset.lmGoalsId);
  });
}

function goalsFieldLabel(field) {
  if (field && typeof field === "object") return field.title || String(field.key).replace(/_/g, " ");
  return String(field).replace(/_/g, " ");
}

function goalsFieldControl(field, data) {
  const key = String(field.key || "");
  const value = data[key];
  const required = field.required ? '<span class="lm-goals-required"> · 필수</span>' : "";
  let control = "";
  if (key === "period_id") {
    const options = S.periods.map((p) => {
      const label = [p.title || p.id, p.start_date && p.end_date ? `${p.start_date}~${p.end_date}` : ""].filter(Boolean).join(" · ");
      return '<option value="' + esc(p.id) + '"' + (String(value ?? "") === String(p.id) ? " selected" : "") + '>' + esc(label) + '</option>';
    }).join("");
    control = '<select class="lm-goals-input" data-lm-goals-key="' + esc(key) + '"><option value="">연결 안 함</option>' + options + '</select>';
  } else if (Array.isArray(field.enum)) {
    control = '<select class="lm-goals-input" data-lm-goals-key="' + esc(key) + '"><option value="">선택…</option>' +
      field.enum.map((v) => '<option value="' + esc(v) + '"' + (value === v ? " selected" : "") + '>' + esc(v) + '</option>').join("") +
      "</select>";
  } else {
    const isArray = field.type === "array";
    const inputType = field.type === "number" ? "number" : "text";
    const raw = isArray && Array.isArray(value) ? value.join(", ") : (value ?? "");
    const hint = isArray
      ? ' placeholder="쉼표나 줄바꿈으로 구분' + (field.itemType ? " (" + esc(field.itemType) + ")" : "") + '"'
      : "";
    control = '<input class="lm-goals-input" type="' + inputType + '" data-lm-goals-key="' + esc(key) + '" value="' + esc(raw) + '"' + hint + ">";
  }
  return '<label class="lm-goals-field"><span class="lm-goals-field-label">' +
    esc(goalsFieldLabel(field)) + required + "</span>" + control + "</label>";
}

function openGoalsForm(id = null) {
  const schema = S.goalsSchema;
  if (!schema || !Array.isArray(schema.fields)) return toast("Goals 스키마를 아직 불러오지 못했어요", "warn");
  const item = id ? S.goals.find((x) => String(x.id) === String(id)) : null;
  if (id && !item) return toast("해당 Goals 항목을 찾지 못했어요", "warn");
  goalsCtx = item || null;
  const data = goalsCtx?.data && typeof goalsCtx.data === "object" ? goalsCtx.data : {};
  $("#lm-goals-head").textContent = goalsCtx ? "Goals 수정" : "Goals 추가";
  $("#lm-goals-title").value = goalsCtx?.title || "";
  $("#lm-goals-fields").innerHTML = schema.fields.map((field) => goalsFieldControl(field, data)).join("");
  $("#lm-goals-delete").style.display = goalsCtx ? "" : "none";
  openSheet("sh-goals");
}

function collectGoalsForm() {
  const title = $("#lm-goals-title").value.trim();
  if (!title) return { error: "목표명 항목은 필수예요" };
  const fields = S.goalsSchema?.fields || [];
  const inputs = [...$("#lm-goals-fields").querySelectorAll("[data-lm-goals-key]")];
  const data = {};
  for (const field of fields) {
    const input = inputs.find((el) => el.dataset.lmGoalsKey === String(field.key));
    const raw = (input?.value || "").trim();
    const isArray = field.type === "array";
    if (field.required && !raw) return { error: goalsFieldLabel(field) + " 항목은 필수예요" };
    if (!raw) continue;
    if (isArray) {
      const values = raw.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
      if (field.required && !values.length) return { error: goalsFieldLabel(field) + " 항목은 필수예요" };
      if (field.itemType === "number") {
        const numbers = values.map(Number);
        if (numbers.some((v) => !Number.isFinite(v))) return { error: goalsFieldLabel(field) + "은 숫자로 적어 주세요" };
        data[field.key] = numbers;
      } else data[field.key] = values;
    } else if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: goalsFieldLabel(field) + "은 숫자로 적어 주세요" };
      data[field.key] = value;
    } else data[field.key] = raw;
  }
  return { title, data };
}

async function refreshGoals() {
  const [schema, items, periods] = await Promise.all([Api.lmSchema("goals"), Api.lmItems("goals"), Api.periods()]);
  S.goalsSchema = schema;
  S.goals = items;
  S.periods = periods;
  renderGoals();
}

function bindGoalsSheet() {
  $("#lm-goals-save").onclick = () => run(async () => {
    const form = collectGoalsForm();
    if (form.error) return toast(form.error, "warn");
    const editing = !!goalsCtx;
    if (editing) await Api.lmUpdate(goalsCtx.id, { title: form.title, data: form.data });
    else await Api.lmCreate("goals", { title: form.title, data: form.data });
    closeAll();
    toast(editing ? "Goals 항목을 수정했어요" : "Goals 항목을 추가했어요", "ok");
    await refreshGoals();
  });
  $("#lm-goals-delete").onclick = () => run(async () => {
    if (!goalsCtx) return;
    const okd = await confirmAsk("Goals 항목을 삭제할까요?", "삭제한 항목은 되돌릴 수 없어요.", "삭제");
    if (okd !== "ok") return;
    await Api.lmDelete(goalsCtx.id);
    closeAll();
    toast("Goals 항목을 삭제했어요", "warn");
    await refreshGoals();
  });
}

/* ── Education (Life Model) ─────────────────────────────── */
let educationCtx = null;

function renderEducation() {
  const box = $("#lm-education-list");
  if (!box) return;
  const items = S.education || [];
  if (!items.length) {
    box.innerHTML = '<div class="lrow"><span class="ts mono">—</span><span style="color:var(--faint)">아직 Education 항목이 없어요 — 필요한 것부터 적어 봐요.</span></div>';
    return;
  }
  box.innerHTML = items.map((item) => {
    const data = item.data && typeof item.data === "object" ? item.data : {};
    const status = typeof data.status === "string" ? data.status : "";
    const meta = [data.term, data.grade].filter((v) => v !== null && v !== undefined && String(v).trim()).join(" · ");
    return '<button class="lm-education-row" data-lm-education-id="' + esc(item.id) + '">' +
      '<span class="lm-education-copy"><span class="lm-education-title">' + esc(item.title) + '</span>' +
      (meta ? '<span class="lm-education-meta">' + esc(meta) + '</span>' : "") + '</span>' +
      (status ? '<span class="lm-education-status" data-status="' + esc(status) + '">' + esc(status) + '</span>' : "") +
      '</button>';
  }).join("");
  $$("#lm-education-list [data-lm-education-id]").forEach((b) => {
    b.onclick = () => openEducationForm(b.dataset.lmEducationId);
  });
}

// 라벨은 스키마가 준다(0014) — 프런트에 매핑을 두면 v2의 새 필드만 영문으로 남는다.
// fieldsOf가 이미 title→key 폴백을 끝내 놨지만, 옛 배포가 title 없이 응답할 수 있으니 여기서도 받는다.
function educationFieldLabel(field) {
  if (field && typeof field === "object") return field.title || String(field.key).replace(/_/g, " ");
  return String(field).replace(/_/g, " ");
}

function educationFieldControl(field, data) {
  const key = String(field.key || "");
  const value = data[key];
  const required = field.required ? '<span class="lm-education-required"> · 필수</span>' : "";
  let control = "";
  if (Array.isArray(field.enum)) {
    control = '<select class="lm-education-input" data-lm-education-key="' + esc(key) + '"><option value="">선택…</option>' +
      field.enum.map((v) => '<option value="' + esc(v) + '"' + (value === v ? " selected" : "") + '>' + esc(v) + '</option>').join("") +
      "</select>";
  } else {
    const isArray = field.type === "array";
    const inputType = field.type === "number" ? "number" : "text";
    const raw = isArray && Array.isArray(value) ? value.join(", ") : (value ?? "");
    const hint = isArray
      ? ' placeholder="쉼표나 줄바꿈으로 구분' + (field.itemType ? " (" + esc(field.itemType) + ")" : "") + '"'
      : "";
    control = '<input class="lm-education-input" type="' + inputType + '" data-lm-education-key="' + esc(key) + '" value="' + esc(raw) + '"' + hint + ">";
  }
  return '<label class="lm-education-field"><span class="lm-education-field-label">' +
    esc(educationFieldLabel(field)) + required + "</span>" + control + "</label>";
}

function openEducationForm(id = null) {
  const schema = S.educationSchema;
  if (!schema || !Array.isArray(schema.fields)) return toast("Education 스키마를 아직 불러오지 못했어요", "warn");
  const item = id ? S.education.find((x) => x.id === id) : null;
  if (id && !item) return toast("해당 Education 항목을 찾지 못했어요", "warn");
  educationCtx = item || null;
  const data = educationCtx?.data && typeof educationCtx.data === "object" ? educationCtx.data : {};
  $("#lm-education-head").textContent = educationCtx ? "Education 수정" : "Education 추가";
  $("#lm-education-fields").innerHTML = schema.fields.map((field) => educationFieldControl(field, data)).join("");
  $("#lm-education-delete").style.display = educationCtx ? "" : "none";
  openSheet("sh-education");
}

function collectEducationForm() {
  const fields = S.educationSchema?.fields || [];
  const inputs = [...$("#lm-education-fields").querySelectorAll("[data-lm-education-key]")];
  const data = {};
  for (const field of fields) {
    const input = inputs.find((el) => el.dataset.lmEducationKey === String(field.key));
    const raw = (input?.value || "").trim();
    const isArray = field.type === "array";
    if (field.required && !raw) return { error: educationFieldLabel(field) + " 항목은 필수예요" };
    if (!raw) continue;
    if (isArray) {
      const values = raw.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
      if (field.required && !values.length) return { error: educationFieldLabel(field) + " 항목은 필수예요" };
      if (field.itemType === "number") {
        const numbers = values.map(Number);
        if (numbers.some((v) => !Number.isFinite(v))) return { error: educationFieldLabel(field) + "은 숫자로 적어 주세요" };
        data[field.key] = numbers;
      } else data[field.key] = values;
    } else if (field.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: educationFieldLabel(field) + "은 숫자로 적어 주세요" };
      data[field.key] = value;
    } else data[field.key] = raw;
  }
  // 제목 후보에서 enum은 뺀다 — status도 {"type":"string","enum":[…]}라, 스키마의 properties
  // 순서가 바뀌면(v2) 제목이 "enrolled" 같은 상태값이 된다. 지금 통과하는 건 name이 먼저인 덕이다.
  const titleField = fields.find((f) => f.type === "string" && f.required && !f.enum)
    || fields.find((f) => f.type === "string" && !f.enum);
  const title = String((titleField && data[titleField.key]) || educationCtx?.title || "").trim();
  if (!title) return { error: "제목으로 쓸 텍스트 항목을 적어 주세요" };
  return { title, data };
}

async function refreshEducation() {
  const [schema, items] = await Promise.all([Api.lmSchema("education"), Api.lmItems("education")]);
  S.educationSchema = schema;
  S.education = items;
  renderEducation();
}

function bindEducationSheet() {
  $("#lm-education-save").onclick = () => run(async () => {
    const form = collectEducationForm();
    if (form.error) return toast(form.error, "warn");
    // closeAll()보다 먼저 읽는다 — closeAll이 evxCtx·dfxCtx를 버리듯 educationCtx도
    // 버리게 되는 날(주석이 그러라고 말하고 있다) 이 문구가 조용히 거짓말을 한다.
    const editing = !!educationCtx;
    if (editing) await Api.lmUpdate(educationCtx.id, { title: form.title, data: form.data });
    else await Api.lmCreate("education", { title: form.title, data: form.data });
    closeAll();
    toast(editing ? "Education 항목을 수정했어요" : "Education 항목을 추가했어요", "ok");
    await refreshEducation();
  });
  $("#lm-education-delete").onclick = () => run(async () => {
    if (!educationCtx) return;
    const okd = await confirmAsk("Education 항목을 삭제할까요?", "삭제한 항목은 되돌릴 수 없어요.", "삭제");
    if (okd !== "ok") return;
    await Api.lmDelete(educationCtx.id);
    closeAll();
    toast("Education 항목을 삭제했어요", "warn");
    await refreshEducation();
  });
}


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
    invalidateCalendarCache();
    closeAll();
    toast(pdCtx ? "기간을 수정했어요" : "기간을 만들었어요", "ok");
    S.periods = await Api.periods();
    calendarPeriodListCache = S.periods;
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
  $("#pd-delete").onclick = () => run(async () => {
    if (!pdCtx) return;
    await Api.deletePeriod(pdCtx.id);
    invalidateCalendarCache();
    closeAll();
    toast("기간을 삭제했어요", "warn");
    S.periods = await Api.periods();
    calendarPeriodListCache = S.periods;
    syncAll();
    if ($("#phone").dataset.tab === "cal") renderCalendar();
  });
}

/* ── Me 필드 편집 (3장) ────────────────────────────────────── */
let meCtx = null;
function openMe(field) {
  meCtx = field;
  $("#me-head").textContent = ME_LABELS[field] || field;
  const g = ME_GUIDE[field];
  $("#me-guide").textContent = g ? g.desc : "";
  const row = (S.me && S.me.fields.find((f) => f.field === field)) || null;
  const ta = $("#me-value");
  ta.value = row ? row.value : "";
  ta.placeholder = g ? g.eg : "내용을 적어요…";
  openSheet("sh-me");
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
  const d = ($("#anal-depth .wseg.on")?.dataset.d) || "detailed";
  const btn = $("#btn-run-anal");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 분석 중 — 2-pass';
  try {
    const a = await Api.runAnalysis(q, d);
    $("#anal-q").value = "";   // 세그 선택은 초기화하지 않는다(다음 분석에도 같은 분량을 쓰는 게 보통).
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

/* ── 누름 피드백 ─────────────────────────────────────────────
 * 박스형 조작부만 한 곳에서 위임해 동적 렌더 뒤에도 그대로 적용한다.
 * 캐러셀이 가로축을 확정하면 이미 .dragging을 붙이므로 그 신호만 읽어 피드백을 걷는다.
 * 제스처 임계값을 여기서 다시 계산하지 않는다. */
const PRESS_FEEDBACK_SELECTOR = [
  ".c", ".trow", ".evrow", ".merow", ".lm-goals-row", ".lm-education-row",
  ".seg button", ".wseg", ".seg-mini button",
].join(",");
let pressFeedbackTarget = null;
function clearPressFeedback() {
  if (pressFeedbackTarget) pressFeedbackTarget.classList.remove("press-feedback-on");
  pressFeedbackTarget = null;
}
function bindPressFeedback() {
  const host = $("#phone");
  host.addEventListener("pointerdown", (e) => {
    clearPressFeedback();
    const target = e.target.closest && e.target.closest(PRESS_FEEDBACK_SELECTOR);
    if (!target || !host.contains(target)) return;
    pressFeedbackTarget = target;
    target.classList.add("press-feedback-on");
  }, { passive: true });
  host.addEventListener("pointermove", (e) => {
    if (pressFeedbackTarget && e.target.closest && e.target.closest(".dragging")) clearPressFeedback();
  }, { passive: true });
  for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"])
    host.addEventListener(type, clearPressFeedback, { passive: true });
  window.addEventListener("blur", clearPressFeedback);
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
const SWIPE_EDGE_RATIO = 0.2;

function isSwipeEdge(e, host) {
  const width = host.clientWidth || 380;
  const left = host.getBoundingClientRect().left;
  const x = e.clientX - left;
  return x <= width * SWIPE_EDGE_RATIO || x >= width * (1 - SWIPE_EDGE_RATIO);
}

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
    dragBlockUntil = Date.now() + 60;                   // 끌고 난 직후의 click은 삼킨다(짧게 — A-4)
    const v = Date.now() - moveT > VEL_STALE ? 0 : vel;  // 멈췄다가 뗐으면 던진 게 아니다
    opt.commit(trackDir(dx, v, host.clientWidth || 380));
  }, { passive: true });

  host.addEventListener("pointercancel", () => { if (axis === "x") opt.commit(0); stop(); }, { passive: true });
}

function bindSwipe() {
  const scr = $(".screens");
  const track = () => $("#tab-track");
  const idx = () => Math.max(0, TAB_ORDER.indexOf($("#phone").dataset.tab));
  const noSwipe = (e) => {
    const el = e.target;
    if (!el.closest) return false;
    if (el.closest(".bchart, .wsegs, .seg, .seg-mini, .likert, .dcol, .sheet, .board, .modal, .tut, input, textarea")) return true;
    return !!el.closest("#cal-rows") && !isSwipeEdge(e, scr);
  };

  bindCarousel(scr, {
    blocked: (e) => noSwipe(e) || !!S.pick,
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

/* 캘린더 가로 드래그 — 달 넘기기. 항상 5-pane의 가운데(2)에 있고 양옆 두 달이 따라온다.
 * 끄는 동안 다음 달이 그대로 따라 들어온다. */
let calBusy = false, calGen = 0;
function calGo(dir) {
  const track = $("#cal-track");
  if (!dir) return trackSet(track, CAL_CENTER, true, CAL_GAP, CAL_TRACK_STEP);
  if (calBusy || !S.today) return;
  calBusy = true;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    track.removeEventListener("transitionend", onEnd);
    clearTimeout(timer);
    S.cal = addMonth(S.cal.y, S.cal.m, dir);
    calGen++;                     // 세대 증가 — 이후 조립만 유효(경합 시 최신 우선)
    // 데이터 조립과 세대 검사가 끝난 뒤에만 pane을 회전한다. 회전·재중심화까지 한 전환이므로
    // 그 짧은 동안은 다음 제스처를 막아 DOM 순서가 중첩되지 않게 한다.
    run(() => renderCalendar(dir).finally(() => { calBusy = false; }));
  };
  const onEnd = (e) => { if (e.target === track) finish(); };
  const timer = setTimeout(finish, TRACK_MS + 150);   // transitionend 유실 대비
  track.addEventListener("transitionend", onEnd);
  trackSet(track, CAL_CENTER + dir, true, CAL_GAP, CAL_TRACK_STEP);
}

function bindCalendarDrag() {
  const host = $("#cal-rows");
  const scr = $(".screens");
  bindCarousel(host, {
    blocked: (e) => !!S.pick || calBusy || isSwipeEdge(e, scr),   // 가장자리는 바깥 탭 캐러셀이 받는다
    drag: (dx) => trackDrag($("#cal-track"), CAL_CENTER, dx, CAL_GAP, CAL_TRACK_STEP),
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
const STRETCH_MAX = 90, STRETCH_K = 0.42;
const STRETCH_BACK_MS = 460, STRETCH_BACK_EASE = "cubic-bezier(.22,1,.36,1)";
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
        sc.style.transition = `transform ${STRETCH_BACK_MS}ms ${STRETCH_BACK_EASE}`;
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
    // 앱으로 돌아올 때마다 상시 서비스를 되살린다.
    // GuardPlugin.load()는 **콜드 스타트에서만** 돌아서, 최근 앱에서 밀어 종료한 뒤
    // 홈에서 다시 들어오면 서비스가 죽은 채로 남는다. 여기가 유일한 복귀 지점이다.
    // 이미 떠 있으면 startForegroundService는 무해하다.
    globalThis.Capacitor?.Plugins?.Guard?.startService?.().catch(() => {});
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

/* Guard 네이티브 동기화 — Android 셸에서만 동작한다(웹에서는 조용히 건너뛴다).
 *
 * 토큰은 여기 localStorage에 있고 네이티브가 직접 못 읽는다. 그래서 웹이 건네준다.
 * 건넨 뒤 한 번 sync를 돌려 서버의 보호 일정을 알람으로 걸어 둔다 —
 * 이후로는 기기가 하루 1회 스스로 갱신하므로 앱을 안 열어도 유지된다(ADR-021).
 *
 * 실패해도 화면을 막지 않는다. 이미 걸린 알람은 동기화와 무관하게 발동한다.
 */
async function syncGuardNative() {
  const G = globalThis.Capacitor?.Plugins?.Guard;
  if (!G) return;                                  // 브라우저·PWA — 네이티브 없음
  try {
    await G.configure({
      baseUrl: location.origin,
      token: localStorage.getItem("api_token") || null,
    });
    const r = await G.sync();
    if (!r.ok) console.warn("[guard] sync 실패:", r.error);
  } catch (e) {
    console.warn("[guard] sync 예외:", e);
  }
}

let booted = false;
async function boot() {
  // DOMContentLoaded가 두 번 오는 환경(테스트 하니스·일부 웹뷰)에서도 바인딩은 한 번만.
  // 두 번 걸리면 스와이프 한 번에 탭이 두 칸 넘어가는 식으로 조용히 어긋난다.
  if (booted) return;
  booted = true;

  // 하드웨어 뒤로가기 (T-34). 판단은 `handleBack()`이 하고 여기는 잇기만 한다.
  // 브라우저(PWA)엔 Capacitor가 없으므로 조용히 지나간다 — 그 환경엔 하드웨어 키도 없다.
  // ⚠️ 리스너를 달면 Capacitor의 기본 동작이 꺼진다 → **나가는 것도 우리가 해야 한다.**
  //    `handleBack()`이 `null`을 주면 `exitApp()`이다. 이걸 빼면 사용자가 앱에 갇힌다.
  const capApp = globalThis.Capacitor?.Plugins?.App;
  capApp?.addListener?.("backButton", () => {
    if (!handleBack()) capApp.exitApp?.();
  });

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
  // .wseg 스타일은 works·분석 depth가 공유하지만 동작은 다르다 → 선택자를 컨테이너로 좁힌다.
  $$("#scr-works .wseg").forEach((b) => (b.onclick = () => {
    $$("#scr-works .wseg").forEach((x) => x.classList.toggle("on", x === b));
    $$(".wview").forEach((v) => v.classList.toggle("on", v.id === "w-" + b.dataset.w));
  }));
  // 분석 출력 분량 — 선택만 바꾸고 분석을 자동 실행하지 않는다.
  $$("#anal-depth .wseg").forEach((b) => (b.onclick = () => {
    $$("#anal-depth .wseg").forEach((x) => x.classList.toggle("on", x === b));
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
  // 상태 서술은 '기록'이라 마감 후엔 어떤 경로로도 못 쓴다(트리거가 막는다).
  // 게다가 cron이 30분마다 지난 날을 auto 마감하므로 받을 수 있는 창은 수동 마감 직전뿐이다.
  // → 비어 있을 때만 확인 박스에 한 줄 유도. 강제하지 않는다.
  const askClose = (kind) => run(async () => {
    const cur = ((S.today.daily && S.today.daily.feelings_text) || "").trim();
    const extra = cur ? "" :
      `<textarea id="cf-feel" rows="2" style="margin-top:10px;width:100%;box-sizing:border-box"
         placeholder="오늘 상태를 한 줄로 (선택) — 마감 후엔 못 써요"></textarea>`;
    const okd = await confirmAsk(
      kind === "brief" ? "간략히 마감할까요?" : "오늘 하루를 마감할까요?",
      (kind === "brief"
        ? "Feelings만 확정하고 닫아요. 마감하면 오늘의 Log·점수는 더 이상 고칠 수 없고, memo만 덧붙일 수 있어요."
        : "마감하면 오늘의 기록이 봉인돼요 — 이후에는 memo만 추가할 수 있어요. 남은 할 일은 Missed로 확정돼요.") + extra,
      "마감하기");
    if (!okd) return;
    // confirmAsk는 .on만 벗기고 요소는 남기므로 resolve 직후 읽을 수 있다. 마감 전에 저장해야 트리거에 안 막힌다.
    const ft = ($("#cf-feel")?.value || "").trim();
    let wrote = false;
    try {
      if (ft) { await Api.feelingsText(ft); wrote = true; }
      await Api.closeDay(kind);
      wrote = true;
    } finally {
      if (wrote) invalidateCalendarCache();
    }
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

  // 캘린더 내비 — 화살표도 스와이프와 같은 슬라이드(calGo). 달 넘김/재중심화/재조립을 calGo가 일괄 처리
  $("#cal-prev").onclick = () => calGo(-1);
  $("#cal-next").onclick = () => calGo(1);
  $("#btn-add-period").onclick = () => openPeriod(null);
  $("#btn-run-anal").onclick = runAnalysis;
  $("#feel-classify").onclick = () => run(async () => {
    const r = await Api.classifyFeelings();
    toast(`분류 완료 — ${Object.entries(r.values).map(([k, v]) => k + " " + v).join(" · ")}`);
    refreshToday();
  });

  applyTheme();
  bindSwipe();
  bindCalendarDrag();
  bindPressFeedback();
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
  bindModeSheet();
  bindGoalsSheet();
  bindEducationSheet();
  bindSettingSheet();
  bindLogSheet();
  bindEventSheet();
  bindDeferSheet();

  $("#boot-retry").onclick = loadData;
  $("#boot-token").onclick = () => { bootUI("done"); switchTab("me"); toggleSet(true); openSetting("api_token"); };
  bindForegroundRefresh();

  await loadData();

  // 데이터가 뜬 뒤에 — 네이티브 예약은 화면을 기다리게 할 이유가 없다.
  syncGuardNative();
}

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", boot);
if (typeof module !== "undefined" && module.exports)
  module.exports = { weeksOf, bandPaths, addDaysStr, diffDaysStr, md, dlabel };
