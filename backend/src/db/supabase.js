/**
 * Supabase Client Module
 * Uses the Supabase JS client with service role key for backend data access.
 * This bypasses RLS policies and gives full read/write access.
 */

const isTestEnv = process.env.NODE_ENV === 'test';
const { createClient } = isTestEnv
  ? { createClient: null }
  : require('@supabase/supabase-js');
const logger = require('../utils/logger');

const deriveSupabaseUrl = () => {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  try {
    const dbUrl = new URL(process.env.DATABASE_URL);
    const host = dbUrl.hostname || '';
    const match = host.match(/^(?:db\.)?([^.]+)\.supabase\.co$/);
    if (match) {
      return `https://${match[1]}.supabase.co`;
    }
  } catch {
    return null;
  }
  return null;
};

const SUPABASE_URL = process.env.SUPABASE_URL || deriveSupabaseUrl();
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const createMockQuery = (table) => {
  const result = { data: [], error: null, count: 0 };
  const builder = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    range: () => builder,
    limit: () => builder,
    update: () => builder,
    insert: () => builder,
    delete: () => builder,
    in: () => builder,
    single: () =>
      Promise.resolve({
        data: table === 'alerts' ? { id: 1, status: 'active' } : null,
        error: null,
      }),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

const createMockClient = () => ({
  from: (table) => createMockQuery(table),
});

const isSupabaseConfigured = isTestEnv || Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!isSupabaseConfigured && !isTestEnv) {
  logger.warn(
    'Supabase is not configured (SUPABASE_URL/SUPABASE_*_KEY missing). Falling back to direct database queries. Set SUPABASE_URL explicitly for custom Supabase domains.'
  );
}

const supabase = isTestEnv
  ? createMockClient()
  : isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

module.exports = { supabase, isSupabaseConfigured };
