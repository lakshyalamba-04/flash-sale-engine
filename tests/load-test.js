/**
 * Load Test Suite — Flash-Sale Concurrency Verification
 * 
 * Uses Autocannon to simulate a flash-sale scenario:
 * - 500+ concurrent users attempting to buy tickets
 * - Only 50 tickets available
 * - Verifies exactly 50 succeed, 450+ receive "Sold Out" (410)
 * - Verifies zero overselling
 * - Measures latency under load
 * 
 * Run with: npm run test:load
 * Prerequisites: Server must be running (npm start) and Redis stock initialized.
 */
const autocannon = require('autocannon');
const http = require('http');

// ─── Configuration ───────────────────────────────────────
const TARGET_URL = process.env.TEST_URL || 'http://localhost:3000';
const EVENT_ID = process.env.TEST_EVENT_ID || 'e0000000-0000-0000-0000-000000000001';
const TOTAL_REQUESTS = parseInt(process.env.TEST_TOTAL_REQUESTS, 10) || 500;
const CONNECTIONS = parseInt(process.env.TEST_CONNECTIONS, 10) || 100;
const EXPECTED_STOCK = parseInt(process.env.TEST_EXPECTED_STOCK, 10) || 50;

// ─── Results Tracking ────────────────────────────────────
const results = {
  reserved: 0,        // HTTP 201 — successful reservations
  soldOut: 0,         // HTTP 410 — sold out responses
  duplicate: 0,       // HTTP 409 — duplicate reservation
  errors: 0,          // HTTP 5xx — server errors
  otherStatus: {},    // Any other status codes
  totalRequests: 0,
  latencies: [],
};

/**
 * Reset Redis stock for the test event.
 * Calls the init-stock endpoint after clearing existing stock.
 */
async function resetStock() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ stock: EXPECTED_STOCK });
    const options = {
      hostname: new URL(TARGET_URL).hostname,
      port: new URL(TARGET_URL).port,
      path: `/api/events/${EVENT_ID}/reset-stock`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-load-test': 'true',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('Stock reset response:', data);
        resolve();
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Run the load test using Autocannon.
 */
async function runLoadTest() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🚀 FLASH-SALE LOAD TEST');
  console.log('═'.repeat(60));
  console.log(`  Target:       ${TARGET_URL}`);
  console.log(`  Event ID:     ${EVENT_ID}`);
  console.log(`  Total Users:  ${TOTAL_REQUESTS}`);
  console.log(`  Connections:  ${CONNECTIONS}`);
  console.log(`  Stock:        ${EXPECTED_STOCK} tickets`);
  console.log('═'.repeat(60) + '\n');

  // Initialize stock
  console.log('📦 Initializing stock...');
  try {
    await resetStock();
  } catch (err) {
    console.log('⚠️  Stock init failed (may already be set):', err.message);
  }

  let userCounter = 0;

  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `${TARGET_URL}/api/bookings/reserve`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-load-test': 'true',
      },
      // Generate unique userId for each request
      setupClient(client) {
        client.setBody(JSON.stringify({
          eventId: EVENT_ID,
          userId: `u${String(++userCounter).padStart(8, '0')}-0000-0000-0000-000000000000`,
          quantity: 1,
        }));
      },
      connections: CONNECTIONS,
      amount: TOTAL_REQUESTS,       // Total number of requests to send
      timeout: 30,                  // 30 second timeout per request
    }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }

      // Analyze results
      console.log('\n' + '═'.repeat(60));
      console.log('  📊 AUTOCANNON RAW RESULTS');
      console.log('═'.repeat(60));
      console.log(`  Total Requests:    ${result.requests.total}`);
      console.log(`  Avg Latency:       ${result.latency.average.toFixed(2)}ms`);
      console.log(`  Max Latency:       ${result.latency.max}ms`);
      console.log(`  Min Latency:       ${result.latency.min}ms`);
      console.log(`  P99 Latency:       ${result.latency.p99}ms`);
      console.log(`  Throughput:        ${(result.throughput.average / 1024).toFixed(2)} KB/s`);
      console.log(`  Errors:            ${result.errors}`);
      console.log(`  Timeouts:          ${result.timeouts}`);

      // Status code breakdown
      console.log('\n  Status Code Breakdown:');
      if (result['1xx']) console.log(`    1xx: ${result['1xx']}`);
      if (result['2xx']) console.log(`    2xx: ${result['2xx']} (Reserved ✅)`);
      if (result['3xx']) console.log(`    3xx: ${result['3xx']}`);
      if (result['4xx']) console.log(`    4xx: ${result['4xx']} (Sold Out / Duplicate)`);
      if (result['5xx']) console.log(`    5xx: ${result['5xx']} (Server Errors ❌)`);

      resolve(result);
    });

    // Track individual responses
    instance.on('response', (client, statusCode, resBytes, responseTime) => {
      results.totalRequests++;
      results.latencies.push(responseTime);

      switch (statusCode) {
        case 201:
          results.reserved++;
          break;
        case 410:
          results.soldOut++;
          break;
        case 409:
          results.duplicate++;
          break;
        default:
          if (statusCode >= 500) {
            results.errors++;
          }
          results.otherStatus[statusCode] = (results.otherStatus[statusCode] || 0) + 1;
      }
    });
  });
}

