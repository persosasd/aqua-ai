const request = require('supertest');
const express = require('express');

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
}));

const { APIError, errorHandler } = require('../src/middleware/errorHandler');

const originalNodeEnv = process.env.NODE_ENV;

const createApp = (errorFactory) => {
  const app = express();

  app.get('/test-error', (req, res, next) => {
    req.requestId = 'req-test-123';
    next(errorFactory());
  });

  app.use(errorHandler);
  return app;
};

describe('Error Handler Production Message Exposure', () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
  });

  it('exposes 4xx error messages in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp(() => new APIError('Invalid input payload', 400));

    const res = await request(app).get('/test-error');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Invalid input payload');
    expect(res.body.requestId).toBe('req-test-123');
    expect(res.body.stack).toBeUndefined();
    expect(res.body.details).toBeUndefined();
  });

  it('masks 5xx error messages in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = createApp(
      () => new APIError('Database connection failed', 503)
    );

    const res = await request(app).get('/test-error');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Internal Server Error');
    expect(res.body.requestId).toBe('req-test-123');
    expect(res.body.stack).toBeUndefined();
    expect(res.body.details).toBeUndefined();
  });
});
