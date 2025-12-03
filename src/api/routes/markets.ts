import { Router, Request, Response } from 'express';
import { getDatabase } from '../../storage/db.js';
import { createLogger } from '../../utils/logger.js';
import { CandleInterval } from '../../normalize/types.js';

const router = Router();
const logger = createLogger('markets-routes');

/**
 * GET /api/markets
 * Get all markets with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();

    const filters = {
      status: req.query.status as any,
      category: req.query.category as string,
      programId: req.query.programId as string,
      createdAfter: req.query.createdAfter
        ? parseInt(req.query.createdAfter as string)
        : undefined,
      createdBefore: req.query.createdBefore
        ? parseInt(req.query.createdBefore as string)
        : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const markets = await db.getAllMarkets(filters);

    res.json({
      data: markets,
      count: markets.length,
      filters,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to fetch markets');
    res.status(500).json({
      error: 'Failed to fetch markets',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id
 * Get specific market details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const market = await db.getMarket(req.params.id);

    if (!market) {
      return res.status(404).json({
        error: 'Market not found',
        marketId: req.params.id,
      });
    }

    res.json({ data: market });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch market');
    res.status(500).json({
      error: 'Failed to fetch market',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/trades
 * Get trades for a market
 */
router.get('/:id/trades', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const trades = await db.getTrades(req.params.id, limit, offset);

    res.json({
      data: trades,
      count: trades.length,
      marketId: req.params.id,
    });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch trades');
    res.status(500).json({
      error: 'Failed to fetch trades',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/orders
 * Get orders for a market
 */
router.get('/:id/orders', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const status = req.query.status as any;

    const orders = await db.getOrders(req.params.id, status);

    res.json({
      data: orders,
      count: orders.length,
      marketId: req.params.id,
      status,
    });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch orders');
    res.status(500).json({
      error: 'Failed to fetch orders',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/orderbook
 * Get current orderbook for a market outcome
 */
router.get('/:id/orderbook', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const outcomeId = req.query.outcomeId as string;

    if (!outcomeId) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'outcomeId query parameter is required',
      });
    }

    const orderbook = await db.getLatestOrderbook(req.params.id, outcomeId);

    if (!orderbook) {
      return res.status(404).json({
        error: 'Orderbook not found',
        marketId: req.params.id,
        outcomeId,
      });
    }

    res.json({ data: orderbook });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch orderbook');
    res.status(500).json({
      error: 'Failed to fetch orderbook',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/resolution
 * Get resolution for a market
 */
router.get('/:id/resolution', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const resolution = await db.getResolution(req.params.id);

    if (!resolution) {
      return res.status(404).json({
        error: 'Resolution not found',
        marketId: req.params.id,
        message: 'Market may not be resolved yet',
      });
    }

    res.json({ data: resolution });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch resolution');
    res.status(500).json({
      error: 'Failed to fetch resolution',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/oracle-updates
 * Get oracle updates for a market
 */
router.get('/:id/oracle-updates', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

    const updates = await db.getOracleUpdates(req.params.id, limit);

    res.json({
      data: updates,
      count: updates.length,
      marketId: req.params.id,
    });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch oracle updates');
    res.status(500).json({
      error: 'Failed to fetch oracle updates',
      message: error.message,
    });
  }
});

/**
 * GET /api/markets/:id/history
 * Get historical candle data for a market outcome
 */
router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const outcomeId = req.query.outcomeId as string;
    const interval = (req.query.interval as CandleInterval) || '1h';
    const startTime = req.query.startTime
      ? parseInt(req.query.startTime as string)
      : undefined;
    const endTime = req.query.endTime
      ? parseInt(req.query.endTime as string)
      : undefined;

    if (!outcomeId) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'outcomeId query parameter is required',
      });
    }

    const candles = await db.getCandles(
      req.params.id,
      outcomeId,
      interval,
      startTime,
      endTime
    );

    res.json({
      data: candles,
      count: candles.length,
      marketId: req.params.id,
      outcomeId,
      interval,
    });
  } catch (error: any) {
    logger.error({ error, marketId: req.params.id }, 'Failed to fetch history');
    res.status(500).json({
      error: 'Failed to fetch history',
      message: error.message,
    });
  }
});

export default router;
