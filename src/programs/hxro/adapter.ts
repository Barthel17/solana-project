import { BaseMarketAdapter } from '../shared/baseAdapter.js';
import { ManualAccountDecoder, DecoderUtils } from '../shared/accountDecoder.js';
import { ProgramAccountData, DecodedAccount, Market, Outcome } from '../../normalize/types.js';
import { createLogger } from '../../utils/logger.js';
import { MarketNormalizer } from '../../normalize/marketNormalizer.js';

const logger = createLogger('hxro-adapter');

// Hxro Parimutuel Program ID (Mainnet)
export const HXRO_PROGRAM_ID = 'HXroKJzRNV3GJxaNS5rCZRUUYFAqqCjYnA9NKCkQ8gJ8';

/**
 * Hxro Parimutuel Market Account Structure
 */
interface HxroMarketAccount {
  marketAddress: string;
  marketName: string;
  marketDescription: string;
  marketAuthority: string;
  oracleAddress: string;
  marketStatus: number; // 0 = Active, 1 = Locked, 2 = Settled, 3 = Cancelled
  outcomes: HxroOutcome[];
  totalPool: bigint;
  settlementTime: bigint;
  createdAt: bigint;
  settledAt: bigint;
  winningOutcome: number;
  feePercent: number;
  minStake: bigint;
  maxStake: bigint;
}

interface HxroOutcome {
  id: number;
  name: string;
  pool: bigint;
  bettors: number;
  odds: number;
}

/**
 * Hxro protocol adapter for parimutuel prediction markets
 */
export class HxroAdapter extends BaseMarketAdapter {
  constructor() {
    super(HXRO_PROGRAM_ID);

    // Register decoder for Hxro market accounts
    this.registerDecoder(
      'ParimutuelMarket',
      new ManualAccountDecoder('ParimutuelMarket', this.decodeMarketAccount.bind(this))
    );

    logger.info('Hxro adapter initialized');
  }

