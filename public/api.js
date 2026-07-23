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
  cancelTask: (id) => _req("POST", `/tasks/${id}/cancel`),
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
  putSetting: (key, value) => _req("PUT", "/settings/" + key, { value }),
  providers: () => _req("GET", "/ai/providers"),
  connections: () => _req("GET", "/ai/connections"),
  aiTest: (which) => _req("POST", "/ai/test", { which }),
  createEvent: (b) => _req("POST", "/events", b),
  updateEvent: (id, b) => _req("PATCH", "/events/" + id, b),
  deleteEvent: (id) => _req("DELETE", "/events/" + id),
  runAnalysis: (prompt) => _req("POST", "/analyses", { prompt }),
  contextRaw: () => _req("GET", "/analyses/context-raw"),
  meHistory: () => _req("GET", "/me/history"),
  settings: () => _req("GET", "/settings"),
  analyses: () => _req("GET", "/analyses"),
  analysis: (id) => _req("GET", "/analyses/" + id),
  ctxPreview: () => _req("GET", "/analyses/context-preview"),
  guardEvents: () => _req("GET", "/guard/events"),
};
