/* api.js — fetch 계층. Worker CRUD 1:1 매핑, 렌더링·상태 없음.
 * 서빙 위치가 Worker와 같으면 상대 경로, file://로 열면 로컬 dev 서버로.
 * 배포 후 API_TOKEN을 쓰면: localStorage.setItem('api_token', '<토큰>') */
const API_BASE =
  ((typeof location !== "undefined" && location.protocol === "file:") ? "http://localhost:8787" : "") + "/api";

/* ── 응답을 기다리는 상한 (T-57) ───────────────────────────
 *
 * **앱의 기다림에도 상한이 있어야 한다.** 없으면 워커가 응답을 한 번 놓쳤을 때 `fetch`가
 * 영원히 매달리고, 화면은 *"눌렀는데 아무 일도 안 일어남"* 으로 멈춘다 —
 * T-54·T-55가 두 티켓에 걸쳐 없앤 **조용한 실패**가 상한 하나가 없어 돌아오는 자리다.
 * 2026-09-04 실측: 소켓 셋이 살아 있는 채로 280초 넘게 응답이 안 왔다(요청은 갔다).
 * 응답이 늦는 순간은 네트워크가 나쁜 새벽이고, 그때가 Guard가 일해야 하는 시각이다.
 *
 * ⚠️ **자리는 `_req` 하나다.** 아래 `Api`의 호출부마다 걸면 **빠뜨린 곳이 조용히 남는다** —
 *    T-52가 방벽을 SQL에 둔 것과 같은 판단이다.
 */
const REQ_TIMEOUT_MS = 15_000;
/** ⚠️ **모델을 부르는 길은 오래 걸리는 것이 정상이다** — 서버가 2-pass로 두 번 부른다
 *  (`services/analysis.ts`). 짧은 상한을 씌우면 **상한이 정상 동작을 끊는다.**
 *  자리는 여전히 `_req` 하나이고 값만 갈린다. */
const REQ_TIMEOUT_SLOW_MS = 180_000;
/** 그 긴 쪽을 쓰는 길 — 서버에서 `callModel`에 닿는 셋이다. **`_req`이 고른다.** */
const SLOW_REQ = ["POST /analyses", "POST /ai/test", "POST /daily/classify-feelings"];
/** ★ **상한에 걸린 것과 실패한 것은 사용자가 할 일이 다르다.** `HTTP 500`은 신고할 것이고
 *  *"아무 답도 없음"*은 다시 눌러 볼 것이다 — 뭉개면 그 구별이 사라진다(T-43·T-53과 같은 판단). */
const REQ_TIMEOUT_TEXT = "응답이 안 와요 — 잠시 뒤 다시 해 주세요";
const _timeoutError = () => Object.assign(new Error(REQ_TIMEOUT_TEXT), { timeout: true });

/** 요청 한 번. **상한 값은 `_req`이 정해서 넘긴다** — 여기서 다시 고르지 않는다. */
async function _send(method, path, body, ms) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const tok = (typeof localStorage !== "undefined") && localStorage.getItem("api_token");
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const init = {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  // 죽은 요청은 **끊어 준다** — 안 끊으면 브라우저의 연결 자리를 계속 물고 있다.
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) init.signal = AbortSignal.timeout(ms);
  let res;
  try {
    res = await fetch(API_BASE + path, init);
  } catch (e) {
    // abort로 끊긴 것도 **같은 문구**로 나가야 한다 — 두 겹이 두 문구가 되면 위 구별이 무너진다.
    throw (e && (e.name === "TimeoutError" || e.name === "AbortError")) ? _timeoutError() : e;
  }
  let json = null;
  try { json = await res.json(); } catch { /* 본문 없음 */ }
  if (!res.ok) {
    const msg = res.status === 401
      ? "인증이 필요해요 — Me › 설정 › API 토큰에 토큰을 넣어 주세요"
      : (json && json.error) || "HTTP " + res.status;
    const e = new Error(msg);
    e.status = res.status;
    if (json && json.suggest) e.suggest = json.suggest;   // 후속 액션 힌트(예: "cancel")
    throw e;
  }
  return json;
}

/**
 * ★ **상한이 서는 유일한 자리.**
 *
 * 두 겹인 데는 이유가 있다: `AbortSignal`은 **죽은 요청을 끊고**, 시계는 **앱을 빼낸다.**
 * fetch가 abort를 안 지키거나 프라미스를 영영 정산하지 않아도 앱은 상한 안에 빠져나온다 —
 * **상한은 원인이 무엇이든 서야 한다.**
 */
async function _req(method, path, body) {
  const ms = SLOW_REQ.includes(method + " " + path.split("?")[0])
    ? REQ_TIMEOUT_SLOW_MS : REQ_TIMEOUT_MS;
  let timer = null;
  const cap = new Promise((_, reject) => { timer = setTimeout(() => reject(_timeoutError()), ms); });
  try {
    return await Promise.race([_send(method, path, body, ms), cap]);
  } finally {
    clearTimeout(timer);
  }
}

