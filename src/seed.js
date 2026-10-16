// Test data: 1 admin, 2 members, sessions over a few days, one FULL session, and one session
// running right now (so check-in can be tried). Safe to run again; re-run it to get a fresh
// "running now" session. Admins are created here / directly in the DB, never via registration.
const bcrypt = require('bcryptjs');
const db = require('./db');
const { makeCode } = require('./lib/codes');

const addUser = db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)');
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
const hash = (p) => bcrypt.hashSync(p, 10);

addUser.run('Admin', 'admin@gym.test', hash('admin12345'), 'admin');
addUser.run('Maya Member', 'maya@gym.test', hash('member12345'), 'member');
addUser.run('Sam Member', 'sam@gym.test', hash('member12345'), 'member');

const at = (dayOffset, hour) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dayOffset);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const addSession = db.prepare('INSERT OR IGNORE INTO sessions (start_at, capacity) VALUES (?, 20)');
const sessionId = (iso) => db.prepare('SELECT id FROM sessions WHERE start_at = ?').get(iso).id;
const book = db.prepare('INSERT INTO bookings (user_id, session_id, checkin_code) VALUES (?, ?, ?)');

[[1, 9], [1, 10], [1, 18], [2, 9], [2, 17], [3, 8]].forEach(([d, h]) => addSession.run(at(d, h)));

// Full session: tomorrow 18:00 has 20 bookings (Maya and Sam can join its waitlist)
const full = sessionId(at(1, 18));
for (let i = 1; i <= 20; i++) {
  addUser.run(`Filler ${i}`, `filler${i}@gym.test`, hash('filler12345'), 'member');
  try { book.run(userId(`filler${i}@gym.test`), full, makeCode()); } catch { /* already seeded */ }
}

// Session running right now, with Maya booked: her code works for check-in until the hour ends
const nowSession = new Date();
nowSession.setUTCMinutes(0, 0, 0);
addSession.run(nowSession.toISOString());
try {
  book.run(userId('maya@gym.test'), sessionId(nowSession.toISOString()), makeCode());
} catch { /* already booked */ }

console.log('Seeded.');
console.log('  admin  admin@gym.test / admin12345');
console.log('  member maya@gym.test  / member12345  (booked into the session running now)');
console.log('  member sam@gym.test   / member12345');
