const mockGenSalt = jest.fn();
const mockHash = jest.fn();

jest.mock('bcryptjs', () => ({
  genSalt: mockGenSalt,
  hash: mockHash,
  compare: jest.fn(),
}));

const mockReturning = jest.fn();
const mockUpdate = jest.fn();
const mockWhere = jest.fn();
const mockDb = jest.fn();

jest.mock('../src/db/connection', () => ({
  db: mockDb,
}));

const User = require('../src/models/User');

describe('User model update', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockDb.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ update: mockUpdate });
    mockUpdate.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([
      {
        id: 1,
        email: 'user@example.com',
        name: 'Updated Name',
        role: 'user',
        updated_at: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]);
  });

  test('should not mutate input updates object when hashing password', async () => {
    mockGenSalt.mockResolvedValue('salt');
    mockHash.mockResolvedValue('hashed-password');

    const updates = { name: 'Updated Name', password: 'new-password' };
    const originalUpdates = { ...updates };

    await User.update(1, updates);

    expect(updates).toEqual(originalUpdates);
    expect(updates).not.toHaveProperty('updated_at');

    expect(mockGenSalt).toHaveBeenCalledWith(10);
    expect(mockHash).toHaveBeenCalledWith('new-password', 'salt');

    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload).not.toBe(updates);
    expect(updatePayload).toMatchObject({
      name: 'Updated Name',
      password: 'hashed-password',
    });
    expect(updatePayload.updated_at).toBeInstanceOf(Date);
  });

  test('should not mutate input updates object when password is not provided', async () => {
    const updates = { name: 'Updated Name' };
    const originalUpdates = { ...updates };

    await User.update(1, updates);

    expect(updates).toEqual(originalUpdates);
    expect(updates).not.toHaveProperty('updated_at');
    expect(mockGenSalt).not.toHaveBeenCalled();
    expect(mockHash).not.toHaveBeenCalled();

    const updatePayload = mockUpdate.mock.calls[0][0];
    expect(updatePayload).toMatchObject({ name: 'Updated Name' });
    expect(updatePayload.updated_at).toBeInstanceOf(Date);
  });
});
