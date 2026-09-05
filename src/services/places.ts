// 장소 (ADR-046 · T-59) — **어디 있었는지는 WiFi가 말한다.**
//
// 귀가·등교는 사용자가 손으로 적을 리가 없고, 그래서 지금 아무 데도 안 남는다.
// 기기가 붙은 네트워크를 보고 서버가 **전이만** 남긴다.
//
// ★ 이 파일이 지는 것 하나: **전이 판정**(ADR-046 ③). 기기는 관측을 그대로 보내고
//   *"이것이 전이인가"* 는 여기서만 갈린다. 기기에 두면 prefs가 비는 날(재설치·백업 복원)에
//   같은 곳이 다시 전이로 들어오고, 두 곳에 두면 갈라진다.
//
// ★ **판정하지 않는 것도 판정이다.** 등록되지 않은 네트워크에서는 아무것도 안 남긴다 —
//   *"자주 있는 곳이 집이겠지"* 가 틀리는 날은 하필 평소와 다른 날이고,
//   이 앱이 관심 있는 날이 정확히 그날이다(ADR-046 ②).
import * as db from "../db";
import { nextId } from "../lib/id";
import { addDays, attributionOfIso, normalizeIso } from "../lib/time";
import { ApiError, type Env, type TimeCtx } from "../types";

/**
 * 네트워크 식별자 형식 — SHA-256 앞 16자리 소문자 hex(기기 `WifiProbe.netId`와 같은 약속).
 *
 * ⚠️ **이것이 원문 유출을 막는 두 겹 중 하나다.** 다른 하나는 0022의 CHECK 이고,
 *    둘 다 형식으로 막으므로 *"실수로 원문을 보내는 구현"* 은 400/409 로 죽지 조용히 저장되지 않는다.
 */
const NET_ID = /^[0-9a-f]{16}$/;

/** 최근 목록 상한 — 화면이 읽는 창이다. 넘겨 달라고 해도 여기서 자른다. */
const RECENT_LIMIT = 60;
const RECENT_DAYS = 14;

function netIdOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!NET_ID.test(s)) throw new ApiError(400, "네트워크 식별자 형식이 아니에요");
  return s;
}

function nameOf(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) throw new ApiError(400, "장소 이름이 필요해요");
  if (s.length > 40) throw new ApiError(400, "장소 이름이 너무 길어요");
  return s;
}

/**
 * 등록된 장소와 최근 전이.
 *
 * ⚠️ *"지금 어디인가"* 는 컬럼이 아니라 **마지막 전이**다(원칙 1). 저장하면 그 값이
 *    관측과 어긋나는 순간이 생기고, 어느 쪽이 참인지 화면이 못 고른다.
 */
export async function list(env: Env, t: TimeCtx) {
  const rows = (await db.places(env)).results;
  const recent = (await db.visitsSince(env, addDays(t.d, -RECENT_DAYS), RECENT_LIMIT)).results;
  const last = recent[0] ?? null;
  return {
    places: rows,
    recent,
    today: recent.filter((v) => v.date === t.d),
    // 마지막 전이 = 지금 있는 곳. **파생이고, 그래서 매번 여기서 만든다.**
    last: last ? { place_id: last.place_id, name: last.name, at: last.at, date: last.date } : null,
  };
}

/** 이름을 붙인다 — **시스템이 추측하지 않는다**(ADR-046 ②). */
export async function register(env: Env, t: TimeCtx, input: any) {
  const net_id = netIdOf(input?.net_id);
  const name = nameOf(input?.name);
  const dup = await db.placeByNet(env, net_id);
  if (dup) throw new ApiError(409, `이 네트워크는 이미 "${dup.name}"이에요`);
  const id = await nextId(env, "places", t.compact);
  await db.stInsertPlace(env, id, name, net_id, t.now).run();
  return list(env, t);
}

/** 이름을 지운다. 그 장소의 전이도 함께 간다 — 이름이 없는 전이는 읽을 수 없는 기록이다. */
export async function remove(env: Env, t: TimeCtx, id: string) {
  const row = await db.placeById(env, id);
  if (!row) throw new ApiError(404, "없는 장소예요");
  await db.stDeletePlace(env, id).run();
  return list(env, t);
}

export interface ObserveResult {
  known: boolean;
  recorded: boolean;
  /** `recorded` · `same_place` · `unknown_network` — **셋이 서로 다른 일이다.** */
  reason: "recorded" | "same_place" | "unknown_network";
  place: { id: string; name: string } | null;
  at: string;
  date: string | null;
}

/**
 * 기기가 본 것 하나. **여기가 전이 판정이 사는 유일한 자리다.**
 *
 * ⚠️ 같은 곳이면 행을 만들지 않는다 — 상태가 아니라 전이를 남기기 때문이다(ADR-046 ③).
 *    매 관측을 남기면 하루에 수십 행이 되고, *"언제 집에 왔나"* 를 그 더미에서 다시 골라내야 한다.
 *
 * ⚠️ **모르는 네트워크에서는 아무것도 안 남긴다.** 여기서 `unknown` 장소 행을 만들면
 *    그것이 곧 추측이 되고, 카페 WiFi 가 *"어딘가"* 라는 이름으로 기록에 들어온다.
 *
 * ★ **거절이 아니라 사실을 돌려준다.** 셋을 다 200으로 돌려주는 이유는 기기가
 *   *"안 남았다"* 와 *"못 보냈다"* 를 갈라야 하기 때문이다 — 400으로 뭉개면 기기의
 *   `lastError`에 정상 동작이 실패로 적히고, 화면이 거짓말을 한다(T-54가 배운 자리).
 */
export async function observe(env: Env, t: TimeCtx, input: any): Promise<ObserveResult> {
  const net_id = netIdOf(input?.net_id);
  // 관측 시각은 기기가 준다 — 배경 권한이 없으면 앱을 열 때 몰아서 오고(ADR-046 ⑥),
  // 그때 서버 시계로 적으면 **귀가 시각이 앱을 연 시각으로** 바뀐다.
  const at = typeof input?.at === "string" && input.at
    ? normalizeIso(input.at, t.offsetMin) : t.now;
  const place = await db.placeByNet(env, net_id);
  if (!place) {
    // ★ 모르는 곳. **판정하지 않는다** — 모른다고 말하는 것이 추측보다 낫다.
    return { known: false, recorded: false, reason: "unknown_network", place: null, at, date: null };
  }
  const prev = await db.lastVisit(env);
  const short = { id: place.id, name: place.name };
  if (prev && prev.place_id === place.id) {
    return { known: true, recorded: false, reason: "same_place", place: short, at, date: prev.date };
  }
  // 귀속일은 **관측 시각에서** 정한다(1.2). 경계를 바꿔도 과거는 재해석되지 않는다.
  const date = attributionOfIso(at, t.boundary);
  await db.stInsertVisit(env, place.id, at, date, t.now).run();
  return { known: true, recorded: true, reason: "recorded", place: short, at, date };
}
