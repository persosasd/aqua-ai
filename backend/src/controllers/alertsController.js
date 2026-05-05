/**
 * Alerts Controller
 * Handles HTTP request parsing and delegates to the service layer.
 */

const alertsService = require('../services/alertsService');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { HTTP_STATUS } = require('../constants');
const { lastValue } = require('../utils/queryHelpers');

const getAll = asyncHandler(async (req, res) => {
  const result = await alertsService.getAlerts({
    status: lastValue(req.query.status),
    severity: lastValue(req.query.severity),
    location_id: lastValue(req.query.location_id),
    parameter: lastValue(req.query.parameter),
    alert_type: lastValue(req.query.alert_type),
    start_date: lastValue(req.query.start_date),
    end_date: lastValue(req.query.end_date),
    limit: parseInt(lastValue(req.query.limit) ?? 100, 10),
    offset: parseInt(lastValue(req.query.offset) ?? 0, 10),
  });

  res.json({ success: true, ...result });
});

const getActive = asyncHandler(async (req, res) => {
  const data = await alertsService.getActiveAlerts({
    severity: lastValue(req.query.severity),
    limit: parseInt(lastValue(req.query.limit) ?? 50, 10),
  });

  res.json({ success: true, data, count: data.length });
});

const getStats = asyncHandler(async (req, res) => {
  const data = await alertsService.getAlertStats({
    start_date: lastValue(req.query.start_date),
    end_date: lastValue(req.query.end_date),
  });

  res.json({ success: true, data });
});

const getById = asyncHandler(async (req, res) => {
  const alert = await alertsService.getAlertById(req.params.id);

  if (!alert) {
    throw new APIError('Alert not found', HTTP_STATUS.NOT_FOUND);
  }

  res.json({ success: true, data: alert });
});

const resolve = asyncHandler(async (req, res) => {
  const updated = await alertsService.resolveAlert(
    req.params.id,
    req.body.resolution_notes,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Alert resolved successfully',
    data: updated,
  });
});

const dismiss = asyncHandler(async (req, res) => {
  const updated = await alertsService.dismissAlert(
    req.params.id,
    req.body.dismissal_reason,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Alert dismissed successfully',
    data: updated,
  });
});

module.exports = {
  getAll,
  getActive,
  getStats,
  getById,
  resolve,
  dismiss,
};
