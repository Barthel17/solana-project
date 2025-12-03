import { createLogger } from '../utils/logger.js';
import {
  Market,
  Outcome,
  MarketStatus,
  Trade,
  Order,
  Orderbook,
  Resolution,
  OracleUpdate,
  Candle,
  CandleInterval,
} from './types.js';
import { z } from 'zod';

const logger = createLogger('market-normalizer');

/**
 * Service for normalizing and validating market data
 */
export class MarketNormalizer {
  /**
   * Normalize and validate a market
   */
  static normalizeMarket(data: Partial<Market>): Market {
    try {
      // Provide defaults for required fields
      const marketData: Market = {
        id: data.id || '',
        programId: data.programId || '',
        address: data.address || '',
        name: data.name || 'Unknown Market',
        description: data.description || '',
        category: data.category,
        status: data.status || 'active',
        outcomes: data.outcomes || [],
        creator: data.creator || '',
        resolver: data.resolver,
        resolutionSource: data.resolutionSource,
        createdAt: data.createdAt || Date.now(),
        expiresAt: data.expiresAt,
        resolvedAt: data.resolvedAt,
        winningOutcome: data.winningOutcome,
        totalVolume: data.totalVolume || '0',
        totalLiquidity: data.totalLiquidity || '0',
        minStake: data.minStake,
        maxStake: data.maxStake,
        fee: data.fee,
        metadata: data.metadata || {},
      };

      // Validate with zod schema
      const validated = z
        .object({
          id: z.string().min(1),
          programId: z.string().min(1),
          address: z.string().min(1),
          name: z.string().min(1),
          description: z.string(),
          status: z.enum(['active', 'settled', 'expired', 'paused', 'cancelled']),
          outcomes: z.array(z.any()),
          creator: z.string(),
        })
        .parse(marketData);

      return marketData;
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize market');
      throw error;
    }
  }

  /**
   * Normalize and validate an outcome
   */
  static normalizeOutcome(data: Partial<Outcome>): Outcome {
    try {
      const outcome: Outcome = {
        id: data.id || '',
        name: data.name || 'Unknown Outcome',
        description: data.description,
        probability: data.probability || 0,
        volume: data.volume || '0',
        liquidity: data.liquidity || '0',
        lastPrice: data.lastPrice,
      };

      // Ensure probability is between 0 and 1
      if (outcome.probability < 0) outcome.probability = 0;
      if (outcome.probability > 1) outcome.probability = 1;

      return outcome;
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize outcome');
      throw error;
    }
  }

