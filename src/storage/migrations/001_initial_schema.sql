-- Initial schema for Solana prediction market aggregator

-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  protocol TEXT NOT NULL,
  program_id TEXT NOT NULL,
  
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('binary', 'categorical', 'scalar')),
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'cancelled', 'pending', 'suspended')),
  
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP,
  resolved_at TIMESTAMP,
  
  winning_outcome TEXT,
  resolution_source TEXT,
  
  total_volume NUMERIC NOT NULL DEFAULT 0,
  volume_24h NUMERIC NOT NULL DEFAULT 0,
  total_liquidity NUMERIC NOT NULL DEFAULT 0,
  
  creator TEXT,
  resolver TEXT,
  
  raw_data JSONB,
  metadata JSONB,
  
  last_updated_slot BIGINT NOT NULL,
  last_updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for markets
CREATE INDEX IF NOT EXISTS idx_markets_protocol ON markets(protocol);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_created_at ON markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_last_updated_at ON markets(last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_title_search ON markets USING gin(to_tsvector('english', title));

-- Outcomes table
CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  
  label TEXT NOT NULL,
  probability NUMERIC NOT NULL CHECK (probability >= 0 AND probability <= 1),
  
  volume_24h NUMERIC,
  trades_24h INTEGER,
  
  metadata JSONB
);

-- Indexes for outcomes
CREATE INDEX IF NOT EXISTS idx_outcomes_market_id ON outcomes(market_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_probability ON outcomes(probability DESC);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  outcome_id TEXT NOT NULL,
  
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  quote_amount NUMERIC NOT NULL,
  
  maker TEXT,
  taker TEXT,
  
  timestamp TIMESTAMP NOT NULL,
  slot BIGINT NOT NULL,
  signature TEXT NOT NULL,
  protocol TEXT NOT NULL
);

-- Indexes for trades
CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(signature);
CREATE INDEX IF NOT EXISTS idx_trades_slot ON trades(slot);
CREATE INDEX IF NOT EXISTS idx_trades_maker ON trades(maker);
CREATE INDEX IF NOT EXISTS idx_trades_taker ON trades(taker);

-- Candles table (OHLCV data)
CREATE TABLE IF NOT EXISTS candles (
  market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  outcome_id TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  interval TEXT NOT NULL CHECK (interval IN ('1m', '5m', '15m', '1h', '4h', '1d')),
  
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  
  volume NUMERIC NOT NULL,
  trades INTEGER NOT NULL,
  
  PRIMARY KEY (market_id, outcome_id, timestamp, interval)
);

-- Indexes for candles
CREATE INDEX IF NOT EXISTS idx_candles_market_outcome ON candles(market_id, outcome_id);
CREATE INDEX IF NOT EXISTS idx_candles_timestamp ON candles(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_candles_interval ON candles(interval);

-- Oracle feeds table (for tracking oracle data)
CREATE TABLE IF NOT EXISTS oracle_feeds (
  feed_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('switchboard', 'pyth', 'custom')),
  feed_address TEXT NOT NULL,
  
  description TEXT,
  decimals INTEGER,
  
  current_value NUMERIC,
  confidence NUMERIC,
  last_update_slot BIGINT,
  last_update_timestamp TIMESTAMP,
  
  metadata JSONB
);

-- Indexes for oracle feeds
CREATE INDEX IF NOT EXISTS idx_oracle_feeds_provider ON oracle_feeds(provider);
CREATE INDEX IF NOT EXISTS idx_oracle_feeds_address ON oracle_feeds(feed_address);

-- Market resolutions table
CREATE TABLE IF NOT EXISTS market_resolutions (
  market_id TEXT PRIMARY KEY REFERENCES markets(id) ON DELETE CASCADE,
  
  resolved_at TIMESTAMP NOT NULL,
  slot BIGINT NOT NULL,
  signature TEXT NOT NULL,
  
  winning_outcome TEXT NOT NULL,
  final_probabilities JSONB,
  
  resolution_source TEXT NOT NULL,
  resolution_data JSONB,
  
  payout_distribution JSONB
);

-- Indexes for resolutions
CREATE INDEX IF NOT EXISTS idx_resolutions_resolved_at ON market_resolutions(resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolutions_signature ON market_resolutions(signature);

