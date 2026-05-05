/**
 * Water Quality Service
 * Pure business logic for water quality data.
 */

const { supabase, isSupabaseConfigured } = require('../db/supabase');
const { db } = require('../db/connection');
const { PAGINATION_DEFAULTS } = require('../constants');
const { sanitizeLikeSearch } = require('../utils/security');

const buildPagination = (total, limit, offset) => ({
  total,
  limit,
  offset,
  hasMore: offset + limit < total,
});

const applyLocationIdFilter = (query, locationId, isSupabase) => {
  const parsed = Number(locationId);
  if (isSupabase) {
    return Number.isFinite(parsed)
      ? query.eq('location_id', parsed)
      : query.ilike('locations.name', `%${locationId}%`);
  }
  if (Number.isFinite(parsed)) {
    query.where('wqr.location_id', parsed);
  } else {
    query.where('l.name', 'ilike', `%${locationId}%`);
  }
  return query;
};

const READINGS_FILTER_RULES = [
  {
    key: 'parameter',
    db: (q, v) => q.where('wqp.parameter_code', String(v).toUpperCase()),
    sb: (q, v) =>
      q.eq('water_quality_parameters.parameter_code', String(v).toUpperCase()),
  },
  {
    key: 'state',
    db: (q, v) => q.where('l.state', 'ilike', `%${v}%`),
    sb: (q, v) => q.ilike('locations.state', `%${v}%`),
  },
  {
    key: 'risk_level',
    db: (q, v) => q.where('wqr.risk_level', v),
    sb: (q, v) => q.eq('risk_level', v),
  },
  {
    key: 'start_date',
    db: (q, v) => q.where('wqr.measurement_date', '>=', v),
    sb: (q, v) => q.gte('measurement_date', v),
  },
  {
    key: 'end_date',
    db: (q, v) => q.where('wqr.measurement_date', '<=', v),
    sb: (q, v) => q.lte('measurement_date', v),
  },
];

const applyReadingsFilters = (query, filters, isSupabase) => {
  const withLocation = filters.location_id
    ? applyLocationIdFilter(query, filters.location_id, isSupabase)
    : query;
  return READINGS_FILTER_RULES.reduce(
    (q, rule) =>
      filters[rule.key]
        ? rule[isSupabase ? 'sb' : 'db'](q, filters[rule.key])
        : q,
    withLocation
  );
};

const mapParameterRow = (row) => ({
  code: row.parameter_code,
  name: row.parameter_name,
  unit: row.unit,
  safe_limit: row.safe_limit,
  moderate_limit: row.moderate_limit,
  high_limit: row.high_limit,
  critical_limit: row.critical_limit,
  description: row.description,
});

const buildReadingsStatsBaseQuery = (state, parameter) => {
  const q = db('water_quality_readings as wqr')
    .join('locations as l', 'wqr.location_id', 'l.id')
    .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id');
  if (state) q.where('l.state', 'ilike', `%${sanitizeLikeSearch(state)}%`);
  if (parameter) q.where('wqp.parameter_code', '=', String(parameter).toUpperCase());
  return q;
};

const computeRiskLevelCounts = (rows) => {
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of rows) {
    if (row.risk_level && counts[row.risk_level] !== undefined) {
      counts[row.risk_level] = parseInt(row.count || 0, 10);
    }
  }
  return counts;
};

const computeAvgQualityScore = (result) => {
  if (result?.avg_score == null) return null;
  return Number(result.avg_score).toFixed(2);
};
const mapReadingsFromSupabase = (data) =>
  (data || []).map((row) => ({
    id: row.id,
    location_id: row.locations?.id,
    location_name: row.locations?.name,
    state: row.locations?.state,
    district: row.locations?.district,
    latitude: row.locations?.latitude,
    longitude: row.locations?.longitude,
    parameter: row.water_quality_parameters?.parameter_name,
    parameter_code: row.water_quality_parameters?.parameter_code,
    value: row.value,
    unit: row.water_quality_parameters?.unit,
    measurement_date: row.measurement_date,
    source: row.source,
    risk_level: row.risk_level,
    quality_score: row.quality_score,
  }));

