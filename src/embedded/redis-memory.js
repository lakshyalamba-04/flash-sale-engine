/**
 * In-Memory Redis Engine
 * 
 * Provides an atomic in-memory emulation of Redis commands and Lua script
 * execution for standalone environments without external Redis.
 * Supports:
 * - Atomic EVAL execution for RESERVE_TICKET, RELEASE_RESERVATION, INIT_STOCK, GET_STOCK
 * - TTL-based expiration for locks
 * - Non-blocking LPUSH and BLPOP queues
 * - GET, SET, DEL, TTL, PING
 */
const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class MemoryRedis extends EventEmitter {
  constructor(name = 'memory') {
    super();
    this.name = name;
    this.data = new Map();
    this.ttls = new Map();
    this.queues = new Map();
    this.closed = false;

    // Periodic cleanup of expired keys
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 1000);
    this.cleanupTimer.unref();

    logger.info(`In-Memory Redis [${name}] initialized`);
  }

  cleanupExpired() {
    const now = Date.now();
    for (const [key, expireAt] of this.ttls.entries()) {
      if (now >= expireAt) {
        this.data.delete(key);
        this.ttls.delete(key);
        logger.debug(`Key ${key} expired in memory Redis`);
      }
    }
  }

  isExpired(key) {
    const expireAt = this.ttls.get(key);
    if (expireAt && Date.now() >= expireAt) {
      this.data.delete(key);
      this.ttls.delete(key);
      return true;
    }
    return false;
  }

  async ping() {
    return 'PONG';
  }

  async get(key) {
    if (this.isExpired(key)) return null;
    const val = this.data.get(key);
    return val !== undefined ? String(val) : null;
  }

  async set(key, value, ...args) {
    let ttlSeconds = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === 'EX' && args[i + 1] !== undefined) {
        ttlSeconds = parseInt(args[i + 1], 10);
        i++;
      } else if (arg === 'NX') {
        nx = true;
      }
    }

    if (nx && this.data.has(key) && !this.isExpired(key)) {
      return null;
    }

    this.data.set(key, value);
    if (ttlSeconds && ttlSeconds > 0) {
      this.ttls.set(key, Date.now() + ttlSeconds * 1000);
    } else {
      this.ttls.delete(key);
    }

    return 'OK';
  }

  async del(key) {
    this.ttls.delete(key);
    const existed = this.data.delete(key);
    return existed ? 1 : 0;
  }

  async ttl(key) {
    if (!this.data.has(key) || this.isExpired(key)) return -2;
    const expireAt = this.ttls.get(key);
    if (!expireAt) return -1;
    const remaining = Math.ceil((expireAt - Date.now()) / 1000);
    return remaining > 0 ? remaining : -2;
  }

  async lpush(queueKey, ...values) {
    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
    }
    const q = this.queues.get(queueKey);
    for (const val of values) {
      q.push(val);
      this.emit(`item:${queueKey}`, val);
    }
    return q.length;
  }

  async blpop(queueKey, timeoutSeconds = 5) {
    if (!this.queues.has(queueKey)) {
      this.queues.set(queueKey, []);
    }
    const q = this.queues.get(queueKey);

    if (q.length > 0) {
      const item = q.shift();
      return [queueKey, item];
    }

    return new Promise((resolve) => {
      let timer = null;

      const onItem = () => {
        if (q.length > 0) {
          cleanup();
          const item = q.shift();
          resolve([queueKey, item]);
        }
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.removeListener(`item:${queueKey}`, onItem);
      };

      if (timeoutSeconds > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve(null);
        }, timeoutSeconds * 1000);
      }

      this.on(`item:${queueKey}`, onItem);
    });
  }

  /**
   * Atomic Lua Script execution emulation in memory
   */
  async eval(script, numKeys, ...args) {
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    // 1. RESERVE_TICKET
    if (script.includes('stockKey') && script.includes('DECRBY') && script.includes('lockKey')) {
      const [stockKey, lockKey, queueKey] = keys;
      const quantity = parseInt(argv[0], 10);
      const ttl = parseInt(argv[1], 10);
      const jobPayload = argv[2];

      if (quantity <= 0) return -3;

      if (this.data.has(lockKey) && !this.isExpired(lockKey)) {
        return -1; // Duplicate
      }

      const currentStockStr = await this.get(stockKey);
      const currentStock = currentStockStr !== null ? parseInt(currentStockStr, 10) : 0;
      if (currentStock < quantity) {
        return -2; // Sold out
      }

      // Decrement stock
      const newStock = currentStock - quantity;
      this.data.set(stockKey, newStock);

      // Set lock with TTL
      await this.set(lockKey, quantity, 'EX', ttl);

      // Push to queue
      await this.lpush(queueKey, jobPayload);

      return 1;
    }

    // 2. RELEASE_RESERVATION
    if (script.includes('RELEASE_RESERVATION') || (script.includes('INCRBY') && script.includes('lockKey'))) {
      const [stockKey, lockKey] = keys;
      if (!this.data.has(lockKey) || this.isExpired(lockKey)) {
        return -1;
      }

      const reserved = parseInt(this.data.get(lockKey), 10) || 1;
      const currentStock = parseInt(await this.get(stockKey) || 0, 10);
      this.data.set(stockKey, currentStock + reserved);
      await this.del(lockKey);

      return reserved;
    }

    // 3. INIT_STOCK
    if (script.includes('INIT_STOCK') || script.includes("'NX'")) {
      const [stockKey] = keys;
      const stock = parseInt(argv[0], 10);
      if (this.data.has(stockKey)) {
        return 0;
      }
      this.data.set(stockKey, stock);
      return 1;
    }

    // 4. GET_STOCK
    if (script.includes('GET_STOCK') || script.includes('local stock = redis.call(\'GET\', stockKey)')) {
      const [stockKey] = keys;
      if (!this.data.has(stockKey)) return -1;
      return parseInt(this.data.get(stockKey), 10);
    }

    throw new Error('Unsupported Lua script in MemoryRedis');
  }

  async quit() {
    clearInterval(this.cleanupTimer);
    this.closed = true;
    return 'OK';
  }
}

// Singleton instances for shared in-process memory
let sharedMemoryClient = null;

const getSharedMemoryClient = () => {
  if (!sharedMemoryClient) {
    sharedMemoryClient = new MemoryRedis('shared');
  }
  return sharedMemoryClient;
};

module.exports = { MemoryRedis, getSharedMemoryClient };
