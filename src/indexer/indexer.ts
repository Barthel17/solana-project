import { PublicKey, AccountInfo, Context } from '@solana/web3.js';
import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { getRpcClient } from '../rpc/connection.js';
import { getWebSocketManager } from '../rpc/websocket.js';
import { getEventDispatcher } from './eventDispatcher.js';
import { getProgramRegistry } from '../programs/shared/programRegistry.js';
import { ProgramAccountData } from '../normalize/types.js';

const logger = createLogger('indexer');

export interface IndexerConfig {
  programIds: string[];
  pollInterval?: number;
  batchSize?: number;
  enableWebSocket?: boolean;
}

export class MarketIndexer {
  private config: IndexerConfig;
  private isRunning = false;
  private pollIntervalId?: NodeJS.Timeout;
  private subscriptions = new Map<string, number>();

  constructor(indexerConfig: IndexerConfig) {
    this.config = {
      pollInterval: 5000,
      batchSize: 100,
      enableWebSocket: true,
      ...indexerConfig,
    };

    logger.info(
      {
        programIds: this.config.programIds,
        enableWebSocket: this.config.enableWebSocket,
      },
      'Market indexer initialized'
    );
  }

  /**
   * Start the indexer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Indexer already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting market indexer');

    try {
      // Initial snapshot of all program accounts
      await this.initialSync();

      // Start WebSocket subscriptions for real-time updates
      if (this.config.enableWebSocket) {
        await this.startWebSocketSubscriptions();
      }

      // Start periodic polling as backup
      this.startPolling();

      logger.info('Market indexer started successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to start indexer');
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the indexer
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Indexer not running');
      return;
    }

    logger.info('Stopping market indexer');
    this.isRunning = false;

    // Stop polling
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }

    // Unsubscribe from WebSocket
    await this.stopWebSocketSubscriptions();

    logger.info('Market indexer stopped');
  }

  /**
   * Perform initial sync of all program accounts
   */
  private async initialSync(): Promise<void> {
    logger.info('Starting initial sync');

    const rpcClient = getRpcClient();
    const programRegistry = getProgramRegistry();

    for (const programIdStr of this.config.programIds) {
      try {
        const adapter = programRegistry.getAdapter(programIdStr);
        if (!adapter) {
          logger.warn({ programId: programIdStr }, 'No adapter found for program');
          continue;
        }

        logger.info({ programId: programIdStr }, 'Syncing program accounts');

        // Fetch all program accounts
        const accounts = await rpcClient.getProgramAccounts(programIdStr);

        logger.info(
          { programId: programIdStr, accountCount: accounts.length },
          'Fetched program accounts'
        );

        // Process accounts in batches
        for (let i = 0; i < accounts.length; i += this.config.batchSize!) {
          const batch = accounts.slice(i, i + this.config.batchSize!);
          
          await Promise.all(
            batch.map(async (account) => {
              try {
                await this.processAccount({
                  programId: programIdStr,
                  address: account.pubkey.toBase58(),
                  data: account.account.data as Buffer,
                  slot: 0, // Will be fetched from context in real-time
                });
              } catch (error) {
                logger.error(
                  { error, address: account.pubkey.toBase58() },
                  'Error processing account'
                );
              }
            })
          );
        }

        logger.info({ programId: programIdStr }, 'Program sync completed');
      } catch (error) {
        logger.error({ error, programId: programIdStr }, 'Error syncing program');
      }
    }

    logger.info('Initial sync completed');
  }

  /**
   * Start WebSocket subscriptions for real-time updates
   */
  private async startWebSocketSubscriptions(): Promise<void> {
    logger.info('Starting WebSocket subscriptions');

    const wsManager = getWebSocketManager();
    const programRegistry = getProgramRegistry();

    for (const programIdStr of this.config.programIds) {
      try {
        const adapter = programRegistry.getAdapter(programIdStr);
        if (!adapter) {
          continue;
        }

        const programId = new PublicKey(programIdStr);

        const subscriptionId = await wsManager.subscribeToProgram(
          programId,
          async (keyedAccountInfo, context) => {
            await this.handleAccountUpdate(
              programIdStr,
              keyedAccountInfo,
              context
            );
          },
          undefined, // filters
          (error) => {
            logger.error(
              { error, programId: programIdStr },
              'WebSocket subscription error'
            );
          }
        );

        this.subscriptions.set(programIdStr, subscriptionId);

        logger.info(
          { programId: programIdStr, subscriptionId },
          'WebSocket subscription active'
        );
      } catch (error) {
        logger.error(
          { error, programId: programIdStr },
          'Failed to subscribe to program'
        );
      }
    }
  }

