import { createLogger } from '../../utils/logger.js';
import { ProgramAccountData, DecodedAccount, Market } from '../../normalize/types.js';
import { AccountDecoder } from './accountDecoder.js';

const logger = createLogger('base-adapter');

/**
 * Base interface for all market program adapters
 */
export interface MarketAdapter {
  /**
   * Program ID this adapter handles
   */
  programId: string;

  /**
   * Decode program account data
   */
  decodeAccount(accountData: ProgramAccountData): Promise<DecodedAccount>;

  /**
   * Normalize decoded account to unified Market schema
   */
  normalize(decoded: DecodedAccount, accountData: ProgramAccountData): Promise<Market>;

  /**
   * Get supported account types
   */
  getSupportedAccountTypes(): string[];
}

/**
 * Abstract base class for market adapters
 */
export abstract class BaseMarketAdapter implements MarketAdapter {
  public readonly programId: string;
  protected decoders: Map<string, AccountDecoder>;

  constructor(programId: string) {
    this.programId = programId;
    this.decoders = new Map();
    
    logger.info({ programId }, 'Base adapter initialized');
  }

  /**
   * Register an account decoder
   */
  protected registerDecoder(accountType: string, decoder: AccountDecoder): void {
    this.decoders.set(accountType, decoder);
    logger.debug({ programId: this.programId, accountType }, 'Decoder registered');
  }

  /**
   * Decode account data using registered decoders
   */
  async decodeAccount(accountData: ProgramAccountData): Promise<DecodedAccount> {
    // Try to identify account type by discriminator
    const discriminator = this.getDiscriminator(accountData.data);

    // Try each decoder
    for (const [accountType, decoder] of this.decoders.entries()) {
      try {
        if (decoder.validate(accountData.data)) {
          logger.debug(
            { programId: this.programId, accountType, address: accountData.address },
            'Account decoded successfully'
          );
          return decoder.decode(accountData.data);
        }
      } catch (error) {
        logger.debug(
          { error, accountType, address: accountData.address },
          'Decoder failed, trying next'
        );
        continue;
      }
    }

    throw new Error(
      `No decoder found for account ${accountData.address} with discriminator ${discriminator}`
    );
  }

  /**
   * Abstract method to normalize decoded data to Market schema
   * Must be implemented by specific adapter
   */
  abstract normalize(
    decoded: DecodedAccount,
    accountData: ProgramAccountData
  ): Promise<Market>;

  /**
   * Get supported account types
   */
  getSupportedAccountTypes(): string[] {
    return Array.from(this.decoders.keys());
  }

  /**
   * Get account discriminator (first 8 bytes as hex)
   */
  protected getDiscriminator(data: Buffer): string {
    if (data.length < 8) {
      return '';
    }
    return data.subarray(0, 8).toString('hex');
  }

  /**
   * Helper to convert BigInt fields to strings
   */
  protected bigIntToString(value: bigint | string | number): string {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'number') {
      return value.toString();
    }
    return value;
  }

  /**
   * Helper to safely parse number
   */
  protected safeParseNumber(value: any, defaultValue = 0): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    return defaultValue;
  }

  /**
   * Helper to convert lamports to SOL
   */
  protected lamportsToSol(lamports: bigint | string | number): number {
    const lamportsNum = typeof lamports === 'bigint' 
      ? Number(lamports) 
      : typeof lamports === 'string'
      ? parseFloat(lamports)
      : lamports;
    
    return lamportsNum / 1e9;
  }
}

