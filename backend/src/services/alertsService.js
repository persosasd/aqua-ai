/**
 * Alerts Service
 * Pure business logic for alert data.
 */

const { supabase, isSupabaseConfigured } = require('../db/supabase');
const { db } = require('../db/connection');
const { APIError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { ALERT_STATUS } = require('../constants');

const buildPagination = (total, limit, offset) => ({
  total,
  limit,
  offset,
  hasMore: offset + limit < total,
});

const ALERT_FILTER_RULES = [
  {
    key: 'status',
    db: (q, v) => q.where('a.status', v),
    sb: (q, v) => q.eq('status', v),
  },
  {
    key: 'severity',
    db: (q, v) => q.where('a.severity', v),
    sb: (q, v) => q.eq('severity', v),
  },
  {
    key: 'location_id',
    db: (q, v) => q.where('a.location_id', v),
    sb: (q, v) => q.eq('location_id', v),
  },
  {
    key: 'parameter',
    db: (q, v) => q.where('wqp.parameter_code', String(v).toUpperCase()),
    sb: (q, v) =>
      q.eq('water_quality_parameters.parameter_code', String(v).toUpperCase()),
  },
  {
    key: 'alert_type',
    db: (q, v) => q.where('a.alert_type', v),
    sb: (q, v) => q.eq('alert_type', v),
  },
  {
    key: 'start_date',
    db: (q, v) => q.where('a.triggered_at', '>=', v),
    sb: (q, v) => q.gte('triggered_at', v),
  },
  {
    key: 'end_date',
    db: (q, v) => q.where('a.triggered_at', '<=', v),
    sb: (q, v) => q.lte('triggered_at', v),
  },
];

const applyAlertFilters = (query, filters, isSupabase) =>
  ALERT_FILTER_RULES.reduce(
    (q, rule) =>
      filters[rule.key]
        ? rule[isSupabase ? 'sb' : 'db'](q, filters[rule.key])
        : q,
    query
  );

const mapAlertRows = (data) =>
  (data || []).map((row) => ({
    id: row.id,
    location_id: row.location_id,
    location_name: row.locations?.name ?? row.location_name,
    state: row.locations?.state ?? row.state,
    parameter: row.water_quality_parameters?.parameter_name ?? row.parameter,
    alert_type: row.alert_type,
    severity: row.severity,
    message: row.message,
    threshold_value: row.threshold_value,
    actual_value: row.actual_value,
    status: row.status,
    triggered_at: row.triggered_at,
    resolved_at: row.resolved_at,
    notification_sent: row.notification_sent,
    created_at: row.created_at,
  }));

const getAlertsFromDb = async (filters) => {
  const { limit = 100, offset = 0 } = filters;
  const baseQuery = applyAlertFilters(
    db('alerts as a')
      .join('locations as l', 'a.location_id', 'l.id')
      .join('water_quality_parameters as wqp', 'a.parameter_id', 'wqp.id'),
    filters,
    false
  );

  const totalResult = await baseQuery.clone().count('a.id as total').first();
  const total = parseInt(totalResult?.total || 0, 10);

  const rows = await baseQuery
    .clone()
    .select(
      'a.id as id',
      'a.location_id as location_id',
      'a.alert_type as alert_type',
      'a.severity as severity',
      'a.message as message',
      'a.threshold_value as threshold_value',
      'a.actual_value as actual_value',
      'a.status as status',
      'a.triggered_at as triggered_at',
      'a.resolved_at as resolved_at',
      'a.notification_sent as notification_sent',
      'a.created_at as created_at',
      'l.name as location_name',
      'l.state as state',
      'wqp.parameter_name as parameter',
      'wqp.parameter_code as parameter_code'
    )
    .orderBy('a.triggered_at', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    data: rows || [],
    pagination: buildPagination(total, limit, offset),
  };
};

const getAlertsFromSupabase = async (filters) => {
  const { limit = 100, offset = 0 } = filters;
  let query = supabase.from('alerts').select(
    `
      id, location_id, alert_type, severity, message, threshold_value, actual_value,
      status, triggered_at, resolved_at, notification_sent, created_at,
      locations!inner ( name, state ),
      water_quality_parameters!inner ( parameter_name, parameter_code )
    `,
    { count: 'exact' }
  );

  query = applyAlertFilters(query, filters, true);

  const { data, count, error } = await query
    .order('triggered_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return {
    data: mapAlertRows(data),
    pagination: buildPagination(count || 0, limit, offset),
  };
};

const getAlertByIdFromDb = async (id) => {
  const data = await db('alerts as a')
    .join('locations as l', 'a.location_id', 'l.id')
    .join('water_quality_parameters as wqp', 'a.parameter_id', 'wqp.id')
    .select(
      'a.*',
      'l.name as location_name',
      'l.state as state',
      'l.district as district',
      'l.latitude as latitude',
      'l.longitude as longitude',
      'wqp.parameter_name as parameter',
      'wqp.parameter_code as parameter_code',
      'wqp.unit as unit'
    )
    .where('a.id', id)
    .first();

  return data || null;
};

const getAlertByIdFromSupabase = async (id) => {
  const { data, error } = await supabase
    .from('alerts')
    .select(
      `
      *,
      locations!inner ( name, state, district, latitude, longitude ),
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
    ...data,
    location_name: data.locations?.name,
    state: data.locations?.state,
    district: data.locations?.district,
    latitude: data.locations?.latitude,
    longitude: data.locations?.longitude,
    parameter: data.water_quality_parameters?.parameter_name,
    parameter_code: data.water_quality_parameters?.parameter_code,
    unit: data.water_quality_parameters?.unit,
    locations: undefined,
    water_quality_parameters: undefined,
  };
};

const fetchAlertStatusFromDb = (id) =>
  db('alerts').select('id', 'status').where('id', id).first();

const fetchAlertStatusFromSupabase = async (id) => {
  const { data } = await supabase
    .from('alerts')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  return data;
};

const finalizeAlertUpdate = ({
  updated,
  existing,
  id,
  logMessage,
  userId,
  notFoundMessage,
  invalidMessage,
}) => {
  if (updated) {
    logger.info(logMessage, { alertId: id, userId });
    return updated;
  }
  if (!existing) {
    throw new APIError(notFoundMessage, 404);
  }
  throw new APIError(invalidMessage, 400);
};

const performAlertStateUpdate = async (id, payload, conditions, opts) => {
  if (!isSupabaseConfigured) {
    const updatedCount = await conditions
      .db(db('alerts').where('id', id))
      .update(payload);
    const updated =
      updatedCount > 0 ? await db('alerts').where('id', id).first() : null;
    const existing = updated ? null : await fetchAlertStatusFromDb(id);
    return finalizeAlertUpdate({ updated, existing, id, ...opts });
  }

  const { data: updated, error } = await conditions
    .sb(supabase.from('alerts').update(payload).eq('id', id))
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const existing = updated ? null : await fetchAlertStatusFromSupabase(id);
  return finalizeAlertUpdate({ updated, existing, id, ...opts });
};

/**
 * Get paginated alerts with optional filters.
 */
async function getAlerts(filters = {}) {
  if (!isSupabaseConfigured) {
    return getAlertsFromDb(filters);
  }

  return getAlertsFromSupabase(filters);
}

/**
 * Get active alerts.
 */
async function getActiveAlerts(filters = {}) {
  const { severity, limit = 50 } = filters;

  if (!isSupabaseConfigured) {
    let query = db('active_alerts').select('*');

    if (severity) {
      query = query.where('severity', severity);
    }

    const data = await query.orderBy('triggered_at', 'desc').limit(limit);
    return data || [];
  }

  let query = supabase.from('active_alerts').select('*');

  if (severity) {
    query = query.eq('severity', severity);
  }

  const { data, error } = await query
    .order('triggered_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

const aggregateCounts = (rows, keyField, seed) => {
  for (const row of rows) {
    if (row[keyField] && seed[row[keyField]] !== undefined) {
      seed[row[keyField]] = parseInt(row.count, 10);
    }
  }
  return seed;
};

const computeAvgResolutionHours = (result) => {
  const avgTime = result?.avg_time;
  if (avgTime === null || avgTime === undefined) {
    return null;
  }
  return (parseFloat(avgTime) / 3600).toFixed(2);
};

const buildAlertStatsBaseQuery = (start_date, end_date) => {
  const q = db('alerts as a').join(
    'water_quality_parameters as wqp',
    'a.parameter_id',
    'wqp.id'
  );
  if (start_date) {
    q.where('a.triggered_at', '>=', start_date);
  }
  if (end_date) {
    q.where('a.triggered_at', '<=', end_date);
  }
  return q;
};

const runAlertStatsQueries = (baseQuery) =>
  Promise.all([
    baseQuery.clone().count('a.id as total').first(),
    baseQuery
      .clone()
      .select('a.status')
      .count('a.id as count')
      .whereNotNull('a.status')
      .groupBy('a.status'),
    baseQuery
      .clone()
      .select('a.severity')
      .count('a.id as count')
      .whereNotNull('a.severity')
      .groupBy('a.severity'),
    baseQuery
      .clone()
      .select('a.alert_type')
      .count('a.id as count')
      .whereNotNull('a.alert_type')
      .groupBy('a.alert_type'),
    baseQuery.clone().countDistinct('a.location_id as count').first(),
    baseQuery
      .clone()
      .select('wqp.parameter_code')
      .whereNotNull('wqp.parameter_code')
      .groupBy('wqp.parameter_code'),
    baseQuery
      .clone()
      .where('a.status', ALERT_STATUS.RESOLVED)
      .whereNotNull('a.resolved_at')
      .whereNotNull('a.triggered_at')
      .select(
        db.raw(
          'AVG(EXTRACT(EPOCH FROM (a.resolved_at - a.triggered_at))) as avg_time'
        )
      )
      .first(),
  ]);

/**
 * Get alert statistics with server-side aggregations.
 */
async function getAlertStats(filters = {}) {
  const { start_date, end_date } = filters;
  const baseQuery = buildAlertStatsBaseQuery(start_date, end_date);

  const [
    totalResult,
    statusResult,
    severityResult,
    alertTypeResult,
    locationsResult,
    parametersResult,
    avgResolutionResult,
  ] = await runAlertStatsQueries(baseQuery);

  const statusCounts = aggregateCounts(statusResult, 'status', {
    active: 0,
    resolved: 0,
    dismissed: 0,
  });
  const severityCounts = aggregateCounts(severityResult, 'severity', {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  });

  const alertTypeCounts = {};
  for (const row of alertTypeResult) {
    alertTypeCounts[row.alert_type] = parseInt(row.count, 10);
  }

  return {
    total_alerts: parseInt(totalResult?.total || 0, 10),
    active_alerts: statusCounts.active,
    resolved_alerts: statusCounts.resolved,
    dismissed_alerts: statusCounts.dismissed,
    severity_distribution: severityCounts,
    alert_types: alertTypeCounts,
    parameters_with_alerts: parametersResult.map((row) => row.parameter_code),
    locations_with_alerts: parseInt(locationsResult?.count || 0, 10),
    average_resolution_time_hours:
      computeAvgResolutionHours(avgResolutionResult),
  };
}

/**
 * Get a specific alert by ID.
 * Uses .maybeSingle() to distinguish "not found" from real DB errors.
 */
async function getAlertById(id) {
  if (!isSupabaseConfigured) {
    return getAlertByIdFromDb(id);
  }

  return getAlertByIdFromSupabase(id);
}

/**
 * Resolve an alert.
 * Uses atomic WHERE clause to prevent race conditions (no read-then-write).
 */
async function resolveAlert(id, resolutionNotes, userId) {
  return performAlertStateUpdate(
    id,
    {
      status: ALERT_STATUS.RESOLVED,
      resolved_at: new Date().toISOString(),
      resolution_notes: resolutionNotes || null,
    },
    {
      db: (q) => q.whereNot('status', ALERT_STATUS.RESOLVED),
      sb: (q) => q.neq('status', ALERT_STATUS.RESOLVED),
    },
    {
      logMessage: 'Alert resolved',
      userId,
      notFoundMessage: 'Alert not found',
      invalidMessage: 'Alert is already resolved',
    }
  );
}

/**
 * Dismiss an alert.
 * Uses atomic WHERE clause to prevent race conditions (no read-then-write).
 */
async function dismissAlert(id, dismissalReason, userId) {
  return performAlertStateUpdate(
    id,
    {
      status: ALERT_STATUS.DISMISSED,
      dismissal_reason: dismissalReason || null,
    },
    {
      db: (q) => q.where('status', ALERT_STATUS.ACTIVE),
      sb: (q) => q.eq('status', ALERT_STATUS.ACTIVE),
    },
    {
      logMessage: 'Alert dismissed',
      userId,
      notFoundMessage: 'Alert not found',
      invalidMessage: 'Only active alerts can be dismissed',
    }
  );
}

module.exports = {
  getAlerts,
  getActiveAlerts,
  getAlertStats,
  getAlertById,
  resolveAlert,
  dismissAlert,
};
