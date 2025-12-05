/**
 * API client for communicating with the bot backend
 */

const BOT_API_URL = process.env.NEXT_PUBLIC_BOT_API_URL || 'http://localhost:3001';
const BOT_API_KEY = process.env.NEXT_PUBLIC_BOT_API_KEY || 'default_api_key';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BOT_API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${BOT_API_KEY}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`);
  }

  return response.json();
}

// Types matching backend
export interface BotStatus {
  status: 'idle' | 'running' | 'trading' | 'error' | 'paused';
  lastRun: string | null;
  nextRun: string | null;
  errorCount: number;
  lastError?: string;
}

export interface BotStats {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  maxDrawdown: number;
  avgEdge: number;
  marketsScanned: number;
  edgesFound: number;
  tradesExecuted: number;
  uptimeSeconds: number;
  lastTradeAt?: string;
}

export interface Market {
  id: string;
  title: string;
  city: string;
  yesPrice: number;
  noPrice: number;
  resolutionDate: string;
  volume24h: number;
}

export interface Edge {
  marketId: string;
  marketTitle: string;
  city: string;
  ourProbability: number;
  marketProbability: number;
  edge: number;
  absEdge?: number;
  side: 'yes' | 'no' | 'none';
  expectedValue?: number;
  recommendedSize: number;
  calculatedAt?: string;
}

export interface Position {
  market: {
    id: string;
    title: string;
  };
  side: 'yes' | 'no';
  tokens: number;
  avgEntryPrice: number;
  totalCost: number;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

export interface Trade {
  id: string;
  signal: {
    market: { title: string };
    side: 'buy_yes' | 'buy_no';
    sizeUsdc: number;
    edge: { edge: number };
  };
  status: 'pending' | 'submitted' | 'confirmed' | 'failed' | 'cancelled';
  txSignature?: string;
  executedAt?: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  createdAt: string;
}

export interface BotState {
  status: BotStatus['status'];
  lastRun: string | null;
  nextRun: string | null;
  stats: BotStats;
  markets: Market[];
  edges: Edge[];
  positions: Position[];
  recentTrades: Trade[];
  recentAlerts: Alert[];
}

// API functions
export async function getBotStatus(): Promise<BotStatus> {
  return fetchAPI<BotStatus>('/api/status');
}

export async function getBotStats(): Promise<BotStats> {
  return fetchAPI<BotStats>('/api/stats');
}

export async function getMarkets(): Promise<Market[]> {
  return fetchAPI<Market[]>('/api/markets');
}

export async function getEdges(): Promise<Edge[]> {
  return fetchAPI<Edge[]>('/api/edges');
}

export async function getPositions(): Promise<Position[]> {
  return fetchAPI<Position[]>('/api/positions');
}

export async function getTrades(): Promise<Trade[]> {
  return fetchAPI<Trade[]>('/api/trades');
}

export async function getAlerts(): Promise<Alert[]> {
  return fetchAPI<Alert[]>('/api/alerts');
}

export async function getBotState(): Promise<BotState> {
  return fetchAPI<BotState>('/api/state');
}

export async function triggerCycle(): Promise<{ message: string }> {
  return fetchAPI<{ message: string }>('/api/trigger', { method: 'POST' });
}

export async function getHealth(): Promise<{ healthy: boolean; status: string; uptime: number }> {
  return fetchAPI('/api/health');
}


