import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import {
  Market,
  Trade,
  Order,
  Orderbook,
  Resolution,
  OracleUpdate,
  Candle,
  CandleInterval,
} from '../normalize/types.js';

const logger = createLogger('database');

/**
 * Base database interface
 */
export interface Database {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Migrations
  runMigrations(): Promise<void>;

  // Markets
  insertMarket(market: Market): Promise<void>;
  updateMarket(marketId: string, updates: Partial<Market>): Promise<void>;
  getMarket(marketId: string): Promise<Market | null>;
  getAllMarkets(filters?: MarketFilters): Promise<Market[]>;
  deleteMarket(marketId: string): Promise<void>;

  // Trades
  insertTrade(trade: Trade): Promise<void>;
  getTrades(marketId: string, limit?: number, offset?: number): Promise<Trade[]>;
  getTradesByOutcome(outcomeId: string, limit?: number): Promise<Trade[]>;

  // Orders
  insertOrder(order: Order): Promise<void>;
  updateOrder(orderId: string, updates: Partial<Order>): Promise<void>;
  getOrder(orderId: string): Promise<Order | null>;
  getOrders(marketId: string, status?: Order['status']): Promise<Order[]>;

  // Orderbook
  insertOrderbookSnapshot(orderbook: Orderbook): Promise<void>;
  getLatestOrderbook(marketId: string, outcomeId: string): Promise<Orderbook | null>;

  // Resolutions
  insertResolution(resolution: Resolution): Promise<void>;
  getResolution(marketId: string): Promise<Resolution | null>;

  // Oracle Updates
  insertOracleUpdate(update: OracleUpdate): Promise<void>;
  getOracleUpdates(marketId: string, limit?: number): Promise<OracleUpdate[]>;

  // Candles
  insertCandle(candle: Candle): Promise<void>;
  getCandles(
    marketId: string,
    outcomeId: string,
    interval: CandleInterval,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]>;

  // Utility
  query(sql: string, params?: any[]): Promise<any>;
}

export interface MarketFilters {
  status?: Market['status'];
  category?: string;
  programId?: string;
  createdAfter?: number;
  createdBefore?: number;
  limit?: number;
  offset?: number;
}

/**
 * SQLite database implementation
 */
