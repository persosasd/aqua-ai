/**
 * Water Quality Service
 * Pure business logic for water quality data.
 */

const { supabase, isSupabaseConfigured } = require('../db/supabase');
const { db } = require('../db/connection');
const { PAGINATION_DEFAULTS } = require('../constants');

/**
 * Get paginated water quality readings with optional filters.
 * @param {object} filters
 * @returns {Promise<{ data: object[], pagination: object }>}
 */
async function getReadings(filters = {}) {
  const {
    location_id,
    parameter,
    state,
    risk_level,
    start_date,
    end_date,
    limit = PAGINATION_DEFAULTS.LIMIT,
    offset = PAGINATION_DEFAULTS.OFFSET,
  } = filters;

  if (!isSupabaseConfigured) {
    const baseQuery = db('water_quality_readings as wqr')
      .join('locations as l', 'wqr.location_id', 'l.id')
      .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id');

    if (location_id) {
      const parsedId = Number(location_id);
      if (Number.isFinite(parsedId)) {
        baseQuery.where('wqr.location_id', parsedId);
      } else {
        baseQuery.where('l.name', 'ilike', `%${location_id}%`);
      }
    }

    if (parameter) {
      baseQuery.where('wqp.parameter_code', String(parameter).toUpperCase());
    }

    if (state) {
      baseQuery.where('l.state', 'ilike', `%${state}%`);
    }

    if (risk_level) {
      baseQuery.where('wqr.risk_level', risk_level);
    }

    if (start_date) {
      baseQuery.where('wqr.measurement_date', '>=', start_date);
    }

    if (end_date) {
      baseQuery.where('wqr.measurement_date', '<=', end_date);
    }

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
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  let query = supabase.from('water_quality_readings').select(
    `
      id, value, measurement_date, source, risk_level, quality_score,
      locations!inner ( id, name, state, district, latitude, longitude ),
      water_quality_parameters!inner ( parameter_name, parameter_code, unit )
    `,
    { count: 'exact' }
  );

  if (location_id) {
    const parsedId = Number(location_id);
    if (Number.isFinite(parsedId)) {
      query = query.eq('location_id', parsedId);
    } else {
      query = query.ilike('locations.name', `%${location_id}%`);
    }
  }

  if (parameter) {
    query = query.eq(
      'water_quality_parameters.parameter_code',
      String(parameter).toUpperCase()
    );
  }

  if (state) {
    query = query.ilike('locations.state', `%${state}%`);
  }

  if (risk_level) {
    query = query.eq('risk_level', risk_level);
  }

  if (start_date) {
    query = query.gte('measurement_date', start_date);
  }

  if (end_date) {
    query = query.lte('measurement_date', end_date);
  }

  const { data, error, count } = await query
    .order('measurement_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  const flattened = (data || []).map((row) => ({
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

  return {
    data: flattened,
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: offset + limit < (count || 0),
    },
  };
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

    return (rows || []).map((p) => ({
      code: p.parameter_code,
      name: p.parameter_name,
      unit: p.unit,
      safe_limit: p.safe_limit,
      moderate_limit: p.moderate_limit,
      high_limit: p.high_limit,
      critical_limit: p.critical_limit,
      description: p.description,
    }));
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

  return (data || []).map((p) => ({
    code: p.parameter_code,
    name: p.parameter_name,
    unit: p.unit,
    safe_limit: p.safe_limit,
    moderate_limit: p.moderate_limit,
    high_limit: p.high_limit,
    critical_limit: p.critical_limit,
    description: p.description,
  }));
}

/**
 * Get water quality statistics with server-side aggregations.
 * @param {object} filters
 * @returns {Promise<object>}
 */
async function getStats(filters = {}) {
  const { state, parameter } = filters;

  const baseQuery = db('water_quality_readings as wqr')
    .join('locations as l', 'wqr.location_id', 'l.id')
    .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id');

  if (state) {
    baseQuery.where('l.state', 'ilike', `%${state}%`);
  }

  if (parameter) {
    baseQuery.where('wqp.parameter_code', '=', String(parameter).toUpperCase());
  }

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

  const totalCount = parseInt(totalResult?.total || 0, 10);

  const riskLevelCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of riskResult) {
    if (row.risk_level && riskLevelCounts[row.risk_level] !== undefined) {
      riskLevelCounts[row.risk_level] = parseInt(row.count || 0, 10);
    }
  }

  const avgScore =
    avgResult?.avg_score !== null && avgResult?.avg_score !== undefined
      ? Number(avgResult.avg_score).toFixed(2)
      : null;

  return {
    total_readings: totalCount,
    risk_level_distribution: riskLevelCounts,
    average_quality_score: avgScore,
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
  const { parameter, limit = PAGINATION_DEFAULTS.SMALL_LIMIT } = filters;

  if (!isSupabaseConfigured) {
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
  }

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
}

/**
 * Get a single reading by ID.
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
async function getReadingById(id) {
  if (!isSupabaseConfigured) {
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

    if (!row) {
      return null;
    }

    return row;
  }

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
}

module.exports = {
  getReadings,
  getParameters,
  getStats,
  getReadingsByLocation,
  getReadingById,
};
