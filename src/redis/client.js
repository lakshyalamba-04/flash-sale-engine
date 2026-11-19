/**
 * Redis Client Module
 * Creates and exports a shared Redis connection using ioredis,
 * with seamless fallback to In-Memory Redis when external Redis is unavailable.
 */
const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');
const { MemoryRedis, getSharedMemoryClient } = require('../embedded/redis-memory');

const useMemoryStore = process.env.USE_MEMORY_STORE === 'true';

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
    const client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      retryStrategy(times) {
        if (times > 3) {
          logger.warn(`Redis ${name} failed to connect after 3 retries. Consider USE_MEMORY_STORE=true.`);
          return null;
        }
        const delay = Math.min(times * 200, 1000);
        return delay;
      },
    });

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

module.exports = { redis, createRedisClient, createBlockingClient };
