// E2E 픽스처 시드 — front.mjs 검사가 "이미 써 온 앱"을 전제로 하는 데이터를 채운다.
// ⚠️ 대상 DB에 실제로 행을 INSERT 한다. 반드시 격리/버릴 DB(base)에만 쓸 것.
//    실제 dev DB(.wrangler/state)에 쓰면 개발 데이터와 섞인다 — e2e.mjs가 임시 DB에만 호출한다.

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (ymd, n) => {
  const t = new Date(ymd + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return iso(t);
};

export async function seedFixtures(base) {
  const api = async (method, path, body) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`seed ${method} ${path} → ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  };

  // 서버 기준 오늘(귀속일)
  const today = (await api("GET", "/health")).date;

  // 기간 — 오늘을 포함 (S.periods[0], 기간 카드)
  await api("POST", "/periods", {
    title: "E2E 기간", start_date: addDays(today, -10), end_date: addDays(today, 40),
    color: "#4C8DFF", goals: ["E2E 검증"],
  });

  // 오늘 task + 로그 (TODO 행 · Log 렌더 · S.today.todo[0])
  await api("POST", "/tasks", { title: "E2E 오늘 task", date: today });
  await api("POST", "/logs", { text: "E2E 로그" });

  // 대기 task (날짜 없음) — 대기 상시 행 · 대기 목록
  await api("POST", "/tasks", { title: "E2E 대기 task" });

  // Me direction — Me 시트 값 채움
  await api("PUT", "/me/direction", { value: "E2E 방향값" });

  // 이월 이력 — 오늘 task 생성 후 오늘→+2일 defer (deferred_to 기록)
  const carry = await api("POST", "/tasks", { title: "E2E 이월 task", date: today });
  await api("POST", `/tasks/${carry.id}/defer`, { from: today, to: addDays(today, 2) });

  return { today };
}
