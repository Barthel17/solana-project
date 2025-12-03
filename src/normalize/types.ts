import { z } from 'zod';

// ============================================================================
// Core Market Types
// ============================================================================

export const OutcomeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  probability: z.number().min(0).max(1),
  volume: z.string(), // BigInt as string
  liquidity: z.string(), // BigInt as string
  lastPrice: z.number().optional(),
});

export type Outcome = z.infer<typeof OutcomeSchema>;

export const MarketStatusSchema = z.enum([
  'active',
  'settled',
  'expired',
  'paused',
  'cancelled',
]);

export type MarketStatus = z.infer<typeof MarketStatusSchema>;

export const MarketSchema = z.object({
  id: z.string(),
  programId: z.string(),
  address: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().optional(),
  status: MarketStatusSchema,
  outcomes: z.array(OutcomeSchema),
  creator: z.string(),
  resolver: z.string().optional(),
  resolutionSource: z.string().optional(), // Oracle address
  createdAt: z.number(), // Unix timestamp
  expiresAt: z.number().optional(),
  resolvedAt: z.number().optional(),
  winningOutcome: z.string().optional(),
  totalVolume: z.string(), // BigInt as string
  totalLiquidity: z.string(), // BigInt as string
  minStake: z.string().optional(),
  maxStake: z.string().optional(),
  fee: z.number().optional(), // Basis points
  metadata: z.record(z.any()).optional(),
});

export type Market = z.infer<typeof MarketSchema>;

// ============================================================================
// Trade & Order Types
// ============================================================================

export const TradeSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  trader: z.string(),
  side: z.enum(['buy', 'sell']),
  amount: z.string(), // BigInt as string
  price: z.number(),
  timestamp: z.number(),
  signature: z.string(),
  slot: z.number(),
});

export type Trade = z.infer<typeof TradeSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcomeId: z.string(),
  trader: z.string(),
  side: z.enum(['buy', 'sell']),
  amount: z.string(),
  price: z.number(),
  filled: z.string(),
  status: z.enum(['open', 'filled', 'cancelled', 'expired']),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Order = z.infer<typeof OrderSchema>;

export const OrderbookLevelSchema = z.object({
  price: z.number(),
  amount: z.string(),
  orders: z.number(),
});

export type OrderbookLevel = z.infer<typeof OrderbookLevelSchema>;

export const OrderbookSchema = z.object({
  marketId: z.string(),
  outcomeId: z.string(),
  bids: z.array(OrderbookLevelSchema),
  asks: z.array(OrderbookLevelSchema),
  timestamp: z.number(),
});

export type Orderbook = z.infer<typeof OrderbookSchema>;

// ============================================================================
// Resolution & Oracle Types
// ============================================================================

export const OracleUpdateSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  oracleAddress: z.string(),
  oracleType: z.enum(['pyth', 'switchboard', 'custom']),
  value: z.string(),
  confidence: z.string().optional(),
  timestamp: z.number(),
  slot: z.number(),
  signature: z.string(),
});

export type OracleUpdate = z.infer<typeof OracleUpdateSchema>;

export const ResolutionSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  winningOutcome: z.string(),
  resolver: z.string(),
  timestamp: z.number(),
  slot: z.number(),
  signature: z.string(),
  proof: z.record(z.any()).optional(),
});

export type Resolution = z.infer<typeof ResolutionSchema>;

// ============================================================================
// Historical Data Types
// ============================================================================

export const CandleIntervalSchema = z.enum(['1m', '5m', '15m', '1h', '4h', '1d']);
export type CandleInterval = z.infer<typeof CandleIntervalSchema>;

export const CandleSchema = z.object({
  marketId: z.string(),
  outcomeId: z.string(),
  interval: CandleIntervalSchema,
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.string(),
  trades: z.number(),
});

export type Candle = z.infer<typeof CandleSchema>;

// ============================================================================
// Event Types (for real-time updates)
// ============================================================================

export const MarketEventTypeSchema = z.enum([
  'market_created',
  'market_updated',
  'market_resolved',
  'trade_executed',
  'order_placed',
  'order_cancelled',
  'orderbook_updated',
  'oracle_updated',
]);

export type MarketEventType = z.infer<typeof MarketEventTypeSchema>;

export const MarketEventSchema = z.object({
  type: MarketEventTypeSchema,
  timestamp: z.number(),
  slot: z.number(),
  signature: z.string().optional(),
  data: z.any(),
});

export type MarketEvent = z.infer<typeof MarketEventSchema>;

// ============================================================================
// Program Account Types (raw data before normalization)
// ============================================================================

export interface ProgramAccountData {
  programId: string;
  address: string;
  data: Buffer;
  slot: number;
}

export interface DecodedAccount {
  type: string;
  data: Record<string, any>;
}
