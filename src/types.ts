/**
 * Type definitions for Weather Prediction Market Trading Bot
 */

// =============================================================================
// MARKET TYPES
// =============================================================================

export interface WeatherMarket {
  id: string;
  title: string;
  description: string;
  category: WeatherCategory;
  city: string;
  state?: string;
  
  // Token information
  yesTokenMint: string;
  noTokenMint: string;
  
  // Pricing (0-1 scale, where 1 = $1.00)
  yesPrice: number;
  noPrice: number;
  
  // Market metadata
  resolutionDate: Date;
  resolutionSource: string;
  volume24h: number;
  liquidity: number;
  
  // Market condition
  condition: MarketCondition;
  threshold?: number; // e.g., temperature threshold
  comparison?: 'above' | 'below' | 'between';
  
  // Source tracking
  source: 'kalshi' | 'polymarket' | 'other';
  externalId: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type WeatherCategory = 
  | 'temperature'
  | 'temperature_high'
  | 'temperature_low'
  | 'precipitation'
  | 'rainfall'
  | 'snow'
  | 'hurricane'
  | 'wind'
  | 'other';

export interface MarketCondition {
  type: 'temperature' | 'precipitation' | 'snow' | 'hurricane' | 'wind';
  metric: string;
  threshold: number;
  unit: string;
  comparison: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'between';
  upperBound?: number;
}

// =============================================================================
// FORECAST TYPES
// =============================================================================

export interface WeatherForecast {
  city: string;
  state: string;
  lat: number;
  lon: number;
  forecastDate: Date;
  generatedAt: Date;
  source: ForecastSource;
  
  // Temperature forecasts
  temperatureHigh?: TemperatureForecast;
  temperatureLow?: TemperatureForecast;
  temperatureMean?: TemperatureForecast;
  
  // Precipitation forecasts
  precipProbability?: number; // 0-1
  precipAmount?: PrecipitationForecast;
  
  // Snow forecasts
  snowProbability?: number;
  snowAmount?: PrecipitationForecast;
  
  // Other
  windSpeed?: RangeForecast;
  humidity?: number;
  
  // Confidence
  confidence: number; // 0-1
}

export interface TemperatureForecast {
  value: number;
  unit: 'F' | 'C';
  min?: number;
  max?: number;
  stdDev?: number;
}

export interface PrecipitationForecast {
  value: number;
  unit: 'in' | 'mm';
  min?: number;
  max?: number;
  probability: number;
}

export interface RangeForecast {
  value: number;
  min?: number;
  max?: number;
  unit: string;
}

export type ForecastSource = 'nws' | 'openweathermap' | 'accuweather' | 'weathercom' | 'ensemble';

export interface EnsembleForecast {
  city: string;
  state: string;
  forecastDate: Date;
  sources: ForecastSource[];
  
  // Aggregated temperature distribution
  temperatureHigh: ProbabilityDistribution;
  temperatureLow: ProbabilityDistribution;
  
  // Aggregated precipitation
  precipProbability: number;
  precipAmount: ProbabilityDistribution;
  
  // Snow
  snowProbability: number;
  snowAmount: ProbabilityDistribution;
  
  // Confidence (weighted by source reliability)
  confidence: number;
}

export interface ProbabilityDistribution {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  percentiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
}

// =============================================================================
// EDGE & TRADING TYPES
// =============================================================================

export interface MarketEdge {
  market: WeatherMarket;
  forecast: EnsembleForecast;
  
  // Our calculated probability
  ourProbability: number;
  
  // Market implied probability (yes price)
  marketProbability: number;
  
  // Edge calculation
  edge: number; // ourProbability - marketProbability (can be negative)
  absEdge: number; // Absolute value
  
  // Trading recommendation
  side: 'yes' | 'no' | 'none';
  expectedValue: number;
  confidence: number;
  
  // Kelly sizing
  kellyFraction: number;
  recommendedSize: number;
  
  // Timestamps
  calculatedAt: Date;
}

export interface TradeSignal {
  market: WeatherMarket;
  edge: MarketEdge;
  
