// 섹션 스키마 검증기 — me-reinforcement-plan §2.2
//
// JSON Schema 전체가 아니라 **필요한 키워드만** 구현한다:
//   type · required · enum · items · properties
// 계획서가 "Worker에서 도는 경량 구현으로 충분하다"고 명시했고, 의존성을 늘리지 않는다.
//
// 소비처가 셋이고 셋 다 같은 스키마를 읽는다:
//   쓰기 검증(여기) · 프롬프트 주입 · UI 폼 생성
//
// 설계 규칙: 초기 스키마는 **필수 필드를 최소로**. 빈칸 허용 원칙(§0-2)과 충돌하면 안 된다.

export interface SchemaNode {
  type?: "object" | "array" | "string" | "number" | "boolean";
  required?: string[];
  enum?: unknown[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
}

export interface ValidationIssue { path: string; message: string }

const typeOf = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

/**
 * @returns 문제 목록. 비어 있으면 통과.
 *   던지지 않는다 — 호출부가 400으로 번역하거나(쓰기) 항목을 폐기한다(추출 파이프라인).
 */
export function validate(schema: SchemaNode, value: unknown, path = "$"): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  if (schema.type) {
    const t = typeOf(value);
    const okType = schema.type === "number" ? t === "number" : t === schema.type;
    if (!okType) {
      out.push({ path, message: `${schema.type} 이어야 해요 (지금 ${t})` });
      return out;   // 타입이 틀리면 하위 검사는 의미가 없다
    }
  }

  if (schema.enum && !schema.enum.some((e) => e === value)) {
    out.push({ path, message: `허용된 값: ${schema.enum.join(" · ")}` });
  }

  if (schema.type === "object" && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      // 빈 문자열도 '없음'으로 본다 — 폼에서 비우고 저장하는 흔한 경로
      if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
        out.push({ path: `${path}.${key}`, message: "필수 항목이에요" });
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined && obj[key] !== null) {
        out.push(...validate(sub, obj[key], `${path}.${key}`));
      }
    }
    // 스키마에 없는 키는 막지 않는다 — 스키마 버전이 올라가는 도중에도 읽기가 깨지면 안 된다.
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((v, i) => out.push(...validate(schema.items!, v, `${path}[${i}]`)));
  }

  return out;
}

/** 저장소의 스키마 본문(JSON 문자열)을 파싱한다. 깨져 있으면 null. */
export function parseSchema(body: string): SchemaNode | null {
  try {
    const o = JSON.parse(body);
    return o && typeof o === "object" ? (o as SchemaNode) : null;
  } catch {
    return null;
  }
}

/**
 * UI 폼·프롬프트가 쓰는 필드 목록. 스키마 하나에서 파생한다(§2.2 소비처 3).
 * 폼을 손으로 만들면 스키마와 어긋나는 순간이 온다.
 */
export function fieldsOf(schema: SchemaNode): Array<{
  key: string; type: string; required: boolean; enum?: unknown[]; itemType?: string;
}> {
  const req = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, s]) => ({
    key,
    type: s.type ?? "string",
    required: req.has(key),
    ...(s.enum ? { enum: s.enum } : {}),
    ...(s.items?.type ? { itemType: s.items.type } : {}),
  }));
}
