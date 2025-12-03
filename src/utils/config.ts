import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const ConfigSchema = z.object({
  // Solana RPC
  solanaRpcHttp: z.string().url(),
  solanaRpcWs: z.string().url(),
  solanaRpcFallbacks: z.array(z.string().url()),

  // Database
  databaseType: z.enum(['sqlite', 'postgres']),
  databasePath: z.string(),

  // API Server
  port: z.number().int().positive(),
  host: z.string(),
  apiRateLimit: z.number().int().positive(),

  // Indexer
  indexerEnabled: z.boolean(),
  indexerBatchSize: z.number().int().positive(),
  indexerPollInterval: z.number().int().positive(),

  // Logging
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
  logPretty: z.boolean(),

  // Program IDs
  programIds: z.array(z.string()),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseConfig(): Config {
  const raw = {
    solanaRpcHttp: process.env.SOLANA_RPC_HTTP || 'https://api.mainnet-beta.solana.com',
    solanaRpcWs: process.env.SOLANA_RPC_WS || 'wss://api.mainnet-beta.solana.com',
    solanaRpcFallbacks: (process.env.SOLANA_RPC_FALLBACK_1 || process.env.SOLANA_RPC_FALLBACK_2)
      ? [process.env.SOLANA_RPC_FALLBACK_1, process.env.SOLANA_RPC_FALLBACK_2].filter(Boolean)
      : [],

    databaseType: (process.env.DATABASE_TYPE || 'sqlite') as 'sqlite' | 'postgres',
    databasePath: process.env.DATABASE_PATH || './data/markets.db',

    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    apiRateLimit: parseInt(process.env.API_RATE_LIMIT || '100', 10),

    indexerEnabled: process.env.INDEXER_ENABLED !== 'false',
    indexerBatchSize: parseInt(process.env.INDEXER_BATCH_SIZE || '100', 10),
    indexerPollInterval: parseInt(process.env.INDEXER_POLL_INTERVAL || '1000', 10),

    logLevel: (process.env.LOG_LEVEL || 'info') as Config['logLevel'],
    logPretty: process.env.LOG_PRETTY !== 'false',

    programIds: process.env.PROGRAM_IDS?.split(',').map((id) => id.trim()) || [],
  };

  return ConfigSchema.parse(raw);
}

export const config = parseConfig();

