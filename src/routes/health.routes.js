/**
 * Health Check Routes
 * System health and readiness probes.
 */
const express = require('express');
const router = express.Router();
const { redis } = require('../redis/client');
const { query } = require('../db/pool');

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {},
  };

  // Check Redis
  try {
    const pong = await redis.ping();
    health.services.redis = { status: pong === 'PONG' ? 'healthy' : 'degraded' };
  } catch (err) {
    health.services.redis = { status: 'unhealthy', error: err.message };
    health.status = 'degraded';
  }

  // Check PostgreSQL
  try {
    const result = await query('SELECT 1 as check');
    health.services.postgres = { status: result.rows[0].check === 1 ? 'healthy' : 'degraded' };
  } catch (err) {
    health.services.postgres = { status: 'unhealthy', error: err.message };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  return res.status(statusCode).json(health);
});

module.exports = router;