  side: 'buy_yes' | 'buy_no';
  sizeUsdc: number;
  expectedTokens: number;
  
  // Execution params
  slippage: number;
  priority: 'low' | 'medium' | 'high';
  
  // Risk metrics
  maxLoss: number;
  expectedProfit: number;
  riskRewardRatio: number;
  
  createdAt: Date;
  expiresAt: Date;
}

export interface Trade {
  id: string;
  signal: TradeSignal;
  
  // Execution details
  status: TradeStatus;
  txSignature?: string;
  
  // Actual execution
  executedPrice?: number;
  executedSize?: number;
  tokensReceived?: number;
  feePaid?: number;
  
  // Timestamps
  createdAt: Date;
  executedAt?: Date;
  
  // Error tracking
  error?: string;
  retryCount: number;
}

export type TradeStatus = 
  | 'pending'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled';

export interface Position {
  market: WeatherMarket;
  side: 'yes' | 'no';
  
  // Position details
  tokens: number;
  avgEntryPrice: number;
  totalCost: number;
  
  // Current state
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  
  // Edge tracking
  entryEdge: number;
  currentEdge: number;
  
  // Timestamps
  openedAt: Date;
  updatedAt: Date;
}

// =============================================================================
// BOT STATE TYPES
// =============================================================================

export interface BotState {
  status: BotStatus;
  lastRun: Date | null;
  nextRun: Date | null;
  
  // Statistics
  stats: BotStats;
  
  // Current state
  markets: WeatherMarket[];
  edges: MarketEdge[];
  positions: Position[];
  
  // Recent activity
  recentTrades: Trade[];
  recentAlerts: Alert[];
  
  // Errors
  lastError?: string;
  errorCount: number;
}

export type BotStatus = 
  | 'idle'
  | 'running'
  | 'trading'
  | 'error'
  | 'paused';

export interface BotStats {
  // Trading stats
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  
  // PnL
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  
  // Performance
  sharpeRatio?: number;
  maxDrawdown: number;
  avgEdge: number;
  
  // Activity
  marketsScanned: number;
  edgesFound: number;
  tradesExecuted: number;
  
  // Time tracking
  uptimeSeconds: number;
  lastTradeAt?: Date;
}

// =============================================================================
// ALERT TYPES
// =============================================================================

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: Date;
  sentVia: ('telegram' | 'discord' | 'log')[];
}

export type AlertType = 
  | 'edge_found'
  | 'trade_executed'
  | 'trade_failed'
  | 'position_closed'
  | 'error'
  | 'warning'
  | 'info';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlan[];
}

export interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface NWSForecastResponse {
  properties: {
    periods: NWSForecastPeriod[];
    generatedAt: string;
    updateTime: string;
  };
}

export interface NWSForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  temperature: number;
  temperatureUnit: string;
  temperatureTrend?: string;
  probabilityOfPrecipitation: {
    value: number | null;
  };
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  isDaytime: boolean;
}

export interface OpenWeatherResponse {
  lat: number;
  lon: number;
  daily: OpenWeatherDaily[];
}

export interface OpenWeatherDaily {
  dt: number;
  temp: {
    day: number;
    min: number;
    max: number;
    night: number;
    eve: number;
    morn: number;
  };
  feels_like: {
    day: number;
    night: number;
    eve: number;
    morn: number;
  };
  pressure: number;
  humidity: number;
  weather: { id: number; main: string; description: string }[];
  pop: number; // Probability of precipitation
  rain?: number;
  snow?: number;
  wind_speed: number;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface BotConfig {
  // Solana
  solana: {
    rpcUrl: string;
    commitment: 'processed' | 'confirmed' | 'finalized';
  };
  
  // Trading
  trading: {
    minEdgeThreshold: number;
    maxEdgeThreshold: number;
    positionSizingMethod: 'kelly' | 'fixed';
    fixedPositionSizeUsdc: number;
    kellyFraction: number;
    maxPositionSizeUsdc: number;
    maxTotalExposureUsdc: number;
    slippageTolerance: number;
    takeProfitEdge: number;
    autoTradeEnabled: boolean;
  };
  
  // Bot
  bot: {
    intervalMinutes: number;
    focusCities: string[];
    marketCategories: WeatherCategory[];
  };
  
  // Weather APIs
  weather: {
    nwsUserAgent: string;
    openWeatherMapApiKey?: string;
    accuWeatherApiKey?: string;
    ibmWeatherApiKey?: string;
  };
  
  // Alerts
  alerts: {
    telegramBotToken?: string;
    telegramChatId?: string;
    discordWebhookUrl?: string;
    alertOnTrades: boolean;
    alertOnEdges: boolean;
    alertOnErrors: boolean;
  };
  
  // Logging
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    toFile: boolean;
    filePath: string;
  };
  
