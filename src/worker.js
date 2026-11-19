/**
 * Background Booking Worker
 * 
 * A decoupled Node.js process that:
 * 1. Listens on the Redis "pending_bookings" queue using BLPOP (blocking pop).
 * 2. Processes each booking job by persisting it to PostgreSQL.
 * 3. Handles failures gracefully with retry logic and dead-letter queue.
 * 
 * Architecture:
 *   Redis Queue (FIFO) ──BLPOP──→ Worker ──INSERT──→ PostgreSQL
 * 
 * This decoupling ensures the API layer never touches the database
 * during the flash-sale traffic spike. PostgreSQL writes happen at
 * a safe, throttled pace.
 * 
 * Run with: npm run worker
 */
const { createBlockingClient, redis } = require('./redis/client');
const { query, getClient } = require('./db/pool');
const config = require('./config');
const logger = require('./utils/logger');

// Prevent double execution if imported by both index.js and server.js
if (global.__WORKER_STARTED__) {
  module.exports = {};
  return;
}
global.__WORKER_STARTED__ = true;

const PENDING_QUEUE = 'pending_bookings';
const DEAD_LETTER_QUEUE = 'dead_letter_bookings';
const MAX_RETRIES = 3;

let isShuttingDown = false;
let activeJobs = 0;

/**
 * Process a single booking job.
 * Persists the reservation to PostgreSQL within a transaction.
 * 
 * @param {Object} job - Parsed job payload from Redis queue
 */
async function processBooking(job) {
  const { bookingId, eventId, userId, quantity, timestamp } = job;
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Fetch event price for total calculation
    const eventResult = await client.query(
      'SELECT price_cents, available_stock FROM events WHERE id = $1 FOR UPDATE',
      [eventId]
    );

    if (eventResult.rows.length === 0) {
      throw new Error(`Event ${eventId} not found in database`);
    }

    const { price_cents, available_stock } = eventResult.rows[0];
    const totalCents = price_cents * quantity;

    // Insert booking record
    await client.query(
      `INSERT INTO bookings (id, event_id, user_id, quantity, status, total_cents, 
                             reservation_key, expires_at)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $6, NOW() + INTERVAL '${config.reservation.ttlSeconds} seconds')
       ON CONFLICT (event_id, user_id) WHERE status IN ('reserved', 'confirmed')
       DO UPDATE SET quantity = $4, total_cents = $5, created_at = NOW()`,
      [bookingId, eventId, userId, quantity, totalCents, `lock:${eventId}:${userId}`]
    );

    // Decrement available_stock in PostgreSQL (eventual consistency with Redis)
    await client.query(
      `UPDATE events SET available_stock = available_stock - $1, updated_at = NOW()
       WHERE id = $2 AND available_stock >= $1`,
      [quantity, eventId]
    );

    // Insert audit log entry
    await client.query(
      `INSERT INTO booking_audit_log (booking_id, event_id, user_id, action, details)
       VALUES ($1, $2, $3, 'reserved', $4)`,
      [bookingId, eventId, userId, JSON.stringify({
        quantity,
        totalCents,
        reservedAt: new Date(timestamp).toISOString(),
        processedAt: new Date().toISOString(),
        processingLatencyMs: Date.now() - timestamp,
      })]
    );

    await client.query('COMMIT');

    logger.info('Booking persisted to database', {
      bookingId,
      eventId,
      userId,
      quantity,
      totalCents,
      latencyMs: Date.now() - timestamp,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Handle a job from the queue, with retry logic.
 * @param {string} rawPayload - JSON string from Redis queue
 */
async function handleJob(rawPayload) {
  activeJobs++;
  let job;

  try {
    job = JSON.parse(rawPayload);
  } catch (err) {
    logger.error('Invalid job payload, moving to dead letter queue', {
      payload: rawPayload,
      error: err.message,
    });
    await redis.lpush(DEAD_LETTER_QUEUE, rawPayload);
    activeJobs--;
    return;
  }

  const retryCount = job._retryCount || 0;

  try {
    await processBooking(job);
  } catch (err) {
    logger.error('Booking processing failed', {
      bookingId: job.bookingId,
      error: err.message,
      retryCount,
    });

    if (retryCount < MAX_RETRIES) {
      // Re-queue with retry count
      job._retryCount = retryCount + 1;
      await redis.lpush(PENDING_QUEUE, JSON.stringify(job));
      logger.warn(`Re-queued job for retry ${job._retryCount}/${MAX_RETRIES}`, {
        bookingId: job.bookingId,
      });
    } else {
      // Max retries exceeded — move to dead letter queue
      logger.error('Max retries exceeded, moving to dead letter queue', {
        bookingId: job.bookingId,
      });
      await redis.lpush(DEAD_LETTER_QUEUE, JSON.stringify(job));
    }
  } finally {
    activeJobs--;
  }
}

/**
 * Main worker loop.
 * Uses BLPOP for efficient blocking-wait on the Redis queue.
 */
async function startWorker() {
  const blockingClient = createBlockingClient();

  logger.info('🔧 Booking Worker started', {
    queue: PENDING_QUEUE,
    concurrency: config.worker.concurrency,
    pid: process.pid,
  });

  while (!isShuttingDown) {
    try {
      // BLPOP blocks until a job is available (timeout: 5 seconds)
      // Returns [queueName, value] or null on timeout
      const result = await blockingClient.blpop(PENDING_QUEUE, 5);

      if (result) {
        const [, payload] = result;
        // Process without awaiting to allow concurrent processing
        // But limit concurrency
        if (activeJobs < config.worker.concurrency) {
          handleJob(payload);  // Fire and don't await (concurrent)
        } else {
          await handleJob(payload);  // Wait if at concurrency limit
        }
      }
    } catch (err) {
      if (!isShuttingDown) {
        logger.error('Worker loop error', { error: err.message });
        // Brief pause before retry to prevent tight error loops
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  // Wait for active jobs to finish
  while (activeJobs > 0) {
    logger.info(`Waiting for ${activeJobs} active jobs to complete...`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await blockingClient.quit();
  logger.info('Worker stopped gracefully');
}

// ─── Graceful Shutdown ───────────────────────────────────
const shutdown = async (signal) => {
  logger.info(`${signal} received. Worker shutting down...`);
  isShuttingDown = true;

  // Give worker loop time to finish
  setTimeout(async () => {
    try {
      await redis.quit();
      const { pool } = require('./db/pool');
      await pool.end();
    } catch (err) {
      logger.error('Shutdown cleanup error', { error: err.message });
    }
    process.exit(0);
  }, 15000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the worker
startWorker().catch((err) => {
  logger.error('Fatal worker error', { error: err.message });
  process.exit(1);
});
