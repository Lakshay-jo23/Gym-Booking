const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { isUnique } = db;
const { invalid, conflict, unauthorized } = require('../errors');
const { EMAIL_RE, bodyOf } = require('../validate');

// Note: Express 4 catches errors thrown synchronously in a handler and passes them to the
// global error handler, so these handlers don't need their own try/catch. (If a handler is
// ever made async, it must call next(err) itself.)
const router = express.Router();

const sign = (user) =>
  jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h' });

// Compared against when the email is unknown, so "no such user" takes as long as "wrong password"
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/register', (req, res) => {
  const { name, email, password } = bodyOf(req);
  const errors = {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) errors.name = 'Required, up to 100 characters';
  if (typeof email !== 'string' || email.trim().length > 254 || !EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email';
  // bcrypt only uses the first 72 bytes, so refuse longer passwords instead of silently truncating
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
    errors.password = 'Must be 8 to 72 characters';
  }
  if (Object.keys(errors).length) throw invalid(errors);

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  try {
    // The role is never read from the request: registration always creates a member
    const info = db
      .prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'member')")
      .run(cleanName, cleanEmail, bcrypt.hashSync(password, 10));
    const user = { id: Number(info.lastInsertRowid), name: cleanName, email: cleanEmail, role: 'member' };
    res.status(201).json({ token: sign(user), user });
  } catch (e) {
    if (isUnique(e)) throw conflict('That email is already registered', 'EMAIL_TAKEN');
    throw e;
  }
});

router.post('/login', (req, res) => {
  const { email, password } = bodyOf(req);
  const errors = {};
  if (typeof email !== 'string' || !email.trim()) errors.email = 'Required';
  if (typeof password !== 'string' || !password) errors.password = 'Required';
  if (Object.keys(errors).length) throw invalid(errors);

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  const ok = bcrypt.compareSync(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw unauthorized('Wrong email or password');

  const user = { id: row.id, name: row.name, email: row.email, role: row.role };
  res.json({ token: sign(user), user });
});

module.exports = router;
