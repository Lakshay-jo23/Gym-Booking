// All booking rules live here. Every function that changes data runs inside ONE
// transaction (immediate), so the checks and the writes can't be split by another request.
const db = require('../db');
const { isUnique, immediate } = db;
const { makeCode } = require('../lib/codes');
const { notFound, forbidden, conflict } = require('../errors');

const HOUR_MS = 60 * 60 * 1000;
const hasStarted = (session) => Date.parse(session.start_at) <= Date.now();

function getSession(id) {
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!s) throw notFound('Session not found');
  return s;
}
const confirmedCount = (sessionId) =>
  db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND status = 'confirmed'").get(sessionId).n;
const hasActiveBooking = (userId, sessionId) =>
  !!db.prepare("SELECT 1 FROM bookings WHERE user_id = ? AND session_id = ? AND status = 'confirmed'").get(userId, sessionId);

// Insert a confirmed booking with a fresh code. The DB trigger and unique index are the backstops.
function insertBooking(userId, sessionId) {
  for (let tries = 0; tries < 5; tries++) {
    try {
      const info = db
        .prepare('INSERT INTO bookings (user_id, session_id, checkin_code) VALUES (?, ?, ?)')
        .run(userId, sessionId, makeCode());
      return { id: Number(info.lastInsertRowid), session_id: sessionId, status: 'confirmed' };
    } catch (e) {
      if (isUnique(e, 'checkin_code')) continue; // code collision: pick another
      if (isUnique(e)) throw conflict('You already have a booking for this session', 'ALREADY_BOOKED');
      if (String(e.message).includes('SESSION_FULL')) throw conflict('Session is full', 'SESSION_FULL');
      throw e;
    }
  }
  throw new Error('Could not generate a unique check-in code');
}

const bookSeat = immediate((userId, sessionId) => {
  const session = getSession(sessionId);
  if (hasStarted(session)) throw conflict('Session has already started', 'SESSION_STARTED');
  if (hasActiveBooking(userId, sessionId)) throw conflict('You already have a booking for this session', 'ALREADY_BOOKED');
  if (confirmedCount(sessionId) >= session.capacity) throw conflict('Session is full', 'SESSION_FULL');

  const booking = insertBooking(userId, sessionId);
  // They now hold a seat, so any waitlist place of theirs for this session is released
  db.prepare('DELETE FROM waitlist WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
  return booking;
});

// Fill free seats from the front of the waitlist. Never touches a session that has started.
function promoteFromWaitlist(sessionId) {
  const session = getSession(sessionId);
  if (hasStarted(session)) return;
  while (confirmedCount(sessionId) < session.capacity) {
    const next = db.prepare('SELECT id, user_id FROM waitlist WHERE session_id = ? ORDER BY id LIMIT 1').get(sessionId);
    if (!next) break;
    db.prepare('DELETE FROM waitlist WHERE id = ?').run(next.id);          // release their place
    if (!hasActiveBooking(next.user_id, sessionId)) insertBooking(next.user_id, sessionId);
  }
}

const cancelBooking = immediate((userId, bookingId) => {
  const b = db.prepare(`
    SELECT b.id, b.user_id, b.session_id, b.status, s.start_at
    FROM bookings b JOIN sessions s ON s.id = b.session_id WHERE b.id = ?`).get(bookingId);
  if (!b) throw notFound('Booking not found');
  if (b.user_id !== userId) throw forbidden('This is not your booking');
  if (b.status === 'cancelled') throw conflict('Booking is already cancelled', 'ALREADY_CANCELLED');
  if (hasStarted(b)) throw conflict('Session has already started', 'SESSION_STARTED');

  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bookingId);
  promoteFromWaitlist(b.session_id);          // same transaction: cancel + promote succeed or fail together
  return { id: bookingId, status: 'cancelled' };
});

const joinWaitlist = immediate((userId, sessionId) => {
  const session = getSession(sessionId);
  if (hasStarted(session)) throw conflict('Session has already started', 'SESSION_STARTED');
  if (hasActiveBooking(userId, sessionId)) throw conflict('You already have a booking for this session', 'ALREADY_BOOKED');
  if (confirmedCount(sessionId) < session.capacity) {
    throw conflict('Session has free seats, book it instead', 'SEATS_AVAILABLE');
  }
  try {
    db.prepare('INSERT INTO waitlist (user_id, session_id) VALUES (?, ?)').run(userId, sessionId);
  } catch (e) {
    if (isUnique(e)) throw conflict('You are already on the waitlist for this session', 'ALREADY_WAITLISTED');
    throw e;
  }
  const { position } = db.prepare(`
    SELECT COUNT(*) AS position FROM waitlist
    WHERE session_id = ? AND id <= (SELECT id FROM waitlist WHERE user_id = ? AND session_id = ?)`)
    .get(sessionId, userId, sessionId);
  return { session_id: sessionId, position };
});

const leaveWaitlist = immediate((userId, sessionId) => {
  getSession(sessionId);
  const r = db.prepare('DELETE FROM waitlist WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
  if (r.changes === 0) throw notFound('You are not on the waitlist for this session');
  return { session_id: sessionId, left: true };
});

// Admin enters a code. Works once, only in the session's hour, never for a cancelled booking.
const checkIn = immediate((code) => {
  const b = db.prepare(`
    SELECT b.id, b.status, b.checked_in_at, u.name, u.email, s.id AS session_id, s.start_at
    FROM bookings b JOIN users u ON u.id = b.user_id JOIN sessions s ON s.id = b.session_id
    WHERE b.checkin_code = ?`).get(code);
  if (!b) throw notFound('No booking has that code');
  if (b.status !== 'confirmed') throw conflict('That booking was cancelled', 'BOOKING_CANCELLED');
  if (b.checked_in_at) throw conflict('That code has already been used', 'CODE_USED');

  const start = Date.parse(b.start_at);
  const now = Date.now();
  if (now < start || now >= start + HOUR_MS) {
    throw conflict("That code only works during its session's hour", 'OUTSIDE_SESSION_HOUR');
  }

  // The WHERE makes "once only" hold even in the unlikely event two check-ins interleave
  const r = db.prepare(
    "UPDATE bookings SET checked_in_at = ? WHERE id = ? AND checked_in_at IS NULL AND status = 'confirmed'"
  ).run(new Date(now).toISOString(), b.id);
  if (r.changes !== 1) throw conflict('That code has already been used', 'CODE_USED');

  return { booking_id: b.id, member: { name: b.name, email: b.email }, session_id: b.session_id, start_at: b.start_at };
});

module.exports = { bookSeat, cancelBooking, joinWaitlist, leaveWaitlist, checkIn };
