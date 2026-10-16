const express = require('express');
const db = require('../db');
const { isUnique } = db;
const { requireAuth, requireAdmin, requireMember } = require('../middleware/auth');
const { invalid, conflict, notFound } = require('../errors');
const { bodyOf, parseId, isRealDate } = require('../validate');
const svc = require('../services/bookingService');

const router = express.Router();
router.use(requireAuth); // every route below needs a logged-in user

// GET /api/sessions?date=YYYY-MM-DD  (any logged-in user)
router.get('/', (req, res) => {
  const { date } = req.query;
  let where = '';
  const params = [req.user.id, req.user.id];
  if (date !== undefined) {
    if (!isRealDate(date)) throw invalid({ date: 'must be a real date, YYYY-MM-DD' });
    where = 'WHERE substr(s.start_at, 1, 10) = ?';
    params.push(date);
  }
  const rows = db.prepare(`
    SELECT s.id, s.start_at, s.capacity,
      (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'confirmed') AS booked,
      (SELECT b.id FROM bookings b WHERE b.session_id = s.id AND b.user_id = ? AND b.status = 'confirmed') AS my_booking_id,
      (SELECT COUNT(*) FROM waitlist w WHERE w.session_id = s.id
         AND w.id <= (SELECT w2.id FROM waitlist w2 WHERE w2.session_id = s.id AND w2.user_id = ?)) AS my_waitlist_position
    FROM sessions s ${where}
    ORDER BY s.start_at`).all(...params);

  const now = Date.now();
  res.json(rows.map((r) => ({
    id: r.id,
    start_at: r.start_at,
    capacity: r.capacity,
    booked: r.booked,
    seats_remaining: r.capacity - r.booked,
    has_started: Date.parse(r.start_at) <= now,
    i_am_booked: r.my_booking_id !== null,
    my_booking_id: r.my_booking_id,
    my_waitlist_position: r.my_waitlist_position || null,
  })));
});

// POST /api/sessions  (admin)  { date: 'YYYY-MM-DD', hour: 0-23 }  capacity is always 20
router.post('/', requireAdmin, (req, res) => {
  const { date, hour, capacity } = bodyOf(req);
  const errors = {};
  if (!isRealDate(date)) errors.date = 'must be a real date, YYYY-MM-DD';
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) errors.hour = 'must be a whole number from 0 to 23';
  if (capacity !== undefined && capacity !== 20) errors.capacity = 'must be 20';
  if (Object.keys(errors).length) throw invalid(errors);

  // Sessions start on the hour, so the start is built from date + hour only (UTC)
  const start = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00.000Z`);
  if (start.getTime() <= Date.now()) throw invalid({ date: 'session must start in the future' });

  try {
    const info = db.prepare('INSERT INTO sessions (start_at, capacity) VALUES (?, 20)').run(start.toISOString());
    res.status(201).json({ id: Number(info.lastInsertRowid), start_at: start.toISOString(), capacity: 20 });
  } catch (e) {
    if (isUnique(e)) throw conflict('A session already starts at that time', 'SESSION_EXISTS');
    throw e;
  }
});

// GET /api/sessions/:id/bookings  (admin: all bookings for the session)
router.get('/:id/bookings', requireAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id)) throw notFound('Session not found');
  const rows = db.prepare(`
    SELECT b.id, b.status, b.checked_in_at, b.created_at, u.name, u.email
    FROM bookings b JOIN users u ON u.id = b.user_id
    WHERE b.session_id = ? ORDER BY b.id`).all(id);
  res.json(rows.map((r) => ({ ...r })));
});

// Member actions on a session
router.post('/:id/book', requireMember, (req, res) => {
  res.status(201).json(svc.bookSeat(req.user.id, parseId(req.params.id)));
});
router.post('/:id/waitlist', requireMember, (req, res) => {
  res.status(201).json(svc.joinWaitlist(req.user.id, parseId(req.params.id)));
});
router.delete('/:id/waitlist', requireMember, (req, res) => {
  res.json(svc.leaveWaitlist(req.user.id, parseId(req.params.id)));
});

module.exports = router;
