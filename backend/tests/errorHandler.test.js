/**
 * Tests for the error handler middleware.
 * Verifies that error messages are correctly exposed/hidden based on environment
 * and that the correct HTTP status codes are returned.
 */

const { APIError, errorHandler, notFound, asyncHandler } = require('../src/middleware/errorHandler');

// Minimal mock req/res/next for middleware testing
function makeReq(overrides = {}) {
  return {
    path: '/test',
    method: 'GET',
    ip: '127.0.0.1',
    requestId: 'test-req-id',
    user: null,
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// Silence logger output during tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('APIError', () => {
  it('creates an error with the correct message and statusCode', () => {
    const err = new APIError('Not found', 404);
    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
    expect(err.isOperational).toBe(true);
  });

  it('defaults to statusCode 500', () => {
    const err = new APIError('oops');
    expect(err.statusCode).toBe(500);
  });

  it('stores details', () => {
    const err = new APIError('bad input', 400, { field: 'email' });
    expect(err.details).toEqual({ field: 'email' });
  });
});

describe('errorHandler middleware', () => {
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  describe('in development mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('returns the actual error message for 4xx errors', () => {
      const err = new APIError('Invalid credentials', 401);
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Invalid credentials');
      expect(res._body.success).toBe(false);
    });

    it('returns the actual error message for 500 errors', () => {
      const err = new Error('DB connection failed');
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('DB connection failed');
    });

    it('includes stack trace in development', () => {
      const err = new APIError('oops', 400);
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._body.stack).toBeDefined();
    });

    it('includes requestId in the response', () => {
      const err = new APIError('oops', 400);
      const req = makeReq({ requestId: 'abc-123' });
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._body.requestId).toBe('abc-123');
    });
  });

  describe('in production mode', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('returns the actual message for 4xx errors (operational)', () => {
      const err = new APIError('Invalid credentials', 401);
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._status).toBe(401);
      expect(res._body.error).toBe('Invalid credentials');
    });

    it('hides the internal message for 500 errors', () => {
      const err = new Error('Raw DB error details');
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._status).toBe(500);
      expect(res._body.error).toBe('Internal Server Error');
      expect(res._body.error).not.toContain('Raw DB error details');
    });

    it('does NOT include a stack trace in production', () => {
      const err = new APIError('oops', 400);
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._body.stack).toBeUndefined();
    });

    it('returns the message for 404 errors', () => {
      const err = new APIError('Route not found: /bad-path', 404);
      const req = makeReq();
      const res = makeRes();

      errorHandler(err, req, res, jest.fn());

      expect(res._status).toBe(404);
      expect(res._body.error).toBe('Route not found: /bad-path');
    });
  });
});

describe('notFound middleware', () => {
  it('calls next with a 404 APIError', () => {
    const req = makeReq({ originalUrl: '/missing' });
    const next = jest.fn();

    notFound(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(APIError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('/missing');
  });
});

describe('asyncHandler', () => {
  it('passes resolved value through normally', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(res._body).toEqual({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards rejected promise to next()', async () => {
    const boom = new Error('async failure');
    const handler = asyncHandler(async () => {
      throw boom;
    });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    await handler(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});
