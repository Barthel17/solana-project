/**
 * Weather Prediction Market Trading Bot
 * Main orchestrator for market discovery, edge detection, and automated trading
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { logger } from './logger';
import { getConfig, validateConfig } from './config';
import { marketFetcher } from './marketFetcher';
import { forecastEngine } from './forecastEngine';
import { trader } from './trader';
import { alertManager } from './alerts';
import type {
  BotState,
  BotStatus,
  BotStats,
  WeatherMarket,
  MarketEdge,
  Trade,
  Position,
} from './types';

class WeatherMarketBot {
  private config = getConfig();
  private state: BotState;
  private isRunning = false;
  private loopInterval: NodeJS.Timeout | null = null;
  private startTime = Date.now();

  constructor() {
    this.state = {
      status: 'idle',
      lastRun: null,
      nextRun: null,
      stats: this.getInitialStats(),
      markets: [],
      edges: [],
      positions: [],
      recentTrades: [],
      recentAlerts: [],
      errorCount: 0,
    };
  }

  /**
   * Initialize and start the bot
   */
  async start(): Promise<void> {
    logger.bot('Starting Weather Market Bot...');
    
    // Validate configuration
    const configErrors = validateConfig(this.config);
    if (configErrors.length > 0) {
      logger.error('Configuration errors:', undefined, { errors: configErrors });
      throw new Error(`Configuration invalid: ${configErrors.join(', ')}`);
    }

    try {
      // Initialize trader (wallet connection) - optional for demo mode
      try {
        await trader.initialize();
        logger.bot('Trader initialized with wallet');
      } catch (walletError) {
        logger.warn('Trader not initialized - running in demo mode (no trading)', {
          error: walletError instanceof Error ? walletError.message : 'Unknown error'
        });
        logger.bot('To enable trading, set SOLANA_PRIVATE_KEY in your .env file');
      }
      
      // Start HTTP API server
      this.startApiServer();
      
      // Run initial cycle
      await this.runCycle();
      
      // Start main loop
      this.startLoop();
      
      this.state.status = 'running';
      logger.bot('Bot started successfully', {
        interval: `${this.config.bot.intervalMinutes} minutes`,
        autoTrade: this.config.trading.autoTradeEnabled,
        demoMode: !trader.isReady(),
      });

      await alertManager.alertBotStatus('Bot started', {
        autoTrade: this.config.trading.autoTradeEnabled,
        minEdge: this.config.trading.minEdgeThreshold,
        demoMode: !trader.isReady(),
      });

    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Bot startup failed', error);
      throw error;
    }
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    logger.bot('Stopping bot...');
    
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    
    this.isRunning = false;
    this.state.status = 'paused';
    
    await alertManager.alertBotStatus('Bot stopped');
    logger.bot('Bot stopped');
  }

  /**
   * Start the main trading loop
   */
  private startLoop(): void {
    const intervalMs = this.config.bot.intervalMinutes * 60 * 1000;
    
    this.loopInterval = setInterval(async () => {
      if (!this.isRunning) {
        await this.runCycle();
      }
    }, intervalMs);

    this.state.nextRun = new Date(Date.now() + intervalMs);
    logger.bot(`Next run scheduled at ${this.state.nextRun.toISOString()}`);
  }

  /**
   * Run a single trading cycle
   */
  async runCycle(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Cycle already running, skipping');
      return;
    }

    this.isRunning = true;
    this.state.status = 'running';
    const cycleStart = Date.now();

    try {
      logger.bot('Starting trading cycle...');

      // Step 1: Fetch weather markets
      const markets = await marketFetcher.fetchWeatherMarkets();
      this.state.markets = markets;
      this.state.stats.marketsScanned = markets.length;

      if (markets.length === 0) {
        logger.warn('No weather markets found');
        this.isRunning = false;
        return;
      }

      logger.bot(`Found ${markets.length} weather markets`);

      // Step 2: Calculate edges
      const edges = await forecastEngine.findEdges(markets);
      this.state.edges = edges;
      this.state.stats.edgesFound += edges.length;

      // Step 3: Alert on significant edges
      for (const edge of edges.slice(0, 5)) { // Top 5 edges
        await alertManager.alertEdgeFound(edge);
      }

      // Step 4: Execute trades if auto-trading enabled
      if (this.config.trading.autoTradeEnabled && edges.length > 0) {
        this.state.status = 'trading';
        
        // Only trade top edges
        const tradableEdges = edges.slice(0, 3);
        const trades = await trader.processEdges(tradableEdges);
        
        this.state.recentTrades = [...trader.getRecentTrades()];
        this.state.stats.tradesExecuted += trades.filter(t => t.status === 'confirmed').length;

        // Alert on trades
        for (const trade of trades) {
          if (trade.status === 'confirmed') {
            await alertManager.alertTradeExecuted(trade);
          } else if (trade.status === 'failed') {
            await alertManager.alertTradeFailed(trade);
          }
        }
      }

      // Step 5: Update positions and check for exits
      await trader.updatePositions();
      this.state.positions = trader.getPositions();
      
      const positionsToClose = await trader.checkTakeProfit();
      for (const position of positionsToClose) {
        const trade = await trader.closePosition(position);
        if (trade) {
          await alertManager.alertPositionClosed(
            position.market.title,
            position.side,
            position.unrealizedPnl,
            trade.txSignature
          );
        }
      }

      // Step 6: Update stats
      this.updateStats();
      
      const cycleDuration = Date.now() - cycleStart;
      logger.bot(`Cycle completed in ${cycleDuration}ms`, {
        markets: markets.length,
        edges: edges.length,
        positions: this.state.positions.length,
      });

      this.state.lastRun = new Date();
      this.state.nextRun = new Date(Date.now() + this.config.bot.intervalMinutes * 60 * 1000);
      this.state.status = 'idle';
      this.state.errorCount = 0;

    } catch (error) {
      this.state.status = 'error';
      this.state.errorCount++;
      this.state.lastError = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Trading cycle failed', error);
      await alertManager.alertError('Trading cycle failed', error as Error);

      // If too many errors, pause the bot
      if (this.state.errorCount >= 5) {
        logger.error('Too many errors, pausing bot');
        await this.stop();
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const pnl = trader.getTotalPnl();
    const trades = trader.getTrades();
    const positions = trader.getPositions();

    const winningTrades = trades.filter(t => 
      t.status === 'confirmed' && (t.signal.edge.expectedValue > 0)
    ).length;

    this.state.stats = {
      ...this.state.stats,
      totalTrades: trades.length,
      winningTrades,
      losingTrades: trades.filter(t => t.status === 'confirmed').length - winningTrades,
      winRate: trades.length > 0 ? winningTrades / trades.length : 0,
      totalPnl: pnl.total,
      realizedPnl: pnl.realized,
      unrealizedPnl: pnl.unrealized,
      avgEdge: this.state.edges.length > 0 
        ? this.state.edges.reduce((sum, e) => sum + e.absEdge, 0) / this.state.edges.length 
        : 0,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      lastTradeAt: trades.length > 0 ? trades[trades.length - 1]?.createdAt : undefined,
    };

    this.state.recentAlerts = alertManager.getRecentAlerts();
  }

  /**
   * Get initial stats object
   */
  private getInitialStats(): BotStats {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnl: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      maxDrawdown: 0,
      avgEdge: 0,
      marketsScanned: 0,
      edgesFound: 0,
      tradesExecuted: 0,
      uptimeSeconds: 0,
    };
  }

  /**
   * Start HTTP API server for frontend
   */
  private startApiServer(): void {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Simple API key check
      const authHeader = req.headers['authorization'];
      const apiKey = authHeader?.replace('Bearer ', '');
      
      if (apiKey !== this.config.api.apiKey && this.config.api.apiKey !== 'default_api_key') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${this.config.api.port}`);
      
      this.handleApiRequest(url.pathname, req, res);
    });

    server.listen(this.config.api.port, () => {
      logger.bot(`API server listening on port ${this.config.api.port}`);
    });
  }

  /**
   * Handle API requests
   */
  private handleApiRequest(
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): void {
    res.setHeader('Content-Type', 'application/json');

    try {
      switch (path) {
        case '/api/status':
          res.writeHead(200);
          res.end(JSON.stringify({
            status: this.state.status,
            lastRun: this.state.lastRun,
            nextRun: this.state.nextRun,
            errorCount: this.state.errorCount,
            lastError: this.state.lastError,
          }));
          break;

        case '/api/stats':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.stats));
          break;

        case '/api/markets':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.markets));
          break;

        case '/api/edges':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.edges.map(e => ({
            marketId: e.market.id,
            marketTitle: e.market.title,
            city: e.market.city,
            ourProbability: e.ourProbability,
            marketProbability: e.marketProbability,
            edge: e.edge,
            absEdge: e.absEdge,
            side: e.side,
            expectedValue: e.expectedValue,
            recommendedSize: e.recommendedSize,
            calculatedAt: e.calculatedAt,
          }))));
          break;

        case '/api/positions':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.positions));
          break;

        case '/api/trades':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.recentTrades));
          break;

        case '/api/alerts':
          res.writeHead(200);
          res.end(JSON.stringify(this.state.recentAlerts));
          break;

        case '/api/state':
          res.writeHead(200);
          res.end(JSON.stringify({
            ...this.state,
            // Don't send full market objects, just summaries
            markets: this.state.markets.map(m => ({
              id: m.id,
              title: m.title,
              city: m.city,
              yesPrice: m.yesPrice,
              noPrice: m.noPrice,
              resolutionDate: m.resolutionDate,
              volume24h: m.volume24h,
            })),
            edges: this.state.edges.map(e => ({
              marketId: e.market.id,
              marketTitle: e.market.title,
              city: e.market.city,
              ourProbability: e.ourProbability,
              marketProbability: e.marketProbability,
              edge: e.edge,
              side: e.side,
              recommendedSize: e.recommendedSize,
            })),
          }));
          break;

        case '/api/trigger':
          if (req.method === 'POST') {
            // Trigger a manual cycle
            if (this.isRunning) {
              res.writeHead(409);
              res.end(JSON.stringify({ error: 'Cycle already running' }));
            } else {
              this.runCycle().catch(err => logger.error('Manual cycle failed', err));
              res.writeHead(200);
              res.end(JSON.stringify({ message: 'Cycle triggered' }));
            }
          } else {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          }
          break;

        case '/api/health':
          res.writeHead(200);
          res.end(JSON.stringify({ 
            healthy: this.state.status !== 'error',
            status: this.state.status,
            uptime: this.state.stats.uptimeSeconds,
          }));
          break;

        default:
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      logger.error('API request failed', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Get current state
   */
  getState(): BotState {
    return this.state;
  }
}

// Main entry point
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         Weather Prediction Market Trading Bot                  ║
║                                                                ║
║  Automated edge detection and trading for weather markets      ║
╚═══════════════════════════════════════════════════════════════╝
`);

  const bot = new WeatherMarketBot();

  // Handle shutdown signals
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down...');
    await bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down...');
    await bot.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason as Error);
  });

  // Start the bot
  await bot.start();
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

export { WeatherMarketBot };
export default WeatherMarketBot;