export class SQLiteDatabase implements Database {
  private db: any = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    try {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      logger.info({ path: this.dbPath }, 'SQLite database connected');
    } catch (error) {
      logger.error({ error }, 'Failed to connect to SQLite');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('SQLite database disconnected');
    }
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async runMigrations(): Promise<void> {
    logger.info('Running SQLite migrations');

    const migrations = [
      // Markets table
      `CREATE TABLE IF NOT EXISTS markets (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL,
        address TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        status TEXT NOT NULL,
        creator TEXT NOT NULL,
        resolver TEXT,
        resolution_source TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        resolved_at INTEGER,
        winning_outcome TEXT,
        total_volume TEXT NOT NULL,
        total_liquidity TEXT NOT NULL,
        min_stake TEXT,
        max_stake TEXT,
        fee REAL,
        metadata TEXT,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

      // Outcomes table
      `CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        probability REAL NOT NULL,
        volume TEXT NOT NULL,
        liquidity TEXT NOT NULL,
        last_price REAL,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Trades table
      `CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        trader TEXT NOT NULL,
        side TEXT NOT NULL,
        amount TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        signature TEXT NOT NULL,
        slot INTEGER NOT NULL,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Orders table
      `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        trader TEXT NOT NULL,
        side TEXT NOT NULL,
        amount TEXT NOT NULL,
        price REAL NOT NULL,
        filled TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Orderbook snapshots table
      `CREATE TABLE IF NOT EXISTS orderbook_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        bids TEXT NOT NULL,
        asks TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Resolutions table
      `CREATE TABLE IF NOT EXISTS resolutions (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL UNIQUE,
        winning_outcome TEXT NOT NULL,
        resolver TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        signature TEXT NOT NULL,
        proof TEXT,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Oracle updates table
      `CREATE TABLE IF NOT EXISTS oracle_updates (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        oracle_address TEXT NOT NULL,
        oracle_type TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence TEXT,
        timestamp INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        signature TEXT NOT NULL,
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Candles table
      `CREATE TABLE IF NOT EXISTS candles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        market_id TEXT NOT NULL,
        outcome_id TEXT NOT NULL,
        interval TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        open REAL NOT NULL,
        high REAL NOT NULL,
        low REAL NOT NULL,
        close REAL NOT NULL,
        volume TEXT NOT NULL,
        trades INTEGER NOT NULL,
        UNIQUE(market_id, outcome_id, interval, timestamp),
        FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE
      )`,

      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status)`,
      `CREATE INDEX IF NOT EXISTS idx_markets_program_id ON markets(program_id)`,
      `CREATE INDEX IF NOT EXISTS idx_markets_created_at ON markets(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_outcomes_market_id ON outcomes(market_id)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_market_id ON trades(market_id)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_outcome_id ON trades(outcome_id)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_market_id ON orders(market_id)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_trader ON orders(trader)`,
      `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
      `CREATE INDEX IF NOT EXISTS idx_orderbook_market_outcome ON orderbook_snapshots(market_id, outcome_id)`,
      `CREATE INDEX IF NOT EXISTS idx_oracle_updates_market_id ON oracle_updates(market_id)`,
      `CREATE INDEX IF NOT EXISTS idx_candles_market_outcome_interval ON candles(market_id, outcome_id, interval)`,
    ];

    for (const migration of migrations) {
      try {
        this.db.exec(migration);
      } catch (error) {
        logger.error({ error, migration }, 'Migration failed');
        throw error;
      }
    }

    logger.info('SQLite migrations completed');
  }

  async insertMarket(market: Market): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO markets (
        id, program_id, address, name, description, category, status,
        creator, resolver, resolution_source, created_at, expires_at,
        resolved_at, winning_outcome, total_volume, total_liquidity,
        min_stake, max_stake, fee, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      market.id,
      market.programId,
      market.address,
      market.name,
      market.description,
      market.category || null,
      market.status,
      market.creator,
      market.resolver || null,
      market.resolutionSource || null,
      market.createdAt,
      market.expiresAt || null,
      market.resolvedAt || null,
      market.winningOutcome || null,
      market.totalVolume,
      market.totalLiquidity,
      market.minStake || null,
      market.maxStake || null,
      market.fee || null,
      market.metadata ? JSON.stringify(market.metadata) : null
    );

    // Insert outcomes
    const outcomeStmt = this.db.prepare(`
      INSERT OR REPLACE INTO outcomes (
        id, market_id, name, description, probability, volume, liquidity, last_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const outcome of market.outcomes) {
      outcomeStmt.run(
        outcome.id,
        market.id,
        outcome.name,
        outcome.description || null,
        outcome.probability,
        outcome.volume,
        outcome.liquidity,
        outcome.lastPrice || null
      );
    }
  }

  async updateMarket(marketId: string, updates: Partial<Market>): Promise<void> {
    const fields = Object.keys(updates)
      .filter((key) => key !== 'outcomes')
      .map((key) => `${this.toSnakeCase(key)} = ?`)
      .join(', ');

    if (fields.length > 0) {
      const values = Object.entries(updates)
        .filter(([key]) => key !== 'outcomes')
        .map(([, value]) => value);

      const stmt = this.db.prepare(
        `UPDATE markets SET ${fields}, updated_at = strftime('%s', 'now') WHERE id = ?`
      );
      stmt.run(...values, marketId);
    }

    // Update outcomes if provided
    if (updates.outcomes) {
      // Delete existing outcomes
      this.db.prepare(`DELETE FROM outcomes WHERE market_id = ?`).run(marketId);

      // Insert new outcomes
      const outcomeStmt = this.db.prepare(`
        INSERT INTO outcomes (
          id, market_id, name, description, probability, volume, liquidity, last_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const outcome of updates.outcomes) {
        outcomeStmt.run(
          outcome.id,
          marketId,
          outcome.name,
          outcome.description || null,
          outcome.probability,
          outcome.volume,
          outcome.liquidity,
          outcome.lastPrice || null
        );
      }
    }
  }

  async getMarket(marketId: string): Promise<Market | null> {
    const market = this.db
      .prepare('SELECT * FROM markets WHERE id = ?')
      .get(marketId);

    if (!market) return null;

    const outcomes = this.db
      .prepare('SELECT * FROM outcomes WHERE market_id = ?')
      .all(marketId);

    return this.rowToMarket(market, outcomes);
  }

  async getAllMarkets(filters: MarketFilters = {}): Promise<Market[]> {
    let query = 'SELECT * FROM markets WHERE 1=1';
    const params: any[] = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.programId) {
      query += ' AND program_id = ?';
      params.push(filters.programId);
    }

    if (filters.createdAfter) {
      query += ' AND created_at >= ?';
      params.push(filters.createdAfter);
    }

    if (filters.createdBefore) {
      query += ' AND created_at <= ?';
      params.push(filters.createdBefore);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }

    const markets = this.db.prepare(query).all(...params);

    return Promise.all(
      markets.map(async (market: any) => {
        const outcomes = this.db
          .prepare('SELECT * FROM outcomes WHERE market_id = ?')
          .all(market.id);
        return this.rowToMarket(market, outcomes);
      })
    );
  }

  async deleteMarket(marketId: string): Promise<void> {
    this.db.prepare('DELETE FROM markets WHERE id = ?').run(marketId);
  }

  async insertTrade(trade: Trade): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO trades (
        id, market_id, outcome_id, trader, side, amount, price,
        timestamp, signature, slot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trade.id,
      trade.marketId,
      trade.outcomeId,
      trade.trader,
      trade.side,
      trade.amount,
      trade.price,
      trade.timestamp,
      trade.signature,
      trade.slot
    );
  }

  async getTrades(
    marketId: string,
    limit = 100,
    offset = 0
  ): Promise<Trade[]> {
    const trades = this.db
      .prepare(
        'SELECT * FROM trades WHERE market_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
      )
      .all(marketId, limit, offset);

    return trades.map(this.rowToTrade);
  }

  async getTradesByOutcome(outcomeId: string, limit = 100): Promise<Trade[]> {
    const trades = this.db
      .prepare(
        'SELECT * FROM trades WHERE outcome_id = ? ORDER BY timestamp DESC LIMIT ?'
      )
      .all(outcomeId, limit);

    return trades.map(this.rowToTrade);
  }

  async insertOrder(order: Order): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, market_id, outcome_id, trader, side, amount, price,
        filled, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      order.id,
      order.marketId,
      order.outcomeId,
      order.trader,
      order.side,
      order.amount,
      order.price,
      order.filled,
      order.status,
      order.createdAt,
      order.updatedAt
    );
  }

  async updateOrder(orderId: string, updates: Partial<Order>): Promise<void> {
    const fields = Object.keys(updates)
      .map((key) => `${this.toSnakeCase(key)} = ?`)
      .join(', ');
    const values = Object.values(updates);

    const stmt = this.db.prepare(`UPDATE orders SET ${fields} WHERE id = ?`);
    stmt.run(...values, orderId);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    const order = this.db
      .prepare('SELECT * FROM orders WHERE id = ?')
      .get(orderId);

    return order ? this.rowToOrder(order) : null;
  }

  async getOrders(
    marketId: string,
    status?: Order['status']
  ): Promise<Order[]> {
    let query = 'SELECT * FROM orders WHERE market_id = ?';
    const params: any[] = [marketId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const orders = this.db.prepare(query).all(...params);
    return orders.map(this.rowToOrder);
  }

  async insertOrderbookSnapshot(orderbook: Orderbook): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO orderbook_snapshots (
        market_id, outcome_id, bids, asks, timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      orderbook.marketId,
      orderbook.outcomeId,
      JSON.stringify(orderbook.bids),
      JSON.stringify(orderbook.asks),
      orderbook.timestamp
    );
  }

  async getLatestOrderbook(
    marketId: string,
    outcomeId: string
  ): Promise<Orderbook | null> {
    const row = this.db
      .prepare(`
        SELECT * FROM orderbook_snapshots
        WHERE market_id = ? AND outcome_id = ?
        ORDER BY timestamp DESC LIMIT 1
      `)
      .get(marketId, outcomeId);

    if (!row) return null;

    return {
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      bids: JSON.parse(row.bids),
      asks: JSON.parse(row.asks),
      timestamp: row.timestamp,
    };
  }

  async insertResolution(resolution: Resolution): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO resolutions (
        id, market_id, winning_outcome, resolver, timestamp, slot, signature, proof
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      resolution.id,
      resolution.marketId,
      resolution.winningOutcome,
      resolution.resolver,
      resolution.timestamp,
      resolution.slot,
      resolution.signature,
      resolution.proof ? JSON.stringify(resolution.proof) : null
    );
  }

  async getResolution(marketId: string): Promise<Resolution | null> {
    const row = this.db
      .prepare('SELECT * FROM resolutions WHERE market_id = ?')
      .get(marketId);

    if (!row) return null;

    return {
      id: row.id,
      marketId: row.market_id,
      winningOutcome: row.winning_outcome,
      resolver: row.resolver,
      timestamp: row.timestamp,
      slot: row.slot,
      signature: row.signature,
      proof: row.proof ? JSON.parse(row.proof) : undefined,
    };
  }

  async insertOracleUpdate(update: OracleUpdate): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO oracle_updates (
        id, market_id, oracle_address, oracle_type, value, confidence,
        timestamp, slot, signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      update.id,
      update.marketId,
      update.oracleAddress,
      update.oracleType,
      update.value,
      update.confidence || null,
      update.timestamp,
      update.slot,
      update.signature
    );
  }

  async getOracleUpdates(marketId: string, limit = 100): Promise<OracleUpdate[]> {
    const rows = this.db
      .prepare(`
        SELECT * FROM oracle_updates WHERE market_id = ?
        ORDER BY timestamp DESC LIMIT ?
      `)
      .all(marketId, limit);

    return rows.map((row: any) => ({
      id: row.id,
      marketId: row.market_id,
      oracleAddress: row.oracle_address,
      oracleType: row.oracle_type,
      value: row.value,
      confidence: row.confidence,
      timestamp: row.timestamp,
      slot: row.slot,
      signature: row.signature,
    }));
  }

  async insertCandle(candle: Candle): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO candles (
        market_id, outcome_id, interval, timestamp, open, high, low, close, volume, trades
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      candle.marketId,
      candle.outcomeId,
      candle.interval,
      candle.timestamp,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
      candle.trades
    );
  }

  async getCandles(
    marketId: string,
    outcomeId: string,
    interval: CandleInterval,
    startTime?: number,
    endTime?: number
  ): Promise<Candle[]> {
    let query = `
      SELECT * FROM candles
      WHERE market_id = ? AND outcome_id = ? AND interval = ?
    `;
    const params: any[] = [marketId, outcomeId, interval];

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY timestamp ASC';

    const rows = this.db.prepare(query).all(...params);

    return rows.map((row: any) => ({
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      interval: row.interval,
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      trades: row.trades,
    }));
  }

  async query(sql: string, params: any[] = []): Promise<any> {
    return this.db.prepare(sql).all(...params);
  }

  // Helper methods
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  private rowToMarket(row: any, outcomes: any[]): Market {
    return {
      id: row.id,
      programId: row.program_id,
      address: row.address,
      name: row.name,
      description: row.description,
      category: row.category,
      status: row.status,
      outcomes: outcomes.map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        probability: o.probability,
        volume: o.volume,
        liquidity: o.liquidity,
        lastPrice: o.last_price,
      })),
      creator: row.creator,
      resolver: row.resolver,
      resolutionSource: row.resolution_source,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      resolvedAt: row.resolved_at,
      winningOutcome: row.winning_outcome,
      totalVolume: row.total_volume,
      totalLiquidity: row.total_liquidity,
      minStake: row.min_stake,
      maxStake: row.max_stake,
      fee: row.fee,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }

  private rowToTrade(row: any): Trade {
    return {
      id: row.id,
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      trader: row.trader,
      side: row.side,
      amount: row.amount,
      price: row.price,
      timestamp: row.timestamp,
      signature: row.signature,
      slot: row.slot,
    };
  }

  private rowToOrder(row: any): Order {
    return {
      id: row.id,
      marketId: row.market_id,
      outcomeId: row.outcome_id,
      trader: row.trader,
      side: row.side,
      amount: row.amount,
      price: row.price,
      filled: row.filled,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// Database factory and singleton
let database: Database | null = null;

export async function initializeDatabase(): Promise<Database> {
  if (database) {
    return database;
  }

  if (config.databaseType === 'sqlite') {
    database = new SQLiteDatabase(config.databasePath);
  } else {
    throw new Error(`Unsupported database type: ${config.databaseType}`);
  }

  await database.connect();
  await database.runMigrations();

  logger.info({ type: config.databaseType }, 'Database initialized');
  return database;
}

export function getDatabase(): Database {
  if (!database) {
    throw new Error('Database not initialized');
  }
  return database;
}
