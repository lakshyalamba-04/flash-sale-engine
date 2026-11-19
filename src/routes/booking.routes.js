/**
 * Booking Routes
 * Handles ticket reservation, cancellation, and status checks.
 * These are the high-traffic flash-sale endpoints.
 */
const express = require('express');
const router = express.Router();
const inventoryService = require('../services/inventory.service');
const logger = require('../utils/logger');

/**
 * POST /api/bookings/reserve
 * Reserve tickets for an event.
 * 
 * Body: { eventId, userId, quantity? }
 * 
 * This is THE critical endpoint — handles 10,000+ concurrent requests.
 * The Redis Lua script ensures atomicity.
 */
router.post('/reserve', async (req, res) => {
  const startTime = Date.now();

  try {
    const { eventId, userId, quantity = 1 } = req.body;

    // Basic validation
    if (!eventId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'eventId and userId are required.',
      });
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be an integer between 1 and 10.',
      });
    }

    const result = await inventoryService.reserveTickets(eventId, userId, quantity);

    const latency = Date.now() - startTime;
    logger.debug('Reserve request completed', { latency: `${latency}ms`, eventId, userId });

    return res.status(result.status).json(result);
  } catch (err) {
    logger.error('Reserve endpoint error', { error: err.message, stack: err.stack });
    return res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again.',
    });
  }
});

/**
 * DELETE /api/bookings/cancel
 * Cancel an existing reservation.
 * 
 * Body: { eventId, userId }
 */
router.delete('/cancel', async (req, res) => {
  try {
    const { eventId, userId } = req.body;

    if (!eventId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'eventId and userId are required.',
      });
    }

    const result = await inventoryService.cancelReservation(eventId, userId);
    return res.status(result.status).json(result);
  } catch (err) {
    logger.error('Cancel endpoint error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
});

/**
 * GET /api/bookings/status/:eventId/:userId
 * Check reservation status for a user on an event.
 */
router.get('/status/:eventId/:userId', async (req, res) => {
  try {
    const { eventId, userId } = req.params;
    const status = await inventoryService.getReservationStatus(eventId, userId);
    return res.status(200).json({ success: true, ...status });
  } catch (err) {
    logger.error('Status check error', { error: err.message });
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
});

module.exports = router;
