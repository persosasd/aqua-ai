/**
 * Alerts Service
 * Pure business logic for alert data.
 */

const { supabase } = require('../db/supabase');
const { db } = require('../db/connection');
const { APIError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { ALERT_STATUS, PAGINATION_DEFAULTS } = require('../constants');

/**
 * Get paginated alerts with optional filters.
 */
async function getAlerts(filters = {}) {
  const {
    status,
    severity,
    location_id,
    parameter,
    alert_type,
    start_date,
    end_date,
    limit = PAGINATION_DEFAULTS.LIMIT,
    offset = PAGINATION_DEFAULTS.OFFSET,
  } = filters;

  let query = supabase.from('alerts').select(
    `
      id, location_id, alert_type, severity, message, threshold_value, actual_value,
      status, triggered_at, resolved_at, notification_sent, created_at,
      locations!inner ( name, state ),
      water_quality_parameters!inner ( parameter_name, parameter_code )
    `,
    { count: 'exact' }
  );

  if (status) {
    query = query.eq('status', status);
  }
  if (severity) {
    query = query.eq('severity', severity);
  }
  if (location_id) {
    query = query.eq('location_id', location_id);
  }
  if (parameter) {
    query = query.eq(
      'water_quality_parameters.parameter_code',
      parameter.toUpperCase()
    );
  }
  if (alert_type) {
    query = query.eq('alert_type', alert_type);
  }
  if (start_date) {
    query = query.gte('triggered_at', start_date);
  }
  if (end_date) {
    query = query.lte('triggered_at', end_date);
  }

  const { data, count, error } = await query
    .order('triggered_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  const alerts = (data || []).map((row) => ({
    id: row.id,
    location_id: row.location_id,
    location_name: row.locations?.name,
    state: row.locations?.state,
    parameter: row.water_quality_parameters?.parameter_name,
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

  return {
    data: alerts,
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: offset + limit < (count || 0),
    },
  };
}

/**
 * Get active alerts.
 */
async function getActiveAlerts(filters = {}) {
  const { severity, limit = PAGINATION_DEFAULTS.SMALL_LIMIT } = filters;

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

/**
 * Get alert statistics with server-side aggregations.
 */
async function getAlertStats(filters = {}) {
  const { start_date, end_date } = filters;

  const baseQuery = db('alerts as a').join(
    'water_quality_parameters as wqp',
    'a.parameter_id',
    'wqp.id'
  );

  if (start_date) {
    baseQuery.where('a.triggered_at', '>=', start_date);
  }
  if (end_date) {
    baseQuery.where('a.triggered_at', '<=', end_date);
  }

  const [
    totalResult,
    statusResult,
    severityResult,
    alertTypeResult,
    locationsResult,
    parametersResult,
    avgResolutionResult,
  ] = await Promise.all([
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

  const totalAlerts = parseInt(totalResult?.total || 0, 10);

  const statusCounts = { active: 0, resolved: 0, dismissed: 0 };
  for (const row of statusResult) {
    if (statusCounts[row.status] !== undefined) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }
  }

  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of severityResult) {
    if (severityCounts[row.severity] !== undefined) {
      severityCounts[row.severity] = parseInt(row.count, 10);
    }
  }

  const alertTypeCounts = {};
  for (const row of alertTypeResult) {
    alertTypeCounts[row.alert_type] = parseInt(row.count, 10);
  }

  let avgResolutionTime = null;
  if (
    avgResolutionResult?.avg_time !== null &&
    avgResolutionResult?.avg_time !== undefined
  ) {
    avgResolutionTime = (
      parseFloat(avgResolutionResult.avg_time) / 3600
    ).toFixed(2);
  }

  return {
    total_alerts: totalAlerts,
    active_alerts: statusCounts.active,
    resolved_alerts: statusCounts.resolved,
    dismissed_alerts: statusCounts.dismissed,
    severity_distribution: severityCounts,
    alert_types: alertTypeCounts,
    parameters_with_alerts: parametersResult.map((row) => row.parameter_code),
    locations_with_alerts: parseInt(locationsResult?.count || 0, 10),
    average_resolution_time_hours: avgResolutionTime,
  };
}

/**
 * Get a specific alert by ID.
 * Uses .maybeSingle() to distinguish "not found" from real DB errors.
 */
async function getAlertById(id) {
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
}

/**
 * Resolve an alert.
 * Uses atomic WHERE clause to prevent race conditions (no read-then-write).
 */
async function resolveAlert(id, resolutionNotes, userId) {
  const { data: updated, error } = await supabase
    .from('alerts')
    .update({
      status: ALERT_STATUS.RESOLVED,
      resolved_at: new Date().toISOString(),
      resolution_notes: resolutionNotes || null,
    })
    .eq('id', id)
    .neq('status', ALERT_STATUS.RESOLVED)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!updated) {
    // Either not found or already resolved — distinguish with a lookup
    const { data: existing } = await supabase
      .from('alerts')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      throw new APIError('Alert not found', 404);
    }
    throw new APIError('Alert is already resolved', 400);
  }

  logger.info('Alert resolved', { alertId: id, userId });
  return updated;
}

/**
 * Dismiss an alert.
 * Uses atomic WHERE clause to prevent race conditions (no read-then-write).
 */
async function dismissAlert(id, dismissalReason, userId) {
  const { data: updated, error } = await supabase
    .from('alerts')
    .update({
      status: ALERT_STATUS.DISMISSED,
      dismissal_reason: dismissalReason || null,
    })
    .eq('id', id)
    .eq('status', ALERT_STATUS.ACTIVE)
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!updated) {
    // Either not found or not active — distinguish with a lookup
    const { data: existing } = await supabase
      .from('alerts')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (!existing) {
      throw new APIError('Alert not found', 404);
    }
    throw new APIError('Only active alerts can be dismissed', 400);
  }

  logger.info('Alert dismissed', { alertId: id, userId });
  return updated;
}

module.exports = {
  getAlerts,
  getActiveAlerts,
  getAlertStats,
  getAlertById,
  resolveAlert,
  dismissAlert,
};
