/**
 * Inventory Service
 * 
 * Orchestrates flash-sale ticket operations by combining
 * Redis atomic operations with PostgreSQL persistence.
 * 
 * This is the heart of the system — all stock operations
 * flow through here.
 */
const { v4: uuidv4 } = require('uuid');
const { redis } = require('../redis/client');
const luaScripts = require('../redis/lua-scripts');
const { query } = require('../db/pool');
const config = require('../config');
const logger = require('../utils/logger');

// Redis key helpers
const stockKey = (eventId) => `stock:${eventId}`;
const lockKey = (eventId, userId) => `lock:${eventId}:${userId}`;
const PENDING_QUEUE = 'pending_bookings';

class InventoryService {
  /**
   * Initialize stock in Redis from PostgreSQL.
   * Called at server startup or when a new event goes live.
   * @param {string} eventId - UUID of the event
   * @returns {Promise<boolean>} true if initialized, false if already set
   */
  async initializeStock(eventId) {
    // Fetch current available stock from DB (source of truth on startup)
    const result = await query(
      'SELECT available_stock FROM events WHERE id = $1 AND status = $2',
      [eventId, 'active']
    );

    if (result.rows.length === 0) {
      throw new Error(`Event ${eventId} not found or not active`);
    }

    const stock = result.rows[0].available_stock;

    const initialized = await redis.eval(
      luaScripts.INIT_STOCK,
      1,
      stockKey(eventId),
      stock
    );

    if (initialized === 1) {
      logger.info(`Stock initialized for event ${eventId}`, { stock });
    } else {
      logger.debug(`Stock already initialized for event ${eventId}`);
    }

    return initialized === 1;
  }

  /**
   * Forcibly reset stock for testing or event resets.
   */
  async resetStock(eventId, customStock = 50) {
    await redis.set(stockKey(eventId), customStock);
    logger.info(`Stock forcibly reset for event ${eventId} to ${customStock}`);
    return customStock;
  }

  /**
   * Get current available stock for an event.
   * @param {string} eventId
   * @returns {Promise<number>} Available stock count
   */
  async getStock(eventId) {
    const stock = await redis.eval(
      luaScripts.GET_STOCK,
      1,
      stockKey(eventId)
    );

    if (stock === -1) {
      // Stock not in Redis, try to initialize from DB
      await this.initializeStock(eventId);
      return this.getStock(eventId);
    }

    return stock;
  }

  /**
   * Reserve tickets for a user.
   * This is the primary flash-sale endpoint logic.
   * 
   * @param {string} eventId - Event UUID
   * @param {string} userId  - User UUID
   * @param {number} quantity - Number of tickets to reserve (default: 1)
   * @returns {Promise<{success: boolean, bookingId?: string, message: string, status: number}>}
   */
  async reserveTickets(eventId, userId, quantity = 1) {
    const bookingId = uuidv4();

    // Build the job payload for the background worker
    const jobPayload = JSON.stringify({
      bookingId,
      eventId,
      userId,
      quantity,
      timestamp: Date.now(),
    });

    // Execute the atomic Lua script in Redis
    const result = await redis.eval(
      luaScripts.RESERVE_TICKET,
      3,                                              // number of KEYS
      stockKey(eventId),                              // KEYS[1]
      lockKey(eventId, userId),                       // KEYS[2]
      PENDING_QUEUE,                                  // KEYS[3]
      quantity,                                       // ARGV[1]
      config.reservation.ttlSeconds,                  // ARGV[2]
      jobPayload                                      // ARGV[3]
    );

    switch (result) {
      case 1:
        logger.info('Ticket reserved successfully', { bookingId, eventId, userId, quantity });
        // On serverless environments (Vercel) without background workers, persist synchronously
        if (process.env.VERCEL) {
          try {
            const { processBooking } = require('../worker');
            await processBooking({ bookingId, eventId, userId, quantity, timestamp: Date.now() });
          } catch (err) {
            logger.warn('Direct persist in serverless mode failed', { error: err.message });
          }
        }
        return {
          success: true,
          bookingId,
          message: 'Tickets reserved! Complete payment within 7 minutes.',
          status: 201,
          expiresIn: config.reservation.ttlSeconds,
        };

      case -1:
        logger.warn('Duplicate reservation attempt', { eventId, userId });
        return {
          success: false,
          message: 'You already have an active reservation for this event.',
          status: 409,
        };

      case -2:
        logger.info('Sold out', { eventId, userId });
        return {
          success: false,
          message: 'Sold Out! All tickets have been claimed.',
          status: 410,
        };

      case -3:
        return {
          success: false,
          message: 'Invalid ticket quantity.',
          status: 400,
        };

      default:
        logger.error('Unexpected Lua script result', { result });
        return {
          success: false,
          message: 'Internal server error.',
          status: 500,
        };
    }
  }

  /**
   * Cancel/release a reservation, returning tickets to stock.
   * @param {string} eventId
   * @param {string} userId
   * @returns {Promise<{success: boolean, message: string, status: number}>}
   */
  async cancelReservation(eventId, userId) {
    const result = await redis.eval(
      luaScripts.RELEASE_RESERVATION,
      2,
      stockKey(eventId),
      lockKey(eventId, userId)
    );

    if (result === -1) {
      return {
        success: false,
        message: 'No active reservation found.',
        status: 404,
      };
    }

    logger.info('Reservation cancelled', { eventId, userId, released: result });

    // Update booking status in DB
    await query(
      `UPDATE bookings SET status = 'cancelled' 
       WHERE event_id = $1 AND user_id = $2 AND status = 'reserved'`,
      [eventId, userId]
    );

    return {
      success: true,
      message: `Reservation cancelled. ${result} ticket(s) returned to pool.`,
      released: result,
      status: 200,
    };
  }

  /**
   * Get reservation status for a user on an event.
   * @param {string} eventId
   * @param {string} userId
   * @returns {Promise<{reserved: boolean, quantity?: number, ttl?: number}>}
   */
  async getReservationStatus(eventId, userId) {
    const key = lockKey(eventId, userId);
    const [reserved, ttl] = await Promise.all([
      redis.get(key),
      redis.ttl(key),
    ]);

    if (!reserved) {
      return { reserved: false };
    }

    return {
      reserved: true,
      quantity: parseInt(reserved, 10),
      ttlSeconds: ttl,
    };
  }
}

module.exports = new InventoryService();
