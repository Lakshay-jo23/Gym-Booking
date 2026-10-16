require('dotenv').config();
// Built-in SQLite (Node 22.13+): no native addon to compile.
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_FILE || './gym.db');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id       INTEGER PRIMARY KEY,
  start_at TEXT NOT NULL UNIQUE,          -- ISO UTC, on the hour; UNIQUE = no two share a start
  capacity INTEGER NOT NULL DEFAULT 20
);

CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  session_id    INTEGER NOT NULL REFERENCES sessions(id),
  status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  checkin_code  TEXT NOT NULL UNIQUE,
  checked_in_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- one ACTIVE booking per member per session; cancelled rows don't count
CREATE UNIQUE INDEX IF NOT EXISTS one_active_booking
  ON bookings(user_id, session_id) WHERE status = 'confirmed';

-- Last line of defence for capacity: even if app code had a bug, the database refuses
-- a confirmed booking that would exceed the session's capacity.
CREATE TRIGGER IF NOT EXISTS capacity_guard
BEFORE INSERT ON bookings
WHEN NEW.status = 'confirmed'
BEGIN
  SELECT RAISE(ABORT, 'SESSION_FULL')
  WHERE (SELECT COUNT(*) FROM bookings WHERE session_id = NEW.session_id AND status = 'confirmed')
        >= (SELECT capacity FROM sessions WHERE id = NEW.session_id);
END;

CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY,         -- ids only go up, so id order = join order
  user_id    INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, session_id)            -- cannot be on the list twice
);
`);

// True if e is a UNIQUE-constraint failure (optionally mentioning a column, e.g. 'checkin_code')
function isUnique(e, column) {
  const msg = String(e && e.message);
  return /UNIQUE constraint failed/.test(msg) && (!column || msg.includes(column));
}

// Runs fn inside BEGIN IMMEDIATE ... COMMIT (ROLLBACK if fn throws).
// IMMEDIATE takes the write lock up front, so concurrent writers run one after another.
function immediate(fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

module.exports = db;
module.exports.isUnique = isUnique;
module.exports.immediate = immediate;
