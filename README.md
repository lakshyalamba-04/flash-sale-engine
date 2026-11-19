# ⚡ High-Concurrency Flash-Sale & Ticket Inventory Engine

Enterprise-grade backend infrastructure designed to handle sudden, massive traffic spikes — flash sales, concert tickets, tatkal-style bookings — without crashing the database or overselling inventory.

## 🌐 Interactive Web Dashboard

Open **`http://localhost:3000`** in any browser to launch the live graphical dashboard:
- **Live Inventory Gauge**: Real-time stock counter and visual progress bar polling Redis RAM.
- **Instant Booking Panel**: Single-click reservation with simulated user identities and a 7-minute TTL countdown timer.
- **Interactive Concurrency Stress Tester**: Fire 25, 50, 100, or 500 concurrent requests right from the browser to verify zero overselling with instant visual telemetry.
- **One-Click Stock Reset**: Instant reset of Redis inventory back to 50 for repeated testing.

## 🎯 Core Problem It Solves

| Problem | Traditional Approach | This Engine |
|---|---|---|
| **Race Conditions (Overselling)** | 10,000 users buy the last 5 tickets simultaneously — all threads see stock available | Atomic Lua script in Redis guarantees exactly N tickets sold |
| **Database Deadlocks** | `SELECT ... FOR UPDATE` causes row-level lock contention under load | Redis handles all real-time stock ops; DB writes are decoupled via queue |
| **Connection Pool Exhaustion** | Every concurrent request holds a DB connection | Only the background worker touches PostgreSQL at a throttled pace |

## 🏗 Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │              API Gateway (Express)              │
                    │         Helmet · CORS · Rate Limiting           │
                    └────────────────────┬────────────────────────────┘
                                         │
                              POST /api/bookings/reserve
                                         │
                    ┌────────────────────▼────────────────────────────┐
                    │           Redis (In-Memory Fast Tier)           │
                    │                                                 │
                    │  ┌─────────────────────────────────────────┐    │
                    │  │    Atomic Lua Script (< 2ms)            │    │
                    │  │                                         │    │
                    │  │  1. CHECK  lock:{eventId}:{userId}      │    │
                    │  │  2. CHECK  stock:{eventId} >= quantity   │    │
                    │  │  3. DECRBY stock:{eventId}              │    │
                    │  │  4. SET    lock (7-min TTL)             │    │
                    │  │  5. LPUSH  pending_bookings (FIFO)      │    │
                    │  └─────────────────────────────────────────┘    │
                    └────────────────────┬────────────────────────────┘
                                         │
                                  BLPOP (blocking)
                                         │
                    ┌────────────────────▼────────────────────────────┐
                    │          Background Worker (Node.js)            │
                    │                                                 │
                    │  • Consumes jobs at a safe, throttled pace      │
                    │  • Retry logic (3x) + dead-letter queue         │
                    │  • Concurrent processing with configurable cap  │
                    └────────────────────┬────────────────────────────┘
                                         │
                                   INSERT/UPDATE
                                         │
                    ┌────────────────────▼────────────────────────────┐
                    │         PostgreSQL (Persistent Storage)         │
                    │                                                 │
                    │  • Events, Users, Bookings, Audit Log           │
                    │  • ACID-compliant transactions                  │
                    │  • Unique constraint: 1 booking per user/event  │
                    └─────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
flash-sale-engine/
├── docker-compose.yml          # Redis + PostgreSQL containers
├── .env.example                # Environment variable template
├── package.json
│
├── src/
│   ├── server.js               # Express API gateway (main entry)
│   ├── worker.js               # Background queue consumer
│   │
│   ├── config/
│   │   └── index.js            # Centralized configuration
│   │
│   ├── db/
│   │   ├── pool.js             # PostgreSQL connection pool
│   │   ├── migrate.js          # Schema migration script
│   │   └── seed.js             # Sample data seeder
│   │
│   ├── redis/
│   │   ├── client.js           # Redis client factory (ioredis)
│   │   └── lua-scripts.js      # Atomic Lua scripts
│   │
│   ├── services/
│   │   ├── inventory.service.js # Core reservation logic
│   │   └── event.service.js     # Event CRUD operations
│   │
│   ├── routes/
│   │   ├── booking.routes.js   # POST /reserve, DELETE /cancel
│   │   ├── event.routes.js     # GET/POST /events
│   │   └── health.routes.js    # GET /health
│   │
│   ├── middleware/
│   │   └── errorHandler.js     # Global error handler
│   │
│   └── utils/
│       └── logger.js           # Winston structured logging
│
└── tests/
    ├── load-test.js            # Autocannon concurrency verification
    └── unit-test.js            # Lightweight unit tests
