// 학사 일정 수집 (T-41 · ADR-037) — cron이 iCal 토큰 URL을 읽어 `collected_items`에 쌓는다.
//
// ★ **해석하지 않는다.** `SUMMARY`·`DESCRIPTION`은 원문 그대로 저장한다.
//   강좌 구분이 어디 실리는지도, 과제 due의 SUMMARY 형식도 아직 모른다(ADR-037 §실측).
//   **모르는 것을 지금 정하면 개강 첫날 틀린다** — 원문을 남겨 두면 나중에 다시 뽑을 수 있다.
//
// 화면에 꺼내는 것은 T-42다. 여기까지는 **아무것도 사용자에게 보이지 않는다.**
import * as db from "../db";
import { nextId } from "../lib/id";
import { normalizeIso } from "../lib/time";
import type { Env, TimeCtx } from "../types";

/** 수집 간격 — 하루 4회. **마감은 분 단위로 생기지 않는다.** cron은 30분마다 돈다. */
const COLLECT_INTERVAL_MS = 6 * 3600_000;

/** 마지막 수집 시각 · 마지막 실패. `settings`에 둔다 — 새 저장소를 만들 이유가 없다. */
const K_LAST = "uclass_last_collect_at";
const K_ERROR = "uclass_last_error";

/** 파싱 결과 한 건. **여기 없는 필드는 저장도 안 한다** — 쓰지 않는 것을 나르지 않는다. */
export interface IcalEvent {
  uid: string;
  summary: string;
  description: string | null;
  dtstart: string | null;
  dtend: string | null;
  lastModified: string | null;
}

/**
 * RFC 5545 §3.1 줄 접힘을 편다.
 *
 * **긴 `SUMMARY`는 반드시 접혀서 온다** — 75옥텟을 넘으면 `CRLF + 공백/탭`으로 잘린다.
 * 안 펴면 제목이 중간에서 끊기고, **그 결함은 짧은 제목으로 검사하면 안 드러난다**
 * (실측 fixture가 개인 일정 하나뿐이라 짧았다 — 그래서 검사에 접힌 줄을 합성해 넣었다).
 *
 * 서버가 `CRLF` 대신 `LF`만 보내는 경우가 있어 둘 다 받는다.
 */
export const unfoldIcal = (text: string): string => text.replace(/\r?\n[ \t]/g, "");

/** RFC 5545 §3.3.11 — 텍스트 값의 이스케이프를 되돌린다. */
const unescapeText = (v: string): string =>
  v.replace(/\\[nN]/g, "\n").replace(/\\([;,\\])/g, "$1");

/**
 * iCal 시각을 ISO로. **오프셋 정보를 지어내지 않는다** —
 * `Z`가 있으면 붙여 두고, 없으면 없는 채로 둔다(`normalizeIso`가 그것을 로컬로 읽는다).
 *
 * 날짜만 오는 종일 이벤트(`VALUE=DATE`)는 `T00:00:00`을 붙여 모양을 맞춘다.
 * 시각이 없다는 사실은 `00:00:00`이 아니라 **원문(`summary`)이 말한다**.
 */
export function icalDateToIso(v: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, z] = m;
  const time = hh ? `${hh}:${mi}:${ss}` : "00:00:00";
  return `${y}-${mo}-${d}T${time}${z ?? ""}`;
}

/**
 * VEVENT를 뽑는다. **순수 함수다** — 네트워크도 시계도 안 읽는다.
 * 그래서 검사에 고정 날짜를 써도 되고(T-36이 정의한 예외), 오히려 고정이어야
 * 형식을 날짜와 무관하게 검사한다.
 *
 * 라이브러리를 붙이지 않는 이유: 쓰는 필드가 여섯이다(ADR-037 §실측의 여덟 중
 * `CLASS`·`DTSTAMP`는 안 쓴다). **파서가 의존성보다 작다.**
 */
