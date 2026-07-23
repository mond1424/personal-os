// ============================================================
// db 계층 — queries.sql 1:1 (섹션 문자 B~K 주석 동일)
// SQL은 이 파일에만 산다. 도메인 규칙·트랜잭션 순서는 services/.
// batch 조립용으로 D1PreparedStatement를 돌려주는 함수는 st* 접두.
// ============================================================
import type { Env } from "../types";

const q = (env: Env, sql: string) => env.DB.prepare(sql);

// ── 공통 행 타입 ─────────────────────────────────────────────
export interface TaskStats {
  id: string; title: string; period_id: string | null;
  status: "not_finished" | "finished"; finished_on: string | null;
  // ★ 상태 판정은 state만 쓴다 (status는 원시 컬럼). 'cancelled' = status='not_finished' + cancelled_at≠NULL (0008).
  state: "not_finished" | "finished" | "cancelled";
  cancelled_at: string | null; cancelled_on: string | null;
  wait_anchor_at: string; created_at: string;
  entry_count: number; defer_count: number; latest_date: string | null;
  current_rate: number; is_waiting: 0 | 1;
}
export interface Entry {
  id: number; task_id: string; date: string; rate: number;
  deferred_to: string | null; deferred_at: string | null; created_at: string;
  defer_reason?: string | null;   // 미루기 사유 (0007) — 도착지 항목에 남김
  day_status?: string;   // 'open' | 'closed' — 그 날이 마감됐는지 (완료율 편집 가능 여부)
}
export interface DailyRow {
  date: string; status: "open" | "closed"; score: number | null;
  feelings_text: string | null; close_kind: string | null;
  closed_at: string | null; created_at: string;
}
export interface PeriodRow {
  id: string; title: string; start_date: string; end_date: string;
  color: string; goals: string; created_at: string;
}

// ── B. Today 조인 ────────────────────────────────────────────
export const todayTodo = (env: Env, d: string) => q(env, `
  SELECT t.id, t.title, t.period_id, p.color, e.rate, s.defer_count
  FROM schedule_entries e
  JOIN tasks t        ON t.id = e.task_id
  LEFT JOIN periods p ON p.id = t.period_id
  JOIN v_task_stats s ON s.id = t.id
  WHERE e.date = ? AND t.status = 'not_finished' AND e.deferred_to IS NULL
  ORDER BY t.created_at`).bind(d).all<{
    id: string; title: string; period_id: string | null; color: string | null;
    rate: number; defer_count: number;
  }>();

export const todayDone = (env: Env, d: string) => q(env, `
  SELECT t.id, t.title, e.rate
  FROM schedule_entries e JOIN tasks t ON t.id = e.task_id
  WHERE e.date = ? AND t.status = 'finished' AND t.finished_on = ?
  ORDER BY t.finished_at`).bind(d, d).all<{ id: string; title: string; rate: number }>();

// 재배정 대기 (v0.8): 최근 예정일 < 오늘 & 미완료 (예정 이력 있는 것만)
export const reassignQueue = (env: Env, d: string) => q(env, `
  SELECT s.id, s.title, s.defer_count, s.latest_date
  FROM v_task_stats s
  WHERE s.status = 'not_finished' AND s.entry_count > 0 AND s.latest_date < ?
  ORDER BY s.latest_date`).bind(d).all<{
    id: string; title: string; defer_count: number; latest_date: string;
  }>();

// 대기 — 목록(오래된 순)·상시 행·21일 초과가 같은 식을 공유 (n일째 = 경과 + 1)
// 대기 목록 — 일수(age)는 귀속일 기준이라 서비스 계층에서 계산한다 (lib/time.attributionOfIso).
// 앵커 오름차순 = 오래 머문 순.
export const waitingList = (env: Env) => q(env, `
  SELECT id, title, wait_anchor_at
  FROM v_task_stats WHERE is_waiting = 1
  ORDER BY wait_anchor_at`).all<{ id: string; title: string; wait_anchor_at: string }>();

// ── C. 하루 열기 ─────────────────────────────────────────────
export const stOpenDaily = (env: Env, d: string, now: string) =>
  q(env, "INSERT INTO daily (date, created_at) VALUES (?, ?) ON CONFLICT (date) DO NOTHING")
    .bind(d, now);

export const getDaily = (env: Env, d: string) =>
  q(env, "SELECT * FROM daily WHERE date = ?").bind(d).first<DailyRow>();

