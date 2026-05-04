/**
 * Locations Service
 * Pure business logic for location data.
 */

const { supabase, isSupabaseConfigured } = require('../db/supabase');
const { db } = require('../db/connection');
const { PAGINATION_DEFAULTS } = require('../constants');
const logger = require('../utils/logger');

/**
 * Get paginated locations with optional filters.
 */
async function getLocations(filters = {}) {
  const {
    state,
    risk_level,
    limit = PAGINATION_DEFAULTS.LIMIT,
    offset = PAGINATION_DEFAULTS.OFFSET,
  } = filters;

  if (!isSupabaseConfigured) {
    const baseQuery = db('location_summary');

    if (state) {
      baseQuery.where('state', 'ilike', `%${state}%`);
    }
    if (risk_level) {
      baseQuery.where('risk_level', risk_level);
    }

    const totalResult = await baseQuery.clone().count('* as total').first();
    const total = parseInt(totalResult?.total || 0, 10);

    const rows = await baseQuery
      .clone()
      .orderBy('name')
      .limit(limit)
      .offset(offset);

    return {
      data: rows || [],
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  }

  let query = supabase.from('location_summary').select('*', { count: 'exact' });

  if (state) {
    query = query.ilike('state', `%${state}%`);
  }
  if (risk_level) {
    query = query.eq('risk_level', risk_level);
  }

  const { data, count, error } = await query
    .order('name')
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: data || [],
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: offset + limit < (count || 0),
    },
  };
}

/**
 * Get unique states list.
 */
async function getStates() {
  if (!isSupabaseConfigured) {
    const rows = await db('locations').distinct('state').orderBy('state');
    return rows.map((row) => row.state).filter(Boolean);
  }

  const { data, error } = await supabase
    .from('locations')
    .select('state')
    .order('state');

  if (error) {
    throw new Error(error.message);
  }

  return [...new Set((data || []).map((r) => r.state).filter(Boolean))];
}

/**
 * Get locations as GeoJSON FeatureCollection.
 */
async function getGeoJSON() {
  if (!isSupabaseConfigured) {
    const data = await db('location_summary').select('*').orderBy('name');
    const features = (data || [])
      .filter(
        (loc) =>
          Number.isFinite(Number(loc.longitude)) &&
          Number.isFinite(Number(loc.latitude))
      )
      .map((loc) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [loc.longitude, loc.latitude],
        },
        properties: loc,
      }));

    return { type: 'FeatureCollection', features };
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('*')
    .order('name');

  if (error) {
    throw new Error(error.message);
  }

  const features = (data || [])
    .filter(
      (loc) =>
        Number.isFinite(Number(loc.longitude)) &&
        Number.isFinite(Number(loc.latitude))
    )
    .map((loc) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [loc.longitude, loc.latitude],
      },
      properties: loc,
    }));

  return { type: 'FeatureCollection', features };
}

/**
 * Get location statistics summary.
 */
