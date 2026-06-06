import express from 'express';
import pool from './db.js';
import economyRouter from './routes/economy.js';
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming JSON bodies automatically
app.use(express.json());


app.use(economyRouter)

// Diagnostic route to verify database connection pool validity
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.status(200).json({ status: "UP", database: "CONNECTED" });
  } catch (error) {
    res.status(500).json({ status: "DOWN", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Economy service running natively on http://localhost:${PORT}`);
});