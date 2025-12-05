/**
 * Market Discovery & Aggregation Module
 * Fetches weather prediction markets from Kalshi (via Jupiter token list and direct API)
 */

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import crypto from 'crypto';
import { logger } from './logger';
import { getConfig } from './config';
import type {
  WeatherMarket,
  WeatherCategory,
  MarketCondition,
  JupiterQuote,
} from './types';

// Constants
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const JUPITER_TOKEN_LIST_URL = 'https://token.jup.ag/all';
const KALSHI_API_URL = 'https://trading-api.kalshi.com/trade-api/v2';

// USDC mint on Solana
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Weather-related keywords for filtering markets
const WEATHER_KEYWORDS = [
  // Temperature
  'temperature', 'temp', 'high', 'low', 'degrees', '°f', '°c',
  'hot', 'cold', 'heat', 'freeze', 'freezing',
  // Precipitation
  'rain', 'rainfall', 'precipitation', 'precip', 'inch', 'inches',
  'wet', 'dry', 'moisture',
  // Snow
  'snow', 'snowfall', 'blizzard', 'winter storm', 'ice',
  // Severe weather
  'hurricane', 'tropical storm', 'cyclone', 'typhoon',
  'tornado', 'severe', 'storm',
  // Wind
  'wind', 'windy', 'gust',
];

// City name patterns
const CITY_PATTERNS = [
  'new york', 'nyc', 'manhattan',
  'los angeles', 'la', 'lax',
  'chicago', 'chi',
  'dallas', 'dfw',
  'denver', 'den',
  'miami', 'mia',
  'phoenix', 'phx',
  'seattle', 'sea',
  'atlanta', 'atl',
  'boston', 'bos',
  'houston', 'hou',
  'san francisco', 'sf', 'sfo',
  'philadelphia', 'philly', 'phl',
  'washington', 'dc',
  'detroit', 'det',
  'minneapolis', 'msp',
  'las vegas', 'vegas',
  'orlando', 'mco',
  'austin', 'aus',
];

export class MarketFetcher {
  private jupiterClient: AxiosInstance;
  private kalshiClient: AxiosInstance;
  private config = getConfig();
  private tokenCache: Map<string, TokenInfo> = new Map();
  private marketCache: Map<string, WeatherMarket> = new Map();
  private lastFetchTime: Date | null = null;