const getReadingsFromDb = async (filters) => {
  const { limit = PAGINATION_DEFAULTS.LIMIT, offset = PAGINATION_DEFAULTS.OFFSET } =
    filters;
  const baseQuery = applyReadingsFilters(
    db('water_quality_readings as wqr')
      .join('locations as l', 'wqr.location_id', 'l.id')
      .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id'),
    filters,
    false
  );

  const totalResult = await baseQuery.clone().count('* as total').first();
  const total = parseInt(totalResult?.total || 0, 10);

  const rows = await baseQuery
    .clone()
    .select(
      'wqr.id as id',
      'wqr.value as value',
      'wqr.measurement_date as measurement_date',
      'wqr.source as source',
      'wqr.risk_level as risk_level',
      'wqr.quality_score as quality_score',
      'l.id as location_id',
      'l.name as location_name',
      'l.state as state',
      'l.district as district',
      'l.latitude as latitude',
      'l.longitude as longitude',
      'wqp.parameter_name as parameter',
      'wqp.parameter_code as parameter_code',
      'wqp.unit as unit'
    )
    .orderBy('wqr.measurement_date', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    data: rows,
    pagination: buildPagination(total, limit, offset),
  };
};

const getReadingsFromSupabase = async (filters) => {
  const { limit = PAGINATION_DEFAULTS.LIMIT, offset = PAGINATION_DEFAULTS.OFFSET } =
    filters;
  let query = supabase.from('water_quality_readings').select(
    `
      id, value, measurement_date, source, risk_level, quality_score,
      locations!inner ( id, name, state, district, latitude, longitude ),
      water_quality_parameters!inner ( parameter_name, parameter_code, unit )
    `,
    { count: 'exact' }
  );

  query = applyReadingsFilters(query, filters, true);

  const { data, error, count } = await query
    .order('measurement_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: mapReadingsFromSupabase(data),
    pagination: buildPagination(count || 0, limit, offset),
  };
};

const getReadingsByLocationFromDb = async (locationId, filters) => {
  const { parameter, limit = PAGINATION_DEFAULTS.SMALL_LIMIT } = filters;
  const baseQuery = db('water_quality_readings as wqr')
    .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id')
    .where('wqr.location_id', locationId);

  if (parameter) {
    baseQuery.where('wqp.parameter_code', String(parameter).toUpperCase());
  }

  const rows = await baseQuery
    .select(
      'wqr.id as id',
      'wqp.parameter_name as parameter',
      'wqp.parameter_code as parameter_code',
      'wqr.value as value',
      'wqp.unit as unit',
      'wqr.measurement_date as measurement_date',
      'wqr.risk_level as risk_level',
      'wqr.quality_score as quality_score',
      'wqr.source as source'
    )
    .orderBy('wqr.measurement_date', 'desc')
    .limit(limit);

  return rows || [];
};

