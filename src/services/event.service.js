/**
 * Event Service
 * Handles CRUD operations for events (concerts, sales, etc.)
 */
const { query } = require('../db/pool');
const logger = require('../utils/logger');

class EventService {
  /**
   * List all active events.
   * @returns {Promise<Array>}
   */
  async listEvents() {
    const result = await query(
      `SELECT id, name, description, venue, event_date, total_tickets,
              available_stock, price_cents, sale_start, sale_end, status, created_at
       FROM events
       WHERE status = 'active' AND sale_start <= NOW()
       ORDER BY event_date ASC`
    );
    return result.rows;
  }

  /**
   * Get a single event by ID.
   * @param {string} eventId
   * @returns {Promise<Object|null>}
   */
  async getEvent(eventId) {
    const result = await query(
      `SELECT id, name, description, venue, event_date, total_tickets,
              available_stock, price_cents, sale_start, sale_end, status, created_at
       FROM events WHERE id = $1`,
      [eventId]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new event.
   * @param {Object} eventData
   * @returns {Promise<Object>} Created event
   */
  async createEvent(eventData) {
    const {
      name, description, venue, eventDate,
      totalTickets, priceCents, saleStart, saleEnd,
    } = eventData;

    const result = await query(
      `INSERT INTO events (name, description, venue, event_date, total_tickets, 
                           available_stock, price_cents, sale_start, sale_end)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
       RETURNING *`,
      [name, description, venue, eventDate, totalTickets, priceCents, saleStart, saleEnd]
    );

    logger.info('Event created', { eventId: result.rows[0].id, name });
    return result.rows[0];
  }

  /**
   * Get bookings for a specific event.
   * @param {string} eventId
   * @returns {Promise<Array>}
   */
  async getEventBookings(eventId) {
    const result = await query(
      `SELECT b.id, b.user_id, u.username, b.quantity, b.status,
              b.total_cents, b.created_at, b.confirmed_at, b.expires_at
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.event_id = $1
       ORDER BY b.created_at ASC`,
      [eventId]
    );
    return result.rows;
  }
}

module.exports = new EventService();
