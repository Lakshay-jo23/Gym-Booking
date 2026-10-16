const { invalid } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The body must be a JSON object (not missing, not an array, not a string)
function bodyOf(req) {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw invalid({ body: 'must be a JSON object' });
  return b;
}

// URL ids: digits only, >= 1
function parseId(value, field = 'id') {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value) || Number(value) < 1) {
    throw invalid({ [field]: 'must be a positive integer' });
  }
  return Number(value);
}

// 'YYYY-MM-DD' that is a real calendar date (JS would silently roll 2026-02-31 into March)
function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

module.exports = { EMAIL_RE, bodyOf, parseId, isRealDate };
