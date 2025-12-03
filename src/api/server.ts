import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { createLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { getEventDispatcher } from '../indexer/eventDispatcher.js';
import { MarketEvent } from '../normalize/types.js';
import marketRoutes from './routes/markets.js';
import healthRoutes from './routes/health.js';

const logger = createLogger('api-server');

export class ApiServer {
  private app: Express;
  private server: any;
  private wss: WebSocketServer | null = null;
  private wsClients = new Set<WebSocket>();

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // CORS
    this.app.use(cors());

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(
          {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration,
          },
          'HTTP request'
        );
      });
      
      next();
    });

    // Rate limiting (simple implementation)
    const rateLimitMap = new Map<string, number[]>();
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const ip = req.ip || 'unknown';
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      const maxRequests = config.apiRateLimit;

      if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
      }

      const requests = rateLimitMap.get(ip)!;
      const recentRequests = requests.filter((time) => now - time < windowMs);
      
      if (recentRequests.length >= maxRequests) {
        return res.status(429).json({
          error: 'Too many requests',
          message: `Rate limit exceeded. Max ${maxRequests} requests per minute.`,
        });
      }

      recentRequests.push(now);
      rateLimitMap.set(ip, recentRequests);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.use('/api/health', healthRoutes);

    // Market routes
    this.app.use('/api/markets', marketRoutes);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.path} not found`,
      });
    });
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logger.error({ error: err, path: req.path }, 'Unhandled error');

      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production' 
          ? 'An error occurred' 
          : err.message,
      });
    });
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocket(): void {
    if (!this.server) {
      throw new Error('HTTP server not initialized');
    }

    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
      
      logger.info({ clientId }, 'WebSocket client connected');
      this.wsClients.add(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: 'connected',
        data: {
          message: 'Connected to Prediction Market Data Stream',
          timestamp: Date.now(),
        },
      });

      // Handle messages from client
      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message, clientId);
        } catch (error) {
          logger.error({ error, clientId }, 'Failed to parse client message');
          this.sendToClient(ws, {
            type: 'error',
            data: { message: 'Invalid message format' },
          });
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        logger.info({ clientId }, 'WebSocket client disconnected');
        this.wsClients.delete(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        logger.error({ error, clientId }, 'WebSocket error');
        this.wsClients.delete(ws);
      });

      // Send replay buffer to new subscriber
      this.sendReplayBuffer(ws);
    });

    // Subscribe to market events and broadcast to WebSocket clients
    const dispatcher = getEventDispatcher();
    dispatcher.onAll((event: MarketEvent) => {
      this.broadcastEvent(event);
    });

    logger.info({ path: '/ws' }, 'WebSocket server initialized');
  }

  /**
   * Handle message from WebSocket client
   */
  private handleClientMessage(ws: WebSocket, message: any, clientId: string): void {
    logger.debug({ message, clientId }, 'Received client message');

    switch (message.type) {
      case 'subscribe':
        // Client wants to subscribe to specific markets/events
        this.sendToClient(ws, {
          type: 'subscribed',
          data: { marketId: message.marketId },
        });
        break;

      case 'unsubscribe':
        // Client wants to unsubscribe
        this.sendToClient(ws, {
          type: 'unsubscribed',
          data: { marketId: message.marketId },
        });
        break;

      case 'ping':
        // Heartbeat
        this.sendToClient(ws, { type: 'pong', data: { timestamp: Date.now() } });
        break;

      default:
        this.sendToClient(ws, {
          type: 'error',
          data: { message: `Unknown message type: ${message.type}` },
        });
    }
  }

  /**
   * Send replay buffer to new client
   */
  private sendReplayBuffer(ws: WebSocket): void {
    try {
      const dispatcher = getEventDispatcher();
      const events = dispatcher.getReplayBuffer();

      if (events.length > 0) {
        this.sendToClient(ws, {
          type: 'replay',
          data: {
            events,
            count: events.length,
          },
        });

        logger.debug({ eventCount: events.length }, 'Sent replay buffer to client');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to send replay buffer');
    }
  }

  /**
   * Broadcast event to all WebSocket clients
   */
  private broadcastEvent(event: MarketEvent): void {
    const message = JSON.stringify({
      type: 'event',
      data: event,
    });

    let successCount = 0;
    let errorCount = 0;

    this.wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          successCount++;
        } catch (error) {
          logger.error({ error }, 'Failed to send to client');
          errorCount++;
        }
      }
    });

    logger.debug(
      { eventType: event.type, successCount, errorCount },
      'Broadcasted event'
    );
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Start the API server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer(this.app);

      this.server.listen(config.port, config.host, () => {
        logger.info(
          { host: config.host, port: config.port },
          'API server started'
        );

        // Setup WebSocket after HTTP server is listening
        this.setupWebSocket();

        resolve();
      });
    });
  }

  /**
   * Stop the API server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close WebSocket server
      if (this.wss) {
        this.wss.close((err) => {
          if (err) {
            logger.error({ error: err }, 'Error closing WebSocket server');
          }
        });

        // Close all client connections
        this.wsClients.forEach((client) => {
          client.close();
        });
        this.wsClients.clear();
      }

      // Close HTTP server
      if (this.server) {
        this.server.close((err: Error | undefined) => {
          if (err) {
            logger.error({ error: err }, 'Error stopping API server');
            reject(err);
          } else {
            logger.info('API server stopped');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server status
   */
  getStatus(): {
    isRunning: boolean;
    wsConnections: number;
    port: number;
  } {
    return {
      isRunning: this.server !== null,
      wsConnections: this.wsClients.size,
      port: config.port,
    };
  }

  /**
   * Get Express app (for testing)
   */
  getApp(): Express {
    return this.app;
  }
}

// Singleton instance
let apiServer: ApiServer | null = null;

export function initializeApiServer(): ApiServer {
  if (!apiServer) {
    apiServer = new ApiServer();
  }
  return apiServer;
}

export function getApiServer(): ApiServer {
  if (!apiServer) {
    throw new Error('API server not initialized');
  }
  return apiServer;
}
