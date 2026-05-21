const request = require('supertest');

// Mock database connection
const mockDb = jest.fn(() => ({
  where: jest.fn().mockReturnThis(),
  first: jest.fn().mockImplementation(() =>
    Promise.resolve({
      id: 1,
      status: 'active',
      triggered_at: new Date(),
    })
  ),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn().mockResolvedValue([{ id: 1, status: 'resolved' }]),
  select: jest.fn().mockReturnThis(),
  join: jest.fn().mockReturnThis(),
  count: jest.fn().mockResolvedValue([{ count: 0 }]),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  offset: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  clone: jest.fn().mockReturnThis(),
  clearSelect: jest.fn().mockReturnThis(),
}));

jest.mock('../src/db/connection', () => ({
  db: mockDb,
  testConnection: jest.fn().mockResolvedValue(true),
  getHealthStatus: jest.fn().mockResolvedValue({ status: 'healthy' }),
  closeConnection: jest.fn().mockResolvedValue(),
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

// Mock auth middleware
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 1, role: 'user' };
    next();
  },
  optionalAuth: (req, res, next) => next(),
  authorize: () => (req, res, next) => next(),
  generateToken: () => 'mock-token',
}));

// Mock logger
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
}));

const app = require('../src/server');

describe('Security: Input Validation', () => {
  it('should reject resolution_notes longer than 1000 characters', async () => {
    const longNotes = 'a'.repeat(1001);

    const res = await request(app)
      .put('/api/alerts/1/resolve')
      .send({ resolution_notes: longNotes });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('should accept resolution_notes with valid length', async () => {
    const validNotes = 'Fixed it';

    const res = await request(app)
      .put('/api/alerts/1/resolve')
      .send({ resolution_notes: validNotes });

    expect(res.status).toBe(200);
  });

  it('should reject dismissal_reason longer than 1000 characters', async () => {
    const longReason = 'a'.repeat(1001);

    const res = await request(app)
      .put('/api/alerts/1/dismiss')
      .send({ dismissal_reason: longReason });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
