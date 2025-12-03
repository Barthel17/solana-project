/**
 * Example: Creating a Custom Protocol Adapter
 * 
 * This shows how to create an adapter for any Solana-based prediction market protocol
 */

import { BaseMarketAdapter } from '../src/programs/shared/baseAdapter.js';
import { ManualAccountDecoder, DecoderUtils } from '../src/programs/shared/accountDecoder.js';
import { ProgramAccountData, DecodedAccount, Market } from '../src/normalize/types.js';
import { MarketNormalizer } from '../src/normalize/marketNormalizer.js';

/**
 * Example: Generic AMM-style prediction market adapter
 */
export class CustomAMMAdapter extends BaseMarketAdapter {
  constructor(programId: string) {
    super(programId);

    // Register decoders for your account types
    this.registerDecoder(
      'Market',
      new ManualAccountDecoder('Market', this.decodeMarketAccount.bind(this))
    );

    this.registerDecoder(
      'Pool',
      new ManualAccountDecoder('Pool', this.decodePoolAccount.bind(this))
    );
  }

  /**
   * Decode your program's market account structure
   * Adjust based on your actual account layout
   */
  private decodeMarketAccount(data: Buffer): Record<string, any> {
    let offset = 8; // Skip 8-byte discriminator

    // Example structure - adjust to match your program
    const marketAuthority = DecoderUtils.readPublicKey(data, offset);
    offset += 32;

    const marketName = DecoderUtils.readString(data, offset, 64);
    offset += 64;

    const isActive = DecoderUtils.readBool(data, offset);
    offset += 1;

    const numOutcomes = DecoderUtils.readU8(data, offset);
    offset += 1;

    // Read outcome data
    const outcomes = [];
    for (let i = 0; i < numOutcomes; i++) {
      const outcomeName = DecoderUtils.readString(data, offset, 32);
      offset += 32;

      const tokenMint = DecoderUtils.readPublicKey(data, offset);
      offset += 32;

      const tokenReserve = DecoderUtils.readU64(data, offset);
      offset += 8;

      outcomes.push({
        name: outcomeName,
        tokenMint,
        reserve: tokenReserve.toString(),
      });
    }

    const createdAt = DecoderUtils.readI64(data, offset);
    offset += 8;

    const expiresAt = DecoderUtils.readI64(data, offset);
    offset += 8;

    return {
      marketAuthority,
      marketName,
      isActive,
      outcomes,
      createdAt: createdAt.toString(),
      expiresAt: expiresAt.toString(),
    };
  }

  /**
   * Decode pool/liquidity accounts
   */
  private decodePoolAccount(data: Buffer): Record<string, any> {
    let offset = 8;

    const poolAuthority = DecoderUtils.readPublicKey(data, offset);
    offset += 32;

    const totalLiquidity = DecoderUtils.readU64(data, offset);
    offset += 8;

    const totalVolume = DecoderUtils.readU64(data, offset);
    offset += 8;

    const feeRate = DecoderUtils.readU16(data, offset);
    offset += 2;

    return {
      poolAuthority,
      totalLiquidity: totalLiquidity.toString(),
      totalVolume: totalVolume.toString(),
      feeRate,
    };
  }

  /**
   * Normalize to unified Market schema
   */
  async normalize(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    
    if (decoded.type === 'Market') {
      return this.normalizeMarket(decoded, accountData);
    } else if (decoded.type === 'Pool') {
      // Handle pool updates - could update existing market
      return this.normalizePoolUpdate(decoded, accountData);
    }

    throw new Error(`Unknown account type: ${decoded.type}`);
  }

  /**
   * Normalize market account
   */
  private async normalizeMarket(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    const data = decoded.data as any;

    // Calculate probabilities from AMM reserves
    const totalReserves = data.outcomes.reduce(
      (sum: bigint, outcome: any) => sum + BigInt(outcome.reserve),
      BigInt(0)
    );

    const outcomes = data.outcomes.map((outcome: any, index: number) => {
      const reserve = BigInt(outcome.reserve);
      const probability = totalReserves > BigInt(0)
        ? Number(reserve) / Number(totalReserves)
        : 1 / data.outcomes.length;

      // Calculate price based on constant product formula
      // price = reserve_other / reserve_this
      const otherReserves = totalReserves - reserve;
      const price = reserve > BigInt(0)
        ? Number(otherReserves) / Number(reserve)
        : 0;

      return MarketNormalizer.normalizeOutcome({
        id: `${accountData.address}-${index}`,
        name: outcome.name,
        probability: Math.max(0, Math.min(1, probability)),
        volume: '0', // Would need to track separately
        liquidity: outcome.reserve,
        lastPrice: price,
      });
    });

    const status: Market['status'] = data.isActive ? 'active' : 'paused';

    const expiresAt = parseInt(data.expiresAt);
    const createdAt = parseInt(data.createdAt);

    return MarketNormalizer.normalizeMarket({
      id: accountData.address,
      programId: accountData.programId,
      address: accountData.address,
      name: data.marketName,
      description: 'Custom AMM prediction market',
      category: 'amm',
      status,
      outcomes,
      creator: data.marketAuthority,
      resolver: data.marketAuthority,
      createdAt: createdAt > 0 ? createdAt * 1000 : Date.now(),
      expiresAt: expiresAt > 0 ? expiresAt * 1000 : undefined,
      totalVolume: '0', // Track via events
      totalLiquidity: totalReserves.toString(),
      metadata: {
        protocol: 'custom-amm',
        outcomesCount: data.outcomes.length,
      },
    });
  }

