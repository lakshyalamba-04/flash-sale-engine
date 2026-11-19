/**
 * Unified Runner
 * Starts both the API Gateway and the Background Worker in a coordinated process.
 * Used for single-command start: npm run start:all or npm start
 */
const logger = require('./utils/logger');

logger.info('🚀 Starting Flash-Sale & Ticket Inventory Engine (All-In-One)...');

// 1. Start API Server
const app = require('./server');

// 2. Start Worker (worker.js starts its worker loop on import)
require('./worker');

logger.info('✨ API Server and Background Worker are both running!');
