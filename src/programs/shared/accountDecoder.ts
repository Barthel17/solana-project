import { createLogger } from '../../utils/logger.js';
import { ProgramAccountData, DecodedAccount } from '../../normalize/types.js';
import { BorshCoder, Idl } from '@coral-xyz/anchor';

const logger = createLogger('account-decoder');

/**
 * Base interface for all program account decoders
 */
export interface AccountDecoder {
  /**
   * Decode raw account data into typed structure
   */
  decode(data: Buffer): DecodedAccount;

  /**
   * Get account discriminator (first 8 bytes typically)
   */
  getDiscriminator(data: Buffer): string;

  /**
   * Validate account data format
   */
  validate(data: Buffer): boolean;
}

/**
 * Borsh-based account decoder for Anchor programs
 */
export class BorshAccountDecoder implements AccountDecoder {
  private coder: BorshCoder;
  private accountName: string;

  constructor(idl: Idl, accountName: string) {
    this.coder = new BorshCoder(idl);
    this.accountName = accountName;
  }

  decode(data: Buffer): DecodedAccount {
    try {
      const decoded = this.coder.accounts.decode(this.accountName, data);
      
      return {
        type: this.accountName,
        data: this.serializeData(decoded),
      };
    } catch (error) {
      logger.error({ error, accountName: this.accountName }, 'Failed to decode account');
      throw error;
    }
  }

  getDiscriminator(data: Buffer): string {
    if (data.length < 8) {
      return '';
    }
    return data.subarray(0, 8).toString('hex');
  }

  validate(data: Buffer): boolean {
    if (data.length < 8) {
      return false;
    }

    try {
      this.decode(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Serialize decoded data to JSON-safe format (handle BigInt, PublicKey, etc.)
   */
  private serializeData(data: any): Record<string, any> {
    if (data === null || data === undefined) {
      return {};
    }

    if (typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.serializeData(item));
    }

    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        result[key] = value;
      } else if (typeof value === 'bigint') {
        result[key] = value.toString();
      } else if (value?.constructor?.name === 'PublicKey') {
        result[key] = value.toString();
      } else if (typeof value === 'object') {
        result[key] = this.serializeData(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

/**
 * Manual buffer decoder for custom binary formats
 */
export class ManualAccountDecoder implements AccountDecoder {
  private decoderFn: (data: Buffer) => Record<string, any>;
  private accountType: string;

  constructor(accountType: string, decoderFn: (data: Buffer) => Record<string, any>) {
    this.accountType = accountType;
    this.decoderFn = decoderFn;
  }

  decode(data: Buffer): DecodedAccount {
    try {
      const decoded = this.decoderFn(data);
      
      return {
        type: this.accountType,
        data: decoded,
      };
    } catch (error) {
      logger.error({ error, accountType: this.accountType }, 'Failed to decode account');
      throw error;
    }
  }

  getDiscriminator(data: Buffer): string {
    if (data.length < 8) {
      return '';
    }
    return data.subarray(0, 8).toString('hex');
  }

  validate(data: Buffer): boolean {
    try {
      this.decode(data);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Utility functions for common decoding patterns
 */
export class DecoderUtils {
  /**
   * Read u8 (1 byte unsigned integer)
   */
  static readU8(buffer: Buffer, offset: number): number {
    return buffer.readUInt8(offset);
  }

  /**
   * Read u16 (2 byte unsigned integer, little-endian)
   */
  static readU16(buffer: Buffer, offset: number): number {
    return buffer.readUInt16LE(offset);
  }

  /**
   * Read u32 (4 byte unsigned integer, little-endian)
   */
  static readU32(buffer: Buffer, offset: number): number {
    return buffer.readUInt32LE(offset);
  }

  /**
   * Read u64 (8 byte unsigned integer as BigInt, little-endian)
   */
  static readU64(buffer: Buffer, offset: number): bigint {
    return buffer.readBigUInt64LE(offset);
  }

  /**
   * Read i64 (8 byte signed integer as BigInt, little-endian)
   */
  static readI64(buffer: Buffer, offset: number): bigint {
    return buffer.readBigInt64LE(offset);
  }

  /**
   * Read PublicKey (32 bytes)
   */
  static readPublicKey(buffer: Buffer, offset: number): string {
    const pubkeyBytes = buffer.subarray(offset, offset + 32);
    // Convert to base58 - for now just return hex, implement base58 encoding if needed
    return pubkeyBytes.toString('hex');
  }

  /**
   * Read fixed-length string
   */
  static readString(buffer: Buffer, offset: number, length: number): string {
    const bytes = buffer.subarray(offset, offset + length);
    // Remove null terminators
    const nullIndex = bytes.indexOf(0);
    return nullIndex >= 0
      ? bytes.subarray(0, nullIndex).toString('utf-8')
      : bytes.toString('utf-8');
  }

  /**
   * Read variable-length string (length prefix)
   */
  static readStringWithLength(buffer: Buffer, offset: number): { value: string; bytesRead: number } {
    const length = this.readU32(buffer, offset);
    const value = buffer.subarray(offset + 4, offset + 4 + length).toString('utf-8');
    return { value, bytesRead: 4 + length };
  }

  /**
   * Read bool (1 byte)
   */
  static readBool(buffer: Buffer, offset: number): boolean {
    return buffer.readUInt8(offset) !== 0;
  }

  /**
   * Read f64 (8 byte float, little-endian)
   */
  static readF64(buffer: Buffer, offset: number): number {
    return buffer.readDoubleLE(offset);
  }

  /**
   * Read array with length prefix
   */
  static readArray<T>(
    buffer: Buffer,
    offset: number,
    itemReader: (buf: Buffer, off: number) => { value: T; bytesRead: number }
  ): { value: T[]; bytesRead: number } {
    const length = this.readU32(buffer, offset);
    const items: T[] = [];
    let currentOffset = offset + 4;

    for (let i = 0; i < length; i++) {
      const { value, bytesRead } = itemReader(buffer, currentOffset);
      items.push(value);
      currentOffset += bytesRead;
    }

    return { value: items, bytesRead: currentOffset - offset };
  }

  /**
   * Read option (1 byte discriminator + optional value)
   */
  static readOption<T>(
    buffer: Buffer,
    offset: number,
    valueReader: (buf: Buffer, off: number) => { value: T; bytesRead: number }
  ): { value: T | null; bytesRead: number } {
    const isSome = this.readBool(buffer, offset);
    
    if (!isSome) {
      return { value: null, bytesRead: 1 };
    }

    const { value, bytesRead } = valueReader(buffer, offset + 1);
    return { value, bytesRead: 1 + bytesRead };
  }
}

/**
 * Multi-decoder that tries multiple decoders until one succeeds
 */
export class MultiAccountDecoder implements AccountDecoder {
  private decoders: AccountDecoder[];

  constructor(decoders: AccountDecoder[]) {
    this.decoders = decoders;
  }

  decode(data: Buffer): DecodedAccount {
    for (const decoder of this.decoders) {
      try {
        if (decoder.validate(data)) {
          return decoder.decode(data);
        }
      } catch {
        continue;
      }
    }

    throw new Error('No decoder could successfully decode the account data');
  }

  getDiscriminator(data: Buffer): string {
    if (data.length < 8) {
      return '';
    }
    return data.subarray(0, 8).toString('hex');
  }

  validate(data: Buffer): boolean {
    return this.decoders.some((decoder) => decoder.validate(data));
  }
}