// ── D. 캘린더 월 그리드 ──────────────────────────────────────
export const calPeriods = (env: Env, start: string, end: string) => q(env, `
  SELECT id, title, color, start_date, end_date, created_at
  FROM periods WHERE start_date <= ? AND end_date >= ?
  ORDER BY created_at`).bind(end, start).all<PeriodRow>();

export const calEntries = (env: Env, start: string, end: string) => q(env, `
  SELECT e.date, t.id, t.title, t.status, e.deferred_to, p.color,
         (t.cancelled_at IS NOT NULL) AS is_cancelled  -- 표시 배지 전용. 상태 판정은 v_task_stats.state
  FROM schedule_entries e
  JOIN tasks t        ON t.id = e.task_id
  LEFT JOIN periods p ON p.id = t.period_id
  WHERE e.date BETWEEN ? AND ?
  ORDER BY e.date, t.created_at`).bind(start, end).all<{
    date: string; id: string; title: string; status: string;
    deferred_to: string | null; color: string | null; is_cancelled: number;
  }>();

// 캘린더 '기록 있는 날' 마커(.dr): 빈 daily(자동 생성)를 오인하지 않게 실제 내용이 있는 날만.
// (3단계: memo는 셀 본문에 직접 나오므로 마커에서 제외 — 마커는 '마감·점수·감정·로그'만 의미.)
export const calDiaryDates = (env: Env, start: string, end: string) =>
  q(env, `SELECT d.date, d.status FROM daily d
          WHERE d.date BETWEEN ? AND ?
            AND (d.status = 'closed'
                 OR d.score IS NOT NULL
                 OR d.feelings_text IS NOT NULL
                 OR EXISTS (SELECT 1 FROM logs l WHERE l.date = d.date))
          ORDER BY d.date`)
    .bind(start, end).all<{ date: string; status: string }>();

// 캘린더 셀 memo 줄: 날짜별 대표 1건(가장 이른 ts) + 총 개수만. 전문은 날짜 팝업에서.
export const calMemos = (env: Env, start: string, end: string) =>
  q(env, `
    SELECT m.date,
           COUNT(*) AS n,
           (SELECT m2.text FROM memos m2
             WHERE m2.date = m.date ORDER BY m2.ts LIMIT 1) AS text
    FROM memos m
    WHERE m.date BETWEEN ? AND ?
    GROUP BY m.date
    ORDER BY m.date`)
    .bind(start, end).all<{ date: string; n: number; text: string }>();

// ── E. 날짜 팝업 조각 ────────────────────────────────────────
export const periodsAt = (env: Env, k: string) =>
  q(env, "SELECT id, title, color, start_date, end_date FROM periods WHERE ? BETWEEN start_date AND end_date ORDER BY created_at")
    .bind(k).all<{ id: string; title: string; color: string; start_date: string; end_date: string }>();

export const feelingsAt = (env: Env, k: string) =>
  q(env, "SELECT field, value, source FROM feelings WHERE date = ?")
    .bind(k).all<{ field: string; value: number; source: string }>();

export const logsAt = (env: Env, k: string) =>
  q(env, "SELECT id, ts, text FROM logs WHERE date = ? ORDER BY ts")
    .bind(k).all<{ id: number; ts: string; text: string }>();

export const memosAt = (env: Env, k: string) =>
  q(env, "SELECT id, ts, text, created_at FROM memos WHERE date = ? ORDER BY ts")
    .bind(k).all<{ id: string; ts: string; text: string; created_at: string }>();

// ── F. 파생 3섹션 재구성 — 그날 항목의 분류 ──────────────────
// 오늘(미마감)의 미완료·미이동은 'todo'. 마감 순간 todo → missed (1.2).
export const classifyAt = (env: Env, k: string) => q(env, `
  SELECT t.id, t.title, t.period_id,
         CASE
           WHEN t.status = 'finished' AND t.finished_on = ?1 THEN 'done'
           WHEN e.deferred_to IS NOT NULL                    THEN 'deferred'
           WHEN (SELECT status FROM daily WHERE date = ?1) = 'closed'
                                                             THEN 'missed'
           ELSE 'todo'
         END AS class,
         e.rate, e.deferred_to,
         (t.cancelled_at IS NOT NULL) AS is_cancelled  -- 표시 배지 전용. 분류(class)는 건드리지 않음
  FROM schedule_entries e JOIN tasks t ON t.id = e.task_id
  WHERE e.date = ?1
  ORDER BY t.created_at`).bind(k).all<{
    id: string; title: string; period_id: string | null;
    class: "done" | "deferred" | "missed" | "todo";
    rate: number; deferred_to: string | null; is_cancelled: number;
  }>();

