# README.md

# Durable Game Economy Service

A robust, crash-resilient, and transactional backend wallet and economy system designed for games. The service guarantees **exactly-once correctness under concurrent load, network retries, and abrupt application crashes (`kill -9`)** without ever losing or duplicating a player's currency or items.

Built as a minimal, high-integrity service using **Node.js (ES Modules)**, **Express**, and **PostgreSQL**.

---

## 🚀 Quick Start (Docker Compose)

The entire environment—including the API server and pre-configured PostgreSQL datastore—is completely containerized.

### 1. Bring up the Services

From the root directory containing your `docker-compose.yml`, run:

```bash
docker-compose up --build

```

This builds the application image and initializes the database container. The API layer will wait for the PostgreSQL database container to be healthy and fully execute the schema definition located inside `init.sql`.

* **API Endpoint:** `http://localhost:3000`
* **Database Port:** `http://localhost:5432`


### 2. Verify System Health

Ensure that the service and database pool are operational by hitting the diagnostic endpoint:

```bash
curl -X GET http://localhost:3000/health

```

**Expected Response:**

```json
{ "status": "UP", "database": "CONNECTED" }

```

---

## 🛠️ Local Testing & Development

If you wish to run the service locally outside of Docker for native debugging or running integration tests:

### 1. Prerequisites

* Node.js (v18+ recommended)
* A running PostgreSQL instance with a database named `economy_service` matching the credentials specified in `db.js`.

### 2. Setup Dependencies

```bash
npm install

```

### 3. Run Commands

* **Start Production Server:** `npm start`
* **Start Development (Nodemon):** `npm run dev`
* **Run Integration Tests (Jest):** `npm test`

---

## 📦 API Contract & Manual Interaction

All mutating requests (`/credit`, `/purchase`, `/claim`) **require** a unique `Idempotency-Key` header to safely resolve retry cycles.

### 1. Check Wallet Balance (`GET`)

Retrieves the target player's total currency balance, inventory layout, and an array of explicitly claimed one-time rewards.

```bash
curl -X GET http://localhost:3000/v1/wallets/player_01

```

### 2. Credit a Wallet (`POST`)

Simulates game progression rewards or battle payouts. Adds an integer currency amount to a player's balance.

```bash
curl -X POST http://localhost:3000/v1/wallets/player_01/credit \
  -H "Idempotency-Key: credit_key_1001" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "reason": "match_payout_victory"}'

```

### 3. Purchase an Item (`POST`)

Atomically debits the asset price from the wallet and appends the item to the user's inventory layout. Includes full validation boundaries to reject insufficient balances cleanly.

```bash
curl -X POST http://localhost:3000/v1/wallets/player_01/purchase \
  -H "Idempotency-Key: purchase_key_2002" \
  -H "Content-Type: application/json" \
  -d '{"itemId": "mythic_sword", "price": 150}'

```

### 4. Claim One-Time Reward (`POST`)

Enforces strict claim-once behaviors per reward ID. If the reward was previously obtained, it gracefully redirects with a standard status payload without duplicating currency credits.

```bash
curl -X POST http://localhost:3000/v1/rewards/welcome_bonus_2026/claim \
  -H "Idempotency-Key: claim_key_3003" \
  -H "Content-Type: application/json" \
  -d '{"playerId": "player_01"}'

```

---

## 🛡️ Correctness & Resilience Architecture Overview

A summary of choices made to satisfy the assessment requirements (elaborated fully inside `DESIGN.md`):

* **Datastore Choice:** **PostgreSQL** was selected for its ACID compliance, write-ahead logging (WAL) safety guarantees, and robust row-level transaction controls.
* **Atomicity & Crash Durability (`kill -9`):** All database operations run inside explicit `BEGIN ... COMMIT` blocks. If the application crashes midway through a multi-stage request (e.g., after a balance deduction but before updating the ledger), the engine automatically rolls back the partial state upon connection severing, maintaining absolute system integrity.
* **Concurrency Handling:** Row-level locks (`SELECT ... FOR UPDATE`) prevent racing parallel purchase requests from causing lost updates or generating illegal negative balances.
* **Exactly-Once Execution Strategy:** An internal `processed_requests` table records incoming idempotency keys.
* If a request is fully complete, subsequent retries receive the identically cached payload instantly.
* If a request is caught running mid-flight by an overlapping concurrent call, the tracking engine rejects the parallel call with a `409 Conflict` state status to prevent split-brain processing.



---

## 🧪 Automated Testing Overview

The service features comprehensive automated integration suites written via **Jest** and **Supertest** (`tests/wallet.test.js`).

The suites isolate test configurations using random string generators (`test_player_${Date.now()}`) and include:

1. **Sequential Idempotency Isolation:** Validates that subsequent network retries utilize matching responses without re-triggering balances or inventory adjustments.
2. **Parallel Race Conditions:** Spams concurrent executions via `Promise.all()` to assert that only exactly one processing lock secures a 200 execution state while racing loops are deflected gracefully with `409 Conflict` blocks.
3. **Database State Audit:** Programmatically validates underlying ledger, account, and inventory tables to guarantee that no phantom mutations occur behind the API response.