/**
 * Vercel Serverless Function Entry Point
 * Exports Express app for Vercel edge/serverless runtime
 */
const app = require('../src/server');

module.exports = app;
