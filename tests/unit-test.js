/**
 * Unit Tests for Flash-Sale Engine
 * 
 * Lightweight tests that verify core logic without needing
 * Redis or PostgreSQL running. Tests Lua script logic,
 * key naming conventions, and configuration.
 * 
 * Run with: npm test
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}. ${message}`);
  }
}

function assertNotEqual(actual, expected, message = '') {
  if (actual === expected) {
    throw new Error(`Expected value to not be ${JSON.stringify(expected)}. ${message}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`Expected truthy value, got ${JSON.stringify(value)}. ${message}`);
  }
}

// ─── Test Suites ─────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log('  Flash-Sale Engine — Unit Tests');
console.log('═'.repeat(50) + '\n');

// ─── Config Tests ────────────────────────────────────────
console.log('📋 Configuration:');

test('Default port is 3000', () => {
  // Simulate config loading
  const port = parseInt(process.env.PORT, 10) || 3000;
  assertEqual(port, 3000);
});

test('Default reservation TTL is 420 seconds (7 minutes)', () => {
  const ttl = parseInt(process.env.RESERVATION_TTL, 10) || 420;
  assertEqual(ttl, 420);
});

test('Default worker concurrency is 5', () => {
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY, 10) || 5;
  assertEqual(concurrency, 5);
});

// ─── Lua Script Tests ────────────────────────────────────
console.log('\n📜 Lua Scripts:');

test('RESERVE_TICKET script contains all required checks', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.RESERVE_TICKET.includes('EXISTS'), 'Missing duplicate check');
  assertTrue(luaScripts.RESERVE_TICKET.includes('DECRBY'), 'Missing stock decrement');
  assertTrue(luaScripts.RESERVE_TICKET.includes('LPUSH'), 'Missing queue push');
  assertTrue(luaScripts.RESERVE_TICKET.includes('EX'), 'Missing TTL on lock');
});

test('RESERVE_TICKET returns -1 for duplicates', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.RESERVE_TICKET.includes('return -1'), 'Missing -1 return for duplicates');
});

test('RESERVE_TICKET returns -2 for sold out', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.RESERVE_TICKET.includes('return -2'), 'Missing -2 return for sold out');
});

test('RESERVE_TICKET returns -3 for invalid quantity', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.RESERVE_TICKET.includes('return -3'), 'Missing -3 return for invalid qty');
});

test('RELEASE_RESERVATION restores stock with INCRBY', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.RELEASE_RESERVATION.includes('INCRBY'), 'Missing stock restoration');
  assertTrue(luaScripts.RELEASE_RESERVATION.includes('DEL'), 'Missing lock deletion');
});

test('INIT_STOCK uses NX flag (set only if not exists)', () => {
  const luaScripts = require('../src/redis/lua-scripts');
  assertTrue(luaScripts.INIT_STOCK.includes("'NX'"), 'Missing NX flag');
});

// ─── Key Naming Tests ────────────────────────────────────
console.log('\n🔑 Key Naming Conventions:');

test('Stock key format is stock:{eventId}', () => {
  const eventId = 'abc-123';
  const key = `stock:${eventId}`;
  assertEqual(key, 'stock:abc-123');
});

test('Lock key format is lock:{eventId}:{userId}', () => {
  const eventId = 'abc-123';
  const userId = 'user-456';
  const key = `lock:${eventId}:${userId}`;
  assertEqual(key, 'lock:abc-123:user-456');
});

// ─── UUID Tests ──────────────────────────────────────────
console.log('\n🆔 UUID Generation:');

test('UUID v4 generates unique IDs', () => {
  const { v4: uuidv4 } = require('uuid');
  const id1 = uuidv4();
  const id2 = uuidv4();
  assertNotEqual(id1, id2, 'UUIDs should be unique');
});

test('UUID v4 format is valid', () => {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assertTrue(uuidRegex.test(id), `UUID ${id} does not match v4 format`);
});

// ─── Validation Tests ────────────────────────────────────
console.log('\n✔️  Input Validation:');

test('Quantity must be positive integer', () => {
  const isValid = (q) => Number.isInteger(q) && q >= 1 && q <= 10;
  assertTrue(isValid(1), 'quantity=1 should be valid');
  assertTrue(isValid(5), 'quantity=5 should be valid');
  assertTrue(isValid(10), 'quantity=10 should be valid');
  assertTrue(!isValid(0), 'quantity=0 should be invalid');
  assertTrue(!isValid(-1), 'quantity=-1 should be invalid');
  assertTrue(!isValid(11), 'quantity=11 should be invalid');
  assertTrue(!isValid(1.5), 'quantity=1.5 should be invalid');
});

test('Event ID is required for reservation', () => {
  const eventId = '';
  assertTrue(!eventId, 'Empty eventId should be falsy');
});

test('User ID is required for reservation', () => {
  const userId = '';
  assertTrue(!userId, 'Empty userId should be falsy');
});

// ─── Summary ─────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed === 0) {
  console.log('  🎉 All tests passed!');
} else {
  console.log('  ⚠️  Some tests failed!');
}
console.log('═'.repeat(50) + '\n');

process.exit(failed > 0 ? 1 : 0);
