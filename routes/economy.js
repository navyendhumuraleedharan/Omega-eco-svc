import express from 'express';
import { query } from '../db.js';

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

export default router;