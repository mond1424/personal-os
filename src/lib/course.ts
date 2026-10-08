// 과목명 — 수집 과제의 `categories` 원문에서 사용자가 쓰는 이름만 꺼낸다 (T-74 → T-87).
//
// ```
// categories (원문 · 0024)   "전자기및연습1 (2026-20, 45004_01_U)"
// 과목명                      "전자기및연습1"
// ```
//
// ★ 규칙은 여기 하나다. 목록·수락 시트가 서버의 표시용 과목명을 쓴다(T-87 ① · T-94).
// ⚠️ **저장은 여전히 원문이다**(0024 §해석 금지) — 이 함수는 읽을 때만 쓴다.
//
// 재촉 종료 뒤에도 순수 이름 함수는 유지한다(T-94). 저장 제목·원장 원문을 소급 변경하지 않는다.

/** 첫 `" ("` 앞까지. 괄호가 없으면 통째로. 비었으면 `null` — 빈 칸을 만들지 않는다(T-74 짝). */
export function courseOf(categories: string | null | undefined): string | null {
  if (!categories) return null;
  const i = categories.indexOf(" (");
  const name = (i > 0 ? categories.slice(0, i) : categories).trim();
  return name || null;
}