  /**
   * Decode Hxro parimutuel market account
   */
  private decodeMarketAccount(data: Buffer): Record<string, any> {
    try {
      let offset = 8; // Skip discriminator

      // Market address (32 bytes)
      const marketAddress = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      // Market name (64 bytes, fixed length)
      const marketName = DecoderUtils.readString(data, offset, 64);
      offset += 64;

      // Market description (256 bytes, fixed length)
      const marketDescription = DecoderUtils.readString(data, offset, 256);
      offset += 256;

      // Market authority (32 bytes)
      const marketAuthority = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      // Oracle address (32 bytes)
      const oracleAddress = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      // Market status (1 byte)
      const marketStatus = DecoderUtils.readU8(data, offset);
      offset += 1;

      // Number of outcomes (1 byte)
      const numOutcomes = DecoderUtils.readU8(data, offset);
      offset += 1;

      // Read outcomes
      const outcomes: HxroOutcome[] = [];
      for (let i = 0; i < numOutcomes; i++) {
        const outcomeName = DecoderUtils.readString(data, offset, 32);
        offset += 32;

        const pool = DecoderUtils.readU64(data, offset);
        offset += 8;

        const bettors = DecoderUtils.readU32(data, offset);
        offset += 4;

        outcomes.push({
          id: i,
          name: outcomeName,
          pool,
          bettors,
          odds: 0, // Will be calculated
        });
      }

      // Total pool (8 bytes)
      const totalPool = DecoderUtils.readU64(data, offset);
      offset += 8;

      // Settlement time (8 bytes, Unix timestamp)
      const settlementTime = DecoderUtils.readI64(data, offset);
      offset += 8;

      // Created at (8 bytes, Unix timestamp)
      const createdAt = DecoderUtils.readI64(data, offset);
      offset += 8;

      // Settled at (8 bytes, Unix timestamp)
      const settledAt = DecoderUtils.readI64(data, offset);
      offset += 8;

      // Winning outcome (1 byte, 255 = not settled)
      const winningOutcome = DecoderUtils.readU8(data, offset);
      offset += 1;

      // Fee percent (2 bytes, basis points)
      const feePercent = DecoderUtils.readU16(data, offset);
      offset += 2;

      // Min stake (8 bytes)
      const minStake = DecoderUtils.readU64(data, offset);
      offset += 8;

      // Max stake (8 bytes)
      const maxStake = DecoderUtils.readU64(data, offset);
      offset += 8;

      // Calculate odds for each outcome
      const totalPoolNum = Number(totalPool);
      outcomes.forEach((outcome) => {
        const outcomePool = Number(outcome.pool);
        outcome.odds = outcomePool > 0 ? totalPoolNum / outcomePool : 0;
      });

      return {
        marketAddress,
        marketName,
        marketDescription,
        marketAuthority,
        oracleAddress,
        marketStatus,
        outcomes: outcomes.map((o) => ({
          ...o,
          pool: o.pool.toString(),
        })),
        totalPool: totalPool.toString(),
        settlementTime: settlementTime.toString(),
        createdAt: createdAt.toString(),
        settledAt: settledAt.toString(),
        winningOutcome,
        feePercent,
        minStake: minStake.toString(),
        maxStake: maxStake.toString(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to decode Hxro market account');
      throw error;
    }
  }

  /**
   * Normalize Hxro market to unified Market schema
   */
  async normalize(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    try {
      const market = decoded.data as any;

      // Map status
      const statusMap: Record<number, Market['status']> = {
        0: 'active',
        1: 'paused',
        2: 'settled',
        3: 'cancelled',
      };
      const status = statusMap[market.marketStatus] || 'active';

      // Calculate probabilities from parimutuel pools
      const totalPool = BigInt(market.totalPool);
      const outcomes: Outcome[] = market.outcomes.map((outcome: any) => {
        const outcomePool = BigInt(outcome.pool);
        
        // Parimutuel probability = pool / total_pool
        const probability =
          totalPool > BigInt(0)
            ? Number(outcomePool) / Number(totalPool)
            : 1 / market.outcomes.length;

        // Price is the odds (inverse of probability, adjusted for fee)
        const feeMultiplier = 1 - market.feePercent / 10000;
        const impliedOdds = outcome.odds * feeMultiplier;
        const price = impliedOdds > 0 ? 1 / impliedOdds : 0;

        return MarketNormalizer.normalizeOutcome({
          id: `${accountData.address}-${outcome.id}`,
          name: outcome.name,
          probability: Math.max(0, Math.min(1, probability)),
          volume: outcome.pool,
          liquidity: outcome.pool, // In parimutuel, pool = liquidity
          lastPrice: price,
        });
      });

      // Build normalized market
      const normalizedMarket = MarketNormalizer.normalizeMarket({
        id: accountData.address,
        programId: accountData.programId,
        address: accountData.address,
        name: market.marketName || 'Hxro Parimutuel Market',
        description: market.marketDescription || '',
        category: 'parimutuel',
        status,
        outcomes,
        creator: market.marketAuthority,
        resolver: market.marketAuthority,
        resolutionSource: market.oracleAddress,
        createdAt: parseInt(market.createdAt) * 1000 || Date.now(),
        expiresAt: parseInt(market.settlementTime) * 1000 || undefined,
        resolvedAt:
          parseInt(market.settledAt) > 0
            ? parseInt(market.settledAt) * 1000
            : undefined,
        winningOutcome:
          market.winningOutcome !== 255
            ? `${accountData.address}-${market.winningOutcome}`
            : undefined,
        totalVolume: market.totalPool,
        totalLiquidity: market.totalPool,
        minStake: market.minStake,
        maxStake: market.maxStake,
        fee: market.feePercent / 100, // Convert basis points to percent
        metadata: {
          marketType: 'parimutuel',
          protocol: 'hxro',
          outcomeCount: market.outcomes.length,
          totalBettors: market.outcomes.reduce(
            (sum: number, o: any) => sum + o.bettors,
            0
          ),
          odds: market.outcomes.map((o: any) => ({
            outcome: o.name,
            odds: o.odds,
          })),
        },
      });

      logger.debug(
        { address: accountData.address, name: market.marketName },
        'Normalized Hxro market'
      );

      return normalizedMarket;
    } catch (error) {
      logger.error({ error, accountData }, 'Failed to normalize Hxro market');
      throw error;
    }
  }
}