// ── G. 하루 마감 조각 (순서는 services/daily.ts가 강제) ──────
export const stUpsertMech = (env: Env, kind: string, key: string, mech: string, now: string) => q(env, `
  INSERT INTO summaries (kind, key, mech, generated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT (kind, key) DO UPDATE SET mech = excluded.mech, stale = 0, generated_at = excluded.generated_at`)
  .bind(kind, key, mech, now);

export const stCloseDaily = (env: Env, d: string, kind: string, now: string) =>
  q(env, "UPDATE daily SET status = 'closed', close_kind = ?, closed_at = ? WHERE date = ? AND status = 'open'")
    .bind(kind, now, d);

// ── H. 자동 마감 대상 ────────────────────────────────────────
export const openDatesBefore = (env: Env, d: string) =>
  q(env, "SELECT date FROM daily WHERE status = 'open' AND date < ? ORDER BY date")
    .bind(d).all<{ date: string }>();

// 행조차 없는데 예정이 있던 날 → closed 행 직접 생성 (Missed 확정의 전제)
export const orphanEntryDates = (env: Env, d: string) => q(env, `
  SELECT DISTINCT e.date FROM schedule_entries e
  LEFT JOIN daily dd ON dd.date = e.date
  WHERE e.date < ? AND dd.date IS NULL
  ORDER BY e.date`).bind(d).all<{ date: string }>();

export const stInsertClosedDaily = (env: Env, date: string, now: string) =>
  q(env, "INSERT INTO daily (date, status, close_kind, closed_at, created_at) VALUES (?, 'closed', 'auto', ?, ?)")
    .bind(date, now, now);

// ── I. 쓰기 조각 ─────────────────────────────────────────────
export const stInsertLog = (env: Env, d: string, ts: string, text: string, now: string) =>
  q(env, "INSERT INTO logs (date, ts, text, created_at) VALUES (?, ?, ?, ?)").bind(d, ts, text, now);

export const getLog = (env: Env, id: number) =>
  q(env, "SELECT id, date, ts, text FROM logs WHERE id = ?").bind(id)
    .first<{ id: number; date: string; ts: string; text: string }>();

export const stUpdateLog = (env: Env, id: number, ts: string, text: string) =>
  q(env, "UPDATE logs SET ts = ?, text = ? WHERE id = ?").bind(ts, text, id);

export const stUpsertFeeling = (env: Env, d: string, field: string, value: number, source: string) => q(env, `
  INSERT INTO feelings (date, field, value, source) VALUES (?, ?, ?, ?)
  ON CONFLICT (date, field) DO UPDATE SET value = excluded.value, source = excluded.source`)
  .bind(d, field, value, source);

export const stSetScore = (env: Env, d: string, score: number) =>
  q(env, "UPDATE daily SET score = ? WHERE date = ?").bind(score, d);

export const stSetFeelingsText = (env: Env, d: string, text: string) =>
  q(env, "UPDATE daily SET feelings_text = ? WHERE date = ?").bind(text, d);

