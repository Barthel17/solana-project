import EventEmitter from 'events';
import { createLogger } from '../utils/logger.js';
import { MarketEvent, MarketEventType } from '../normalize/types.js';

const logger = createLogger('event-dispatcher');

export type EventHandler = (event: MarketEvent) => void | Promise<void>;

export interface ReplayBufferOptions {
  enabled: boolean;
  maxSize: number;
  ttlMs?: number;
}

interface BufferedEvent {
  event: MarketEvent;
  timestamp: number;
}

/**
 * Event dispatcher with pub/sub, replay buffer, and type-safe routing
 */
export class EventDispatcher extends EventEmitter {
  private replayBuffer: BufferedEvent[] = [];
  private replayBufferConfig: ReplayBufferOptions;
  private handlers = new Map<MarketEventType, Set<EventHandler>>();
  private globalHandlers = new Set<EventHandler>();
  private processingQueue: MarketEvent[] = [];
  private isProcessing = false;

  constructor(replayBufferConfig: ReplayBufferOptions = { enabled: true, maxSize: 1000 }) {
    super();
    this.replayBufferConfig = replayBufferConfig;
    this.setMaxListeners(100); // Increase max listeners for many subscriptions

    // Cleanup old events periodically
    if (replayBufferConfig.ttlMs) {
      setInterval(() => this.cleanupOldEvents(), 60000); // Every minute
    }

    logger.info(
      { replayBufferEnabled: replayBufferConfig.enabled, maxSize: replayBufferConfig.maxSize },
      'Event dispatcher initialized'
    );
  }

  /**
   * Emit a market event to all subscribers
   */
  async dispatch(event: MarketEvent): Promise<void> {
    // Add to replay buffer
    if (this.replayBufferConfig.enabled) {
      this.addToReplayBuffer(event);
    }

    // Add to processing queue
    this.processingQueue.push(event);

    // Process queue
    await this.processQueue();
  }

  /**
   * Process event queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.processingQueue.length > 0) {
        const event = this.processingQueue.shift()!;
        await this.processEvent(event);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single event
   */
  private async processEvent(event: MarketEvent): Promise<void> {
    const eventHandlers = this.handlers.get(event.type);
    const allHandlers = [
      ...(eventHandlers ? Array.from(eventHandlers) : []),
      ...Array.from(this.globalHandlers),
    ];

    if (allHandlers.length === 0) {
      logger.debug({ eventType: event.type }, 'No handlers registered for event type');
      return;
    }

    // Execute all handlers in parallel
    const handlerPromises = allHandlers.map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        logger.error(
          { error, eventType: event.type, eventData: event.data },
          'Error in event handler'
        );
      }
    });

    await Promise.allSettled(handlerPromises);

    // Also emit as standard EventEmitter event for compatibility
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard event
  }

  /**
   * Subscribe to a specific event type
   */
  on(eventType: MarketEventType, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler);
    logger.debug({ eventType }, 'Handler registered for event type');
  }

  /**
   * Subscribe to all events
   */
  onAll(handler: EventHandler): void {
    this.globalHandlers.add(handler);
    logger.debug('Global handler registered');
  }

  /**
   * Unsubscribe from a specific event type
   */
  off(eventType: MarketEventType, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      logger.debug({ eventType }, 'Handler unregistered');
    }
  }

  /**
   * Unsubscribe from all events
   */
  offAll(handler: EventHandler): void {
    this.globalHandlers.delete(handler);
    logger.debug('Global handler unregistered');
  }

  /**
   * Subscribe once to an event type
   */
  once(eventType: MarketEventType, handler: EventHandler): void {
    const wrappedHandler: EventHandler = async (event: MarketEvent) => {
      await handler(event);
      this.off(eventType, wrappedHandler);
    };

    this.on(eventType, wrappedHandler);
  }

  /**
   * Add event to replay buffer
   */
  private addToReplayBuffer(event: MarketEvent): void {
    this.replayBuffer.push({
      event,
      timestamp: Date.now(),
    });

    // Trim buffer if it exceeds max size
    if (this.replayBuffer.length > this.replayBufferConfig.maxSize) {
      const excess = this.replayBuffer.length - this.replayBufferConfig.maxSize;
      this.replayBuffer.splice(0, excess);
    }
  }

  /**
   * Clean up old events from replay buffer based on TTL
   */
  private cleanupOldEvents(): void {
    if (!this.replayBufferConfig.ttlMs) {
      return;
    }

    const now = Date.now();
    const cutoff = now - this.replayBufferConfig.ttlMs;

    const originalSize = this.replayBuffer.length;
    this.replayBuffer = this.replayBuffer.filter((item) => item.timestamp > cutoff);

    const removed = originalSize - this.replayBuffer.length;
    if (removed > 0) {
      logger.debug({ removed, remaining: this.replayBuffer.length }, 'Cleaned up old events');
    }
  }

  /**
   * Get replay buffer for new subscribers
   */
  getReplayBuffer(eventType?: MarketEventType, since?: number): MarketEvent[] {
    let events = this.replayBuffer.map((item) => item.event);

    // Filter by event type if specified
    if (eventType) {
      events = events.filter((event) => event.type === eventType);
    }

    // Filter by timestamp if specified
    if (since) {
      events = events.filter((event) => event.timestamp >= since);
    }

    return events;
  }

  /**
   * Replay events to a new subscriber
   */
  async replayTo(
    handler: EventHandler,
    eventType?: MarketEventType,
    since?: number
  ): Promise<void> {
    const events = this.getReplayBuffer(eventType, since);

    logger.info(
      { eventType, since, eventCount: events.length },
      'Replaying events to new subscriber'
    );

    for (const event of events) {
      try {
        await handler(event);
      } catch (error) {
        logger.error({ error, event }, 'Error replaying event');
      }
    }
  }

  /**
   * Clear replay buffer
   */
  clearReplayBuffer(): void {
    const size = this.replayBuffer.length;
    this.replayBuffer = [];
    logger.info({ clearedEvents: size }, 'Replay buffer cleared');
  }

  /**
   * Get statistics about the dispatcher
   */
  getStats(): {
    replayBufferSize: number;
    handlerCounts: Record<string, number>;
    globalHandlers: number;
    queuedEvents: number;
    isProcessing: boolean;
  } {
    const handlerCounts: Record<string, number> = {};
    for (const [eventType, handlers] of this.handlers.entries()) {
      handlerCounts[eventType] = handlers.size;
    }

    return {
      replayBufferSize: this.replayBuffer.length,
      handlerCounts,
      globalHandlers: this.globalHandlers.size,
      queuedEvents: this.processingQueue.length,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Wait for all queued events to be processed
   */
  async waitForIdle(): Promise<void> {
    while (this.processingQueue.length > 0 || this.isProcessing) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Cleanup and remove all handlers
   */
  cleanup(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
    this.processingQueue = [];
    this.removeAllListeners();
    logger.info('Event dispatcher cleaned up');
  }
}

// Singleton instance
let dispatcher: EventDispatcher | null = null;

export function initializeEventDispatcher(
  replayBufferConfig?: ReplayBufferOptions
): EventDispatcher {
  if (!dispatcher) {
    dispatcher = new EventDispatcher(replayBufferConfig);
  }
  return dispatcher;
}

export function getEventDispatcher(): EventDispatcher {
  if (!dispatcher) {
    throw new Error('Event dispatcher not initialized');
  }
  return dispatcher;
}