async function getLocationStats() {
  if (!isSupabaseConfigured) {
    const all = await db('location_summary').select(
      'state',
      'water_body_type',
      'avg_wqi_score',
      'active_alerts'
    );

    const stateSet = new Set(all.map((r) => r.state).filter(Boolean));
    const bodyTypeSet = new Set(
      all.map((r) => r.water_body_type).filter(Boolean)
    );
    const locationsWithAlerts = all.filter((r) => r.active_alerts > 0).length;
    const scoresWithValue = all.filter(
      (r) => r.avg_wqi_score !== null && r.avg_wqi_score !== undefined
    );
    const avgWqi =
      scoresWithValue.length > 0
        ? (
            scoresWithValue.reduce((sum, r) => sum + r.avg_wqi_score, 0) /
            scoresWithValue.length
          ).toFixed(2)
        : null;

    return {
      total_locations: all.length,
      states_covered: stateSet.size,
      water_body_types: [...bodyTypeSet],
      locations_with_alerts: locationsWithAlerts,
      average_wqi_score: avgWqi,
    };
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('state, water_body_type, avg_wqi_score, active_alerts');

  if (error) {
    throw new Error(error.message);
  }

  const all = data || [];
  const stateSet = new Set(all.map((r) => r.state).filter(Boolean));
  const bodyTypeSet = new Set(
    all.map((r) => r.water_body_type).filter(Boolean)
  );
  const locationsWithAlerts = all.filter((r) => r.active_alerts > 0).length;
  const scoresWithValue = all.filter(
    (r) => r.avg_wqi_score !== null && r.avg_wqi_score !== undefined
  );
  const avgWqi =
    scoresWithValue.length > 0
      ? (
          scoresWithValue.reduce((sum, r) => sum + r.avg_wqi_score, 0) /
          scoresWithValue.length
        ).toFixed(2)
      : null;

  return {
    total_locations: all.length,
    states_covered: stateSet.size,
    water_body_types: [...bodyTypeSet],
    locations_with_alerts: locationsWithAlerts,
    average_wqi_score: avgWqi,
  };
}

/**
 * Get risk level summary counts.
 */
async function getRiskSummary() {
  if (!isSupabaseConfigured) {
    const data = await db('location_summary').select('risk_level');
    const counts = { safe: 0, moderate: 0, poor: 0, critical: 0, unknown: 0 };
    for (const row of data || []) {
      const level = row.risk_level || 'unknown';
      counts[level] = (counts[level] || 0) + 1;
    }
    return counts;
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('risk_level');

  if (error) {
    throw new Error(error.message);
  }

  const counts = { safe: 0, moderate: 0, poor: 0, critical: 0, unknown: 0 };
  for (const row of data || []) {
    const level = row.risk_level || 'unknown';
    counts[level] = (counts[level] || 0) + 1;
  }

  return counts;
}

/**
 * Search locations by query string.
 */
async function searchLocations(q, limit = PAGINATION_DEFAULTS.SEARCH_LIMIT) {
  if (!isSupabaseConfigured) {
    const query = db('location_summary').select('*');
    if (q) {
      query.where('name', 'ilike', `%${q}%`);
    }
    const data = await query.orderBy('name').limit(limit);
    return data || [];
  }

  let query = supabase.from('location_summary').select('*');

  if (q) {
    query = query.ilike('name', `%${q}%`);
  }

  const { data, error } = await query.order('name').limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

/**
 * Get a specific location with latest readings.
 */
async function getLocationById(id) {
  if (!isSupabaseConfigured) {
    const location = await db('locations').select('*').where('id', id).first();

    if (!location) {
      return null;
    }

    const readings = await db('water_quality_readings as wqr')
      .join('water_quality_parameters as wqp', 'wqr.parameter_id', 'wqp.id')
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
      .where('wqr.location_id', id)
      .orderBy('wqr.measurement_date', 'desc')
      .limit(PAGINATION_DEFAULTS.LOCATION_READINGS_LIMIT);

    let summary = null;
    try {
      summary = await db('location_summary').select('*').where('id', id).first();
    } catch (error) {
      logger.warn('Failed to fetch location summary', {
        locationId: id,
        error: error?.message,
      });
    }

    return {
      ...location,
      wqi_score: summary?.avg_wqi_score ?? null,
      risk_level: summary?.risk_level ?? null,
      latest_readings: readings || [],
    };
  }

  const { data: location, error: locError } = await supabase
    .from('locations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (locError) {
    throw new Error(locError.message);
  }

  if (!location) {
    return null;
  }

  const { data: readings, error: readingsError } = await supabase
    .from('water_quality_readings')
    .select(
      `
      id, value, measurement_date, risk_level, quality_score, source,
      water_quality_parameters!inner ( parameter_name, parameter_code, unit )
    `
    )
    .eq('location_id', id)
    .order('measurement_date', { ascending: false })
    .limit(PAGINATION_DEFAULTS.LOCATION_READINGS_LIMIT);

  if (readingsError) {
    throw new Error(readingsError.message);
  }

  const { data: summary, error: summaryError } = await supabase
    .from('location_summary')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (summaryError) {
    // Log but don't fail — summary is supplemental data
    const logger = require('../utils/logger');
    logger.warn('Failed to fetch location summary', {
      locationId: id,
      error: summaryError.message,
    });
  }

  const latestReadings = (readings || []).map((row) => ({
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

  return {
    ...location,
    wqi_score: summary?.avg_wqi_score ?? null,
    risk_level: summary?.risk_level ?? null,
    latest_readings: latestReadings,
  };
}

module.exports = {
  getLocations,
  getStates,
  getGeoJSON,
  getLocationStats,
  getRiskSummary,
  searchLocations,
  getLocationById,
};
