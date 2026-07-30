// 고정 코어 컨텍스트 — me-reinforcement-plan §6.2
//
// **빈 섹션을 생략하지 않는다.** 생략하면 모델이 빈 곳을 상상으로 메우고,
// "Education: 정보 없음"이라고 적으면 "수강 이력이 없어 판단 보류"가 나온다(§6.2·§7-1).
// 이 규칙이 이 파일의 존재 이유다 — 직렬화 자체는 아무것도 아니다.
//
// 소비처는 지금 **Guard Level 4 검증 하나**뿐이다(ADR-024). 범용 확장을 미리 하지 않는다 —
// §6.3 관리인 chat은 Phase 4이고, 그때 도구 계층과 함께 짜는 것이 계획이다.
// 지금 범용으로 만들면 소비처 없는 껍데기가 된다(STATE의 buildCoreContext 연기 근거와 같다).

import * as db from "../db";
import { diffDays } from "./time";
import type { Env, TimeCtx } from "../types";

const NONE = "정보 없음";

/** 섹션 표시 순서. §6.2가 "Overview + 활성 Goals"를 먼저 든다. 목록에 없는 섹션은 뒤에 붙는다. */
const ORDER = ["overview", "goals", "education"];

const label = (section: string) => section.charAt(0).toUpperCase() + section.slice(1);

/** 항목 한 줄 — 제목 + 본문 + data. 모델이 읽을 것이므로 JSON 원문보다 납작하게 편다. */
function itemLine(r: { title: string; body: string | null; data: string | null }): string {
  const parts: string[] = [];
  if (r.body && r.body.trim()) parts.push(r.body.trim());
  if (r.data) {
    try {
      const o = JSON.parse(r.data);
      const flat = Object.entries(o ?? {})
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("/") : v}`)
        .join(", ");
      if (flat) parts.push(flat);
    } catch { /* 깨진 data는 조용히 건너뛴다 — 컨텍스트가 판단을 막으면 안 된다 */ }
  }
  return parts.length ? `- ${r.title}: ${parts.join(" · ")}` : `- ${r.title}`;
}

/**
 * Life Model 섹션 + 활성 제약(디데이)을 프롬프트용 텍스트로 만든다.
 *
 * 섹션 목록은 **레지스트리에서 가져온다**(`lm_schema`) — 여기에 손으로 적으면
 * 새 섹션이 생겨도 컨텍스트에 안 들어오고, 그 누락은 조용하다.
 */
export async function buildCoreContext(env: Env, t: TimeCtx): Promise<string> {
  const sections = (await db.lmSchemaSections(env)).results.map((r) => r.section);
  const ordered = [
    ...ORDER.filter((s) => sections.includes(s)),
    ...sections.filter((s) => !ORDER.includes(s)).sort(),
  ];

  const blocks: string[] = [];
  for (const section of ordered) {
    const rows = (await db.lmItems(env, section)).results;
    // 빈 섹션도 반드시 한 줄 남긴다 — 이 else가 §6.2의 요구다.
    blocks.push(rows.length
      ? `${label(section)}:\n${rows.map(itemLine).join("\n")}`
      : `${label(section)}: ${NONE}`);
  }

  const dd = (await db.periodsWithDday(env, t.d)).results;
  blocks.push(dd.length
    ? `제약(디데이):\n${dd.map((p) => {
        const left = diffDays(p.end_date, t.d);
        return `- ${p.dday_label} (${p.title}) — ${p.end_date}까지 ${left}일`;
      }).join("\n")}`
    : `제약(디데이): ${NONE}`);

  return blocks.join("\n\n");
}
