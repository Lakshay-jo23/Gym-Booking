const jwt = require('jsonwebtoken');
const db = require('../db');
const { unauthorized, forbidden } = require('../errors');

// Requires a valid token; loads the user from the DB so role changes apply immediately
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(unauthorized());
  try {
    const { sub } = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(sub);
    if (!user) return next(unauthorized('Account no longer exists'));
    req.user = { ...user };
    next();
  } catch {
    next(unauthorized('Invalid or expired token'));
  }
}

const requireRole = (role, msg) => (req, res, next) =>
  req.user.role === role ? next() : next(forbidden(msg));

const requireAdmin = requireRole('admin', 'Admins only');
const requireMember = requireRole('member', 'Members only'); // admins run the gym; they don't book

module.exports = { requireAuth, requireAdmin, requireMember };
