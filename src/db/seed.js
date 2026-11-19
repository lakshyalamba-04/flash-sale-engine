/**
 * Database Seed Script
 * Populates the database with sample events and users for testing.
 * Run with: npm run seed
 */
const { pool, query } = require('./pool');
const logger = require('../utils/logger');

const seedData = async () => {
  logger.info('Seeding database...');

  try {
    // Clear existing data (dev only)
    await query('DELETE FROM booking_audit_log');
    await query('DELETE FROM bookings');
    await query('DELETE FROM events');
    await query('DELETE FROM users');

    // Insert sample users
    const userInsert = `
      INSERT INTO users (id, username, email) VALUES
        ('a0000000-0000-0000-0000-000000000001', 'alice',   'alice@example.com'),
        ('a0000000-0000-0000-0000-000000000002', 'bob',     'bob@example.com'),
        ('a0000000-0000-0000-0000-000000000003', 'charlie', 'charlie@example.com'),
        ('a0000000-0000-0000-0000-000000000004', 'diana',   'diana@example.com'),
        ('a0000000-0000-0000-0000-000000000005', 'eve',     'eve@example.com')
      ON CONFLICT DO NOTHING;
    `;
    await query(userInsert);
    logger.info('Inserted 5 sample users');

    // Insert sample events
    const eventInsert = `
      INSERT INTO events (id, name, description, venue, event_date, total_tickets, available_stock, price_cents, sale_start, sale_end) VALUES
        (
          'e0000000-0000-0000-0000-000000000001',
          'Coldplay: Music of the Spheres World Tour',
          'Experience Coldplay live with their spectacular world tour!',
          'DY Patil Stadium, Mumbai',
          NOW() + INTERVAL '30 days',
          50,
          50,
          750000,
          NOW() - INTERVAL '1 hour',
          NOW() + INTERVAL '7 days'
        ),
        (
          'e0000000-0000-0000-0000-000000000002',
          'Flash Sale: Premium Headphones',
          'Limited stock flash sale - first come first served!',
          'Online',
          NOW(),
          100,
          100,
          299900,
          NOW() - INTERVAL '1 hour',
          NOW() + INTERVAL '2 hours'
        ),
        (
          'e0000000-0000-0000-0000-000000000003',
          'Tatkal Railway Booking Simulation',
          'High-demand tatkal-style booking with extreme concurrency.',
          'Indian Railways',
          NOW() + INTERVAL '1 day',
          10,
          10,
          50000,
          NOW() - INTERVAL '10 minutes',
          NOW() + INTERVAL '30 minutes'
        )
      ON CONFLICT DO NOTHING;
    `;
    await query(eventInsert);
    logger.info('Inserted 3 sample events');

    logger.info('Database seeding completed successfully!');
  } catch (err) {
    logger.error('Seeding failed', { error: err.message });
    throw err;
  } finally {
    await pool.end();
  }
};

seedData().catch(() => process.exit(1));
