# DESIGN.md

# Architecture & Design Specifications

This document outlines the architectural patterns, data safety considerations, and core design choices implemented in the **Durable Game Economy Service**. The primary directive of this system is to maintain strict transactional integrity—ensuring that player balances, item inventories, and one-time rewards are **never lost, double-spent, or duplicated** under any failure condition.

---

## 1. Datastore Choice & Justification

### Selected Technology: **PostgreSQL (v15-alpine)**
We chose a relational database with strict ACID compliance over a NoSQL or pure key-value store for the following reasons:

* **Strong Consistency:** Game economies are inherently transactional. PostgreSQL allows us to utilize the `SERIALIZABLE` or `READ COMMITTED` isolation levels along with explicit row-level locking to prevent race conditions.
* **Write-Ahead Logging (WAL):** PostgreSQL logs every transaction to disk (via the WAL) before modifying actual data pages. This guarantees that if the host machine experiences a hard crash or power failure, any committed transaction can be completely recovered upon reboot.
* **Check Constraints & Schema Enforcement:** Hard schema constraints (e.g., `CHECK (balance >= 0)`) act as an absolute last line of defense at the database engine layer, making it physically impossible for application-layer bugs to induce illegal states like negative balances.

---

## 1.1 Database Schema & Data Integrity Constraints

The physical data model is strictly designed to guarantee structural integrity at the storage engine layer, ensuring application bugs can never corrupt state.

```text 
       [ Incoming HTTP Request with Idempotency-Key ]
                             │
                             ▼
              ┌──────────────────────────────┐
              │      processed_requests      │
              ├──────────────────────────────┤
              │ PK: idempotency_key          │
              └──────────────┬───────────────┘
                             │
               (If Unique / Lock Secured)
                             │
                             ▼
                      ┌──────────────┐
                      │   accounts   │
                      ├──────────────┤
                      │ PK:player_id │
                      └──────┬───────┘
                             │
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
   ┌────────────────┐┌────────────────┐┌────────────────┐
   │   inventory    ││claimed_rewards ││     ledger     │
   ├────────────────┤├────────────────┤├────────────────┤
   │PK: player_id,  ││PK: reward_id,  ││PK: id (Serial) │
   │    item_id     ││    player_id   ││   player_id    │
   └────────────────┘└────────────────┘└────────────────┘
``` 

### Table Definitions & Safety Mechanics

* **`accounts`**: Holds the authoritative financial state for each user.
  * *Safety Guard:* Enforces an immutable database-level engine constraint: `CHECK (balance >= 0)`. If an application edge case attempts to over-deduct a wallet, PostgreSQL forcefully throws an exception and rolls back the operation at the core engine boundary.
* **`inventory`**: Tracks item allocations using a composite primary key (`player_id`, `item_id`).
  * *Safety Guard:* Utilizes `CHECK (quantity > 0)` and handles acquisitions via `ON CONFLICT (player_id, item_id) DO UPDATE` to gracefully increment quantities atomically without duplicating rows.
* **`claimed_rewards`**: Enforces strict unique constraints on reward eligibility using a composite primary key (`reward_id`, `player_id`). This physically stops a player from claiming a one-time promo code or milestone reward multiple times.
* **`processed_requests`**: The primary data layer driving our exactly-once execution engine. It stores incoming unique `idempotency_key` strings along with their cached HTTP response body status states.
* **`ledger`**: An immutable, append-only financial audit trail tracking every single atomic movement of currency (`CREDIT`, `PURCHASE_DEBIT`, `REWARD_CREDIT`). It features no update paths, ensuring total historical traceability for troubleshooting or accounting audits.

### Indexing Optimization Strategy
To maintain stable $O(1)$ to $O(\log N)$ query lookup times as player records scale into the millions, targeted secondary indexes are built explicitly over foreign query paths:
* **`idx_ledger_player`**: Fast historical pagination audits.
* **`idx_processed_requests_player`**: Instant state tracking evaluation loops.
* **`idx_claimed_rewards_player`**: Immediate confirmation bounds for claiming flows.
---

## 2. Idempotency & Exactly-Once Strategy

To handle network retries gracefully without executing side-effects multiple times, the service mandates an `Idempotency-Key` header for all mutating endpoints (`/credit`, `/purchase`, `/claim`).

### The `processed_requests` Lifecycle
We maintain an authoritative idempotency state ledger using the `processed_requests` table:

