# Gym Slot Booking

Members book and cancel one-hour gym sessions online. Admins create sessions and check people in at the door.
Node.js + Express API, SQLite database, plain HTML/JS frontend.

**Live demo:** not deployed (run it locally, steps below)

## Quick start

Requires **Node 22.13 or newer** (the database is Node's built-in SQLite, so there is nothing to compile).

```bash
cp .env.example .env     # then set JWT_SECRET to any long random string
npm install
npm run seed             # creates test data (safe to run again)
npm start                # http://localhost:3000
```

| Variable     | Purpose                              | Default    |
|--------------|--------------------------------------|------------|
| `JWT_SECRET` | Signs login tokens. **Required.**    | none       |
| `PORT`       | HTTP port                            | `3000`     |
| `DB_FILE`    | SQLite database file                 | `./gym.db` |

To start over with a clean database, stop the server, delete `gym.db`, `gym.db-wal` and `gym.db-shm`, then run `npm run seed`.

## Test logins

| Role   | Email            | Password      |
|--------|------------------|---------------|
| Admin  | `admin@gym.test` | `admin12345`  |
| Member | `maya@gym.test`  | `member12345` |
| Member | `sam@gym.test`   | `member12345` |

### What the seed data gives you

- Sessions over the next few days (09:00, 10:00 and 18:00 tomorrow, plus later days).
- **Tomorrow 18:00 is full** (20 bookings from `filler1@gym.test` … `filler20@gym.test`, password `filler12345`). Log in as Maya or Sam to try the waitlist. Cancel as a filler user to see the first waiter get promoted.
- **A session running right now**, with Maya booked into it. Her check-in code is on her *My bookings* page; enter it on the admin page to try check-in. Run `npm run seed` again later to get a fresh "running now" session.

## Design note

1. **Stack:** Node 22 + Express 4 API, built-in SQLite (`node:sqlite`, no native build), plain HTML/JS frontend served by the same app.
2. **Auth:** passwords hashed with bcrypt, login returns a JWT (8 h); the user's role is read from the database on every request, never from the token or the request body.
3. **Tables:** `users` (role member/admin), `sessions` (`start_at` UNIQUE, capacity 20), `bookings` (user, session, status, check-in code UNIQUE, `checked_in_at`), `waitlist` (user, session, UNIQUE pair).
4. **One active booking:** a partial unique index covers only `status = 'confirmed'` rows, so a member who cancelled can rebook.
5. **Last seat:** each booking runs in one `BEGIN IMMEDIATE` transaction (check, count, insert), so two simultaneous requests are processed one after the other.
6. **Backstop:** a database trigger also rejects any confirmed booking beyond capacity, so the limit holds even if application code were wrong.
7. **Waitlist:** cancelling and promoting happen in the same transaction: cancel, then book the earliest waiter (lowest id) and delete their waitlist row; never for a session that has started.
8. **Check-in codes:** 6 characters from a cryptographically secure RNG (about a billion values), UNIQUE column, so one code reveals nothing about another; single use, valid only from the session's start to one hour later.
9. **Structure:** all booking rules are in `src/services/bookingService.js`; routes validate input and call it; one error class produces one JSON error format.
10. **Frontend:** ES modules with a hash router, optimistic booking that rolls back if the server refuses, and 10-second polling for seat counts.

## Assumptions

Where the brief was ambiguous, I decided as follows:

- **Time zone:** all session times are UTC, both when created and when displayed. The UI labels times "UTC".
- **Capacity** is always 20. The API rejects any other value.
- **Admins can't book, cancel or join waitlists.** The brief says members book and admins run the gym, so those routes return 403 for admins. Admins browse sessions, create sessions, view a session's bookings and check people in.
- **Sessions can't be created in the past** (400).
- **Someone else's booking:** cancelling it returns 403 (not 404).
- **Admins see names and emails per session, not check-in codes.** Codes are shown only to the member who owns the booking.
- **Waitlist order** is join order. Booking a seat directly removes your own waitlist entry for that session.
- **Joining the waitlist** is only allowed when the session is full (otherwise 409: book instead), has not started, and you have no active booking.
- **Started sessions:** booking, cancelling and joining the waitlist are refused (409), and nobody is promoted into one.
- **Check-in window:** a code works from the session's start time up to, but not including, one hour later.
- **Passwords** must be 8 to 72 bytes (bcrypt ignores anything past 72, so longer ones are refused rather than silently cut). Emails are trimmed and lowercased.
- **Validation errors** use 400. Conflicts (full, already booked, code already used, and so on) use 409 with a specific `code`.
- **Admin accounts** are created directly in the database (the seed script); registration always creates a member.

## API

All routes except register and login need `Authorization: Bearer <token>`.
Errors always look like `{ "error": { "code": "...", "message": "...", "details": { "field": "..." } } }` (`details` only for validation errors).

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/auth/register` | public | Create a member `{name, email, password}`; returns a token |
| `POST /api/auth/login` | public | `{email, password}`; returns a token |
| `GET /api/sessions?date=YYYY-MM-DD` | any user | Sessions with seats remaining, your booking and waitlist place |
| `POST /api/sessions` | admin | Create a session `{date, hour}` (UTC, on the hour) |
| `GET /api/sessions/:id/bookings` | admin | All bookings for a session |
| `POST /api/sessions/:id/book` | member | Book a seat |
| `POST /api/sessions/:id/waitlist` | member | Join the waitlist |
| `DELETE /api/sessions/:id/waitlist` | member | Leave the waitlist |
| `GET /api/bookings/mine` | member | Your own bookings, with check-in codes |
| `DELETE /api/bookings/:id` | member (owner) | Cancel; promotes the first waiter |
| `POST /api/checkin` | admin | `{code}`; marks that member present |

Status codes: `400` invalid input, `401` not logged in, `403` wrong role or not your data, `404` not found, `409` conflict (full, already booked, code used, outside the session hour, and so on), `413` body too large, `500` unexpected (generic message, details only in the server log).

## Project structure

```
src/
  server.js              app setup, routes, global error handler
  db.js                  schema, transaction helper, capacity trigger
  errors.js              AppError and helpers (one JSON error format)
  validate.js            input helpers (ids, dates, body checks)
  seed.js                test data
  lib/codes.js           check-in code generator
  middleware/auth.js     requireAuth, requireAdmin, requireMember
  routes/                auth, sessions, bookings, checkin
  services/bookingService.js   all booking, waitlist and check-in rules
public/
  index.html, css/style.css
  js/                    main (router), api, ui helpers
  js/views/              auth, sessions, bookings, admin
```

## Security notes

- No secrets in the repository: `.env` is git-ignored and `.env.example` lists the variables.
- Every non-public route sits behind auth middleware; admin routes check the role; members only reach their own bookings (the queries filter by the logged-in user, and cancel checks ownership).
- Passwords are bcrypt hashes. Login takes about the same time whether or not the email exists.
- The frontend builds the page with DOM calls and text nodes, never by inserting HTML strings, so user-supplied names cannot inject markup.
- The login token is kept in `localStorage` for simplicity. An `httpOnly` cookie would be safer against script injection; that is the first thing I would change for production.

## Known limitations

- SQLite with a single server process: fine for one gym, not for several app instances behind a load balancer (that would need Postgres).
- No rate limiting on login.
- No automated test suite in the repository yet.
- Polling (10 s) rather than WebSockets for live seat counts.
