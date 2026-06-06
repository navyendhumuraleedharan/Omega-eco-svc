import express from 'express';
import pool, { query } from '../db.js';

const router = express.Router();

router.get('/v1/wallets/:playerId', async (req, res) => {
    const { playerId } = req.params;

    // Validate playerId
    if (!playerId || playerId.trim() === '') {
        return res.status(400).json({
            error: 'Invalid or missing playerId parameter'
        });
    }

    try {


        const accountResult = await query(
            `
      SELECT balance
      FROM accounts
      WHERE player_id = $1
      `,
            [playerId]
        );



        const balance =
            accountResult.rows.length > 0
                ? accountResult.rows[0].balance
                : 0;


        const inventoryResult = await query(
            `
      SELECT item_id, quantity
      FROM inventory
      WHERE player_id = $1
      `,
            [playerId]
        );



        const inventory = inventoryResult.rows.map(row => ({
            itemId: row.item_id,
            quantity: row.quantity
        }));



        const rewardsResult = await query(
            `
      SELECT reward_id
      FROM claimed_rewards
      WHERE player_id = $1
      `,
            [playerId]
        );


        const claimedRewards = rewardsResult.rows.map(
            row => row.reward_id
        );


        return res.status(200).json({
            balance,
            inventory,
            claimedRewards
        });

    } catch (error) {

        console.error('Wallet lookup failed:', error);

        return res.status(500).json({
            error: 'Internal server error'
        });
    }
});


//claim rewared
router.post('/v1/rewards/:rewardId/claim', async (req, res) => {
  const { rewardId } = req.params;
  const { playerId } = req.body;

  // Validation 
  if (!rewardId || !playerId || playerId.trim() === '') {
    return res.status(400).json({ error: 'Missing rewardId in URL or playerId in request body.' });
  }

  //isolated client from our pool to handle the transaction safely
  const client = await pool.connect();

  try {
    // start database transaction block
    await client.query('BEGIN');

    //idempotency check. Attempt to record the claim event
    try {
      await client.query(
        `INSERT INTO claimed_rewards (player_id, reward_id) VALUES ($1, $2);`,
        [playerId, rewardId]
      );
    } catch (dbErr) {
      // Error Code '23505' Unique Constraint Violation
      if (dbErr.code === '23505') {
        // Cancel the transaction since they already claimed it
        await client.query('ROLLBACK');
        return res.status(200).json({ 
          message: 'Reward already claimed previously. Deduplicated gracefully.' 
        });
      }
      throw dbErr; 
    }

    //REWARD EFFECT: Credit the player with a default reward 
    await client.query(
      `INSERT INTO accounts (player_id, balance) 
       VALUES ($1, 100) 
       ON CONFLICT (player_id) 
       DO UPDATE SET balance = accounts.balance + 100;`,
      [playerId]
    );

    // Save everything permanently to the database
    await client.query('COMMIT');
    
    return res.status(200).json({ 
      message: 'Reward claimed successfully.', 
      rewardId, 
      playerId 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Reward claim transaction failure:', error);
    return res.status(500).json({ error: 'Internal system transaction failure.' });
  } finally {
    client.release();
  }
});



//Credt the wallet
router.post('/v1/wallets/:playerId/credit', async (req, res) => {
  const { playerId } = req.params;
  const { amount, reason } = req.body;

  
  if (!playerId || playerId.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid playerId parameter.' });
  }

  // amount is a number, an integer, and greater than zero
  if (typeof amount !== 'number' || amount <= 0 || !Number.isInteger(amount)) {
    return res.status(400).json({ error: 'Amount must be a positive integer greater than 0.' });
  }

  //reason is present and not just empty whitespace
  if (!reason || reason.trim() === '') {
    return res.status(400).json({ error: 'A valid reason string must be provided.' });
  }

  try {
    // Safe Database UPSERT operation
    // If the player row doesn't exist, it inserts it.
    // If it does exist, it increments the balance atomically.
    const result = await query(
      `
      INSERT INTO accounts (player_id, balance)
      VALUES ($1, $2)
      ON CONFLICT (player_id)
      DO UPDATE SET balance = accounts.balance + EXCLUDED.balance
      RETURNING balance;
      `,
      [playerId, amount]
    );

    const updatedBalance = result.rows[0].balance;

    // Log the transaction in the server console for clean tracking
    console.log(`[CREDIT] Player: ${playerId} | Added: +${amount} | New Balance: ${updatedBalance} | Reason: ${reason}`);

    return res.status(200).json({
      playerId,
      balance: updatedBalance,
      reason: reason.trim()
    });

  } catch (error) {
    console.error('Wallet credit operation failed:', error);
    return res.status(500).json({ error: 'Internal server error processing credit operation.' });
  }
});


// purchase  the inventory

router.post('/v1/wallets/:playerId/purchase', async (req, res) => {
  const { playerId } = req.params;
  const { itemId, price } = req.body;

  // Validation
  if (!playerId || playerId.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid playerId parameter.' });
  }

  if (!itemId || itemId.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid itemId in request body.' });
  }

  if (typeof price !== 'number' || price <= 0 || !Number.isInteger(price)) {
    return res.status(400).json({ error: 'Price must be a positive integer greater than 0.' });
  }

  const client = await pool.connect();

  try {
    //Start the Atomic Transaction Block
    await client.query('BEGIN');

    // Fetch current balance and lock the row to avoid data concurrency issues (FOR UPDATE)
    const accountResult = await client.query(
      `SELECT balance FROM accounts WHERE player_id = $1 FOR UPDATE;`,
      [playerId]
    );

    const currentBalance = accountResult.rows.length > 0 ? accountResult.rows[0].balance : 0;

    // INSUFFICIENT FUNDS CHECK
    if (currentBalance < price) {
      // Immediately cancel the transaction without changing anything!
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient funds',
        message: `Player has a balance of ${currentBalance}, but the item costs ${price}.`
      });
    }

    // Debit: Deduct the price from the player's wallet balance
    await client.query(
      `UPDATE accounts SET balance = balance - $1 WHERE player_id = $2;`,
      [price, playerId]
    );

    //GRANT ITEM: Atomically upsert the item into the player's inventory
    await client.query(
      `
      INSERT INTO inventory (player_id, item_id, quantity)
      VALUES ($1, $2, 1)
      ON CONFLICT (player_id, item_id)
      DO UPDATE SET quantity = inventory.quantity + 1;
      `,
      [playerId, itemId]
    );

    //Permanently commit all actions together
    await client.query('COMMIT');

    console.log(`[PURCHASE SUCCESS] Player: ${playerId} bought ${itemId} for ${price} coins.`);

    return res.status(200).json({
      message: 'Purchase completed successfully.',
      playerId,
      itemId,
      remainingBalance: currentBalance - price
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Purchase engine transaction crashed:', error);
    return res.status(500).json({ error: 'Internal system transaction failure processing purchase.' });
  } finally {
    //release the connection back to the pool
    client.release();
  }
});


export default router;