/**
 * PostgreSQL Connection Pool
 * Manages a shared pool of database connections using node-pg,
 * with seamless fallback to In-Memory Database when external PostgreSQL is unavailable.
 */
const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');
const { MemoryDB, getSharedMemoryDb } = require('../embedded/db-memory');

const useMemoryStore = process.env.USE_MEMORY_STORE === 'true';

let pool;
let query;
let getClient;

if (useMemoryStore) {
  logger.info('Using Embedded In-Memory PostgreSQL tier');
  const memoryDb = getSharedMemoryDb();
  pool = memoryDb;
  query = (text, params) => memoryDb.query(text, params);
  getClient = () => memoryDb.getClient();
} else {
  pool = new Pool(config.postgres);

  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected');
  });

  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error', { error: err.message });
  });

  query = (text, params) => pool.query(text, params);
  getClient = () => pool.connect();
}

module.exports = { pool, query, getClient };