  /**
   * Handle pool/liquidity updates
   */
  private async normalizePoolUpdate(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    const data = decoded.data as any;

    // In a real implementation, you'd fetch the associated market
    // and update it with new liquidity/volume data
    // For this example, we create a placeholder

    return MarketNormalizer.normalizeMarket({
      id: accountData.address,
      programId: accountData.programId,
      address: accountData.address,
      name: 'Pool Update',
      description: 'Liquidity pool update',
      status: 'active',
      outcomes: [],
      creator: data.poolAuthority,
      createdAt: Date.now(),
      totalVolume: data.totalVolume,
      totalLiquidity: data.totalLiquidity,
      fee: data.feeRate / 10000, // Convert basis points to percentage
    });
  }
}

/**
 * Example: Orderbook-based prediction market adapter
 */
export class CustomOrderbookAdapter extends BaseMarketAdapter {
  constructor(programId: string) {
    super(programId);

    this.registerDecoder(
      'OrderbookMarket',
      new ManualAccountDecoder('OrderbookMarket', this.decodeOrderbookMarket.bind(this))
    );
  }

  private decodeOrderbookMarket(data: Buffer): Record<string, any> {
    let offset = 8;

    const marketId = DecoderUtils.readPublicKey(data, offset);
    offset += 32;

    const baseMint = DecoderUtils.readPublicKey(data, offset);
    offset += 32;

    const quoteMint = DecoderUtils.readPublicKey(data, offset);
    offset += 32;

    // Read orderbook data
    const bidCount = DecoderUtils.readU32(data, offset);
    offset += 4;

    const askCount = DecoderUtils.readU32(data, offset);
    offset += 4;

    const bestBid = DecoderUtils.readF64(data, offset);
    offset += 8;

    const bestAsk = DecoderUtils.readF64(data, offset);
    offset += 8;

    const volume24h = DecoderUtils.readU64(data, offset);
    offset += 8;

    return {
      marketId,
      baseMint,
      quoteMint,
      bidCount,
      askCount,
      bestBid,
      bestAsk,
      volume24h: volume24h.toString(),
    };
  }

  async normalize(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market> {
    const data = decoded.data as any;

    // Calculate mid-market price
    const midPrice = (data.bestBid + data.bestAsk) / 2;
    const probability = Math.max(0, Math.min(1, midPrice));

    const outcomes = [
      MarketNormalizer.normalizeOutcome({
        id: `${accountData.address}-yes`,
        name: 'Yes',
        probability: probability,
        volume: data.volume24h,
        liquidity: '0', // Calculate from orderbook depth
        lastPrice: midPrice,
      }),
      MarketNormalizer.normalizeOutcome({
        id: `${accountData.address}-no`,
        name: 'No',
        probability: 1 - probability,
        volume: data.volume24h,
        liquidity: '0',
        lastPrice: 1 - midPrice,
      }),
    ];

    return MarketNormalizer.normalizeMarket({
      id: accountData.address,
      programId: accountData.programId,
      address: accountData.address,
      name: 'Orderbook Market',
      description: 'CLOB-based prediction market',
      category: 'orderbook',
      status: 'active',
      outcomes,
      creator: data.marketId,
      createdAt: Date.now(),
      totalVolume: data.volume24h,
      totalLiquidity: '0',
      metadata: {
        protocol: 'custom-orderbook',
        bidCount: data.bidCount,
        askCount: data.askCount,
        bestBid: data.bestBid,
        bestAsk: data.bestAsk,
        spread: data.bestAsk - data.bestBid,
      },
    });
  }
}

/**
 * How to use these adapters:
 * 
 * 1. Import in src/index.ts:
 *    import { CustomAMMAdapter } from '../examples/custom-adapter.js';
 * 
 * 2. Register with the program registry:
 *    const customAdapter = new CustomAMMAdapter('YOUR_PROGRAM_ID');
 *    registry.registerAdapter(customAdapter);
 * 
 * 3. Add program ID to .env:
 *    PROGRAM_IDS=YOUR_PROGRAM_ID,OTHER_IDS
 * 
 * 4. The indexer will automatically use your adapter for accounts from that program
 */

