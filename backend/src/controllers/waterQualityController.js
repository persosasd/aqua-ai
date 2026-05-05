/**
 * Water Quality Controller
 * Handles HTTP request parsing, delegates to the service layer.
 */

const waterQualityService = require('../services/waterQualityService');
const { asyncHandler, APIError } = require('../middleware/errorHandler');
const { HTTP_STATUS } = require('../constants');
const { lastValue } = require('../utils/queryHelpers');

/**
 * GET /api/water-quality
 */
const getReadings = asyncHandler(async (req, res) => {
  const result = await waterQualityService.getReadings({
    location_id: lastValue(req.query.location_id),
    parameter: lastValue(req.query.parameter),
    state: lastValue(req.query.state),
    risk_level: lastValue(req.query.risk_level),
    start_date: lastValue(req.query.start_date),
    end_date: lastValue(req.query.end_date),
    limit: parseInt(lastValue(req.query.limit) ?? 100, 10),
    offset: parseInt(lastValue(req.query.offset) ?? 0, 10),
  });

  res.json({ success: true, ...result });
});

/**
 * GET /api/water-quality/parameters
 */
const getParameters = asyncHandler(async (_req, res) => {
  const data = await waterQualityService.getParameters();
  res.json({ success: true, data });
});

/**
 * GET /api/water-quality/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const data = await waterQualityService.getStats({
    state: lastValue(req.query.state),
    parameter: lastValue(req.query.parameter),
  });

  res.json({ success: true, data });
});

/**
 * GET /api/water-quality/location/:locationId
 */
const getByLocation = asyncHandler(async (req, res) => {
  const readings = await waterQualityService.getReadingsByLocation(
    req.params.locationId,
    {
      parameter: lastValue(req.query.parameter),
      limit: parseInt(lastValue(req.query.limit) ?? 50, 10),
    }
  );

  res.json({ success: true, data: readings, count: readings.length });
});

/**
 * GET /api/water-quality/:id
 */
const getById = asyncHandler(async (req, res) => {
  const data = await waterQualityService.getReadingById(req.params.id);

  if (!data) {
    throw new APIError('Water quality reading not found', HTTP_STATUS.NOT_FOUND);
  }

  res.json({ success: true, data });
});

module.exports = {
  getReadings,
  getParameters,
  getStats,
  getByLocation,
  getById,
};
