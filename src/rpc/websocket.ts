import { Connection, PublicKey, AccountInfo, Context } from '@solana/web3.js';
import { createLogger } from '../utils/logger.js';
import { sleep } from '../utils/retry.js';

const logger = createLogger('websocket');

export interface AccountSubscription {
  id: number;
  publicKey: PublicKey;
  callback: (accountInfo: AccountInfo<Buffer>, context: Context) => void;
  errorCallback?: (error: Error) => void;
}

export interface ProgramSubscription {
  id: number;
  programId: PublicKey;
  callback: (keyedAccountInfo: any, context: Context) => void;
  errorCallback?: (error: Error) => void;
}

export class WebSocketManager {
  private connection: Connection;
  private accountSubscriptions = new Map<string, number>();
  private programSubscriptions = new Map<string, number>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isReconnecting = false;

  constructor(connection: Connection) {
    this.connection = connection;
    this.setupConnectionMonitoring();
  }

  /**
   * Monitor connection health and handle reconnections
   */
  private setupConnectionMonitoring(): void {
    // Connection error handling will be done per subscription
    logger.info('WebSocket manager initialized');
  }

  /**
   * Subscribe to account changes
   */
  async subscribeToAccount(
    publicKey: PublicKey,
    callback: (accountInfo: AccountInfo<Buffer>, context: Context) => void,
    errorCallback?: (error: Error) => void
  ): Promise<number> {
    const key = publicKey.toBase58();

    try {
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        (accountInfo, context) => {
          try {
            callback(accountInfo, context);
          } catch (error) {
            logger.error(
              { error, publicKey: key },
              'Error in account subscription callback'
            );
            errorCallback?.(error as Error);
          }
        },
        'confirmed'
      );

      this.accountSubscriptions.set(key, subscriptionId);

      logger.info({ publicKey: key, subscriptionId }, 'Subscribed to account');
      return subscriptionId;
    } catch (error) {
      logger.error({ error, publicKey: key }, 'Failed to subscribe to account');
      errorCallback?.(error as Error);
      throw error;
    }
  }

  /**
   * Subscribe to program account changes
   */
  async subscribeToProgram(
    programId: PublicKey,
    callback: (keyedAccountInfo: any, context: Context) => void,
    filters?: any[],
    errorCallback?: (error: Error) => void
  ): Promise<number> {
    const key = programId.toBase58();

    try {
      const subscriptionId = this.connection.onProgramAccountChange(
        programId,
        (keyedAccountInfo, context) => {
          try {
            callback(keyedAccountInfo, context);
          } catch (error) {
            logger.error(
              { error, programId: key },
              'Error in program subscription callback'
            );
            errorCallback?.(error as Error);
          }
        },
        'confirmed',
        filters
      );

      this.programSubscriptions.set(key, subscriptionId);

      logger.info(
        { programId: key, subscriptionId, filters },
        'Subscribed to program'
      );
      return subscriptionId;
    } catch (error) {
      logger.error({ error, programId: key }, 'Failed to subscribe to program');
      errorCallback?.(error as Error);
      throw error;
    }
  }

  /**
   * Unsubscribe from account
   */
  async unsubscribeFromAccount(publicKey: PublicKey): Promise<void> {
    const key = publicKey.toBase58();
    const subscriptionId = this.accountSubscriptions.get(key);

    if (subscriptionId !== undefined) {
      try {
        await this.connection.removeAccountChangeListener(subscriptionId);
        this.accountSubscriptions.delete(key);
        logger.info({ publicKey: key, subscriptionId }, 'Unsubscribed from account');
      } catch (error) {
        logger.error({ error, publicKey: key }, 'Failed to unsubscribe from account');
        throw error;
      }
    }
  }

  /**
   * Unsubscribe from program
   */
  async unsubscribeFromProgram(programId: PublicKey): Promise<void> {
    const key = programId.toBase58();
    const subscriptionId = this.programSubscriptions.get(key);

    if (subscriptionId !== undefined) {
      try {
        await this.connection.removeProgramAccountChangeListener(subscriptionId);
        this.programSubscriptions.delete(key);
        logger.info({ programId: key, subscriptionId }, 'Unsubscribed from program');
      } catch (error) {
        logger.error({ error, programId: key }, 'Failed to unsubscribe from program');
        throw error;
      }
    }
  }

  /**
   * Resubscribe all active subscriptions (used after reconnection)
   */
  async resubscribeAll(): Promise<void> {
    logger.info('Resubscribing to all active subscriptions');

    // Store current subscriptions
    const accountKeys = Array.from(this.accountSubscriptions.keys());
    const programKeys = Array.from(this.programSubscriptions.keys());

    // Clear existing subscriptions
    this.accountSubscriptions.clear();
    this.programSubscriptions.clear();

    // Resubscribe (callbacks are lost, so this is a basic implementation)
    // In production, you'd want to store callbacks and reattach them
    logger.warn(
      { accountKeys, programKeys },
      'Resubscription requires callback storage - implement as needed'
    );
  }

  /**
   * Handle reconnection logic
   */
  async handleReconnect(): Promise<void> {
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached');
      this.isReconnecting = false;
      throw new Error('WebSocket reconnection failed after max attempts');
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'Attempting WebSocket reconnection'
    );

    await sleep(delay);

    try {
      // Test connection
      await this.connection.getSlot();
      
      // Resubscribe to all active subscriptions
      await this.resubscribeAll();

      logger.info('WebSocket reconnection successful');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
    } catch (error) {
      logger.error({ error }, 'Reconnection attempt failed');
      this.isReconnecting = false;
      // Try again
      await this.handleReconnect();
    }
  }

  /**
   * Unsubscribe from all and cleanup
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up WebSocket subscriptions');

    for (const [key, subId] of this.accountSubscriptions.entries()) {
      try {
        await this.connection.removeAccountChangeListener(subId);
      } catch (error) {
        logger.error({ error, key }, 'Error removing account subscription');
      }
    }

    for (const [key, subId] of this.programSubscriptions.entries()) {
      try {
        await this.connection.removeProgramAccountChangeListener(subId);
      } catch (error) {
        logger.error({ error, key }, 'Error removing program subscription');
      }
    }

    this.accountSubscriptions.clear();
    this.programSubscriptions.clear();

    logger.info('WebSocket cleanup complete');
  }

  /**
   * Get subscription status
   */
  getStatus(): {
    accountSubscriptions: number;
    programSubscriptions: number;
    isReconnecting: boolean;
    reconnectAttempts: number;
  } {
    return {
      accountSubscriptions: this.accountSubscriptions.size,
      programSubscriptions: this.programSubscriptions.size,
      isReconnecting: this.isReconnecting,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Singleton instance
let wsManager: WebSocketManager | null = null;

export function initializeWebSocketManager(connection: Connection): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager(connection);
  }
  return wsManager;
}

export function getWebSocketManager(): WebSocketManager {
  if (!wsManager) {
    throw new Error('WebSocket manager not initialized');
  }
  return wsManager;
}
