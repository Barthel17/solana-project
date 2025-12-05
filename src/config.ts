/**
 * Configuration loader for Weather Prediction Market Bot
 * Loads settings from environment variables with validation
 */

import { config as loadEnv } from 'dotenv';
import type { BotConfig, WeatherCategory } from './types';

// Load .env file
loadEnv();

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid number for environment variable ${key}: ${value}`);
  }
  return num;
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.toLowerCase() === 'true' || value === '1';
}

function getEnvArray(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

export function loadConfig(): BotConfig {
  return {
    solana: {
      rpcUrl: getEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
      commitment: getEnv('SOLANA_COMMITMENT', 'confirmed') as 'processed' | 'confirmed' | 'finalized',
    },
    
    trading: {
      minEdgeThreshold: getEnvNumber('MIN_EDGE_THRESHOLD', 0.08),
      maxEdgeThreshold: getEnvNumber('MAX_EDGE_THRESHOLD', 0.50),
      positionSizingMethod: getEnv('POSITION_SIZING_METHOD', 'kelly') as 'kelly' | 'fixed',
      fixedPositionSizeUsdc: getEnvNumber('FIXED_POSITION_SIZE_USDC', 50),
      kellyFraction: getEnvNumber('KELLY_FRACTION', 0.25),
      maxPositionSizeUsdc: getEnvNumber('MAX_POSITION_SIZE_USDC', 500),
      maxTotalExposureUsdc: getEnvNumber('MAX_TOTAL_EXPOSURE_USDC', 2000),
      slippageTolerance: getEnvNumber('SLIPPAGE_TOLERANCE', 0.02),
      takeProfitEdge: getEnvNumber('TAKE_PROFIT_EDGE', 0.02),
      autoTradeEnabled: getEnvBoolean('AUTO_TRADE_ENABLED', false),
    },
    
    bot: {
      intervalMinutes: getEnvNumber('BOT_INTERVAL_MINUTES', 10),
      focusCities: getEnvArray('FOCUS_CITIES'),
      marketCategories: getEnvArray('MARKET_CATEGORIES', ['temperature', 'precipitation']) as WeatherCategory[],
    },
    
    weather: {
      nwsUserAgent: getEnv('NWS_USER_AGENT', 'WeatherBot (contact@example.com)'),
      openWeatherMapApiKey: process.env['OPENWEATHERMAP_API_KEY'] || undefined,
      accuWeatherApiKey: process.env['ACCUWEATHER_API_KEY'] || undefined,
      ibmWeatherApiKey: process.env['IBM_WEATHER_API_KEY'] || undefined,
    },
    
    alerts: {
      telegramBotToken: process.env['TELEGRAM_BOT_TOKEN'] || undefined,
      telegramChatId: process.env['TELEGRAM_CHAT_ID'] || undefined,
      discordWebhookUrl: process.env['DISCORD_WEBHOOK_URL'] || undefined,
      alertOnTrades: getEnvBoolean('ALERT_ON_TRADES', true),
      alertOnEdges: getEnvBoolean('ALERT_ON_EDGES', true),
      alertOnErrors: getEnvBoolean('ALERT_ON_ERRORS', true),
    },
    
    logging: {
      level: getEnv('LOG_LEVEL', 'info') as 'error' | 'warn' | 'info' | 'debug',
      toFile: getEnvBoolean('LOG_TO_FILE', true),
      filePath: getEnv('LOG_FILE_PATH', './logs/bot.log'),
    },
    
    api: {
      port: getEnvNumber('BOT_API_PORT', 3001),
      apiKey: getEnv('BOT_API_KEY', 'default_api_key'),
    },
    
    kalshi: {
      apiKey: process.env['KALSHI_API_KEY'] || undefined,
      privateKey: process.env['KALSHI_PRIVATE_KEY'] || undefined,
    },
  };
}

// Singleton config instance
let _config: BotConfig | null = null;

export function getConfig(): BotConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Get Solana private key separately (security: don't include in config object)
export function getSolanaPrivateKey(): string {
  const key = process.env['SOLANA_PRIVATE_KEY'];
  if (!key || key === 'your_base58_encoded_private_key_here') {
    throw new Error('SOLANA_PRIVATE_KEY not configured. Please set it in your .env file.');
  }
  return key;
}

// Validate configuration
export function validateConfig(config: BotConfig): string[] {
  const errors: string[] = [];
  
  if (config.trading.minEdgeThreshold < 0 || config.trading.minEdgeThreshold > 1) {
    errors.push('MIN_EDGE_THRESHOLD must be between 0 and 1');
  }
  
  if (config.trading.maxEdgeThreshold < config.trading.minEdgeThreshold) {
    errors.push('MAX_EDGE_THRESHOLD must be greater than MIN_EDGE_THRESHOLD');
  }
  
  if (config.trading.kellyFraction <= 0 || config.trading.kellyFraction > 1) {
    errors.push('KELLY_FRACTION must be between 0 and 1');
  }
  
  if (config.trading.slippageTolerance < 0 || config.trading.slippageTolerance > 0.1) {
    errors.push('SLIPPAGE_TOLERANCE should be between 0 and 0.1 (10%)');
  }
  
  if (config.bot.intervalMinutes < 1) {
    errors.push('BOT_INTERVAL_MINUTES must be at least 1');
  }
  
  if (!config.weather.nwsUserAgent.includes('@')) {
    errors.push('NWS_USER_AGENT should include a contact email');
  }
  
  return errors;
}

export default getConfig;


