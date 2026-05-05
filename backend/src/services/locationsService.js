/**
 * Locations Service
 * Pure business logic for location data.
 */

const { supabase, isSupabaseConfigured } = require('../db/supabase');
const { db } = require('../db/connection');
const { PAGINATION_DEFAULTS } = require('../constants');
const logger = require('../utils/logger');
const { sanitizeLikeSearch } = require('../utils/security');
const { buildPagination } = require('../utils/pagination');

const LOCATION_FILTER_RULES = [
  {
    key: 'state',
    db: (q, v) => q.where('state', 'ilike', `%${sanitizeLikeSearch(v)}%`),
    sb: (q, v) => q.ilike('state', `%${v}%`),
  },
  {
    key: 'risk_level',
    db: (q, v) => q.where('risk_level', v),
    sb: (q, v) => q.eq('risk_level', v),
  },
];

const applyLocationFilters = (query, filters, isSupabase) =>
  LOCATION_FILTER_RULES.reduce(
    (q, rule) =>
      filters[rule.key]
        ? rule[isSupabase ? 'sb' : 'db'](q, filters[rule.key])
        : q,
    query
  );

const buildGeoJSON = (data) => {
  const features = (data || [])
    .map((loc) => {
      const longitude = Number(loc.longitude);
      const latitude = Number(loc.latitude);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        properties: loc,
      };
    })
    .filter(Boolean);

  return { type: 'FeatureCollection', features };
};

const computeLocationStats = (all) => {
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
};

const computeRiskSummary = (data) => {
  const counts = { safe: 0, moderate: 0, poor: 0, critical: 0, unknown: 0 };
  for (const row of data || []) {
    const level = row.risk_level || 'unknown';
    counts[level] = (counts[level] || 0) + 1;
  }
  return counts;
};

const getLocationsFromDb = async (filters) => {
  const {
    limit = PAGINATION_DEFAULTS.LIMIT,
    offset = PAGINATION_DEFAULTS.OFFSET,
  } = filters;
  const baseQuery = applyLocationFilters(
    db('location_summary'),
    filters,
    false
  );
  const totalResult = await baseQuery.clone().count('* as total').first();
  const total = parseInt(totalResult?.total || 0, 10);

  const rows = await baseQuery
    .clone()
    .orderBy('name')
    .limit(limit)
    .offset(offset);

  return {
    data: rows || [],
    pagination: buildPagination(total, limit, offset),
  };
};

const getLocationsFromSupabase = async (filters) => {
  const {
    limit = PAGINATION_DEFAULTS.LIMIT,
    offset = PAGINATION_DEFAULTS.OFFSET,
  } = filters;
  let query = supabase.from('location_summary').select('*', { count: 'exact' });

  query = applyLocationFilters(query, filters, true);

  const { data, count, error } = await query
    .order('name')
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: data || [],
    pagination: buildPagination(count || 0, limit, offset),
  };
};

const getLocationSummaryRows = async () => {
  if (!isSupabaseConfigured) {
    return db('location_summary').select('*').orderBy('name');
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('*')
    .order('name');

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
};

const getLocationStatsRows = async () => {
  if (!isSupabaseConfigured) {
    return db('location_summary').select(
      'state',
      'water_body_type',
      'avg_wqi_score',
      'active_alerts'
    );
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('state, water_body_type, avg_wqi_score, active_alerts');

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
};

const getLocationByIdFromDb = async (id) => {
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
};

const fetchSupabaseLocation = async (id) => {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

const fetchSupabaseLocationReadings = async (id) => {
  const { data, error } = await supabase
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

  if (error) {
    throw new Error(error.message);
  }
  return data;
};

const fetchSupabaseLocationSummary = async (id) => {
  const { data, error } = await supabase
    .from('location_summary')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.warn('Failed to fetch location summary', {
      locationId: id,
      error: error.message,
    });
  }
  return data;
};

const mapLocationReadings = (readings) => {
  return (readings || []).map((row) => ({
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

const getLocationByIdFromSupabase = async (id) => {
  const location = await fetchSupabaseLocation(id);

  if (!location) {
    return null;
  }

  const readings = await fetchSupabaseLocationReadings(id);
  const summary = await fetchSupabaseLocationSummary(id);

  return {
    ...location,
    wqi_score: summary?.avg_wqi_score ?? null,
    risk_level: summary?.risk_level ?? null,
    latest_readings: mapLocationReadings(readings),
  };
};

/**
 * Get paginated locations with optional filters.
 */
async function getLocations(filters = {}) {
  if (!isSupabaseConfigured) {
    return getLocationsFromDb(filters);
  }

  return getLocationsFromSupabase(filters);
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
  const data = await getLocationSummaryRows();
  return buildGeoJSON(data);
}

/**
 * Get location statistics summary.
 */
async function getLocationStats() {
  const all = await getLocationStatsRows();
  return computeLocationStats(all);
}

/**
 * Get risk level summary counts.
 */
async function getRiskSummary() {
  if (!isSupabaseConfigured) {
    const data = await db('location_summary').select('risk_level');
    return computeRiskSummary(data);
  }

  const { data, error } = await supabase
    .from('location_summary')
    .select('risk_level');

  if (error) {
    throw new Error(error.message);
  }

  return computeRiskSummary(data);
}

const searchLocationsFromDb = async (sanitized, limit) => {
  const query = db('location_summary').select('*');
  if (sanitized) {
    query.where('name', 'ilike', `%${sanitized}%`);
  }
  const data = await query.orderBy('name').limit(limit);
  return data || [];
};

const searchLocationsFromSupabase = async (sanitized, limit) => {
  let query = supabase.from('location_summary').select('*');
  if (sanitized) {
    query = query.ilike('name', `%${sanitized}%`);
  }

  const { data, error } = await query.order('name').limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
};

/**
 * Search locations by query string.
 */
async function searchLocations(q, limit = PAGINATION_DEFAULTS.SEARCH_LIMIT) {
  const sanitized = q ? sanitizeLikeSearch(q) : null;

  if (!isSupabaseConfigured) {
    return searchLocationsFromDb(sanitized, limit);
  }

  return searchLocationsFromSupabase(sanitized, limit);
}

/**
 * Get a specific location with latest readings.
 */
async function getLocationById(id) {
  if (!isSupabaseConfigured) {
    return getLocationByIdFromDb(id);
  }

  return getLocationByIdFromSupabase(id);
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
