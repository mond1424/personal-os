-- 0004: '일정(event)' — 캘린더 전용 엔티티. task와 성격이 다르다.
--   task  = 해야 할 일. 완료율·미루기·이월이 있고 Works에서 관리된다.
--   event = 그 시각에 일어나는 사건(시험·약속·수업). 완료 개념이 없고 캘린더에서만 다룬다.
-- 마감된 날의 일정은 수정·삭제할 수 없다 (1.3 불변성 — 그날 무슨 일이 있었는지는 기록이다).
CREATE TABLE events (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  date       TEXT NOT NULL,
  time       TEXT,                       -- 'HH:MM' · NULL이면 하루 종일
  period_id  TEXT REFERENCES periods(id) ON DELETE SET NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_date ON events(date);

CREATE TRIGGER trg_events_frozen_upd BEFORE UPDATE ON events
WHEN EXISTS (SELECT 1 FROM daily WHERE date = OLD.date AND status = 'closed')
BEGIN SELECT RAISE(ABORT, '마감된 날의 일정은 수정할 수 없음'); END;

CREATE TRIGGER trg_events_frozen_del BEFORE DELETE ON events
WHEN EXISTS (SELECT 1 FROM daily WHERE date = OLD.date AND status = 'closed')
BEGIN SELECT RAISE(ABORT, '마감된 날의 일정은 삭제할 수 없음'); END;
