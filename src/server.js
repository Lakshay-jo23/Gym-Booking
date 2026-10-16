require('dotenv').config();
const path = require('path');
const express = require('express');
const { AppError, notFound } = require('./errors');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Public: register + login only. Everything else applies requireAuth inside its router.
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/checkin', require('./routes/checkin'));

// Unknown API route -> JSON 404
app.use('/api', (req, res, next) => next(notFound('Route not found')));

// Frontend (static)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Global error handler: one JSON shape, never a stack trace
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const send = (status, code, message, details) =>
    res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });

  if (err instanceof AppError) return send(err.status, err.code, err.message, err.details);
  if (err.type === 'entity.parse.failed') return send(400, 'BAD_JSON', 'Request body is not valid JSON');
  if (err.type === 'entity.too.large') return send(413, 'TOO_LARGE', 'Request body is too large');

  console.error(err); // full detail stays in the server log only
  send(500, 'INTERNAL', 'Something went wrong');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
