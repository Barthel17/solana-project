#!/usr/bin/env node
import { initializeDatabase } from './db.js';
import { createLogger } from '../utils/logger.js';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { config } from '../utils/config.js';

const logger = createLogger('migrate');

async function runMigrations() {
  try {
    logger.info('Starting database migrations...');

    // Ensure data directory exists
    if (config.databaseType === 'sqlite') {
      const dir = dirname(config.databasePath);
      await mkdir(dir, { recursive: true });
      logger.info({ path: dir }, 'Ensured data directory exists');
    }

    // Initialize and run migrations
    const db = await initializeDatabase();
    
    logger.info('Migrations completed successfully');
    
    await db.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

runMigrations();
