/**
 * Shared pagination helper.
 * Builds a standard pagination metadata object used across all services.
 *
 * @param {number} total  - Total number of records matching the query
 * @param {number} limit  - Page size
 * @param {number} offset - Current offset
 * @returns {{ total: number, limit: number, offset: number, hasMore: boolean }}
 */
const buildPagination = (total, limit, offset) => ({
  total,
  limit,
  offset,
  hasMore: offset + limit < total,
});

module.exports = { buildPagination };
