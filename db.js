import pg from 'pg';

const { Pool } = pg;

// Adaptive connection logic: uses environment URL inside docker, defaults to localhost for native testing
const connectionString = process.env.DATABASE_URL || 'postgres://game_admin:super_secure_password@localhost:5432/economy_service';

const pool = new Pool({
  connectionString,
  max: 20,                       // Maximum number of active connection clients
  idleTimeoutMillis: 30000,      // Terminate idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Drop and fail if a connection block takes over 2 seconds
});

export const query = (text, params) => pool.query(text, params);

export default pool;