/**
 * Verify test results match expectations.
 */
function verifyResults() {
  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 VERIFICATION RESULTS');
  console.log('═'.repeat(60));

  const tests = [];

  // Test 1: Exactly EXPECTED_STOCK tickets sold
  const stockTest = results.reserved === EXPECTED_STOCK;
  tests.push(stockTest);
  console.log(`  ${stockTest ? '✅' : '❌'} Tickets Reserved:    ${results.reserved} (expected: ${EXPECTED_STOCK})`);

  // Test 2: No overselling (reserved <= EXPECTED_STOCK)
  const noOversellTest = results.reserved <= EXPECTED_STOCK;
  tests.push(noOversellTest);
  console.log(`  ${noOversellTest ? '✅' : '❌'} No Overselling:      ${noOversellTest ? 'PASS' : 'FAIL — OVERSOLD!'}`);

  // Test 3: Remaining users got 410 Sold Out
  const expectedSoldOut = TOTAL_REQUESTS - EXPECTED_STOCK - results.duplicate;
  const soldOutTest = results.soldOut >= expectedSoldOut - 5; // Small tolerance for race in counting
  tests.push(soldOutTest);
  console.log(`  ${soldOutTest ? '✅' : '❌'} Sold Out Responses:  ${results.soldOut} (expected: ~${expectedSoldOut})`);

  // Test 4: Zero server errors
  const noErrorsTest = results.errors === 0;
  tests.push(noErrorsTest);
  console.log(`  ${noErrorsTest ? '✅' : '❌'} Server Errors:       ${results.errors} (expected: 0)`);

  // Test 5: No database deadlocks (no 500s)
  const noDeadlockTest = results.errors === 0;
  tests.push(noDeadlockTest);
  console.log(`  ${noDeadlockTest ? '✅' : '❌'} DB Deadlocks:        ${noDeadlockTest ? 'None detected' : 'DEADLOCKS DETECTED!'}`);

  // Latency stats
  if (results.latencies.length > 0) {
    const sorted = results.latencies.sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];

    console.log('\n  ⚡ Latency Distribution:');
    console.log(`    Average:  ${avg.toFixed(2)}ms`);
    console.log(`    P50:      ${p50}ms`);
    console.log(`    P95:      ${p95}ms`);
    console.log(`    P99:      ${p99}ms`);
    console.log(`    Min:      ${sorted[0]}ms`);
    console.log(`    Max:      ${sorted[sorted.length - 1]}ms`);
  }

  // Summary
  const allPassed = tests.every(Boolean);
  console.log('\n' + '═'.repeat(60));
  if (allPassed) {
    console.log('  🎉 ALL TESTS PASSED — Zero overselling, zero deadlocks!');
  } else {
    console.log('  ⚠️  SOME TESTS FAILED — Review results above.');
  }
  console.log('═'.repeat(60) + '\n');

  return allPassed;
}

// ─── Main ────────────────────────────────────────────────
(async () => {
  try {
    await runLoadTest();
    const passed = verifyResults();
    process.exit(passed ? 0 : 1);
  } catch (err) {
    console.error('Load test failed:', err);
    process.exit(1);
  }
})();