```text 

              [ Incoming Request ]
                       │
         Is Idempotency Key in DB?
           ├─── YES ───► Status = 0 (In-Flight) ──► Return 409 Conflict
           │       └───► Status = 200 (Done)   ──► Return Cached JSON
           │
           └─── NO  ───► INSERT Key with Status = 0
                       │ (Atomic Lock Secured)
                       ▼
             Execute Core Logic
          (Balance / Inventory / Ledger)
                       │
                       ▼
             UPDATE Key Status = 200
               & Save Response Body
                       │
                       ▼
                    COMMIT
```        


### Key Retention Policy (Production Recommendation)
While keys are stored indefinitely in this reference implementation, a production engine should maintain an **8-day sliding window** for idempotency keys. This provides ample time for client retry loops to exhaust during extended outages. An automated database cron job (`pg_cron` or a Redis TTL backing layer if decoupled) can safely prune expired keys beyond this window to keep index lookups fast.

---

## 3. Atomicity, Isolation, & Durability (`kill -9` Mitigation)

### What is Atomic?
Every mutating endpoint encapsulates its multi-table adjustments inside a single SQL transaction block (`BEGIN ... COMMIT`). For instance, during a `/purchase`:
1. Checking and reserving the idempotency state.
2. Checking the balance and acquiring a row lock.
3. Updating the account balance.
4. Upserting the item inventory layout.
5. Writing an audit tracking row to the immutable `ledger`.

### Crash Behavior (`kill -9` Mid-Purchase)
If the Node.js process is forcefully terminated via `kill -9` at any point during execution:
* **Before `COMMIT`:** The database connection drops. PostgreSQL instantly detects the severed connection socket, marks the transaction as abandoned, and triggers an automated **rollback**. Balance changes are discarded, inventory is untouched, and the idempotency key reservation is wiped. It is as if the request never happened (**All-or-Nothing**).
* **After `COMMIT`:** The transaction state is securely written to disk via the PostgreSQL WAL. The state is fully durable and visible to subsequent requests immediately upon application recovery.

---

## 4. Concurrency Strategy (Handling Racing Requests)

When a single player spams rapid concurrent requests against a single wallet balance (e.g., buying two items simultaneously with funds only sufficient for one), the system mitigates race conditions using two distinct layer locks:

### Layer 1: In-Flight Idempotency Rejection (Same Request Retries)
If the identical `Idempotency-Key` is sent in rapid parallel succession, the database constraint raises a `23505 Unique Violation` on the `processed_requests` table. The application catches this error, checks if the saved status is `0` (indicating processing is already actively running mid-flight), and cleanly blocks the duplicate with a `409 Conflict` response.

### Layer 2: Row-Level Locking via `FOR UPDATE` (Different Requests, Same Wallet)
When different requests aim to modify the *same* wallet simultaneously, we execute a pessimistic row lock:

```sql
SELECT balance FROM accounts WHERE player_id = $1 FOR UPDATE;
```

This forces PostgreSQL to lock that specific player's account row. Any other concurrent transaction attempting to read or write to that specific player's balance must pause and queue sequentially behind the primary lock holder. This completely prevents lost updates or racing deductions.

---
## 5. API Contract Specifications

### Success & Error Mappings

| Endpoint | Success Code | Expected Response Body | Failure Scenarios & Codes |
| :--- | :--- | :--- | :--- |
| `POST /v1/wallets/{id}/credit` | `200 OK` | `{"playerId": "str", "balance": int, "reason": "str"}` | `400 Bad Request` (Invalid amount/missing reason) \| `409 Conflict` (Concurrent request retry) |
| `POST /v1/wallets/{id}/purchase` | `200 OK` | `{"message": "str", "playerId": "str", "itemId": "str", "remainingBalance": int}` | `400 Bad Request` (Insufficient funds/malformed payloads) \| `409 Conflict` (Concurrent request execution) |
| `POST /v1/rewards/{id}/claim` | `200 OK` | `{"message": "str", "rewardId": "str", "playerId": "str"}` | `200 OK` (Graceful fallback if reward already claimed) \| `409 Conflict` (Concurrent request) |
| `GET /v1/wallets/{id}` | `200 OK` | `{"balance": int, "inventory": [...], "claimedRewards": [...]}` | `400 Bad Request` (Missing/blank player parameter) |


### System Limits & Data Safety Bounds
* **Currency Units:** All internal representation formats map directly to **Integers**. Floating-point decimals are strictly banned across financial tracking spaces to eliminate IEEE 754 precision compounding errors.
* **Boundary Validation:** Inputs are sanity-checked before any SQL mapping layer. Credit amounts and asset prices must explicitly evaluate as `Number.isInteger(amount) && amount > 0`. This stops overflow attacks or negative value injections (`amount: -1000`) at the application perimeter.