const Api = {
  // Today · Daily
  today: () => _req("GET", "/today"),
  day: (k) => _req("GET", "/days/" + k),
  calendar: (s, e) => _req("GET", `/calendar?start=${s}&end=${e}`),
  diary: (limit = 30) => _req("GET", "/diary?limit=" + limit),
  addLog: (text) => _req("POST", "/logs", { text }),
  feelings: (values) => _req("PUT", "/daily/feelings", { values }),
  feelingsText: (text) => _req("PUT", "/daily/feelings-text", { text }),
  score: (score) => _req("PUT", "/daily/score", { score }),
  closeDay: (kind) => _req("POST", "/daily/close", { kind }),
  memo: (date, ts, text) => _req("POST", "/memos", { date, ts, text }),
  // Tasks · Works
  works: (seg) => _req("GET", "/works/" + seg),
  task: (id) => _req("GET", "/tasks/" + id),
  createTask: (b) => _req("POST", "/tasks", b),
  patchTask: (id, b) => _req("PATCH", "/tasks/" + id, b),
  defer: (id, from, to, reason) => _req("POST", `/tasks/${id}/defer`, { from, to, reason }),
  schedule: (id, date) => _req("POST", `/tasks/${id}/schedule`, { date }),
  extend: (id) => _req("POST", `/tasks/${id}/extend`),
  deleteTask: (id) => _req("DELETE", "/tasks/" + id),
  complete: (id) => _req("POST", `/tasks/${id}/complete`),
  cancelTask: (id, reason) => _req("POST", `/tasks/${id}/cancel`, { reason }),   // 기존 1인자 호출도 그대로 동작
  uncancelTask: (id) => _req("POST", `/tasks/${id}/uncancel`),
  classifyFeelings: () => _req("POST", "/daily/classify-feelings"),
  editLog: (id, b) => _req("PATCH", "/logs/" + id, b),
  setRate: (id, date, rate) => _req("PUT", `/tasks/${id}/rate`, { date, rate }),
  // Periods
  periods: () => _req("GET", "/periods"),
  period: (id) => _req("GET", "/periods/" + id),
  createPeriod: (b) => _req("POST", "/periods", b),
  updatePeriod: (id, b) => _req("PATCH", "/periods/" + id, b),
  deletePeriod: (id) => _req("DELETE", "/periods/" + id),
  // Me · 설정 · 분석
  me: () => _req("GET", "/me"),
  putMe: (field, value) => _req("PUT", "/me/" + field, { value }),
  lmSchema: (section) => _req("GET", "/lm/" + encodeURIComponent(section) + "/schema"),
  lmItems: (section) => _req("GET", "/lm/" + encodeURIComponent(section)),
  lmCreate: (section, body) => _req("POST", "/lm/" + encodeURIComponent(section), body),
  lmUpdate: (id, body) => _req("PATCH", "/lm/item/" + encodeURIComponent(id), body),
  lmDelete: (id) => _req("DELETE", "/lm/item/" + encodeURIComponent(id)),
  putSetting: (key, value) => _req("PUT", "/settings/" + key, { value }),
  providers: () => _req("GET", "/ai/providers"),
  connections: () => _req("GET", "/ai/connections"),
  aiTest: (which) => _req("POST", "/ai/test", { which }),
  // 시간표 (T-58) — parse는 **저장하지 않는다.** 확인 화면이 그 사이에 선다
  timetable: () => _req("GET", "/timetable"),
  timetableParse: (text) => _req("POST", "/timetable/parse", { text }),
  timetableSave: (rules, term_start, term_end) => _req("PUT", "/timetable", { rules, term_start, term_end }),
  // 장소 (T-59) — 이름은 **사용자가 붙인다.** 관측은 기기가 보내고 전이 판정은 서버가 한다
  places: () => _req("GET", "/places"),
  placeRegister: (net_id, name) => _req("POST", "/places", { net_id, name }),
  placeDelete: (id) => _req("DELETE", "/places/" + encodeURIComponent(id)),
  createEvent: (b) => _req("POST", "/events", b),
  updateEvent: (id, b) => _req("PATCH", "/events/" + id, b),
  deleteEvent: (id) => _req("DELETE", "/events/" + id),
  setProtect: (id, b) => _req("PUT", "/events/" + encodeURIComponent(id) + "/protect", b),
  runAnalysis: (prompt, depth) => _req("POST", "/analyses", { prompt, depth }),
  contextRaw: () => _req("GET", "/analyses/context-raw"),
  meHistory: () => _req("GET", "/me/history"),
  settings: () => _req("GET", "/settings"),
  analyses: () => _req("GET", "/analyses"),
  analysis: (id) => _req("GET", "/analyses/" + id),
  ctxPreview: () => _req("GET", "/analyses/context-preview"),
  guardEvents: (limit = 100) => _req("GET", "/guard/events?limit=" + limit),
  // outcome은 Guard가 판단하지 않는다 — 사용자가 사후 확정한다 (설계 §6.5)
  guardPending: () => _req("GET", "/guard/pending-outcome"),
  guardOutcome: (id, outcome) => _req("POST", `/guard/events/${id}/outcome`, { outcome }),
  // 밤 개입이 연속으로 지나갔나 (T-60 · ADR-047 ③) — **세는 것이지 컬럼이 아니다**
  guardL2Nag: () => _req("GET", "/guard/l2-nag"),
  guardL2NagAck: () => _req("POST", "/guard/l2-nag/ack"),
  // 수집한 학사 일정 — 제안까지가 상한이다. 자동으로 events에 넣지 않는다 (T-42 · ADR-030)
  collectedPending: () => _req("GET", "/collected/pending"),
  collectedAccept: (id) => _req("POST", `/collected/${id}/accept`),
  collectedDismiss: (id) => _req("POST", `/collected/${id}/dismiss`),
  // 수집이 돌았는가 (T-43) — pending의 빈 배열이 '안 돌았다'인지 '창이 비었다'인지 가른다
  collectedStatus: () => _req("GET", "/collected/status"),
  guardModes: () => _req("GET", "/guard/modes"),
  guardSetMode: (key, reason) => _req("PUT", "/guard/modes/active",
    reason === undefined ? { key } : { key, reason }),
};
