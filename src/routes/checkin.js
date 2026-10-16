const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { invalid } = require('../errors');
const { bodyOf } = require('../validate');
const { CODE_RE } = require('../lib/codes');
const svc = require('../services/bookingService');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// POST /api/checkin  { code }  -> marks the booking present and says whose it is
router.post('/', (req, res) => {
  const { code } = bodyOf(req);
  const clean = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!CODE_RE.test(clean)) throw invalid({ code: 'must be a 6-character code' });
  res.json(svc.checkIn(clean));
});

module.exports = router;
