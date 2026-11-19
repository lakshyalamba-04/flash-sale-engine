/**
 * Flash-Sale Engine — API Gateway
 * 
 * Express server that handles incoming HTTP requests,
 * validates inputs, and delegates to the Redis-backed
 * inventory service for atomic stock operations.
 * 
 * Architecture:
 *   Client → Express API → Redis (Lua atomic scripts) → Redis Queue
 *                                                          ↓
 *                                              Background Worker (BLPOP)
 *                                                          ↓
 *                                                     PostgreSQL
 */
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const healthRoutes = require('./routes/health.routes');
const eventRoutes = require('./routes/event.routes');
const bookingRoutes = require('./routes/booking.routes');

// Initialize Express app
const app = express();

// ─── Security Middleware ─────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// ─── Rate Limiting ───────────────────────────────────────
const shouldSkipRateLimit = (req) => {
  return process.env.DISABLE_RATE_LIMIT === 'true' ||
         process.env.NODE_ENV === 'test' ||
         req.headers['x-load-test'] === 'true';
};

// Aggressive rate limit on booking endpoint to prevent bot abuse
const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,    // 1-minute window
  max: 30,                // 30 requests per minute per IP
  skip: shouldSkipRateLimit,
  message: {
    success: false,
    message: 'Too many booking attempts. Please try again in a minute.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  skip: shouldSkipRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Body Parsing ────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));   // Small payload limit for security
app.use(express.urlencoded({ extended: false }));

// ─── Request Logging ─────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.originalUrl !== '/health') {
      logger.debug(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ─── Static Frontend ────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public')));

// ─── Routes ──────────────────────────────────────────────
app.use('/health', healthRoutes);
app.use('/api/events', generalLimiter, eventRoutes);
app.use('/api/bookings', bookingLimiter, bookingRoutes);

// Root endpoint: serves UI for browsers, JSON for API clients
app.get('/', (req, res) => {
  if (req.accepts('html')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  res.json({
    name: 'Flash-Sale & Ticket Inventory Engine',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      events: 'GET /api/events',
      reserve: 'POST /api/bookings/reserve',
      cancel: 'DELETE /api/bookings/cancel',
      status: 'GET /api/bookings/status/:eventId/:userId',
    },
  });
});

// ─── 404 Handler ─────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// ─── Global Error Handler ────────────────────────────────
app.use(errorHandler);

// ─── Start Server ────────────────────────────────────────
const server = app.listen(config.server.port, () => {
  logger.info(`Flash-Sale Engine API running on port ${config.server.port}`, {
    env: config.server.env,
    pid: process.pid,
  });
});

// ─── Graceful Shutdown ───────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      const { redis } = require('./redis/client');
      await redis.quit();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error('Error closing Redis', { error: err.message });
    }

    try {
      const { pool } = require('./db/pool');
      await pool.end();
      logger.info('PostgreSQL pool closed');
    } catch (err) {
      logger.error('Error closing PostgreSQL', { error: err.message });
    }

    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app; // For testing
