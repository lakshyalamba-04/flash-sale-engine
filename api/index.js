/**
 * Vercel Serverless Function Entry Point
 * Exports handler for Vercel serverless runtime
 */
process.env.VERCEL = '1';
if (process.env.USE_MEMORY_STORE === undefined) {
  process.env.USE_MEMORY_STORE = 'true';
}

const app = require('../src/server');

module.exports = (req, res) => {
  return app(req, res);
};