  // API
  api: {
    port: number;
    apiKey: string;
  };
  
  // Kalshi
  kalshi: {
    apiKey?: string;
    privateKey?: string;
  };
}

// =============================================================================
// CITY DATA
// =============================================================================

export interface CityInfo {
  code: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  nwsGridpoint: {
    office: string;
    gridX: number;
    gridY: number;
  };
  timezone: string;
}

export const SUPPORTED_CITIES: Record<string, CityInfo> = {
  NYC: {
    code: 'NYC',
    name: 'New York',
    state: 'NY',
    lat: 40.7128,
    lon: -74.0060,
    nwsGridpoint: { office: 'OKX', gridX: 33, gridY: 37 },
    timezone: 'America/New_York',
  },
  LAX: {
    code: 'LAX',
    name: 'Los Angeles',
    state: 'CA',
    lat: 34.0522,
    lon: -118.2437,
    nwsGridpoint: { office: 'LOX', gridX: 154, gridY: 44 },
    timezone: 'America/Los_Angeles',
  },
  CHI: {
    code: 'CHI',
    name: 'Chicago',
    state: 'IL',
    lat: 41.8781,
    lon: -87.6298,
    nwsGridpoint: { office: 'LOT', gridX: 65, gridY: 76 },
    timezone: 'America/Chicago',
  },
  DFW: {
    code: 'DFW',
    name: 'Dallas',
    state: 'TX',
    lat: 32.7767,
    lon: -96.7970,
    nwsGridpoint: { office: 'FWD', gridX: 79, gridY: 108 },
    timezone: 'America/Chicago',
  },
  DEN: {
    code: 'DEN',
    name: 'Denver',
    state: 'CO',
    lat: 39.7392,
    lon: -104.9903,
    nwsGridpoint: { office: 'BOU', gridX: 62, gridY: 60 },
    timezone: 'America/Denver',
  },
  MIA: {
    code: 'MIA',
    name: 'Miami',
    state: 'FL',
    lat: 25.7617,
    lon: -80.1918,
    nwsGridpoint: { office: 'MFL', gridX: 110, gridY: 50 },
    timezone: 'America/New_York',
  },
  PHX: {
    code: 'PHX',
    name: 'Phoenix',
    state: 'AZ',
    lat: 33.4484,
    lon: -112.0740,
    nwsGridpoint: { office: 'PSR', gridX: 159, gridY: 57 },
    timezone: 'America/Phoenix',
  },
  SEA: {
    code: 'SEA',
    name: 'Seattle',
    state: 'WA',
    lat: 47.6062,
    lon: -122.3321,
    nwsGridpoint: { office: 'SEW', gridX: 124, gridY: 67 },
    timezone: 'America/Los_Angeles',
  },
  ATL: {
    code: 'ATL',
    name: 'Atlanta',
    state: 'GA',
    lat: 33.7490,
    lon: -84.3880,
    nwsGridpoint: { office: 'FFC', gridX: 50, gridY: 86 },
    timezone: 'America/New_York',
  },
  BOS: {
    code: 'BOS',
    name: 'Boston',
    state: 'MA',
    lat: 42.3601,
    lon: -71.0589,
    nwsGridpoint: { office: 'BOX', gridX: 71, gridY: 90 },
    timezone: 'America/New_York',
  },
};


