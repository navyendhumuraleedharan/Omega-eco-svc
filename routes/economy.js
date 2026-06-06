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

export default router;