import request from 'supertest';
import app from '../server.js'; 
import pool from '../db.js';   

describe('Wallet & Idempotency Concurrency Integration Tests', () => {
    
    // Clean up test data after the tests run to keep the DB pristine
    afterAll(async () => {
        await pool.query("DELETE FROM processed_requests WHERE player_id LIKE 'test_player_%'");
        await pool.query("DELETE FROM accounts WHERE player_id LIKE 'test_player_%'");
        await pool.query("DELETE FROM inventory WHERE player_id LIKE 'test_player_%'");
        await pool.query("DELETE FROM ledger WHERE player_id LIKE 'test_player_%'");
        await pool.end();    });

    describe('POST /v1/wallets/:playerId/purchase - Duplicate & Concurrency', () => {
        
        let playerId;
        let initialBalance = 500;
        let itemPrice = 100;

        beforeEach(async () => {
            // Setup a fresh player with a known balance before each test case
            playerId = `test_player_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            
            await pool.query(
                `INSERT INTO accounts (player_id, balance) VALUES ($1, $2)`,
                [playerId, initialBalance]
            );
        });

        /**
         * Test 1: Sequential Duplicate Requests (Standard Idempotency)
         * Sends request 1, waits for it to finish, then sends request 2 with the same key.
         */
        it('should return a cached response and deduct funds only once for sequential duplicate requests', async () => {
            const idempotencyKey = `seq_key_${playerId}`;
            const purchasePayload = { itemId: 'legendary_shield', price: itemPrice };

            // 1. Send the first request and wait for success
            const response1 = await request(app)
                .post(`/v1/wallets/${playerId}/purchase`)
                .set('Idempotency-Key', idempotencyKey)
                .send(purchasePayload);

            expect(response1.status).toBe(200);
            expect(response1.body.remainingBalance).toBe(initialBalance - itemPrice);

            // 2. Send the exact same request with the same key sequentially
            const response2 = await request(app)
                .post(`/v1/wallets/${playerId}/purchase`)
                .set('Idempotency-Key', idempotencyKey)
                .send(purchasePayload);

            // Expect identical 200 payload back due to idempotency tracking
            expect(response2.status).toBe(200);
            expect(response2.body).toEqual(response1.body);

            // 3. Double check database integrity: The balance must only drop ONCE
            const dbCheck = await pool.query('SELECT balance FROM accounts WHERE player_id = $1', [playerId]);
            expect(dbCheck.rows[0].balance).toBe(initialBalance - itemPrice);
            
            // Check inventory table: quantity should be exactly 1
            const invCheck = await pool.query('SELECT quantity FROM inventory WHERE player_id = $1', [playerId]);
            expect(invCheck.rows[0].quantity).toBe(1);
        });

        /**
         * Test 2: Concurrent Purchase Requests (Race Condition / In-Flight Locking)
         * Fires multiple requests at the exact same time using Promise.all().
         */
        it('should safely handle rapid concurrent requests, returning either a 200 or 409, and never double-deducting', async () => {
            const idempotencyKey = `concur_key_${playerId}`;
            const purchasePayload = { itemId: 'shadow_boots', price: itemPrice };

            // Fire 3 identical requests completely in parallel
            const concurrentRequests = [
                request(app).post(`/v1/wallets/${playerId}/purchase`).set('Idempotency-Key', idempotencyKey).send(purchasePayload),
                request(app).post(`/v1/wallets/${playerId}/purchase`).set('Idempotency-Key', idempotencyKey).send(purchasePayload),
                request(app).post(`/v1/wallets/${playerId}/purchase`).set('Idempotency-Key', idempotencyKey).send(purchasePayload)
            ];

            const responses = await Promise.all(concurrentRequests);

            // Isolate status codes
            const statuses = responses.map(r => r.status);

            // Core Architectural Assertions:
            // 1. At least one request MUST succeed with 200
            expect(statuses).toContain(200);

            // 2. The other requests should either get a 200 (if caught after initial commit saved)
            //    or a 409 Conflict (if caught mid-flight during execution processing)
            responses.forEach(res => {
                expect([200, 409]).toContain(res.status);
                if (res.status === 409) {
                    expect(res.body.error).toBe('Concurrent Request');
                }
            });

            // 3. Absolute Sanity Audit: Check database state to confirm NO multi-deductions occurred
            const accountRecord = await pool.query('SELECT balance FROM accounts WHERE player_id = $1', [playerId]);
            expect(accountRecord.rows[0].balance).toBe(initialBalance - itemPrice);

            const inventoryRecord = await pool.query('SELECT quantity FROM inventory WHERE player_id = $1', [playerId]);
            expect(inventoryRecord.rows[0].quantity).toBe(1);

            const ledgerRecords = await pool.query('SELECT * FROM ledger WHERE player_id = $1', [playerId]);
            expect(ledgerRecords.rows.length).toBe(1); // Only 1 audit log entry generated!
        });
    });
});