#!/usr/bin/env node
import { createLogger } from './utils/logger.js';
import { config } from './utils/config.js';
import { initializeRpcClient } from './rpc/connection.js';
import { initializeWebSocketManager } from './rpc/websocket.js';
import { initializeEventDispatcher } from './indexer/eventDispatcher.js';
import { initializeProgramRegistry } from './programs/shared/programRegistry.js';
import { initializeDatabase } from './storage/db.js';
import { initializeIndexer } from './indexer/indexer.js';
import { initializeApiServer } from './api/server.js';
import { SwitchboardAdapter } from './programs/switchboard/index.js';
import { HxroAdapter } from './programs/hxro/index.js';

const logger = createLogger('main');

/**
 * Initialize all system components
 */
async function initialize() {
  logger.info('Initializing Solana Prediction Market Aggregator...');

  try {
    // 1. Initialize RPC client
    logger.info('Initializing RPC client...');
    const rpcClient = initializeRpcClient();
    const connection = rpcClient.getConnection();

    // 2. Initialize WebSocket manager
    logger.info('Initializing WebSocket manager...');
    initializeWebSocketManager(connection);

    // 3. Initialize event dispatcher
    logger.info('Initializing event dispatcher...');
    initializeEventDispatcher({
      enabled: true,
      maxSize: 1000,
      ttlMs: 3600000, // 1 hour
    });

    // 4. Initialize database
    logger.info('Initializing database...');
    await initializeDatabase();

    // 5. Initialize program registry and register adapters
    logger.info('Registering program adapters...');
    const registry = initializeProgramRegistry();
    
    // Register Switchboard adapter
    const switchboardAdapter = new SwitchboardAdapter();
    registry.registerAdapter(switchboardAdapter);

    // Register Hxro adapter
    const hxroAdapter = new HxroAdapter();
    registry.registerAdapter(hxroAdapter);

    logger.info(
      { adapters: registry.getRegisteredProgramIds() },
      'Program adapters registered'
    );

    // 6. Initialize and start indexer
    if (config.indexerEnabled) {
      logger.info('Initializing indexer...');
      const indexer = initializeIndexer();
      await indexer.start();
    } else {
      logger.warn('Indexer is disabled in configuration');
    }

    // 7. Initialize and start API server
    logger.info('Initializing API server...');
    const apiServer = initializeApiServer();
    await apiServer.start();

    logger.info('🚀 All systems initialized and running!');
    logger.info({
      rpcEndpoint: rpcClient.getCurrentEndpoint(),
      apiPort: config.port,
      database: config.databaseType,
      programIds: config.programIds,
    }, 'System configuration');

  } catch (error) {
    logger.error({ error }, 'Failed to initialize system');
    throw error;
  }
}

/**
 * Cleanup and shutdown
 */
async function shutdown() {
  logger.info('Shutting down...');

  try {
    // Stop indexer
    const { getIndexer } = await import('./indexer/indexer.js');
    const indexer = getIndexer();
    await indexer.stop();

    // Stop API server
    const { getApiServer } = await import('./api/server.js');
    const apiServer = getApiServer();
    await apiServer.stop();

    // Disconnect database
    const { getDatabase } = await import('./storage/db.js');
    const database = getDatabase();
    await database.disconnect();

    // Cleanup WebSocket
    const { getWebSocketManager } = await import('./rpc/websocket.js');
    const wsManager = getWebSocketManager();
    await wsManager.cleanup();

    // Cleanup event dispatcher
    const { getEventDispatcher } = await import('./indexer/eventDispatcher.js');
    const dispatcher = getEventDispatcher();
    dispatcher.cleanup();

    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

/**
 * Handle uncaught errors
 */
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  shutdown();
});

/**
 * Handle shutdown signals
 */
process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  shutdown();
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  shutdown();
});

/**
 * Start the application
 */
async function main() {
  try {
    await initialize();
  } catch (error) {
    logger.error({ error }, 'Fatal error during initialization');
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { initialize, shutdown };