export function parseIcal(text: string): IcalEvent[] {
  const lines = unfoldIcal(text).split(/\r?\n/);
  const out: IcalEvent[] = [];
  let cur: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.UID) {
        out.push({
          uid: cur.UID,
          summary: cur.SUMMARY ?? "",
          description: cur.DESCRIPTION || null,
          dtstart: cur.DTSTART ? icalDateToIso(cur.DTSTART) : null,
          dtend: cur.DTEND ? icalDateToIso(cur.DTEND) : null,
          lastModified: cur["LAST-MODIFIED"] || null,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;                       // VCALENDAR 머리·꼬리는 버린다

    const colon = line.indexOf(":");
    if (colon < 0) continue;
    // `NAME;PARAM=VALUE:value` — 파라미터는 안 쓰지만 이름에서 떼어내야 한다.
    const name = (line.slice(0, colon).split(";")[0] ?? "").toUpperCase();
    cur[name] = unescapeText(line.slice(colon + 1));
  }
  return out;
}

const note = (env: Env, key: string, value: string) =>
  db.stSettingPut(env, key, value).run().then(() => {}, () => {});

/**
 * 한 바퀴 수집한다.
 *
 * **던질 수 있다.** 부르는 쪽(`scheduled.autoClose`)이 `.catch`로 삼킨다 —
 * `finalizeIgnored`와 같은 모양이고 같은 이유다: **수집 실패가 자동 마감을 멈추면 안 된다.**
 * 다만 **조용히 사라지지는 않는다** — 실패 사유를 `settings`에 남긴다.
 * *"아무 일도 안 일어난다"*가 이 리포가 반복해서 물린 실패 모양이다(T-31).
 *
 * ⚠️ **토큰이 없으면 조용히 건너뛴다.** 그래야 이 코드를 지금 배포해도 아무것도 안 바뀌고,
 * 사용자가 시크릿을 넣는 순간부터 돈다.
 */
export async function collect(
  env: Env, t: TimeCtx, force = false,
): Promise<{ skipped: string | null; collected: number; added: number; changed: number }> {
  const url = env.UCLASS_ICAL_URL?.trim();
  if (!url) return { skipped: "no_token", collected: 0, added: 0, changed: 0 };

  const settings = Object.fromEntries(
    (await db.settingsAll(env)).results.map((r) => [r.key, r.value]),
  );
  const lastMs = Date.parse(settings[K_LAST] ?? "");
  const nowMs = Date.parse(t.now);
  if (!force && Number.isFinite(lastMs) && nowMs - lastMs < COLLECT_INTERVAL_MS) {
    return { skipped: "too_soon", collected: 0, added: 0, changed: 0 };
  }

  let text: string;
  try {
    const res = await fetch(url, { headers: { Accept: "text/calendar" } });
    // 2xx가 아니면 본문은 달력이 아니다. 코드까지 남긴다 — 401(토큰 만료)과 503의 대응이 다르다.
    if (!res.ok) throw new Error(`http_${res.status}`);
    text = await res.text();
  } catch (e: any) {
    // ⚠️ **URL을 사유에 싣지 않는다.** 그 값 자체가 열쇠다(ADR-037 §근거 ④).
    await note(env, K_ERROR, `${t.now} ${String(e?.message ?? e).slice(0, 120)}`);
    throw e;
  }

  const events = parseIcal(text);
  let added = 0, changed = 0;
  for (const ev of events) {
    const startsAt = ev.dtstart ? normalizeIso(ev.dtstart, t.offsetMin) : null;
    const endsAt = ev.dtend ? normalizeIso(ev.dtend, t.offsetMin) : null;
    const row = {
      uid: ev.uid, summary: ev.summary, description: ev.description,
      starts_at: startsAt, ends_at: endsAt, last_modified: ev.lastModified, at: t.now,
    };
    const existing = await db.collectedByUid(env, ev.uid);
    if (!existing) {
      const id = await nextId(env, "collected_items", t.compact);
      await db.stInsertCollected(env, { id, source: "uclass", ...row }).run();
      added++;
    } else {
      // 다시 본 것 — 원문을 갱신하고 `last_seen_at`을 민다. **`state`는 안 건드린다.**
      if (existing.last_modified !== ev.lastModified) changed++;
      await db.stTouchCollected(env, row).run();
    }
  }

  // ★ **목록에서 빠진 것은 여기서 아무 일도 일어나지 않는다.** 지우지 않는다 —
  //   창이 `-5일 ~ +365일`이라 지난 마감은 저절로 빠지고, 그걸 삭제로 읽으면
  //   **어제 한 과제가 오늘 사라진다.** `last_seen_at`이 안 밀린 것으로만 안다.

  await note(env, K_LAST, t.now);
  await note(env, K_ERROR, "");
  return { skipped: null, collected: events.length, added, changed };
}
