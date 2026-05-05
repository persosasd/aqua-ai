/**
 * User Model
 * Handles user data and authentication
 */

const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');

class User {
  /**
   * Create a new user
   */
  static async create({ email, password, name, role = 'user' }) {
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert user
    const [user] = await db('users')
      .insert({
        email,
        password: hashedPassword,
        name,
        role,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(['id', 'email', 'name', 'role', 'created_at']);

    return user;
  }

  /**
   * Find user by email
   */
  static async findByEmail(email) {
    const user = await db('users').where({ email }).first();

    return user;
  }

  /**
   * Find user by ID
   */
  static async findById(id) {
    const user = await db('users')
      .where({ id })
      .select('id', 'email', 'name', 'role', 'created_at', 'updated_at')
      .first();

    return user;
  }

  /**
   * Verify password
   */
  static verifyPassword(plainPassword, hashedPassword) {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Update user
   */
  static async update(id, updates) {
    const updateData = { ...updates };

    // If password is being updated, hash it
    if (updateData.password) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password, salt);
    }

    updateData.updated_at = new Date();

    const [user] = await db('users')
      .where({ id })
      .update(updateData)
      .returning(['id', 'email', 'name', 'role', 'updated_at']);

    return user;
  }

  /**
   * Delete user
   */
  static delete(id) {
    return db('users').where({ id }).del();
  }

  /**
   * Get all users (admin only)
   */
  static async findAll({ limit = 50, offset = 0 }) {
    const users = await db('users')
      .select('id', 'email', 'name', 'role', 'created_at', 'updated_at')
      .limit(limit)
      .offset(offset)
      .orderBy('created_at', 'desc');

    const [{ count }] = await db('users').count('* as count');

    return {
      users,
      total: parseInt(count || '0', 10),
      limit,
      offset,
    };
  }
}

module.exports = User;
