/**
 * Database Migration Script
 * Creates all required tables for the flash-sale engine.
 * Run with: npm run migrate
 */
const { pool, query } = require('./pool');
const logger = require('../utils/logger');

const migration = `
  -- Enable UUID extension
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- ============================================
  -- USERS TABLE
  -- ============================================
  CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(100) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );

  -- Index for fast user lookups
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- ============================================
  -- EVENTS TABLE
  -- ============================================
  CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    venue           VARCHAR(255),
    event_date      TIMESTAMPTZ NOT NULL,
    total_tickets   INTEGER NOT NULL CHECK (total_tickets >= 0),
    available_stock INTEGER NOT NULL CHECK (available_stock >= 0),
    price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
    sale_start      TIMESTAMPTZ NOT NULL,
    sale_end        TIMESTAMPTZ,
    status          VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'sold_out', 'completed')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ============================================
  -- BOOKINGS TABLE
  -- ============================================
  CREATE TABLE IF NOT EXISTS bookings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID NOT NULL REFERENCES events(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    status          VARCHAR(20) DEFAULT 'reserved'
                    CHECK (status IN ('reserved', 'confirmed', 'cancelled', 'expired')),
    reservation_key VARCHAR(255),
    total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ
  );

  -- Prevent duplicate bookings per user per event
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_user_event
    ON bookings(event_id, user_id) WHERE status IN ('reserved', 'confirmed');

  -- Index for worker queue processing
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  CREATE INDEX IF NOT EXISTS idx_bookings_event ON bookings(event_id);

  -- ============================================
  -- AUDIT LOG TABLE (optional but recommended)
  -- ============================================
  CREATE TABLE IF NOT EXISTS booking_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    booking_id  UUID REFERENCES bookings(id),
    event_id    UUID REFERENCES events(id),
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    details     JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
`;

async function migrate() {
  logger.info('Starting database migration...');
  try {
    await query(migration);
    logger.info('Migration completed successfully');
  } catch (err) {
    logger.error('Migration failed', { error: err.message, stack: err.stack });
    throw err;
  } finally {
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
