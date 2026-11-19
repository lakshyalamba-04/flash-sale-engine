/**
 * Centralized Configuration Module
 * Loads environment variables and provides typed, validated config.
 */
require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
  },

  postgres: {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT, 10) || 5432,
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'flash_sale_db',
    max: 20,                    // Connection pool max size
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 300,
  },

  reservation: {
    ttlSeconds: parseInt(process.env.RESERVATION_TTL, 10) || 420, // 7 minutes
  },

  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY, 10) || 5,
    pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL, 10) || 100,
  },
};

module.exports = config;
