/**
 * Enhanced Error Handler Middleware
 * Provides structured error responses and logging
 */

const logger = require('../utils/logger');

/**
 * Custom API Error class
 */
class APIError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error handler middleware
 */
const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;

  // Only show debug info if EXPLICITLY in development mode
  const isDev = process.env.NODE_ENV === 'development';

  // In production: show the message for client errors (4xx) but hide it for
  // server errors (5xx) to avoid leaking internal implementation details.
  const showMessage = isDev || statusCode < 500;

  // Log the full error server-side always
  logger.error('Error occurred:', {
    message: err.message,
    statusCode,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id,
    requestId: req.requestId,
  });

  const response = {
    success: false,
    error: showMessage ? err.message : 'Internal Server Error',
    requestId: req.requestId, // So users can reference in bug reports
    ...(isDev && {
      stack: err.stack,
      details: err.details || null,
    }),
  };

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found handler
 */
const notFound = (req, res, next) => {
  const error = new APIError(`Route not found: ${req.originalUrl}`, 404);
  next(error);
};

/**
 * Async handler wrapper to catch errors in async route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
  APIError,
  errorHandler,
  notFound,
  asyncHandler,
};