  constructor() {
    this.jupiterClient = axios.create({
      baseURL: JUPITER_API_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });

    this.kalshiClient = axios.create({
      baseURL: KALSHI_API_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for Kalshi authentication
    this.kalshiClient.interceptors.request.use((config) => {
      return this.signKalshiRequest(config);
    });
  }

  /**
   * Sign Kalshi API request with RSA-PSS
   */
  private signKalshiRequest(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
    const kalshiKey = this.config.kalshi?.apiKey;
    const kalshiPrivateKey = this.config.kalshi?.privateKey;

    if (!kalshiKey || !kalshiPrivateKey) {
      return config; // No auth if credentials not provided
    }

    try {
      // Extract path without query parameters
      // Kalshi requires the full path including /trade-api/v2 prefix
      let path = config.url || '/';
      // Remove query string if present
      const queryIndex = path.indexOf('?');
      if (queryIndex !== -1) {
        path = path.substring(0, queryIndex);
      }
      // Ensure path starts with /
      if (!path.startsWith('/')) {
        path = '/' + path;
      }
      // The baseURL is https://trading-api.kalshi.com/trade-api/v2
      // So we need to include /trade-api/v2 in the signed path
      if (!path.startsWith('/trade-api/v2')) {
        path = '/trade-api/v2' + path;
      }
      
      const method = (config.method || 'GET').toUpperCase();
      
      // Generate timestamp (milliseconds)
      const timestamp = Date.now().toString();
      
      // Create message: timestamp + method + path
      const message = timestamp + method + path;
      
      // Load private key - handle quoted strings and newlines from .env
      let privateKeyPem = kalshiPrivateKey;
      if (privateKeyPem.startsWith('"') && privateKeyPem.endsWith('"')) {
        privateKeyPem = privateKeyPem.slice(1, -1);
      }
      // Replace literal \n with actual newlines
      privateKeyPem = privateKeyPem.replace(/\\n/g, '\n');
      
      const privateKey = crypto.createPrivateKey({
        key: privateKeyPem,
        format: 'pem',
      });
      
      // Sign with RSA-PSS SHA256
      // Kalshi uses PSS with MAX_LENGTH salt (which is -1 in Node.js crypto)
      const signature = crypto.sign('sha256', Buffer.from(message), {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN, // This is -1, which is MAX_LENGTH
      });
      
      // Base64 encode signature
      const signatureB64 = signature.toString('base64');
      
      // Add headers
      config.headers = config.headers || {};
      config.headers['KALSHI-ACCESS-KEY'] = kalshiKey;
      config.headers['KALSHI-ACCESS-TIMESTAMP'] = timestamp;
      config.headers['KALSHI-ACCESS-SIGNATURE'] = signatureB64;
      
      logger.debug('Signed Kalshi request', { path, method, timestamp, keyId: kalshiKey });
      
      return config;
    } catch (error) {
      logger.error('Failed to sign Kalshi request', error instanceof Error ? error : new Error(String(error)), {
        hasKey: !!kalshiKey,
        hasPrivateKey: !!kalshiPrivateKey,
      });
      return config;
    }
  }

  /**
   * Fetch all active weather markets
   */
  async fetchWeatherMarkets(): Promise<WeatherMarket[]> {
    logger.bot('Fetching weather markets...');
    
    const markets: WeatherMarket[] = [];
    
    try {
      // Fetch from multiple sources in parallel
      const [kalshiMarkets, jupiterTokens] = await Promise.all([
        this.fetchKalshiWeatherMarkets(),
        this.fetchJupiterWeatherTokens(),
      ]);
      
      markets.push(...kalshiMarkets);
      markets.push(...jupiterTokens);
      
      // Deduplicate by ID
      const uniqueMarkets = this.deduplicateMarkets(markets);
      
      // Filter by config settings
      const filteredMarkets = this.filterMarkets(uniqueMarkets);
      
      // Update cache
      filteredMarkets.forEach(m => this.marketCache.set(m.id, m));
      this.lastFetchTime = new Date();
      
      logger.bot(`Found ${filteredMarkets.length} weather markets`, {
        total: markets.length,
        filtered: filteredMarkets.length,
      });
      
      return filteredMarkets;
    } catch (error) {
      logger.error('Failed to fetch weather markets', error);
      // Return cached markets if available
      return Array.from(this.marketCache.values());
    }
  }

  /**
   * Fetch weather markets from Kalshi API
   */
  private async fetchKalshiWeatherMarkets(): Promise<WeatherMarket[]> {
    const markets: WeatherMarket[] = [];
    
    // Check if we have credentials
    const hasCredentials = this.config.kalshi?.apiKey && this.config.kalshi?.privateKey;
    
    if (!hasCredentials) {
      logger.debug('No Kalshi credentials, using simulated markets');
      return this.generateSimulatedMarkets();
    }
    
    try {
      // Try to fetch events - Kalshi API structure
      // First try to get portfolio to verify auth works
      try {
        await this.kalshiClient.get('/portfolio/balance');
        logger.debug('Kalshi authentication successful');
      } catch (authError) {
        logger.warn('Kalshi authentication failed', { error: (authError as Error).message });
        return this.generateSimulatedMarkets();
      }
      
      // Fetch events - try different endpoints
      let events: any[] = [];
      
      // Try /events endpoint
      try {
        const response = await this.kalshiClient.get('/events', {
          params: {
            status: 'open',
            limit: 200,
          },
        });
        events = response.data?.events || response.data || [];
      } catch (eventsError) {
        logger.debug('Events endpoint failed, trying alternatives', { error: (eventsError as Error).message });
        
        // Try /exchange/events
        try {
          const response = await this.kalshiClient.get('/exchange/events', {
            params: {
              status: 'open',
              limit: 200,
            },
          });
          events = response.data?.events || response.data || [];
        } catch (exchangeError) {
          logger.warn('Could not fetch events from Kalshi', { error: (exchangeError as Error).message });
          return this.generateSimulatedMarkets();
        }
      }
      
      // Filter for weather events
      const weatherEvents = events.filter((event: any) => 
        this.isWeatherMarket(event.title || event.event_subtitle || '', event.category || event.series_ticker || '')
      );
      
      logger.bot(`Found ${weatherEvents.length} weather events from Kalshi`, { total: events.length });
      
      // Fetch markets for each weather event
      for (const event of weatherEvents.slice(0, 20)) { // Limit to 20 events
        try {
          const eventTicker = event.event_ticker || event.ticker || event.id;
          if (!eventTicker) continue;
          
          const marketsResponse = await this.kalshiClient.get(`/events/${eventTicker}/markets`, {
            params: { limit: 50 },
          });
          
          const eventMarkets = marketsResponse.data?.markets || marketsResponse.data || [];
          
          for (const market of eventMarkets) {
            const parsed = this.parseKalshiMarket(market, event);
            if (parsed) {
              markets.push(parsed);
            }
          }
        } catch (marketError) {
          logger.debug('Failed to fetch markets for event', { event: event.event_ticker, error: (marketError as Error).message });
        }
      }
      
      if (markets.length === 0) {
        logger.warn('No weather markets found from Kalshi, using simulated markets');
        return this.generateSimulatedMarkets();
      }
      
      logger.bot(`Successfully fetched ${markets.length} weather markets from Kalshi`);
      return markets;
      
    } catch (error) {
      logger.warn('Kalshi API fetch failed, using fallback data', { error: (error as Error).message });
      return this.generateSimulatedMarkets();
    }
  }

  /**
   * Fetch weather-related tokens from Jupiter token list
   */
  private async fetchJupiterWeatherTokens(): Promise<WeatherMarket[]> {
    const markets: WeatherMarket[] = [];
    
    try {
      const response = await axios.get(JUPITER_TOKEN_LIST_URL);
      const tokens = response.data || [];
      
      // Filter for weather-related prediction market tokens
      const weatherTokens = tokens.filter((token: TokenInfo) => 
        this.isWeatherMarket(token.name, token.symbol) ||
        (token.tags && token.tags.some((tag: string) => 
          WEATHER_KEYWORDS.some(kw => tag.toLowerCase().includes(kw))
        ))
      );
      
      // Cache tokens for later use
      weatherTokens.forEach((token: TokenInfo) => {
        this.tokenCache.set(token.address, token);
      });
      
      // Convert to weather markets (would need price data)
      for (const token of weatherTokens) {
        const market = await this.tokenToWeatherMarket(token);
        if (market) {
          markets.push(market);
        }
      }
    } catch (error) {
      logger.warn('Jupiter token list fetch failed', { error: (error as Error).message });
    }
    
    return markets;
  }

  /**
   * Check if a market title/category indicates a weather market
   */
  private isWeatherMarket(title: string, category?: string): boolean {
    const text = `${title} ${category || ''}`.toLowerCase();
    
    // Must contain a weather keyword
    const hasWeatherKeyword = WEATHER_KEYWORDS.some(kw => text.includes(kw));
    if (!hasWeatherKeyword) return false;
    
    // Should contain a city name (for specificity)
    const hasCityName = CITY_PATTERNS.some(city => text.includes(city));
    
    return hasCityName || text.includes('weather');
  }

  /**
   * Parse a Kalshi market response into our WeatherMarket type
   */
  private parseKalshiMarket(market: KalshiMarket, event: KalshiEvent): WeatherMarket | null {
    try {
      const category = this.detectWeatherCategory(market.title);
      const city = this.extractCity(market.title);
      const condition = this.parseMarketCondition(market.title);
      
      if (!city || !condition) return null;
      
      return {
        id: `kalshi_${market.ticker}`,
        title: market.title,
        description: event.title,
        category,
        city: city.code,
        state: city.state,
        
        // Kalshi tokenizes Yes/No - these would be derived
        yesTokenMint: market.yes_token_id || '',
        noTokenMint: market.no_token_id || '',
        
        // Prices are in cents on Kalshi (0-100)
        yesPrice: (market.yes_bid + market.yes_ask) / 2 / 100,
        noPrice: (market.no_bid + market.no_ask) / 2 / 100,
        
        resolutionDate: new Date(market.close_time),
        resolutionSource: 'NWS',
        volume24h: market.volume_24h || 0,
        liquidity: market.open_interest || 0,
        
        condition,
        threshold: condition.threshold,
        comparison: this.mapComparison(condition.comparison),
        
        source: 'kalshi',
        externalId: market.ticker,
        
        createdAt: new Date(market.created_time || Date.now()),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.debug('Failed to parse Kalshi market', { market: market.ticker, error });
      return null;
    }
  }

  /**
   * Convert a Jupiter token to a WeatherMarket
   */
  private async tokenToWeatherMarket(token: TokenInfo): Promise<WeatherMarket | null> {
    try {
      // Get current price via Jupiter quote
      const price = await this.getTokenPrice(token.address);
      if (price === null) return null;
      
      const category = this.detectWeatherCategory(token.name);
      const city = this.extractCity(token.name);
      const condition = this.parseMarketCondition(token.name);
      
      if (!city || !condition) return null;
      
      return {
        id: `jupiter_${token.address}`,
        title: token.name,
        description: token.symbol,
        category,
        city: city.code,
        state: city.state,
        
        yesTokenMint: token.address,
        noTokenMint: '', // Would need to find paired token
        
        yesPrice: price,
        noPrice: 1 - price,
        
        resolutionDate: this.extractResolutionDate(token.name) || new Date(Date.now() + 86400000),
        resolutionSource: 'NWS',
        volume24h: 0,
        liquidity: 0,
        
        condition,
        threshold: condition.threshold,
        comparison: this.mapComparison(condition.comparison),
        
        source: 'other',
        externalId: token.address,
        
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      logger.debug('Failed to convert token to market', { token: token.address, error });
      return null;
    }
  }

  /**
   * Get token price via Jupiter quote API
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Quote 1 USDC worth
      const response = await this.jupiterClient.get('/quote', {
        params: {
          inputMint: USDC_MINT,
          outputMint: tokenMint,
          amount: 1000000, // 1 USDC (6 decimals)
          slippageBps: 50,
        },
      });
      
      const quote: JupiterQuote = response.data;
      // Price = 1 / tokens received for 1 USDC
      const tokensOut = parseInt(quote.outAmount);
      const decimals = this.tokenCache.get(tokenMint)?.decimals || 6;
      const price = 1 / (tokensOut / Math.pow(10, decimals));
      
      return Math.min(Math.max(price, 0), 1); // Clamp to 0-1
    } catch (error) {
      logger.debug('Failed to get token price', { tokenMint, error });
      return null;
    }
  }

  /**
   * Get Jupiter quote for a swap
   */
  async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 200
  ): Promise<JupiterQuote | null> {
    try {
      const response = await this.jupiterClient.get('/quote', {
        params: {
          inputMint,
          outputMint,
          amount: Math.floor(amount),
          slippageBps,
          onlyDirectRoutes: false,
        },
      });
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get Jupiter quote', error);
      return null;
    }
  }

  /**
   * Detect weather category from title
   */
  private detectWeatherCategory(title: string): WeatherCategory {
    const text = title.toLowerCase();
    
    if (text.includes('high') && text.includes('temp')) return 'temperature_high';
    if (text.includes('low') && text.includes('temp')) return 'temperature_low';
    if (text.includes('temperature') || text.includes('°') || text.includes('degrees')) return 'temperature';
    if (text.includes('snow')) return 'snow';
    if (text.includes('rain') || text.includes('precip')) return 'precipitation';
    if (text.includes('hurricane') || text.includes('tropical')) return 'hurricane';
    if (text.includes('wind')) return 'wind';
    
    return 'other';
  }

  /**
   * Extract city information from title
   */
  private extractCity(title: string): { code: string; state: string } | null {
    const text = title.toLowerCase();
    
    const cityMappings: Record<string, { code: string; state: string }> = {
      'new york': { code: 'NYC', state: 'NY' },
      'nyc': { code: 'NYC', state: 'NY' },
      'manhattan': { code: 'NYC', state: 'NY' },
      'los angeles': { code: 'LAX', state: 'CA' },
      'la': { code: 'LAX', state: 'CA' },
      'chicago': { code: 'CHI', state: 'IL' },
      'dallas': { code: 'DFW', state: 'TX' },
      'denver': { code: 'DEN', state: 'CO' },
      'miami': { code: 'MIA', state: 'FL' },
      'phoenix': { code: 'PHX', state: 'AZ' },
      'seattle': { code: 'SEA', state: 'WA' },
      'atlanta': { code: 'ATL', state: 'GA' },
      'boston': { code: 'BOS', state: 'MA' },
    };
    
    for (const [pattern, info] of Object.entries(cityMappings)) {
      if (text.includes(pattern)) {
        return info;
      }
    }
    
    return null;
  }

  /**
   * Parse market condition from title
   */
  private parseMarketCondition(title: string): MarketCondition | null {
    const text = title.toLowerCase();
    
    // Temperature patterns: "above 80°F", "below 32", "between 60 and 70"
    const tempAbove = text.match(/(?:above|over|>=?)\s*(\d+)/);
    const tempBelow = text.match(/(?:below|under|<=?)\s*(\d+)/);
    const tempBetween = text.match(/between\s*(\d+)\s*(?:and|to|-)\s*(\d+)/);
    
    if (tempAbove) {
      return {
        type: 'temperature',
        metric: text.includes('high') ? 'high' : text.includes('low') ? 'low' : 'temp',
        threshold: parseInt(tempAbove[1] || '0'),
        unit: 'F',
        comparison: 'gte',
      };
    }
    
    if (tempBelow) {
      return {
        type: 'temperature',
        metric: text.includes('high') ? 'high' : text.includes('low') ? 'low' : 'temp',
        threshold: parseInt(tempBelow[1] || '0'),
        unit: 'F',
        comparison: 'lte',
      };
    }
    
    if (tempBetween) {
      return {
        type: 'temperature',
        metric: 'temp',
        threshold: parseInt(tempBetween[1] || '0'),
        upperBound: parseInt(tempBetween[2] || '0'),
        unit: 'F',
        comparison: 'between',
      };
    }
    
    // Precipitation patterns: "more than 0.1 inches", "at least 1 inch"
    const precipMatch = text.match(/(?:more than|at least|>=?)\s*([\d.]+)\s*inch/);
    if (precipMatch) {
      return {
        type: 'precipitation',
        metric: text.includes('snow') ? 'snow' : 'rain',
        threshold: parseFloat(precipMatch[1] || '0'),
        unit: 'in',
        comparison: 'gte',
      };
    }
    
    // Snow patterns
    if (text.includes('snow')) {
      const snowMatch = text.match(/([\d.]+)\s*(?:inch|")/);
      return {
        type: 'snow',
        metric: 'snow',
        threshold: snowMatch ? parseFloat(snowMatch[1] || '0') : 0.1,
        unit: 'in',
        comparison: 'gte',
      };
    }
    
    return null;
  }

  /**
   * Extract resolution date from title
   */
  private extractResolutionDate(title: string): Date | null {
    const text = title.toLowerCase();
    
    // Look for date patterns: "December 4", "12/4", "tomorrow"
    const monthDay = text.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})/i);
    if (monthDay) {
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const monthIndex = monthNames.findIndex(m => text.includes(m));
      if (monthIndex !== -1) {
        const date = new Date();
        date.setMonth(monthIndex);
        date.setDate(parseInt(monthDay[1] || '1'));
        // If date is in past, assume next year
        if (date < new Date()) {
          date.setFullYear(date.getFullYear() + 1);
        }
        return date;
      }
    }
    
    // "tomorrow"
    if (text.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow;
    }
    
    return null;
  }

  /**
   * Map comparison type
   */
  private mapComparison(comparison: string): 'above' | 'below' | 'between' {
    if (comparison === 'between') return 'between';
    if (comparison === 'gte' || comparison === 'gt') return 'above';
    return 'below';
  }

  /**
   * Deduplicate markets by ID
   */
  private deduplicateMarkets(markets: WeatherMarket[]): WeatherMarket[] {
    const seen = new Map<string, WeatherMarket>();
    for (const market of markets) {
      if (!seen.has(market.id)) {
        seen.set(market.id, market);
      }
    }
    return Array.from(seen.values());
  }

  /**
   * Filter markets based on config settings
   */
  private filterMarkets(markets: WeatherMarket[]): WeatherMarket[] {
    const { focusCities, marketCategories } = this.config.bot;
    
    return markets.filter(market => {
      // Filter by city if specified
      if (focusCities.length > 0 && !focusCities.includes(market.city)) {
        return false;
      }
      
      // Filter by category
      if (!marketCategories.includes(market.category)) {
        return false;
      }
      
      // Filter out expired markets
      if (market.resolutionDate < new Date()) {
        return false;
      }
      
      // Must have valid prices
      if (market.yesPrice <= 0 || market.yesPrice >= 1) {
        return false;
      }
      
      return true;
    });
  }

  /**
   * Generate simulated weather markets for development/testing
   */
  private generateSimulatedMarkets(): WeatherMarket[] {
    const markets: WeatherMarket[] = [];
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    
    const cities = ['NYC', 'LAX', 'CHI', 'MIA', 'DEN'];
    const temps = [75, 85, 90, 95];
    
    for (const city of cities) {
      for (const temp of temps) {
        const yesPrice = 0.3 + Math.random() * 0.4; // 30-70 cents
        
        markets.push({
          id: `sim_temp_${city}_${temp}`,
          title: `${city} High Temperature Above ${temp}°F Tomorrow`,
          description: `Will the high temperature in ${city} be ${temp}°F or higher tomorrow?`,
          category: 'temperature_high',
          city,
          state: this.getCityState(city),
          
          yesTokenMint: `sim_yes_${city}_${temp}`,
          noTokenMint: `sim_no_${city}_${temp}`,
          
          yesPrice,
          noPrice: 1 - yesPrice,
          
          resolutionDate: tomorrow,
          resolutionSource: 'NWS',
          volume24h: Math.floor(Math.random() * 10000),
          liquidity: Math.floor(Math.random() * 50000),
          
          condition: {
            type: 'temperature',
            metric: 'high',
            threshold: temp,
            unit: 'F',
            comparison: 'gte',
          },
          threshold: temp,
          comparison: 'above',
          
          source: 'kalshi',
          externalId: `SIM_${city}_TEMP_${temp}`,
          
          createdAt: now,
          updatedAt: now,
        });
      }
      
      // Add precipitation market
      const precipPrice = 0.2 + Math.random() * 0.3;
      markets.push({
        id: `sim_precip_${city}`,
        title: `${city} Rainfall Above 0.1" Tomorrow`,
        description: `Will ${city} receive 0.1 inches or more of rainfall tomorrow?`,
        category: 'precipitation',
        city,
        state: this.getCityState(city),
        
        yesTokenMint: `sim_yes_precip_${city}`,
        noTokenMint: `sim_no_precip_${city}`,
        
        yesPrice: precipPrice,
        noPrice: 1 - precipPrice,
        
        resolutionDate: tomorrow,
        resolutionSource: 'NWS',
        volume24h: Math.floor(Math.random() * 5000),
        liquidity: Math.floor(Math.random() * 20000),
        
        condition: {
          type: 'precipitation',
          metric: 'rain',
          threshold: 0.1,
          unit: 'in',
          comparison: 'gte',
        },
        threshold: 0.1,
        comparison: 'above',
        
        source: 'kalshi',
        externalId: `SIM_${city}_PRECIP`,
        
        createdAt: now,
        updatedAt: now,
      });
    }
    
    return markets;
  }

  private getCityState(code: string): string {
    const states: Record<string, string> = {
      NYC: 'NY', LAX: 'CA', CHI: 'IL', MIA: 'FL', DEN: 'CO',
      PHX: 'AZ', SEA: 'WA', ATL: 'GA', BOS: 'MA', DFW: 'TX',
    };
    return states[code] || '';
  }

  /**
   * Get cached markets
   */
  getCachedMarkets(): WeatherMarket[] {
    return Array.from(this.marketCache.values());
  }

  /**
   * Get market by ID
   */
  getMarket(id: string): WeatherMarket | undefined {
    return this.marketCache.get(id);
  }
}

// Type definitions for external APIs
interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  tags?: string[];
}

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  yes_token_id?: string;
  no_token_id?: string;
  close_time: string;
  created_time?: string;
  volume_24h?: number;
  open_interest?: number;
}

interface KalshiEvent {
  event_ticker: string;
  title: string;
  category?: string;
}

// Export singleton instance
export const marketFetcher = new MarketFetcher();
export default marketFetcher;


