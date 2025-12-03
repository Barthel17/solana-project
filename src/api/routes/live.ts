/**
 * WebSocket live feed routes
 */

import { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { getEventDispatcher } from '../../indexer/eventDispatcher.js';
import { IndexerEvent, IndexerEventType } from '../../normalize/types.js';
import { logger } from '../../utils/logger.js';

interface WebSocketClient {
  ws: WebSocket;
  subscriptionId?: string;
  filters?: {
    eventTypes?: IndexerEventType[];
    protocols?: string[];
    marketIds?: string[];
  };
}

const clients = new Set<WebSocketClient>();

export function registerWebSocketRoutes(server: FastifyInstance): void {
  /**
   * WebSocket endpoint for live updates
   */
  server.get('/live', { websocket: true }, (connection, request) => {
    const ws = connection.socket;
    const client: WebSocketClient = { ws };
    
    clients.add(client);
    
    logger.info({ remoteAddress: request.ip }, 'WebSocket client connected');
    
    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to Solana Prediction Market live feed',
        timestamp: new Date().toISOString(),
      })
    );
    
    // Handle incoming messages (for subscriptions)
    ws.on('message', (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        handleClientMessage(client, data);
      } catch (error) {
        logger.error({ error }, 'Error parsing WebSocket message');
        ws.send(
          JSON.stringify({
            type: 'error',
            error: 'Invalid message format',
          })
        );
      }
    });
    
    // Handle disconnection
    ws.on('close', () => {
      logger.info('WebSocket client disconnected');
      
      // Unsubscribe from events
      if (client.subscriptionId) {
        const eventDispatcher = getEventDispatcher();
        eventDispatcher.unsubscribe(client.subscriptionId);
      }
      
      clients.delete(client);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
    });
    
    // Subscribe to all events by default
    subscribeClientToEvents(client);
  });
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(client: WebSocketClient, data: any): void {
  const { type, payload } = data;
  
  switch (type) {
    case 'subscribe':
      // Update filters and resubscribe
      if (payload) {
        client.filters = {
          eventTypes: payload.eventTypes,
          protocols: payload.protocols,
          marketIds: payload.marketIds,
        };
      }
      
      // Resubscribe with new filters
      if (client.subscriptionId) {
        const eventDispatcher = getEventDispatcher();
        eventDispatcher.unsubscribe(client.subscriptionId);
      }
      
      subscribeClientToEvents(client);
      
      client.ws.send(
        JSON.stringify({
          type: 'subscribed',
          filters: client.filters,
        })
      );
      break;
    
    case 'unsubscribe':
      if (client.subscriptionId) {
        const eventDispatcher = getEventDispatcher();
        eventDispatcher.unsubscribe(client.subscriptionId);
        client.subscriptionId = undefined;
      }
      
      client.ws.send(
        JSON.stringify({
          type: 'unsubscribed',
        })
      );
      break;
    
    case 'ping':
      client.ws.send(
        JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
        })
      );
      break;
    
    default:
      client.ws.send(
        JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${type}`,
        })
      );
  }
}

/**
 * Subscribe client to events
 */
function subscribeClientToEvents(client: WebSocketClient): void {
  const eventDispatcher = getEventDispatcher();
  
  client.subscriptionId = eventDispatcher.subscribeToAll((event: IndexerEvent) => {
    // Apply filters
    if (client.filters) {
      if (
        client.filters.eventTypes &&
        !client.filters.eventTypes.includes(event.type)
      ) {
        return;
      }
      
      if (
        client.filters.protocols &&
        !client.filters.protocols.includes(event.protocol)
      ) {
        return;
      }
      
      if (client.filters.marketIds) {
        // Check if event is related to filtered market IDs
        const marketId = (event.data as any)?.id || (event.data as any)?.marketId;
        if (marketId && !client.filters.marketIds.includes(marketId)) {
          return;
        }
      }
    }
    
    // Send event to client
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(
          JSON.stringify({
            type: 'event',
            event: {
              type: event.type,
              protocol: event.protocol,
              data: event.data,
              slot: event.slot,
              signature: event.signature,
              timestamp: event.timestamp,
            },
          })
        );
      }
    } catch (error) {
      logger.error({ error }, 'Error sending event to WebSocket client');
    }
  });
}

/**
 * Broadcast message to all connected clients
 */
export function broadcastToClients(message: any): void {
  const messageStr = JSON.stringify(message);
  
  for (const client of clients) {
    try {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    } catch (error) {
      logger.error({ error }, 'Error broadcasting to client');
    }
  }
}

/**
 * Get connected clients count
 */
export function getConnectedClientsCount(): number {
  return clients.size;
}

