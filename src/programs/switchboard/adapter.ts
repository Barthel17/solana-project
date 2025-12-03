import { BaseMarketAdapter } from '../shared/baseAdapter.js';
import { ManualAccountDecoder, DecoderUtils } from '../shared/accountDecoder.js';
import { ProgramAccountData, DecodedAccount, Market, Outcome } from '../../normalize/types.js';
import { createLogger } from '../../utils/logger.js';
import { MarketNormalizer } from '../../normalize/marketNormalizer.js';

const logger = createLogger('switchboard-adapter');

// Switchboard V2 Program ID
export const SWITCHBOARD_PROGRAM_ID = 'SW1TCHw1TCH7qNvdvZzTA1jjCbqRX7w9QHfxhWUq6xfU';

/**
 * Switchboard Prediction Feed Account Structure
 * Based on Switchboard V2 aggregator accounts
 */
interface SwitchboardFeedAccount {
  name: string;
  metadata: string;
  authority: string;
  queueAddress: string;
  oracleRequestBatchSize: number;
  minOracleResults: number;
  minJobResults: number;
  minUpdateDelaySeconds: number;
  startAfter: bigint;
  varianceThreshold: number;
  forceReportPeriod: bigint;
  expiration: bigint;
  consecutiveFailureCount: bigint;
  nextAllowedUpdateTime: bigint;
  isLocked: boolean;
  crankAddress: string;
  latestConfirmedRound: {
    numSuccess: number;
    numError: number;
    roundOpenSlot: bigint;
    roundOpenTimestamp: bigint;
    result: number;
    stdDeviation: number;
    minResponse: number;
    maxResponse: number;
  };
  currentRound: {
    numSuccess: number;
    numError: number;
    roundOpenSlot: bigint;
    roundOpenTimestamp: bigint;
    result: number;
    stdDeviation: number;
    minResponse: number;
    maxResponse: number;
  };
  jobPubkeysData: string[];
  jobHashes: Buffer[];
  jobsChecksum: Buffer;
  historyLimit: number;
}

/**
 * Switchboard prediction market adapter
 */
export class SwitchboardAdapter extends BaseMarketAdapter {
  constructor() {
    super(SWITCHBOARD_PROGRAM_ID);

    // Register decoder for Switchboard feed accounts
    this.registerDecoder(
      'AggregatorAccount',
      new ManualAccountDecoder('AggregatorAccount', this.decodeFeedAccount.bind(this))
    );

    logger.info('Switchboard adapter initialized');
  }

