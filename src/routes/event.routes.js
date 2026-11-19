/**
 * Event Routes
 * CRUD endpoints for events/sales.
 */
const express = require('express');
const router = express.Router();
const eventService = require('../services/event.service');
const inventoryService = require('../services/inventory.service');
const logger = require('../utils/logger');

/**
 * GET /api/events
 * List all active events with ticket availability.
 */
router.get('/', async (req, res) => {
  try {
    const events = await eventService.listEvents();

    // Enrich with real-time stock from Redis
    const enriched = await Promise.all(
      events.map(async (event) => {
        try {
          const liveStock = await inventoryService.getStock(event.id);
          return { ...event, live_stock: liveStock };
        } catch {
          return { ...event, live_stock: event.available_stock };
        }
      })
    );

    return res.json({ success: true, events: enriched });
  } catch (err) {
    logger.error('List events error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/events/:id
 * Get event details with live stock count.
 */
router.get('/:id', async (req, res) => {
  try {
    const event = await eventService.getEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found.' });
    }

    try {
      event.live_stock = await inventoryService.getStock(event.id);
    } catch {
      event.live_stock = event.available_stock;
    }

    return res.json({ success: true, event });
  } catch (err) {
    logger.error('Get event error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/events
 * Create a new event.
 */
router.post('/', async (req, res) => {
  try {
    const event = await eventService.createEvent(req.body);
    return res.status(201).json({ success: true, event });
  } catch (err) {
    logger.error('Create event error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/events/:id/bookings
 * Get all bookings for an event.
 */
router.get('/:id/bookings', async (req, res) => {
  try {
    const bookings = await eventService.getEventBookings(req.params.id);
    return res.json({ success: true, bookings });
  } catch (err) {
    logger.error('Event bookings error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/events/:id/init-stock
 * Initialize Redis stock for an event from database.
 */
router.post('/:id/init-stock', async (req, res) => {
  try {
    const initialized = await inventoryService.initializeStock(req.params.id);
    return res.json({
      success: true,
      message: initialized ? 'Stock initialized in Redis.' : 'Stock already initialized.',
    });
  } catch (err) {
    logger.error('Init stock error', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/events/:id/reset-stock
 * Reset Redis stock to a specific number (e.g. 50).
 */
router.post('/:id/reset-stock', async (req, res) => {
  try {
    const stock = req.body && req.body.stock !== undefined ? parseInt(req.body.stock, 10) : 50;
    await inventoryService.resetStock(req.params.id, stock);
    return res.json({
      success: true,
      message: `Stock reset to ${stock} in Redis.`,
    });
  } catch (err) {
    logger.error('Reset stock error', { error: err.message });
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
