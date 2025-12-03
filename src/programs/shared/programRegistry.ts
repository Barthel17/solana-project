import { createLogger } from '../../utils/logger.js';
import { MarketAdapter } from './baseAdapter.js';

const logger = createLogger('program-registry');

/**
 * Central registry for all market program adapters
 */
export class ProgramRegistry {
  private adapters = new Map<string, MarketAdapter>();

  /**
   * Register a program adapter
   */
  registerAdapter(adapter: MarketAdapter): void {
    if (this.adapters.has(adapter.programId)) {
      logger.warn(
        { programId: adapter.programId },
        'Overwriting existing adapter'
      );
    }

    this.adapters.set(adapter.programId, adapter);
    
    logger.info(
      {
        programId: adapter.programId,
        supportedTypes: adapter.getSupportedAccountTypes(),
      },
      'Adapter registered'
    );
  }

  /**
   * Get adapter for a program ID
   */
  getAdapter(programId: string): MarketAdapter | undefined {
    return this.adapters.get(programId);
  }

  /**
   * Check if adapter exists for program ID
   */
  hasAdapter(programId: string): boolean {
    return this.adapters.has(programId);
  }

  /**
   * Get all registered program IDs
   */
  getRegisteredProgramIds(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registered adapters
   */
  getAllAdapters(): MarketAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Unregister an adapter
   */
  unregisterAdapter(programId: string): boolean {
    const result = this.adapters.delete(programId);
    if (result) {
      logger.info({ programId }, 'Adapter unregistered');
    }
    return result;
  }

  /**
   * Clear all adapters
   */
  clear(): void {
    const count = this.adapters.size;
    this.adapters.clear();
    logger.info({ count }, 'All adapters cleared');
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalAdapters: number;
    programIds: string[];
  } {
    return {
      totalAdapters: this.adapters.size,
      programIds: this.getRegisteredProgramIds(),
    };
  }
}

// Singleton instance
let registry: ProgramRegistry | null = null;

export function initializeProgramRegistry(): ProgramRegistry {
  if (!registry) {
    registry = new ProgramRegistry();
  }
  return registry;
}

export function getProgramRegistry(): ProgramRegistry {
  if (!registry) {
    throw new Error('Program registry not initialized');
  }
  return registry;
}