const getReadingsByLocationFromSupabase = async (locationId, filters) => {
  const { parameter, limit = PAGINATION_DEFAULTS.SMALL_LIMIT } = filters;
  let query = supabase
    .from('water_quality_readings')
    .select(
      `
      id, value, measurement_date, risk_level, quality_score, source,
      water_quality_parameters!inner ( parameter_name, parameter_code, unit )
    `
    )
    .eq('location_id', locationId)
    .order('measurement_date', { ascending: false })
    .limit(limit);

  if (parameter) {
    query = query.eq(
      'water_quality_parameters.parameter_code',
      String(parameter).toUpperCase()
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => ({
    id: row.id,
    parameter: row.water_quality_parameters?.parameter_name,
    parameter_code: row.water_quality_parameters?.parameter_code,
    value: row.value,
    unit: row.water_quality_parameters?.unit,
    measurement_date: row.measurement_date,
    risk_level: row.risk_level,
    quality_score: row.quality_score,
    source: row.source,
  }));
};

const getReadingByIdFromDb = async (id) => {
  const row = await db('water_quality_readings as wqr')
    .join('locations as l', 'wqr.location_id', 'l.id')
    .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id')
    .select(
      'wqr.id as id',
      'wqr.value as value',
      'wqr.measurement_date as measurement_date',
      'wqr.risk_level as risk_level',
      'wqr.quality_score as quality_score',
      'wqr.source as source',
      'wqr.is_validated as is_validated',
      'wqr.validation_notes as validation_notes',
      'wqr.created_at as created_at',
      'l.id as location_id',
      'l.name as location_name',
      'l.state as state',
      'l.district as district',
      'l.latitude as latitude',
      'l.longitude as longitude',
      'wqp.parameter_name as parameter',
      'wqp.parameter_code as parameter_code',
      'wqp.unit as unit'
    )
    .where('wqr.id', id)
    .first();

  return row || null;
};

const getReadingByIdFromSupabase = async (id) => {
  const { data, error } = await supabase
    .from('water_quality_readings')
    .select(
      `
      id, value, measurement_date, risk_level, quality_score, source,
      is_validated, validation_notes, created_at,
      locations!inner ( id, name, state, district, latitude, longitude ),
      water_quality_parameters!inner ( parameter_name, parameter_code, unit )
    `
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    location_id: data.locations?.id,
    location_name: data.locations?.name,
    state: data.locations?.state,
    district: data.locations?.district,
    latitude: data.locations?.latitude,
    longitude: data.locations?.longitude,
    parameter: data.water_quality_parameters?.parameter_name,
    parameter_code: data.water_quality_parameters?.parameter_code,
    value: data.value,
    unit: data.water_quality_parameters?.unit,
    measurement_date: data.measurement_date,
    risk_level: data.risk_level,
    quality_score: data.quality_score,
    source: data.source,
    is_validated: data.is_validated,
    validation_notes: data.validation_notes,
    created_at: data.created_at,
  };
};

/**
 * Get paginated water quality readings with optional filters.
 * @param {object} filters
 * @returns {Promise<{ data: object[], pagination: object }>}
 */
async function getReadings(filters = {}) {
  if (!isSupabaseConfigured) {
    return getReadingsFromDb(filters);
  }

  return getReadingsFromSupabase(filters);
}

/**
 * Get available water quality parameters.
 * @returns {Promise<object[]>}
 */
async function getParameters() {
  if (!isSupabaseConfigured) {
    const rows = await db('water_quality_parameters')
      .select(
        'parameter_code',
        'parameter_name',
        'unit',
        'safe_limit',
        'moderate_limit',
        'high_limit',
        'critical_limit',
        'description'
      )
      .orderBy('parameter_code');

    return (rows || []).map(mapParameterRow);
  }

  const { data, error } = await supabase
    .from('water_quality_parameters')
    .select(
      'parameter_code, parameter_name, unit, safe_limit, moderate_limit, high_limit, critical_limit, description'
    )
    .order('parameter_code');

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map(mapParameterRow);
}

/**
 * Get water quality statistics with server-side aggregations.
 * @param {object} filters
 * @returns {Promise<object>}
 */
async function getStats(filters = {}) {
  const { state, parameter } = filters;
  const baseQuery = buildReadingsStatsBaseQuery(state, parameter);

  const [
    totalResult,
    riskResult,
    avgResult,
    paramsResult,
    statesResult,
    latestResult,
  ] = await Promise.all([
    baseQuery.clone().count('* as total').first(),
    baseQuery
      .clone()
      .select('wqr.risk_level')
      .count('* as count')
      .whereNotNull('wqr.risk_level')
      .groupBy('wqr.risk_level'),
    baseQuery.clone().avg('wqr.quality_score as avg_score').first(),
    baseQuery
      .clone()
      .distinct('wqp.parameter_code')
      .whereNotNull('wqp.parameter_code'),
    baseQuery.clone().distinct('l.state').whereNotNull('l.state'),
    baseQuery.clone().max('wqr.measurement_date as latest_date').first(),
  ]);

  return {
    total_readings: parseInt(totalResult?.total || 0, 10),
    risk_level_distribution: computeRiskLevelCounts(riskResult),
    average_quality_score: computeAvgQualityScore(avgResult),
    parameters_monitored: paramsResult.map((row) => row.parameter_code),
    states_monitored: statesResult.map((row) => row.state),
    latest_reading: latestResult?.latest_date || null,
  };
}

/**
 * Get readings for a specific location.
 * @param {number|string} locationId
 * @param {object} filters
 * @returns {Promise<object[]>}
 */
async function getReadingsByLocation(locationId, filters = {}) {
  if (!isSupabaseConfigured) {
    return getReadingsByLocationFromDb(locationId, filters);
  }

  return getReadingsByLocationFromSupabase(locationId, filters);
}

/**
 * Get a single reading by ID.
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
async function getReadingById(id) {
  if (!isSupabaseConfigured) {
    return getReadingByIdFromDb(id);
  }

  return getReadingByIdFromSupabase(id);
}

module.exports = {
  getReadings,
  getParameters,
  getStats,
  getReadingsByLocation,
  getReadingById,
};