export const stInsertTask = (env: Env, id: string, title: string, periodId: string | null, now: string) =>
  q(env, "INSERT INTO tasks (id, title, period_id, wait_anchor_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, title, periodId, now, now);

export const stInsertEntry = (env: Env, taskId: string, date: string, now: string) =>
  q(env, "INSERT INTO schedule_entries (task_id, date, created_at) VALUES (?, ?, ?)")
    .bind(taskId, date, now);

// 미루기 (1.4): 원 항목 기록 + 새 항목 — services가 한 batch로 묶는다
export const stMarkDeferred = (env: Env, taskId: string, from: string, to: string, now: string) =>
  q(env, "UPDATE schedule_entries SET deferred_to = ?, deferred_at = ? WHERE task_id = ? AND date = ? AND deferred_to IS NULL")
    .bind(to, now, taskId, from);

// 대기 연장 (v0.8): UPDATE 하나 — 이력은 trg_wait_ext_log가 자동 기록
export const stExtendWait = (env: Env, taskId: string, now: string) =>
  q(env, "UPDATE tasks SET wait_anchor_at = ? WHERE id = ?").bind(now, taskId);

/** 살아 있는(미뤄지지 않은) 마지막 항목 — 완료율을 붙일 자리. */
export const liveEntry = (env: Env, taskId: string) =>
  q(env, `SELECT e.date, e.rate, COALESCE(d.status,'open') AS day_status
          FROM schedule_entries e LEFT JOIN daily d ON d.date = e.date
          WHERE e.task_id = ? AND e.deferred_to IS NULL
          ORDER BY e.date DESC LIMIT 1`).bind(taskId)
    .first<{ date: string; rate: number; day_status: string }>();

export const stRate100At = (env: Env, taskId: string, date: string) =>
  q(env, "UPDATE schedule_entries SET rate = 100 WHERE task_id = ? AND date = ? AND deferred_to IS NULL")
    .bind(taskId, date);

export const stFinishTask = (env: Env, taskId: string, now: string, d: string) =>
  q(env, "UPDATE tasks SET status = 'finished', finished_at = ?, finished_on = ? WHERE id = ? AND status = 'not_finished'")
    .bind(now, d, taskId);

// 취소 (0008) — status는 그대로 두고 cancelled_at/on만 세운다. state 뷰가 'cancelled'로 계산.
export const stCancelTask = (env: Env, id: string, now: string, d: string) =>
  q(env, `UPDATE tasks SET cancelled_at = ?, cancelled_on = ?
           WHERE id = ? AND cancelled_at IS NULL AND status = 'not_finished'`)
    .bind(now, d, id);

export const stUncancelTask = (env: Env, id: string) =>
  q(env, `UPDATE tasks SET cancelled_at = NULL, cancelled_on = NULL
           WHERE id = ? AND cancelled_at IS NOT NULL`).bind(id);

export const stSetRate = (env: Env, taskId: string, date: string, rate: number) =>
  q(env, "UPDATE schedule_entries SET rate = ? WHERE task_id = ? AND date = ? AND deferred_to IS NULL")
    .bind(rate, taskId, date);

// 미루기 사유 (0007): 도착지 항목에 남긴다. 같은 batch에서 stInsertEntry 직후 호출.
// UNIQUE(task_id, date)라 도착지 한 행만 맞는다. 도착지는 열린 날이므로 frozen 트리거에 안 걸린다.
export const stSetDeferReason = (env: Env, taskId: string, date: string, reason: string) =>
  q(env, "UPDATE schedule_entries SET defer_reason = ? WHERE task_id = ? AND date = ?")
    .bind(reason, taskId, date);

export const stUpdateTaskMeta = (env: Env, taskId: string, title: string, periodId: string | null) =>
  q(env, "UPDATE tasks SET title = ?, period_id = ? WHERE id = ?").bind(title, periodId, taskId);

export const stInsertMemo = (env: Env, id: string, date: string, ts: string, text: string, now: string) =>
  q(env, "INSERT INTO memos (id, date, ts, text, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, date, ts, text, now);

export const stStaleSummary = (env: Env, kind: string, key: string) =>
  q(env, "UPDATE summaries SET stale = 1 WHERE kind = ? AND key = ?").bind(kind, key);

// ── J. Works 세그먼트 ────────────────────────────────────────
export const worksScheduled = (env: Env, d: string) => q(env, `
  SELECT e.date, t.id, t.title, s.defer_count, p.color, e.rate
  FROM schedule_entries e
  JOIN tasks t        ON t.id = e.task_id
  JOIN v_task_stats s ON s.id = t.id
  LEFT JOIN periods p ON p.id = t.period_id
  WHERE t.status = 'not_finished' AND e.deferred_to IS NULL AND e.date >= ?
  ORDER BY e.date, t.created_at`).bind(d).all<{
    date: string; id: string; title: string; defer_count: number;
    color: string | null; rate: number;
  }>();

export const worksDeferring = (env: Env) => q(env, `
  SELECT s.id, s.title, s.defer_count, s.latest_date,
         (SELECT MIN(date) FROM schedule_entries e WHERE e.task_id = s.id) AS first_date
  FROM v_task_stats s
  WHERE s.state = 'not_finished' AND s.defer_count > 0
  ORDER BY s.defer_count DESC`).all<{
    id: string; title: string; defer_count: number;
    latest_date: string; first_date: string;
  }>();

export const worksByPeriod = (env: Env) => q(env, `
  SELECT p.id AS period_id, p.title AS period_title, p.color,
         s.id, s.title, s.state, s.latest_date, s.is_waiting
  FROM periods p JOIN v_task_stats s ON s.period_id = p.id
  WHERE s.state <> 'cancelled'
  ORDER BY p.created_at, s.latest_date IS NULL, s.latest_date`).all<{
    period_id: string; period_title: string; color: string;
    id: string; title: string; state: string;
    latest_date: string | null; is_waiting: 0 | 1;
  }>();

// 완료 목록 — 완료를 누른 날(finished_on)과 그 일의 예정일(live entry)은 다를 수 있다.
// 둘 다 보여 줘야 "완료인데 왜 그 날짜?"가 사라진다.
export const worksDone = (env: Env) => q(env, `
  SELECT t.id, t.title, t.finished_on AS on_date, 'finished' AS kind,
         (SELECT e.date FROM schedule_entries e
           WHERE e.task_id = t.id AND e.deferred_to IS NULL
           ORDER BY e.date DESC LIMIT 1) AS planned_on
  FROM tasks t WHERE t.status = 'finished'
  UNION ALL
  SELECT t.id, t.title, t.cancelled_on AS on_date, 'cancelled' AS kind, NULL
  FROM tasks t WHERE t.cancelled_at IS NOT NULL
  ORDER BY on_date DESC`).all<{
    id: string; title: string; on_date: string;
    kind: "finished" | "cancelled"; planned_on: string | null;
  }>();

// ── 일정(event) — 캘린더 전용 엔티티 (0004) ─────────────────
export interface EventRow {
  id: string; title: string; date: string; time: string | null;
  period_id: string | null; note: string | null; created_at: string;
}
export const eventGet = (env: Env, id: string) =>
  q(env, "SELECT * FROM events WHERE id = ?").bind(id).first<EventRow>();

export const eventsAt = (env: Env, date: string) =>
  q(env, `SELECT e.*, p.color FROM events e LEFT JOIN periods p ON p.id = e.period_id
          WHERE e.date = ? ORDER BY COALESCE(e.time,'99:99'), e.created_at`)
    .bind(date).all<EventRow & { color: string | null }>();

export const eventsRange = (env: Env, start: string, end: string) =>
  q(env, `SELECT e.*, p.color FROM events e LEFT JOIN periods p ON p.id = e.period_id
          WHERE e.date BETWEEN ? AND ? ORDER BY e.date, COALESCE(e.time,'99:99')`)
    .bind(start, end).all<EventRow & { color: string | null }>();

export const stInsertEvent = (
  env: Env, id: string, title: string, date: string,
  time: string | null, periodId: string | null, note: string | null, now: string,
) => q(env, "INSERT INTO events (id,title,date,time,period_id,note,created_at) VALUES (?,?,?,?,?,?,?)")
  .bind(id, title, date, time, periodId, note, now);

export const stUpdateEvent = (
  env: Env, id: string, title: string, date: string,
  time: string | null, periodId: string | null, note: string | null,
) => q(env, "UPDATE events SET title=?, date=?, time=?, period_id=?, note=? WHERE id=?")
  .bind(title, date, time, periodId, note, id);

export const stDeleteEvent = (env: Env, id: string) =>
  q(env, "DELETE FROM events WHERE id = ?").bind(id);

// 기간 카드 — 달성률(2.1)은 뷰가 계산
export const periodCards = (env: Env) => q(env, `
  SELECT p.*, a.achievement FROM periods p
  JOIN v_period_achievement a ON a.id = p.id
  ORDER BY p.created_at`).all<PeriodRow & { achievement: number | null }>();

// ── K. 캘린더 목록(일기 몰아 읽기) ───────────────────────────
export const diaryList = (env: Env, before: string, limit: number) => q(env, `
  SELECT d.date, d.score, d.close_kind,
         (SELECT group_concat(field || ':' || value) FROM feelings f WHERE f.date = d.date) AS feelings,
         (SELECT text FROM logs l WHERE l.date = d.date ORDER BY ts DESC LIMIT 1) AS last_log
  FROM daily d WHERE d.date < ?
  ORDER BY d.date DESC LIMIT ?`).bind(before, limit).all<{
    date: string; score: number | null; close_kind: string | null;
    feelings: string | null; last_log: string | null;
  }>();

// ── 엔티티 단건·기타 ─────────────────────────────────────────
export const taskStats = (env: Env, id: string) =>
  q(env, "SELECT * FROM v_task_stats WHERE id = ?").bind(id).first<TaskStats>();

// 항목마다 '그 날이 마감됐는지'를 함께 준다 — 화면이 완료율을 열지 말지 판단하는 근거.
// 없으면 프론트가 날짜만 보고 추측하게 되고, 추측은 트리거 거부(409)로 드러난다.
export const taskEntries = (env: Env, id: string) =>
  q(env, `SELECT e.*, COALESCE(d.status,'open') AS day_status
          FROM schedule_entries e LEFT JOIN daily d ON d.date = e.date
          WHERE e.task_id = ? ORDER BY e.date`).bind(id).all<Entry>();

export const taskEntryAt = (env: Env, id: string, date: string) =>
  q(env, "SELECT * FROM schedule_entries WHERE task_id = ? AND date = ?").bind(id, date).first<Entry>();

export const waitExtensions = (env: Env, id: string) =>
  q(env, "SELECT prev_anchor_at, extended_at FROM wait_extensions WHERE task_id = ? ORDER BY extended_at")
    .bind(id).all<{ prev_anchor_at: string; extended_at: string }>();

export const getPeriod = (env: Env, id: string) =>
  q(env, "SELECT * FROM periods WHERE id = ?").bind(id).first<PeriodRow>();

export const stInsertPeriod = (env: Env, p: PeriodRow) =>
  q(env, "INSERT INTO periods (id, title, start_date, end_date, color, goals, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(p.id, p.title, p.start_date, p.end_date, p.color, p.goals, p.created_at);

export const stUpdatePeriod = (env: Env, p: PeriodRow) =>
  q(env, "UPDATE periods SET title = ?, start_date = ?, end_date = ?, color = ?, goals = ? WHERE id = ?")
    .bind(p.title, p.start_date, p.end_date, p.color, p.goals, p.id);

// 삭제를 막는 것들. 개수가 아니라 '무엇이'를 돌려준다 —
// "다른 기록이 참조하고 있어요"로는 사용자가 손쓸 수 없기 때문이다.
export const closedEntryDates = (env: Env, taskId: string) =>
  q(env, `SELECT e.date FROM schedule_entries e
          JOIN daily d ON d.date = e.date
          WHERE e.task_id = ? AND d.status = 'closed'
          ORDER BY e.date`).bind(taskId).all<{ date: string }>();

export const guardEventCount = (env: Env, taskId: string) =>
  q(env, "SELECT COUNT(*) AS n FROM guard_events WHERE task_id = ?").bind(taskId).first<{ n: number }>();

// 연장 이력은 마감 기록이 없을 때만 지워진다 — 허용 여부는 트리거가 최종 판정 (0005)
export const stDeleteExtensions = (env: Env, taskId: string) =>
  q(env, "DELETE FROM wait_extensions WHERE task_id = ?").bind(taskId);

export const stDeleteEntries = (env: Env, taskId: string) =>
  q(env, "DELETE FROM schedule_entries WHERE task_id = ?").bind(taskId);

// 취소 (0008): 열린 날(=마감되지 않은 날)의 예정만 비운다. 마감된 날은 트리거가 막는 영역이라
// 조건에서 애초에 제외한다 — ABORT로 batch 전체가 죽는 걸 피한다.
// ★ 미래 날짜는 daily 행 자체가 없다. d.status='open'으로 쓰면 미래 예정이 안 지워진다.
//   반드시 NOT EXISTS(closed)로 쓸 것.
export const stDeleteOpenEntries = (env: Env, taskId: string) =>
  q(env, `DELETE FROM schedule_entries
           WHERE task_id = ?
             AND NOT EXISTS (SELECT 1 FROM daily d
                              WHERE d.date = schedule_entries.date AND d.status = 'closed')`)
    .bind(taskId);
export const stDeleteTask = (env: Env, id: string) =>
  q(env, "DELETE FROM tasks WHERE id = ?").bind(id);

export const stDeletePeriod = (env: Env, id: string) =>
  q(env, "DELETE FROM periods WHERE id = ?").bind(id);

// Me (3장) — 현재값 + 변경 이력 (me_history)
export const meAll = (env: Env) =>
  q(env, "SELECT field, value, updated_at FROM me ORDER BY field")
    .all<{ field: string; value: string; updated_at: string }>();

export const meGet = (env: Env, field: string) =>
  q(env, "SELECT value FROM me WHERE field = ?").bind(field).first<{ value: string }>();

export const stMeHistory = (env: Env, field: string, oldV: string | null, newV: string, source: string, now: string) =>
  q(env, "INSERT INTO me_history (field, old_value, new_value, source, changed_at) VALUES (?, ?, ?, ?, ?)")
    .bind(field, oldV, newV, source, now);

export const stMeUpsert = (env: Env, field: string, value: string, now: string) => q(env, `
  INSERT INTO me (field, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT (field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
  .bind(field, value, now);

export const meHistory = (env: Env, limit: number) =>
  q(env, "SELECT field, old_value, new_value, source, changed_at FROM me_history ORDER BY changed_at DESC, id DESC LIMIT ?")
    .bind(limit).all<{ field: string; old_value: string | null; new_value: string; source: string; changed_at: string }>();

// settings
export const settingsAll = (env: Env) =>
  q(env, "SELECT key, value FROM settings ORDER BY key").all<{ key: string; value: string }>();

export const stSettingPut = (env: Env, key: string, value: string) => q(env, `
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(key, value);

// analyses (5장)
export const analysesList = (env: Env) =>
  q(env, "SELECT id, prompt, created_at, substr(pass1, 1, 80) AS preview FROM analyses ORDER BY created_at DESC")
    .all<{ id: string; prompt: string; created_at: string; preview: string }>();

export const analysisGet = (env: Env, id: string) =>
  q(env, "SELECT * FROM analyses WHERE id = ?").bind(id)
    .first<{ id: string; prompt: string; pass1: string; pass2: string; context_meta: string | null; created_at: string }>();

export const weeklySummaryGet = (env: Env, key: string) =>
  q(env, "SELECT key, stale FROM summaries WHERE kind = 'weekly' AND key = ?").bind(key)
    .first<{ key: string; stale: number }>();

export const weeklySummaryFull = (env: Env, key: string) =>
  q(env, "SELECT key, ai_text, stale FROM summaries WHERE kind = 'weekly' AND key = ?").bind(key)
    .first<{ key: string; ai_text: string | null; stale: number }>();

export const mechDaily = (env: Env, key: string) =>
  q(env, "SELECT mech FROM summaries WHERE kind = 'daily' AND key = ?").bind(key)
    .first<{ mech: string | null }>();

// 컨텍스트 조립(5.2)용 범위 조회 — 하루씩 도는 대신 한 번에
export const dailyRange = (env: Env, start: string, end: string) =>
  q(env, "SELECT date, score, status, close_kind, feelings_text FROM daily WHERE date BETWEEN ? AND ? ORDER BY date")
    .bind(start, end).all<{ date: string; score: number | null; status: string; close_kind: string | null; feelings_text: string | null }>();

export const logsRange = (env: Env, start: string, end: string) =>
  q(env, "SELECT date, ts, text FROM logs WHERE date BETWEEN ? AND ? ORDER BY date, ts")
    .bind(start, end).all<{ date: string; ts: string; text: string }>();

export const feelingsRange = (env: Env, start: string, end: string) =>
  q(env, "SELECT date, field, value FROM feelings WHERE date BETWEEN ? AND ? ORDER BY date, field")
    .bind(start, end).all<{ date: string; field: string; value: number }>();

export const memosRange = (env: Env, start: string, end: string) =>
  q(env, "SELECT date, ts, text FROM memos WHERE date BETWEEN ? AND ? ORDER BY date, ts")
    .bind(start, end).all<{ date: string; ts: string; text: string }>();

export const analysesRecentFull = (env: Env, n: number) =>
  q(env, "SELECT id, prompt, pass1, pass2, created_at FROM analyses ORDER BY created_at DESC LIMIT ?")
    .bind(n).all<{ id: string; prompt: string; pass1: string; pass2: string; created_at: string }>();

export const stInsertAnalysis = (
  env: Env, id: string, prompt: string, pass1: string, pass2: string, meta: string, now: string,
) =>
  q(env, "INSERT INTO analyses (id, prompt, pass1, pass2, context_meta, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, prompt, pass1, pass2, meta, now);

// guard (6.5) — 구현 1은 조회만 (설정 화면의 이벤트 수)
export const guardEventsList = (env: Env) =>
  q(env, "SELECT * FROM guard_events ORDER BY fired_at DESC").all<Record<string, unknown>>();
