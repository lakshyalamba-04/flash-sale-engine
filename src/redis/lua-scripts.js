/**
 * Redis Lua Scripts for Atomic Operations
 * 
 * These Lua scripts execute atomically within Redis, guaranteeing
 * that stock checks and decrements happen as a single indivisible
 * operation — mathematically eliminating race conditions.
 * 
 * Performance: Executes in < 2ms within Redis memory.
 */

/**
 * RESERVE_TICKET Lua Script
 * 
 * Atomically:
 * 1. Checks if user already has a reservation lock
 * 2. Checks if stock is available (stock > 0)
 * 3. Decrements stock by requested quantity
 * 4. Sets a TTL-based reservation lock for the user
 * 5. Pushes a booking job to the pending queue
 * 
 * KEYS[1] = stock:{eventId}           (integer: available stock)
 * KEYS[2] = lock:{eventId}:{userId}   (reservation lock key)
 * KEYS[3] = pending_bookings          (FIFO job queue)
 * 
 * ARGV[1] = quantity requested
 * ARGV[2] = TTL in seconds for reservation lock
 * ARGV[3] = JSON payload for the booking job
 * 
 * Returns:
 *   1  = Success (reserved)
 *  -1  = Already reserved (duplicate)
 *  -2  = Sold out (insufficient stock)
 *  -3  = Invalid quantity
 */
const RESERVE_TICKET = `
  local stockKey    = KEYS[1]
  local lockKey     = KEYS[2]
  local queueKey    = KEYS[3]
  local quantity    = tonumber(ARGV[1])
  local ttl         = tonumber(ARGV[2])
  local jobPayload  = ARGV[3]

  -- Validate quantity
  if quantity <= 0 then
    return -3
  end

  -- Check for duplicate reservation
  if redis.call('EXISTS', lockKey) == 1 then
    return -1
  end

  -- Check available stock
  local currentStock = tonumber(redis.call('GET', stockKey) or 0)
  if currentStock == nil or currentStock < quantity then
    return -2
  end

  -- Atomically decrement stock
  redis.call('DECRBY', stockKey, quantity)

  -- Set reservation lock with TTL (7-minute window for payment)
  redis.call('SET', lockKey, quantity, 'EX', ttl)

  -- Push booking job to FIFO queue for background worker
  redis.call('LPUSH', queueKey, jobPayload)

  return 1
`;

/**
 * RELEASE_RESERVATION Lua Script
 * 
 * Atomically releases a reservation:
 * 1. Checks if the lock exists
 * 2. Reads the reserved quantity from the lock
 * 3. Increments stock back
 * 4. Deletes the lock
 * 
 * KEYS[1] = stock:{eventId}
 * KEYS[2] = lock:{eventId}:{userId}
 * 
 * Returns:
 *   quantity released (> 0) = Success
 *   -1                      = No reservation found
 */
const RELEASE_RESERVATION = `
  local stockKey = KEYS[1]
  local lockKey  = KEYS[2]

  -- Check if reservation exists
  local reserved = redis.call('GET', lockKey)
  if reserved == false then
    return -1
  end

  local quantity = tonumber(reserved)

  -- Restore stock
  redis.call('INCRBY', stockKey, quantity)

  -- Remove the reservation lock
  redis.call('DEL', lockKey)

  return quantity
`;

/**
 * INIT_STOCK Lua Script
 * 
 * Sets the initial stock for an event in Redis.
 * Only sets if the key does not already exist (NX).
 * 
 * KEYS[1] = stock:{eventId}
 * ARGV[1] = initial stock count
 * 
 * Returns:
 *   1  = Stock initialized
 *   0  = Stock already exists (no-op)
 */
const INIT_STOCK = `
  local stockKey = KEYS[1]
  local stock    = tonumber(ARGV[1])

  local result = redis.call('SET', stockKey, stock, 'NX')
  if result then
    return 1
  end
  return 0
`;

/**
 * GET_STOCK Lua Script
 * 
 * Returns the current stock for an event.
 * 
 * KEYS[1] = stock:{eventId}
 * 
 * Returns: current stock (integer) or -1 if not found
 */
const GET_STOCK = `
  local stockKey = KEYS[1]
  local stock = redis.call('GET', stockKey)
  if stock == false then
    return -1
  end
  return tonumber(stock)
`;

module.exports = {
  RESERVE_TICKET,
  RELEASE_RESERVATION,
  INIT_STOCK,
  GET_STOCK,
};