  /**
   * Normalize and validate a trade
   */
  static normalizeTrade(data: Partial<Trade>): Trade {
    try {
      return {
        id: data.id || '',
        marketId: data.marketId || '',
        outcomeId: data.outcomeId || '',
        trader: data.trader || '',
        side: data.side || 'buy',
        amount: data.amount || '0',
        price: data.price || 0,
        timestamp: data.timestamp || Date.now(),
        signature: data.signature || '',
        slot: data.slot || 0,
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize trade');
      throw error;
    }
  }

  /**
   * Normalize and validate an order
   */
  static normalizeOrder(data: Partial<Order>): Order {
    try {
      return {
        id: data.id || '',
        marketId: data.marketId || '',
        outcomeId: data.outcomeId || '',
        trader: data.trader || '',
        side: data.side || 'buy',
        amount: data.amount || '0',
        price: data.price || 0,
        filled: data.filled || '0',
        status: data.status || 'open',
        createdAt: data.createdAt || Date.now(),
        updatedAt: data.updatedAt || Date.now(),
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize order');
      throw error;
    }
  }

  /**
   * Normalize and validate an orderbook
   */
  static normalizeOrderbook(data: Partial<Orderbook>): Orderbook {
    try {
      return {
        marketId: data.marketId || '',
        outcomeId: data.outcomeId || '',
        bids: data.bids || [],
        asks: data.asks || [],
        timestamp: data.timestamp || Date.now(),
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize orderbook');
      throw error;
    }
  }

  /**
   * Normalize and validate a resolution
   */
  static normalizeResolution(data: Partial<Resolution>): Resolution {
    try {
      return {
        id: data.id || '',
        marketId: data.marketId || '',
        winningOutcome: data.winningOutcome || '',
        resolver: data.resolver || '',
        timestamp: data.timestamp || Date.now(),
        slot: data.slot || 0,
        signature: data.signature || '',
        proof: data.proof,
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize resolution');
      throw error;
    }
  }

  /**
   * Normalize and validate an oracle update
   */
  static normalizeOracleUpdate(data: Partial<OracleUpdate>): OracleUpdate {
    try {
      return {
        id: data.id || '',
        marketId: data.marketId || '',
        oracleAddress: data.oracleAddress || '',
        oracleType: data.oracleType || 'custom',
        value: data.value || '0',
        confidence: data.confidence,
        timestamp: data.timestamp || Date.now(),
        slot: data.slot || 0,
        signature: data.signature || '',
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize oracle update');
      throw error;
    }
  }

  /**
   * Normalize and validate a candle
   */
  static normalizeCandle(data: Partial<Candle>): Candle {
    try {
      return {
        marketId: data.marketId || '',
        outcomeId: data.outcomeId || '',
        interval: data.interval || '1m',
        timestamp: data.timestamp || Date.now(),
        open: data.open || 0,
        high: data.high || 0,
        low: data.low || 0,
        close: data.close || 0,
        volume: data.volume || '0',
        trades: data.trades || 0,
      };
    } catch (error) {
      logger.error({ error, data }, 'Failed to normalize candle');
      throw error;
    }
  }

  /**
   * Calculate outcome probabilities from volumes (for simple markets)
   */
  static calculateProbabilitiesFromVolumes(outcomes: Outcome[]): Outcome[] {
    const totalVolume = outcomes.reduce(
      (sum, outcome) => sum + BigInt(outcome.volume),
      BigInt(0)
    );

    if (totalVolume === BigInt(0)) {
      // Equal probabilities if no volume
      const equalProb = 1 / outcomes.length;
      return outcomes.map((outcome) => ({
        ...outcome,
        probability: equalProb,
      }));
    }

    return outcomes.map((outcome) => ({
      ...outcome,
      probability: Number(BigInt(outcome.volume)) / Number(totalVolume),
    }));
  }

  /**
   * Calculate outcome probabilities from prices (AMM style)
   */
  static calculateProbabilitiesFromPrices(outcomes: Outcome[]): Outcome[] {
    // Normalize prices to probabilities
    const totalPrice = outcomes.reduce(
      (sum, outcome) => sum + (outcome.lastPrice || 0),
      0
    );

    if (totalPrice === 0) {
      const equalProb = 1 / outcomes.length;
      return outcomes.map((outcome) => ({
        ...outcome,
        probability: equalProb,
      }));
    }

    return outcomes.map((outcome) => ({
      ...outcome,
      probability: (outcome.lastPrice || 0) / totalPrice,
    }));
  }

  /**
   * Merge market updates (for incremental updates)
   */
  static mergeMarketUpdate(existing: Market, update: Partial<Market>): Market {
    return {
      ...existing,
      ...update,
      // Don't override outcomes unless explicitly provided
      outcomes: update.outcomes || existing.outcomes,
      // Don't override metadata unless explicitly provided
      metadata: update.metadata
        ? { ...existing.metadata, ...update.metadata }
        : existing.metadata,
    };
  }

  /**
   * Validate market status transition
   */
  static isValidStatusTransition(
    currentStatus: MarketStatus,
    newStatus: MarketStatus
  ): boolean {
    const validTransitions: Record<MarketStatus, MarketStatus[]> = {
      active: ['paused', 'expired', 'settled', 'cancelled'],
      paused: ['active', 'cancelled', 'expired'],
      expired: ['settled', 'cancelled'],
      settled: [], // Terminal state
      cancelled: [], // Terminal state
    };

    return validTransitions[currentStatus]?.includes(newStatus) || false;
  }

  /**
   * Calculate market metrics
   */
  static calculateMarketMetrics(market: Market): {
    totalProbability: number;
    volumeWeightedPrice: number;
    liquidityDepth: string;
  } {
    const totalProbability = market.outcomes.reduce(
      (sum, outcome) => sum + outcome.probability,
      0
    );

    const totalVolume = market.outcomes.reduce(
      (sum, outcome) => sum + BigInt(outcome.volume),
      BigInt(0)
    );

    const volumeWeightedPrice =
      totalVolume > BigInt(0)
        ? market.outcomes.reduce((sum, outcome) => {
            const weight = Number(BigInt(outcome.volume)) / Number(totalVolume);
            return sum + (outcome.lastPrice || 0) * weight;
          }, 0)
        : 0;

    const liquidityDepth = market.outcomes
      .reduce((sum, outcome) => sum + BigInt(outcome.liquidity), BigInt(0))
      .toString();

    return {
      totalProbability,
      volumeWeightedPrice,
      liquidityDepth,
    };
  }
}