  /**
   * Decode Switchboard feed account
   */
  private decodeFeedAccount(data: Buffer): Record<string, any> {
    try {
      let offset = 8; // Skip discriminator

      // Read account fields
      const name = DecoderUtils.readString(data, offset, 32);
      offset += 32;

      const metadata = DecoderUtils.readString(data, offset, 128);
      offset += 128;

      const authority = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      const queueAddress = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      const oracleRequestBatchSize = DecoderUtils.readU32(data, offset);
      offset += 4;

      const minOracleResults = DecoderUtils.readU32(data, offset);
      offset += 4;

      const minJobResults = DecoderUtils.readU32(data, offset);
      offset += 4;

      const minUpdateDelaySeconds = DecoderUtils.readU32(data, offset);
      offset += 4;

      const startAfter = DecoderUtils.readI64(data, offset);
      offset += 8;

      const varianceThreshold = DecoderUtils.readF64(data, offset);
      offset += 8;

      const forceReportPeriod = DecoderUtils.readI64(data, offset);
      offset += 8;

      const expiration = DecoderUtils.readI64(data, offset);
      offset += 8;

      const consecutiveFailureCount = DecoderUtils.readU64(data, offset);
      offset += 8;

      const nextAllowedUpdateTime = DecoderUtils.readI64(data, offset);
      offset += 8;

      const isLocked = DecoderUtils.readBool(data, offset);
      offset += 1;

      const crankAddress = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      // Latest confirmed round
      const latestConfirmedRound = {
        numSuccess: DecoderUtils.readU32(data, offset),
        numError: DecoderUtils.readU32(data, offset + 4),
        roundOpenSlot: DecoderUtils.readU64(data, offset + 8),
        roundOpenTimestamp: DecoderUtils.readI64(data, offset + 16),
        result: DecoderUtils.readF64(data, offset + 24),
        stdDeviation: DecoderUtils.readF64(data, offset + 32),
        minResponse: DecoderUtils.readF64(data, offset + 40),
        maxResponse: DecoderUtils.readF64(data, offset + 48),
      };
      offset += 56;

      // Current round
      const currentRound = {
        numSuccess: DecoderUtils.readU32(data, offset),
        numError: DecoderUtils.readU32(data, offset + 4),
        roundOpenSlot: DecoderUtils.readU64(data, offset + 8),
        roundOpenTimestamp: DecoderUtils.readI64(data, offset + 16),
        result: DecoderUtils.readF64(data, offset + 24),
        stdDeviation: DecoderUtils.readF64(data, offset + 32),
        minResponse: DecoderUtils.readF64(data, offset + 40),
        maxResponse: DecoderUtils.readF64(data, offset + 48),
      };
      offset += 56;

      return {
        name,
        metadata,
        authority,
        queueAddress,
        oracleRequestBatchSize,
        minOracleResults,
        minJobResults,
        minUpdateDelaySeconds,
        startAfter: startAfter.toString(),
        varianceThreshold,
        forceReportPeriod: forceReportPeriod.toString(),
        expiration: expiration.toString(),
        consecutiveFailureCount: consecutiveFailureCount.toString(),
        nextAllowedUpdateTime: nextAllowedUpdateTime.toString(),
        isLocked,
        crankAddress,
        latestConfirmedRound: {
          ...latestConfirmedRound,
          roundOpenSlot: latestConfirmedRound.roundOpenSlot.toString(),
          roundOpenTimestamp: latestConfirmedRound.roundOpenTimestamp.toString(),
        },
        currentRound: {
          ...currentRound,
          roundOpenSlot: currentRound.roundOpenSlot.toString(),
          roundOpenTimestamp: currentRound.roundOpenTimestamp.toString(),
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to decode Switchboard feed account');
      throw error;
    }
  }

  /**
   * Normalize Switchboard feed to unified Market schema
   */
  async normalize(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    try {
      const feed = decoded.data as any;

      // Extract probability from oracle result (0-1 scale)
      const probability = Math.max(0, Math.min(1, feed.latestConfirmedRound.result));

      // Create binary outcomes (Yes/No) based on prediction feed
      const outcomes: Outcome[] = [
        MarketNormalizer.normalizeOutcome({
          id: `${accountData.address}-yes`,
          name: 'Yes',
          description: 'Outcome is true',
          probability: probability,
          volume: '0', // Switchboard doesn't track volume directly
          liquidity: '0',
          lastPrice: probability,
        }),
        MarketNormalizer.normalizeOutcome({
          id: `${accountData.address}-no`,
          name: 'No',
          description: 'Outcome is false',
          probability: 1 - probability,
          volume: '0',
          liquidity: '0',
          lastPrice: 1 - probability,
        }),
      ];

      // Determine market status
      let status: Market['status'] = 'active';
      if (feed.isLocked) {
        status = 'paused';
      }
      
      const expiration = parseInt(feed.expiration);
      if (expiration > 0 && expiration < Date.now() / 1000) {
        status = 'expired';
      }

      // Build market
      const market = MarketNormalizer.normalizeMarket({
        id: accountData.address,
        programId: accountData.programId,
        address: accountData.address,
        name: feed.name || 'Switchboard Prediction Feed',
        description: feed.metadata || 'Oracle-based prediction market',
        category: 'oracle',
        status,
        outcomes,
        creator: feed.authority,
        resolver: feed.authority,
        resolutionSource: accountData.address, // The feed itself is the oracle
        createdAt: Date.now(), // We don't have creation time from Switchboard
        expiresAt: expiration > 0 ? expiration * 1000 : undefined,
        totalVolume: '0',
        totalLiquidity: '0',
        metadata: {
          oracleType: 'switchboard',
          queueAddress: feed.queueAddress,
          minOracleResults: feed.minOracleResults,
          varianceThreshold: feed.varianceThreshold,
          latestResult: feed.latestConfirmedRound.result,
          stdDeviation: feed.latestConfirmedRound.stdDeviation,
          confidence: this.calculateConfidence(feed),
          lastUpdate: parseInt(feed.latestConfirmedRound.roundOpenTimestamp) * 1000,
          consecutiveFailures: feed.consecutiveFailureCount,
        },
      });

      logger.debug(
        { address: accountData.address, name: feed.name },
        'Normalized Switchboard feed'
      );

      return market;
    } catch (error) {
      logger.error({ error, accountData }, 'Failed to normalize Switchboard feed');
      throw error;
    }
  }

  /**
   * Calculate confidence score from oracle data
   */
  private calculateConfidence(feed: any): number {
    const round = feed.latestConfirmedRound;
    
    // Base confidence on number of successful oracle responses
    const successRate = round.numSuccess / (round.numSuccess + round.numError || 1);
    
    // Penalize high standard deviation
    const stdPenalty = Math.max(0, 1 - round.stdDeviation);
    
    // Combine factors
    const confidence = (successRate * 0.6 + stdPenalty * 0.4);
    
    return Math.max(0, Math.min(1, confidence));
  }
}
