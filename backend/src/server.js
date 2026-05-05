const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const dotenvResult = require('dotenv').config();
if (dotenvResult.error && dotenvResult.error.code !== 'ENOENT') {
  throw dotenvResult.error;
}
const { randomUUID } = require('crypto');
const qs = require('qs');

const logger = require('./utils/logger');
const { runWithRequestId } = require('./utils/requestContext');
const {
  testConnection,
  closeConnection,
  getHealthStatus,
} = require('./db/connection');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const hppProtection = require('./middleware/hpp');
const { startDataPipeline } = require('./utils/dataPipelineRunner');
const {
  RATE_LIMIT,
  REQUEST_TIMEOUT_MS,
  BODY_SIZE_LIMIT,
  HTTP_STATUS,
} = require('./constants');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust the first proxy (Render/Load Balancer)
// This ensures req.ip is correct for rate limiting and logging
app.set('trust proxy', 1);
app.set('query parser', (str) =>
  qs.parse(str, {
    allowDots: true,
    depth: 5,
    arrayLimit: 20,
    duplicates: 'last',
  })
);

if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.error(
      'FATAL: JWT_SECRET environment variable is required in production.'
    );
    process.exit(1);
  } else {
    logger.warn('JWT_SECRET is not set. Using fallback for development only.');
  }
}

// Security middleware
app.use(helmet());
app.use(hppProtection);

// CORS configuration
const corsOptions = {
  origin(origin, callback) {
    // In production, reject requests with no Origin header
    // (except health check which is handled before CORS)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('CORS: Origin header is required'), false);
      }
      // Allow in development (for curl, Postman, etc.)
      return callback(null, true);
    }

    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      // Only match YOUR Vercel project previews
      /^https:\/\/aqua-ai[\w-]*\.vercel\.app$/,
    ].filter(Boolean);

    const isAllowed = allowedOrigins.some((allowed) => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('CORS: Origin not allowed'), false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: RATE_LIMIT.GENERAL_WINDOW_MS,
  max: RATE_LIMIT.GENERAL_MAX,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.ip === '127.0.0.1' || req.ip === '::1';
  },
});
app.use('/api/', limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: RATE_LIMIT.GENERAL_WINDOW_MS,
  max: RATE_LIMIT.AUTH_MAX,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Force HTTPS in production
app.use((req, res, next) => {
  if (
    process.env.NODE_ENV === 'production' &&
    req.headers['x-forwarded-proto'] !== 'https' &&
    req.method === 'GET'
  ) {
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
});

// Request timeout middleware
// 60s to accommodate Render free-tier cold starts (~30-50s wake-up time)
app.use((req, res, next) => {
  req.setTimeout(REQUEST_TIMEOUT_MS, () => {
    logger.warn(`Request timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(HTTP_STATUS.REQUEST_TIMEOUT).json({
        success: false,
        error: 'Request timeout',
      });
    }
  });
  next();
});

// General middleware
app.use(compression());
app.use(express.json({ limit: BODY_SIZE_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
app.use((req, _res, next) => {
  const blockedKeys = new Set(['__proto__', 'prototype', 'constructor']);
  const flatten = (value) => {
    if (Array.isArray(value)) {
      return value.length > 0 ? flatten(value[value.length - 1]) : undefined;
    }
    if (value && typeof value === 'object') {
      const output = Object.create(null);
      for (const [key, nestedValue] of Object.entries(value)) {
        if (blockedKeys.has(key)) {
          continue;
        }
        output[key] = flatten(nestedValue);
      }
      return output;
    }
    return value;
  };
  if (req.query && typeof req.query === 'object') {
    Object.defineProperty(req, 'query', {
      value: flatten(req.query),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  next();
});

app.use((req, res, next) => {
  const requestId =
    req.get('x-request-id') || req.get('x-correlation-id') || randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  runWithRequestId(requestId, next);
});

app.use((req, _res, next) => {
  const arrayPaths = [];
  const collectArrayPaths = (value, path) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      arrayPaths.push(path);
      return;
    }
    for (const [key, nestedValue] of Object.entries(value)) {
      collectArrayPaths(nestedValue, path ? `${path}.${key}` : key);
    }
  };
  collectArrayPaths(req.query, 'query');
  collectArrayPaths(req.body, 'body');
  if (arrayPaths.length > 0) {
    logger.warn('Request contains array values', {
      requestId: req.requestId,
      paths: arrayPaths,
      url: req.originalUrl,
      method: req.method,
    });
  }
  next();
});

app.use((req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    logger.info(`${req.method} ${req.path}`, {
      requestId: req.requestId,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    });
  });

  next();
});

const { authenticate, authorize } = require('./middleware/auth');

// Public health check — minimal info
app.get('/api/health', async (req, res) => {
  try {
    const dbHealth = await getHealthStatus();
    res.json({
      status: dbHealth.status === 'healthy' ? 'OK' : 'DEGRADED',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'ERROR' });
  }
});

// Detailed health — requires auth (for monitoring/admin use)
app.get(
  '/api/admin/health',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const dbHealth = await getHealthStatus();
      res.json({
        status: 'OK',
        environment: process.env.NODE_ENV || 'development',
        database: dbHealth,
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({ status: 'ERROR', error: error.message });
    }
  }
);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/water-quality', require('./routes/waterQuality'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/alerts', require('./routes/alerts'));

// 404 handler
app.use(notFound);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize server
async function startServer() {
  try {
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.warn('⚠️  Starting server without database connection');
    }

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Aqua-AI Backend server is running on port ${PORT}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/api/health`);
      startDataPipeline();
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        logger.info('HTTP server closed');
        await closeConnection();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT signal received: closing HTTP server');
      server.close(async () => {
        logger.info('HTTP server closed');
        await closeConnection();
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server (only if not in test mode AND not running as a Vercel serverless function)
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  startServer();
}

module.exports = app;
