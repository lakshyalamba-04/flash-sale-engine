/**
 * In-Memory Database Engine
 * 
 * Provides an in-memory SQL query interface mimicking node-pg
 * for events, bookings, users, and audit logs.
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class MemoryDB {
  constructor() {
    this.users = new Map([
      ['a0000000-0000-0000-0000-000000000001', { id: 'a0000000-0000-0000-0000-000000000001', username: 'alice', email: 'alice@example.com' }],
      ['a0000000-0000-0000-0000-000000000002', { id: 'a0000000-0000-0000-0000-000000000002', username: 'bob', email: 'bob@example.com' }],
      ['a0000000-0000-0000-0000-000000000003', { id: 'a0000000-0000-0000-0000-000000000003', username: 'charlie', email: 'charlie@example.com' }],
      ['a0000000-0000-0000-0000-000000000004', { id: 'a0000000-0000-0000-0000-000000000004', username: 'diana', email: 'diana@example.com' }],
      ['a0000000-0000-0000-0000-000000000005', { id: 'a0000000-0000-0000-0000-000000000005', username: 'eve', email: 'eve@example.com' }],
    ]);

    this.events = new Map([
      [
        'e0000000-0000-0000-0000-000000000001',
        {
          id: 'e0000000-0000-0000-0000-000000000001',
          name: 'Coldplay: Music of the Spheres World Tour',
          description: 'Experience Coldplay live with their spectacular world tour!',
          venue: 'DY Patil Stadium, Mumbai',
          event_date: new Date(Date.now() + 30 * 86400000).toISOString(),
          total_tickets: 50,
          available_stock: 50,
          price_cents: 750000,
          sale_start: new Date(Date.now() - 3600000).toISOString(),
          sale_end: new Date(Date.now() + 7 * 86400000).toISOString(),
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      [
        'e0000000-0000-0000-0000-000000000002',
        {
          id: 'e0000000-0000-0000-0000-000000000002',
          name: 'Flash Sale: Premium Headphones',
          description: 'Limited stock flash sale - first come first served!',
          venue: 'Online',
          event_date: new Date().toISOString(),
          total_tickets: 100,
          available_stock: 100,
          price_cents: 299900,
          sale_start: new Date(Date.now() - 3600000).toISOString(),
          sale_end: new Date(Date.now() + 7200000).toISOString(),
          status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    ]);

    this.bookings = [];
    this.auditLog = [];
    logger.info('In-Memory Database initialized with sample seed data');
  }

  async query(sql, params = []) {
    const text = sql.trim();
    const upper = text.toUpperCase();

    // Health check
    if (upper.includes('SELECT 1')) {
      return { rows: [{ check: 1 }] };
    }

    // Begin / Commit / Rollback
    if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
      return { rows: [] };
    }

    // Migrations / DDL no-ops
    if (upper.startsWith('CREATE') || upper.startsWith('--') || upper.startsWith('ALTER')) {
      return { rows: [] };
    }

    // Delete statements
    if (upper.startsWith('DELETE FROM')) {
      if (upper.includes('BOOKING_AUDIT_LOG')) this.auditLog = [];
      if (upper.includes('BOOKINGS')) this.bookings = [];
      return { rows: [] };
    }

    // SELECT available_stock FROM events WHERE id = $1
    if (upper.includes('FROM EVENTS') && upper.includes('WHERE ID = $1')) {
      const eventId = params[0];
      const event = this.events.get(eventId);
      if (!event) return { rows: [] };
      return { rows: [{ ...event }] };
    }

    // SELECT ... FROM events WHERE status = 'active'
    if (upper.includes('FROM EVENTS') && !upper.includes('WHERE ID = $1')) {
      const activeEvents = Array.from(this.events.values()).filter((e) => e.status === 'active');
      return { rows: activeEvents };
    }

    // INSERT INTO bookings
    if (upper.startsWith('INSERT INTO BOOKINGS')) {
      const [bookingId, eventId, userId, quantity, totalCents, resKey] = params;
      const existingIdx = this.bookings.findIndex(
        (b) => b.event_id === eventId && b.user_id === userId && (b.status === 'reserved' || b.status === 'confirmed')
      );

      const bookingRecord = {
        id: bookingId || uuidv4(),
        event_id: eventId,
        user_id: userId,
        quantity,
        status: 'reserved',
        total_cents: totalCents,
        reservation_key: resKey,
        created_at: new Date().toISOString(),
      };

      if (existingIdx >= 0) {
        this.bookings[existingIdx] = bookingRecord;
      } else {
        this.bookings.push(bookingRecord);
      }
      return { rows: [bookingRecord] };
    }

    // UPDATE events SET available_stock = available_stock - $1
    if (upper.startsWith('UPDATE EVENTS')) {
      const quantity = params[0];
      const eventId = params[1];
      const event = this.events.get(eventId);
      if (event) {
        event.available_stock = Math.max(0, event.available_stock - quantity);
        event.updated_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    // INSERT INTO booking_audit_log
    if (upper.startsWith('INSERT INTO BOOKING_AUDIT_LOG')) {
      const [bookingId, eventId, userId, action, details] = params;
      const logEntry = {
        id: this.auditLog.length + 1,
        booking_id: bookingId,
        event_id: eventId,
        user_id: userId,
        action,
        details,
        created_at: new Date().toISOString(),
      };
      this.auditLog.push(logEntry);
      return { rows: [logEntry] };
    }

    // UPDATE bookings SET status = 'cancelled'
    if (upper.startsWith('UPDATE BOOKINGS SET STATUS = \'CANCELLED\'')) {
      const [eventId, userId] = params;
      const booking = this.bookings.find(
        (b) => b.event_id === eventId && b.user_id === userId && b.status === 'reserved'
      );
      if (booking) {
        booking.status = 'cancelled';
      }
      return { rows: [] };
    }

    // SELECT b.id, b.user_id ... FROM bookings b
    if (upper.includes('FROM BOOKINGS')) {
      const eventId = params[0];
      const eventBookings = this.bookings
        .filter((b) => !eventId || b.event_id === eventId)
        .map((b) => {
          const u = this.users.get(b.user_id) || { username: 'unknown' };
          return { ...b, username: u.username };
        });
      return { rows: eventBookings };
    }

    // Generic fallback
    return { rows: [] };
  }

  getClient() {
    return {
      query: (sql, params) => this.query(sql, params),
      release: () => {},
    };
  }

  async end() {
    return true;
  }
}

// Singleton database instance
let sharedMemoryDb = null;

const getSharedMemoryDb = () => {
  if (!sharedMemoryDb) {
    sharedMemoryDb = new MemoryDB();
  }
  return sharedMemoryDb;
};

module.exports = { MemoryDB, getSharedMemoryDb };
