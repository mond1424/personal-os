// 과목명 — 수집 과제의 `categories` 원문에서 사용자가 쓰는 이름만 꺼낸다 (T-74 → T-87).
//
// ```
// categories (원문 · 0024)   "전자기및연습1 (2026-20, 45004_01_U)"
// 과목명                      "전자기및연습1"
// ```
//
// ★★ **규칙은 여기 하나다** (T-87 ①). T-74 때는 화면(`app.js courseOf`)이 잘랐다 —
//   *"쪼개기는 해석이고 해석은 표시하는 쪽이 한다"*. 그런데 **표시하는 쪽이 둘이 됐다**:
//   들어온 것 시트와 **과제 재촉 알림**(ADR-050 ④ — *과목 · 과제 이름 · …*).
//   ⚠️ 알림은 기기가 띄우고 **발동 경로엔 네트워크가 없다**(ADR-021) — 기기에 규칙을 두면
//   Kotlin 에 두 번째 벌이 생기고, 그것은 `verify` 가 못 본다(함정 13).
//   그래서 서버가 자르고 둘 다 그 값을 쓴다 — `titleOf`(T-86)와 같은 판단이다.
// ⚠️ **저장은 여전히 원문이다**(0024 §해석 금지) — 이 함수는 읽을 때만 쓴다.
//
// 왜 `services/collected.ts`가 아니라 여기인가: 재촉(`services/nudge.ts`)과 수집(`collected.ts`)이
// 둘 다 부르는데, `collected → tasks → nudge` 로 이미 이어져 있어 저쪽에 두면 고리가 된다.

/** 첫 `" ("` 앞까지. 괄호가 없으면 통째로. 비었으면 `null` — 빈 칸을 만들지 않는다(T-74 짝). */
export function courseOf(categories: string | null | undefined): string | null {
  if (!categories) return null;
  const i = categories.indexOf(" (");
  const name = (i > 0 ? categories.slice(0, i) : categories).trim();
  return name || null;
}
