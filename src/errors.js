// One error type, one JSON shape: { error: { code, message, details? } }
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// details = { fieldName: 'what is wrong' } so the frontend can show inline errors
const invalid = (details, message = 'Invalid input') => new AppError(400, 'VALIDATION_ERROR', message, details);
const unauthorized = (msg = 'Login required') => new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'Not allowed') => new AppError(403, 'FORBIDDEN', msg);
const notFound = (msg = 'Not found') => new AppError(404, 'NOT_FOUND', msg);
const conflict = (msg, code = 'CONFLICT') => new AppError(409, code, msg);

module.exports = { AppError, invalid, unauthorized, forbidden, notFound, conflict };
