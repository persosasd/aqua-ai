/**
 * Application-wide constants.
 * Extracts magic strings and numbers from across the codebase for DRY and clarity.
 */

const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REQUEST_TIMEOUT: 408,
  INTERNAL_SERVER_ERROR: 500,
});

const RISK_LEVELS = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

const ALERT_STATUS = Object.freeze({
  ACTIVE: 'active',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
});

const PAGINATION_DEFAULTS = Object.freeze({
  LIMIT: 100,
  OFFSET: 0,
  SMALL_LIMIT: 50,
  SEARCH_LIMIT: 20,
  LOCATION_READINGS_LIMIT: 20,
});

const RATE_LIMIT = Object.freeze({
  GENERAL_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  GENERAL_MAX: 100,
  AUTH_MAX: 5,
});

const REQUEST_TIMEOUT_MS = 60_000; // 60s for Render cold starts

const BODY_SIZE_LIMIT = '1mb';

module.exports = {
  HTTP_STATUS,
  RISK_LEVELS,
  ALERT_STATUS,
  PAGINATION_DEFAULTS,
  RATE_LIMIT,
  REQUEST_TIMEOUT_MS,
  BODY_SIZE_LIMIT,
};
