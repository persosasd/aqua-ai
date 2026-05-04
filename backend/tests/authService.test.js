/**
 * Unit tests for the Auth Service layer.
 * Mocks User model and generateToken so tests run without a real DB.
 */

const { APIError } = require('../src/middleware/errorHandler');

// --- Mocks (must be declared before requiring the service) ---

const mockUser = {
  id: 1,
  email: 'alice@example.com',
  name: 'Alice',
  role: 'user',
  password: 'hashed_password',
};

jest.mock('../src/models/User', () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  verifyPassword: jest.fn(),
}));

jest.mock('../src/middleware/auth', () => ({
  generateToken: jest.fn().mockReturnValue('mock-jwt-token'),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const User = require('../src/models/User');
const { generateToken } = require('../src/middleware/auth');
const authService = require('../src/services/authService');

// ---------------------------------------------------------------------------

describe('authService.registerUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 400 when the email is already registered', async () => {
    User.findByEmail.mockResolvedValue(mockUser);

    await expect(
      authService.registerUser({
        email: 'alice@example.com',
        password: 'Password1',
        name: 'Alice',
      })
    ).rejects.toMatchObject({ statusCode: 400, message: /already exists/i });
  });

  it('creates a user and returns user + token on success', async () => {
    User.findByEmail.mockResolvedValue(null);
    User.create.mockResolvedValue(mockUser);

    const result = await authService.registerUser({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
    });

    expect(User.create).toHaveBeenCalledWith({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
    });
    expect(generateToken).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual({
      user: { id: 1, email: 'alice@example.com', name: 'Alice', role: 'user' },
      token: 'mock-jwt-token',
    });
  });
});

// ---------------------------------------------------------------------------

describe('authService.loginUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 401 when the user does not exist', async () => {
    User.findByEmail.mockResolvedValue(null);
    // bcrypt compare on the dummy hash still returns false
    User.verifyPassword.mockResolvedValue(false);

    await expect(
      authService.loginUser({ email: 'nobody@example.com', password: 'pass' })
    ).rejects.toMatchObject({ statusCode: 401, message: /invalid credentials/i });
  });

  it('throws 401 when the password is wrong', async () => {
    User.findByEmail.mockResolvedValue(mockUser);
    User.verifyPassword.mockResolvedValue(false);

    await expect(
      authService.loginUser({ email: 'alice@example.com', password: 'WrongPass1' })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('returns user + token on valid credentials', async () => {
    User.findByEmail.mockResolvedValue(mockUser);
    User.verifyPassword.mockResolvedValue(true);

    const result = await authService.loginUser({
      email: 'alice@example.com',
      password: 'Password1',
    });

    expect(generateToken).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual({
      user: { id: 1, email: 'alice@example.com', name: 'Alice', role: 'user' },
      token: 'mock-jwt-token',
    });
  });

  it('always calls verifyPassword even when user is not found (timing-attack mitigation)', async () => {
    User.findByEmail.mockResolvedValue(null);
    User.verifyPassword.mockResolvedValue(false);

    await authService
      .loginUser({ email: 'nobody@example.com', password: 'pass' })
      .catch(() => {});

    expect(User.verifyPassword).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------

describe('authService.getUserProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when user is not found', async () => {
    User.findById.mockResolvedValue(null);

    await expect(authService.getUserProfile(999)).rejects.toMatchObject({
      statusCode: 404,
      message: /user not found/i,
    });
  });

  it('returns the user when found', async () => {
    const profile = { id: 1, email: 'alice@example.com', name: 'Alice', role: 'user' };
    User.findById.mockResolvedValue(profile);

    const result = await authService.getUserProfile(1);

    expect(User.findById).toHaveBeenCalledWith(1);
    expect(result).toEqual(profile);
  });
});

// ---------------------------------------------------------------------------

describe('authService.updateUserProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 400 when the new email is already taken by another account', async () => {
    User.findByEmail.mockResolvedValue({ id: 2, email: 'bob@example.com' });

    await expect(
      authService.updateUserProfile(
        1,
        { email: 'bob@example.com' },
        'alice@example.com'
      )
    ).rejects.toMatchObject({ statusCode: 400, message: /already in use/i });
  });

  it('does not check for email conflict when email is unchanged', async () => {
    const updated = { id: 1, email: 'alice@example.com', name: 'Alice Updated' };
    User.update.mockResolvedValue(updated);

    const result = await authService.updateUserProfile(
      1,
      { email: 'alice@example.com', name: 'Alice Updated' },
      'alice@example.com' // same email — no conflict check
    );

    expect(User.findByEmail).not.toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it('updates only provided fields (name)', async () => {
    const updated = { id: 1, email: 'alice@example.com', name: 'New Name' };
    User.update.mockResolvedValue(updated);

    await authService.updateUserProfile(
      1,
      { name: 'New Name' },
      'alice@example.com'
    );

    expect(User.update).toHaveBeenCalledWith(1, { name: 'New Name' });
  });

  it('updates both name and email when new email is free', async () => {
    User.findByEmail.mockResolvedValue(null); // new email is free
    const updated = { id: 1, email: 'newalice@example.com', name: 'Alice' };
    User.update.mockResolvedValue(updated);

    const result = await authService.updateUserProfile(
      1,
      { name: 'Alice', email: 'newalice@example.com' },
      'alice@example.com'
    );

    expect(User.findByEmail).toHaveBeenCalledWith('newalice@example.com');
    expect(User.update).toHaveBeenCalledWith(1, {
      name: 'Alice',
      email: 'newalice@example.com',
    });
    expect(result).toEqual(updated);
  });
});
