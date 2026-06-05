-- =====================================================
-- ACCOUNTS
-- One wallet per player
-- =====================================================

CREATE TABLE IF NOT EXISTS accounts (
    player_id VARCHAR(255) PRIMARY KEY,
    balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =====================================================
-- INVENTORY
-- Tracks item quantities owned by a player
-- =====================================================

CREATE TABLE IF NOT EXISTS inventory (
    player_id VARCHAR(255) NOT NULL,
    item_id VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),

    PRIMARY KEY (player_id, item_id)
);


-- =====================================================
-- CLAIMED REWARDS
-- Ensures a reward can only be claimed once per player
-- =====================================================

CREATE TABLE IF NOT EXISTS claimed_rewards (
    reward_id VARCHAR(255) NOT NULL,
    player_id VARCHAR(255) NOT NULL,
    claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (reward_id, player_id)
);


-- =====================================================
-- IDEMPOTENCY / PROCESSED REQUESTS
-- Stores already-processed requests and their responses
-- =====================================================

CREATE TABLE IF NOT EXISTS processed_requests (
    idempotency_key VARCHAR(255) PRIMARY KEY,

    player_id VARCHAR(255) NOT NULL,

    request_type VARCHAR(50) NOT NULL,

    response_status INT NOT NULL,

    response_body TEXT NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =====================================================
-- LEDGER
-- Immutable audit log of all currency movements
-- =====================================================

CREATE TABLE IF NOT EXISTS ledger (
    id BIGSERIAL PRIMARY KEY,

    player_id VARCHAR(255) NOT NULL,

    operation_type VARCHAR(50) NOT NULL,
    -- CREDIT
    -- PURCHASE_DEBIT
    -- REWARD_CREDIT

    amount INT NOT NULL,

    reference_id VARCHAR(255),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_ledger_player
ON ledger(player_id);

CREATE INDEX IF NOT EXISTS idx_processed_requests_player
ON processed_requests(player_id);

CREATE INDEX IF NOT EXISTS idx_claimed_rewards_player
ON claimed_rewards(player_id);