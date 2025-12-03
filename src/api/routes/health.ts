import { Router, Request, Response } from 'express';
import { getRpcClient } from '../../rpc/connection.js';
import { getDatabase } from '../../storage/db.js';
import { getIndexer } from '../../indexer/indexer.js';
import { getEventDispatcher } from '../../indexer/eventDispatcher.js';
import { getProgramRegistry } from '../../programs/shared/programRegistry.js';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const rpcClient = getRpcClient();
    const database = getDatabase();
    const indexer = getIndexer();
    const dispatcher = getEventDispatcher();
    const registry = getProgramRegistry();

    // Check RPC health
    const rpcHealthy = await rpcClient.healthCheck();

    // Check database health
    const dbHealthy = database.isConnected();

    // Get component statuses
    const indexerStatus = indexer.getStatus();
    const dispatcherStats = dispatcher.getStats();
    const registryStats = registry.getStats();

    const isHealthy = rpcHealthy && dbHealthy && indexerStatus.isRunning;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: Date.now(),
      components: {
        rpc: {
          healthy: rpcHealthy,
          endpoint: rpcClient.getCurrentEndpoint(),
        },
        database: {
          healthy: dbHealthy,
        },
        indexer: {
          healthy: indexerStatus.isRunning,
          ...indexerStatus,
        },
        eventDispatcher: {
          ...dispatcherStats,
        },
        programRegistry: {
          ...registryStats,
        },
      },
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: Date.now(),
    });
  }
});

export default router;
