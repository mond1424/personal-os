/* api.js — fetch 계층. Worker CRUD 1:1 매핑, 렌더링·상태 없음.
 * 서빙 위치가 Worker와 같으면 상대 경로, file://로 열면 로컬 dev 서버로.
 * 배포 후 API_TOKEN을 쓰면: localStorage.setItem('api_token', '<토큰>') */
const API_BASE =
  ((typeof location !== "undefined" && location.protocol === "file:") ? "http://localhost:8787" : "") + "/api";

async function _req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const tok = (typeof localStorage !== "undefined") && localStorage.getItem("api_token");
  if (tok) headers["Authorization"] = "Bearer " + tok;
  const res = await fetch(API_BASE + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
