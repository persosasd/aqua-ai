const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('../src/db/connection', () => ({
  db: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    update: jest.fn().mockReturnThis(),
    returning: jest.fn(),
  })),
}));

// Mock supabase — alertsService uses supabase for resolve/dismiss with atomic update
jest.mock('../src/db/supabase', () => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    maybeSingle: jest
      .fn()
      .mockResolvedValue({ data: { id: 1, status: 'resolved' }, error: null }),
    single: jest
      .fn()
      .mockResolvedValue({ data: { id: 1, status: 'resolved' }, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.neq.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);

  return {
    supabase: {
      from: jest.fn().mockReturnValue(chain),
    },
    isSupabaseConfigured: true,
  };
});

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
}));

// Mock middlewares
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    // Default to a regular user if not set in test
    req.user = req.user || { id: 1, role: 'user' };
    next();
  },
  authorize:
    (...roles) =>
    (req, res, next) => {
      if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    },
}));

// We need to setup a mini app to test the route
const alertsRouter = require('../src/routes/alerts');
const { errorHandler } = require('../src/middleware/errorHandler');

const app = express();
app.use(express.json());
// Inject user for specific tests
app.use((req, res, next) => {
  if (req.headers['x-test-role']) {
    req.user = { id: 1, role: req.headers['x-test-role'] };
  }
  next();
});
app.use('/api/alerts', alertsRouter);
app.use(errorHandler);

describe('Alerts Authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should deny access to resolve alert for regular user', async () => {
    const res = await request(app)
      .put('/api/alerts/1/resolve')
      .set('x-test-role', 'user')
      .send({ resolution_notes: 'Fixed' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient permissions');
  });

  it('should allow access to resolve alert for admin', async () => {
    const res = await request(app)
      .put('/api/alerts/1/resolve')
      .set('x-test-role', 'admin')
      .send({ resolution_notes: 'Fixed' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should allow access to resolve alert for moderator', async () => {
    const res = await request(app)
      .put('/api/alerts/1/resolve')
      .set('x-test-role', 'moderator')
      .send({ resolution_notes: 'Fixed' });

    expect(res.status).toBe(200);
  });
});
