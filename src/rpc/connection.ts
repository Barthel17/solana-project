import { Connection, Commitment, ConnectionConfig } from '@solana/web3.js';
import { config } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const logger = createLogger('rpc-connection');

export interface SolanaRpcConfig {
  httpEndpoint: string;
  wsEndpoint: string;
  fallbackEndpoints?: string[];
  commitment?: Commitment;
  confirmTransactionInitialTimeout?: number;
}

export class SolanaRpcClient {
  private connection: Connection;
  private currentEndpointIndex = 0;
  private endpoints: string[];
  private wsEndpoint: string;
  private config: ConnectionConfig;
  private failoverInProgress = false;

  constructor(rpcConfig: SolanaRpcConfig) {
    this.endpoints = [
      rpcConfig.httpEndpoint,
      ...(rpcConfig.fallbackEndpoints || []),
    ];
    this.wsEndpoint = rpcConfig.wsEndpoint;

    this.config = {
      commitment: rpcConfig.commitment || 'confirmed',
      wsEndpoint: this.wsEndpoint,
      confirmTransactionInitialTimeout:
        rpcConfig.confirmTransactionInitialTimeout || 60000,
    };

    this.connection = this.createConnection(this.endpoints[0]);
    logger.info(
      { endpoint: this.endpoints[0], commitment: this.config.commitment },
      'RPC client initialized'
    );
  }

  private createConnection(endpoint: string): Connection {
    return new Connection(endpoint, this.config);
  }

  /**
   * Get the current connection instance
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Execute an RPC call with automatic retry and failover
   */
  async executeWithRetry<T>(
    operation: (connection: Connection) => Promise<T>,
    operationName = 'rpc-call'
  ): Promise<T> {
    return withRetry(
      async () => {
        try {
          return await operation(this.connection);
        } catch (error) {
          logger.warn(
            { error, operationName, endpoint: this.endpoints[this.currentEndpointIndex] },
            'RPC operation failed'
          );

          // Try failover to next endpoint
          if (this.shouldFailover(error)) {
            await this.failover();
            // Retry with new connection
            return await operation(this.connection);
          }

          throw error;
        }
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        onRetry: (error, attempt) => {
          logger.warn(
            { error: error.message, attempt, operationName },
            'Retrying RPC operation'
          );
        },
      }
    );
  }

  /**
   * Determine if we should failover to another endpoint
   */
  private shouldFailover(error: any): boolean {
    // Failover on network errors, timeouts, 429s, 5xx errors
    const errorMessage = error?.message?.toLowerCase() || '';
    return (
      errorMessage.includes('timeout') ||
      errorMessage.includes('network') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('429') ||
      errorMessage.includes('503') ||
      errorMessage.includes('504')
    );
  }

  /**
   * Failover to the next available endpoint
   */
  async failover(): Promise<void> {
    if (this.failoverInProgress) {
      logger.debug('Failover already in progress, waiting...');
      return;
    }

    if (this.endpoints.length <= 1) {
      logger.warn('No fallback endpoints available');
      return;
    }

    this.failoverInProgress = true;

    try {
      const oldEndpoint = this.endpoints[this.currentEndpointIndex];
      this.currentEndpointIndex = (this.currentEndpointIndex + 1) % this.endpoints.length;
      const newEndpoint = this.endpoints[this.currentEndpointIndex];

      logger.info(
        { oldEndpoint, newEndpoint },
        'Failing over to alternative RPC endpoint'
      );

      this.connection = this.createConnection(newEndpoint);

      // Test new connection
      await this.connection.getSlot();
      logger.info({ endpoint: newEndpoint }, 'Failover successful');
    } catch (error) {
      logger.error({ error }, 'Failover failed');
      throw error;
    } finally {
      this.failoverInProgress = false;
    }
  }

  /**
   * Get current slot with retry
   */
  async getSlot(commitment?: Commitment): Promise<number> {
    return this.executeWithRetry(
      (conn) => conn.getSlot(commitment),
      'getSlot'
    );
  }

  /**
   * Get account info with retry
   */
  async getAccountInfo(
    publicKey: string,
    commitment?: Commitment
  ): Promise<any> {
    return this.executeWithRetry(
      (conn) => conn.getAccountInfo(publicKey as any, commitment),
      'getAccountInfo'
    );
  }

  /**
   * Get multiple accounts with retry and batching
   */
  async getMultipleAccounts(
    publicKeys: string[],
    commitment?: Commitment
  ): Promise<any[]> {
    // Batch requests to avoid RPC limits
    const BATCH_SIZE = 100;
    const batches: string[][] = [];

    for (let i = 0; i < publicKeys.length; i += BATCH_SIZE) {
      batches.push(publicKeys.slice(i, i + BATCH_SIZE));
    }

    const results: any[] = [];

    for (const batch of batches) {
      const batchResults = await this.executeWithRetry(
        (conn) => conn.getMultipleAccountsInfo(batch as any, commitment),
        'getMultipleAccounts'
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get program accounts with retry
   */
  async getProgramAccounts(
    programId: string,
    commitment?: Commitment
  ): Promise<any[]> {
    return this.executeWithRetry(
      (conn) => conn.getProgramAccounts(programId as any, commitment),
      'getProgramAccounts'
    );
  }

  /**
   * Get confirmed signatures for address
   */
  async getConfirmedSignaturesForAddress2(
    address: string,
    options?: any,
    commitment?: Commitment
  ): Promise<any[]> {
    return this.executeWithRetry(
      (conn) =>
        conn.getConfirmedSignaturesForAddress2(
          address as any,
          options,
          commitment
        ),
      'getConfirmedSignaturesForAddress2'
    );
  }

  /**
   * Get transaction details
   */
  async getTransaction(signature: string, options?: any): Promise<any> {
    return this.executeWithRetry(
      (conn) => conn.getTransaction(signature, options),
      'getTransaction'
    );
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.connection.getSlot();
      return true;
    } catch (error) {
      logger.error({ error }, 'Health check failed');
      return false;
    }
  }

  /**
   * Get current endpoint info
   */
  getCurrentEndpoint(): string {
    return this.endpoints[this.currentEndpointIndex];
  }
}

// Singleton instance
let rpcClient: SolanaRpcClient | null = null;

export function initializeRpcClient(): SolanaRpcClient {
  if (!rpcClient) {
    rpcClient = new SolanaRpcClient({
      httpEndpoint: config.solanaRpcHttp,
      wsEndpoint: config.solanaRpcWs,
      fallbackEndpoints: config.solanaRpcFallbacks,
      commitment: 'confirmed',
    });
  }
  return rpcClient;
}

export function getRpcClient(): SolanaRpcClient {
  if (!rpcClient) {
    throw new Error('RPC client not initialized. Call initializeRpcClient() first.');
  }
  return rpcClient;
}
