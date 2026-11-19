/**
 * Redis Client Module
 * Creates and exports a shared Redis connection using ioredis,
 * with seamless fallback to In-Memory Redis when external Redis is unavailable.
 */
const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');
const { MemoryRedis, getSharedMemoryClient } = require('../embedded/redis-memory');

// Detect if external Redis connection string or remote host is explicitly provided
const hasExternalRedis = Boolean(
  process.env.REDIS_URL || 
  (process.env.REDIS_HOST && process.env.REDIS_HOST !== 'localhost' && process.env.REDIS_HOST !== '127.0.0.1')
);

// Default to in-memory store for zero-config deployments (Render, Vercel, Railway, Local without Docker),
// unless external Redis is explicitly configured or USE_MEMORY_STORE is set to 'false'.
const useMemoryStore = process.env.USE_MEMORY_STORE === 'true' || 
  (process.env.USE_MEMORY_STORE !== 'false' && !hasExternalRedis);

let redis;
let createRedisClient;
let createBlockingClient;

if (useMemoryStore) {
  logger.info('Using Embedded In-Memory Redis tier');
  const sharedMemory = getSharedMemoryClient();
  redis = sharedMemory;
  createRedisClient = () => sharedMemory;
  createBlockingClient = () => sharedMemory;
} else {
  createRedisClient = (name = 'default') => {
    const connectionOptions = process.env.REDIS_URL || {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryStrategy(times) {
        if (times > 3) {
          logger.warn(`Redis ${name} failed to connect after 3 retries.`);
          return null;
        }
        return Math.min(times * 200, 1000);
      },
    };

    const client = new Redis(connectionOptions);

    client.on('connect', () => {
      logger.info(`Redis ${name} client connected`);
    });

    client.on('error', (err) => {
      logger.error(`Redis ${name} client error`, { error: err.message });
    });

    return client;
  };

  redis = createRedisClient('primary');
  createBlockingClient = () => createRedisClient('blocking');
}

module.exports = { redis, createRedisClient, createBlockingClient, useMemoryStore };
