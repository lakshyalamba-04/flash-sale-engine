/**
 * PostgreSQL Connection Pool
 * Manages a shared pool of database connections using node-pg,
 * with seamless fallback to In-Memory Database when external PostgreSQL is unavailable.
 */
const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');
const { MemoryDB, getSharedMemoryDb } = require('../embedded/db-memory');

// Detect if external PostgreSQL connection string or remote host is explicitly provided
const hasExternalPg = Boolean(
  process.env.DATABASE_URL || 
  (process.env.PG_HOST && process.env.PG_HOST !== 'localhost' && process.env.PG_HOST !== '127.0.0.1')
);

// Default to in-memory store for zero-config deployments,
// unless external PostgreSQL is explicitly configured or USE_MEMORY_STORE is set to 'false'.
const useMemoryStore = process.env.USE_MEMORY_STORE === 'true' || 
  (process.env.USE_MEMORY_STORE !== 'false' && !hasExternalPg);

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
  const poolConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }
    : config.postgres;

  pool = new Pool(poolConfig);

  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected');
  });

  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error', { error: err.message });
  });

  query = (text, params) => pool.query(text, params);
  getClient = () => pool.connect();
}

module.exports = { pool, query, getClient, useMemoryStore };