  /**
   * Stop WebSocket subscriptions
   */
  private async stopWebSocketSubscriptions(): Promise<void> {
    logger.info('Stopping WebSocket subscriptions');

    const wsManager = getWebSocketManager();

    for (const [programIdStr, subscriptionId] of this.subscriptions.entries()) {
      try {
        const programId = new PublicKey(programIdStr);
        await wsManager.unsubscribeFromProgram(programId);
        logger.info(
          { programId: programIdStr, subscriptionId },
          'Unsubscribed from program'
        );
      } catch (error) {
        logger.error(
          { error, programId: programIdStr },
          'Error unsubscribing from program'
        );
      }
    }

    this.subscriptions.clear();
  }

  /**
   * Start periodic polling
   */
  private startPolling(): void {
    if (this.pollIntervalId) {
      return;
    }

    this.pollIntervalId = setInterval(async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        await this.poll();
      } catch (error) {
        logger.error({ error }, 'Error during polling');
      }
    }, this.config.pollInterval);

    logger.info(
      { intervalMs: this.config.pollInterval },
      'Polling started'
    );
  }

  /**
   * Perform a poll cycle
   */
  private async poll(): Promise<void> {
    logger.debug('Polling for updates');

    const rpcClient = getRpcClient();

    try {
      // Health check
      const isHealthy = await rpcClient.healthCheck();
      if (!isHealthy) {
        logger.warn('RPC health check failed');
      }
    } catch (error) {
      logger.error({ error }, 'Polling error');
    }
  }

  /**
   * Handle account update from WebSocket
   */
  private async handleAccountUpdate(
    programId: string,
    keyedAccountInfo: any,
    context: Context
  ): Promise<void> {
    try {
      await this.processAccount({
        programId,
        address: keyedAccountInfo.accountId.toBase58(),
        data: keyedAccountInfo.accountInfo.data as Buffer,
        slot: context.slot,
      });
    } catch (error) {
      logger.error(
        { error, programId, address: keyedAccountInfo.accountId.toBase58() },
        'Error handling account update'
      );
    }
  }

  /**
   * Process a program account
   */
  private async processAccount(accountData: ProgramAccountData): Promise<void> {
    const programRegistry = getProgramRegistry();
    const adapter = programRegistry.getAdapter(accountData.programId);

    if (!adapter) {
      logger.debug(
        { programId: accountData.programId },
        'No adapter found for program'
      );
      return;
    }

    try {
      // Decode account using adapter
      const decoded = await adapter.decodeAccount(accountData);

      // Normalize to unified schema
      const normalized = await adapter.normalize(decoded, accountData);

      // Dispatch events
      const dispatcher = getEventDispatcher();
      
      // Determine event type based on account state
      // This is a simple heuristic - adapters can provide more specific logic
      await dispatcher.dispatch({
        type: 'market_updated',
        timestamp: Date.now(),
        slot: accountData.slot,
        signature: undefined,
        data: normalized,
      });

      logger.debug(
        { programId: accountData.programId, address: accountData.address },
        'Account processed successfully'
      );
    } catch (error) {
      logger.error(
        { error, programId: accountData.programId, address: accountData.address },
        'Error processing account'
      );
    }
  }

  /**
   * Get indexer status
   */
  getStatus(): {
    isRunning: boolean;
    subscriptions: number;
    programIds: string[];
  } {
    return {
      isRunning: this.isRunning,
      subscriptions: this.subscriptions.size,
      programIds: this.config.programIds,
    };
  }
}

// Singleton instance
let indexer: MarketIndexer | null = null;

export function initializeIndexer(): MarketIndexer {
  if (!indexer) {
    indexer = new MarketIndexer({
      programIds: config.programIds,
      pollInterval: config.indexerPollInterval,
      batchSize: config.indexerBatchSize,
      enableWebSocket: true,
    });
  }
  return indexer;
}

export function getIndexer(): MarketIndexer {
  if (!indexer) {
    throw new Error('Indexer not initialized');
  }
  return indexer;
}
