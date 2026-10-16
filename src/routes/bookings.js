const express = require('express');
const db = require('../db');
const { requireAuth, requireMember } = require('../middleware/auth');
const { parseId } = require('../validate');
const svc = require('../services/bookingService');

const router = express.Router();
router.use(requireAuth, requireMember);

// GET /api/bookings/mine  - only the caller's own bookings (the WHERE is the ownership check)
router.get('/mine', (req, res) => {
  const rows = db.prepare(`
    SELECT b.id, b.status, b.checkin_code, b.checked_in_at, s.id AS session_id, s.start_at
    FROM bookings b JOIN sessions s ON s.id = b.session_id
    WHERE b.user_id = ? ORDER BY s.start_at DESC`).all(req.user.id);
  res.json(rows.map((r) => ({
    ...r,
    // a cancelled booking's code is dead, so don't show it
    checkin_code: r.status === 'confirmed' ? r.checkin_code : null,
  })));
});

// DELETE /api/bookings/:id  - cancel (owner only, before the session starts)
router.delete('/:id', (req, res) => {
  res.json(svc.cancelBooking(req.user.id, parseId(req.params.id)));
});

module.exports = router;