```

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **Docker** & **Docker Compose** (for Redis + PostgreSQL)

### 1. Start Infrastructure
```bash
docker-compose up -d
```
This launches PostgreSQL (port 5432) and Redis (port 6379).

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env if needed (defaults work with docker-compose)
```

### 4. Run Database Migrations
```bash
npm run migrate
```

### 5. Seed Sample Data
```bash
npm run seed
```

### 6. Start the API Server
```bash
npm start
# Or with auto-reload:
npm run dev
```

### 7. Start the Background Worker
In a **separate terminal**:
```bash
npm run worker
```

### 8. Run the Load Test
In a **third terminal**:
```bash
npm run test:load
```

## 📡 API Endpoints

### Health Check
```
GET /health
```
Returns service health for Redis and PostgreSQL.

### Events
```
GET    /api/events              # List all active events (with live stock)
GET    /api/events/:id          # Get event details
POST   /api/events              # Create a new event
GET    /api/events/:id/bookings # Get bookings for an event
POST   /api/events/:id/init-stock # Initialize Redis stock from DB
```

### Bookings (Flash-Sale Endpoints)
```
POST   /api/bookings/reserve              # Reserve tickets (THE critical endpoint)
DELETE /api/bookings/cancel               # Cancel a reservation
GET    /api/bookings/status/:eventId/:userId  # Check reservation status
```

#### Reserve Tickets
```bash
curl -X POST http://localhost:3000/api/bookings/reserve \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "e0000000-0000-0000-0000-000000000001",
    "userId": "a0000000-0000-0000-0000-000000000001",
    "quantity": 1
  }'
```

**Success (201)**:
```json
{
  "success": true,
  "bookingId": "uuid-here",
  "message": "Tickets reserved! Complete payment within 7 minutes.",
  "status": 201,
  "expiresIn": 420
}
```

**Sold Out (410)**:
```json
{
  "success": false,
  "message": "Sold Out! All tickets have been claimed.",
  "status": 410
}
```

**Duplicate (409)**:
```json
{
  "success": false,
  "message": "You already have an active reservation for this event.",
  "status": 409
}
```

## 🧪 Load Test Results

The load test simulates a real flash-sale scenario:

| Metric | Value |
|---|---|
| Concurrent Users | 500 |
| Available Stock | 50 tickets |
| Expected 201 (Reserved) | Exactly 50 |
| Expected 410 (Sold Out) | ~450 |
| Expected Overselling | 0 |
| Expected Deadlocks | 0 |
| Avg Latency | < 5ms |
| P99 Latency | < 20ms |

## 🔑 Key Design Decisions

### Why Redis Lua Scripts?
Redis Lua scripts execute **atomically** — the entire check-and-decrement happens as a single operation within Redis's single-threaded event loop. Even with 10,000 concurrent requests, it's mathematically impossible to oversell:

```lua
-- Simplified flow of the RESERVE_TICKET script:
if EXISTS(lock) then return -1 end      -- Already reserved
stock = GET(stockKey)
if stock < quantity then return -2 end  -- Sold out
DECRBY(stockKey, quantity)              -- Atomic decrement
SET(lockKey, quantity, EX, ttl)         -- 7-min reservation
LPUSH(queue, job)                       -- Queue for DB persist
return 1                                -- Success
```

### Why a Background Worker?
The API server **never touches PostgreSQL** during the traffic spike. All database writes are deferred to the worker, which processes them at a safe pace. This prevents:
- Connection pool exhaustion
- Database deadlocks
- Cascading failures under load

### Why a 7-Minute TTL Lock?
The reservation lock gives users a 7-minute window to complete payment. If the TTL expires, the lock auto-deletes in Redis, and a cleanup process can release the tickets back to the pool.

## 🛡 Production Considerations

- **Rate Limiting**: 30 req/min per IP on booking endpoints, 100 req/min on general API
- **Helmet**: Security headers enabled by default
- **Graceful Shutdown**: SIGTERM/SIGINT handlers drain active connections before exit
- **Structured Logging**: Winston with JSON format for log aggregation
- **Dead Letter Queue**: Failed bookings (after 3 retries) are moved to a DLQ for manual review
- **Audit Trail**: Every booking action is logged to `booking_audit_log` with timestamps and metadata

## 📄 License

MIT
