/**
 * Weather Forecast Edge Engine
 * Aggregates forecasts from multiple sources and calculates market probabilities
 */

import axios, { type AxiosInstance } from 'axios';
import { logger } from './logger';
import { getConfig } from './config';
import type {
  WeatherForecast,
  EnsembleForecast,
  ProbabilityDistribution,
  WeatherMarket,
  MarketEdge,
  ForecastSource,
  NWSForecastResponse,
  OpenWeatherResponse,
  CityInfo,
  SUPPORTED_CITIES,
} from './types';

// Re-export SUPPORTED_CITIES for convenience
export { SUPPORTED_CITIES } from './types';

// Statistical helper functions
const jstat = {
  // Normal CDF approximation using error function
  normalCdf(x: number, mean: number, std: number): number {
    const z = (x - mean) / std;
    return 0.5 * (1 + this.erf(z / Math.SQRT2));
  },
  
  // Error function approximation
  erf(x: number): number {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return sign * y;
  },
  
  // Inverse normal CDF (for percentiles)
  normalInv(p: number, mean: number, std: number): number {
    // Approximation using Abramowitz and Stegun formula 26.2.23
    const a = [
      -3.969683028665376e+01,
       2.209460984245205e+02,
      -2.759285104469687e+02,
       1.383577518672690e+02,
      -3.066479806614716e+01,
       2.506628277459239e+00,
    ];
    const b = [
      -5.447609879822406e+01,
       1.615858368580409e+02,
      -1.556989798598866e+02,
       6.680131188771972e+01,
      -1.328068155288572e+01,
    ];
    const c = [
      -7.784894002430293e-03,
      -3.223964580411365e-01,
      -2.400758277161838e+00,
      -2.549732539343734e+00,
       4.374664141464968e+00,
       2.938163982698783e+00,
    ];
    const d = [
       7.784695709041462e-03,
       3.224671290700398e-01,
       2.445134137142996e+00,
       3.754408661907416e+00,
    ];
    
    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q: number, r: number, z: number;
    
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      z = (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
          ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      z = (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5])*q /
          (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      z = -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
           ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
    }
    
    return mean + z * std;
  },
};

export class ForecastEngine {
  private config = getConfig();
  private nwsClient: AxiosInstance;
  private owmClient: AxiosInstance;
  private forecastCache: Map<string, EnsembleForecast> = new Map();
  private lastFetchTime: Map<string, Date> = new Map();
  
  // Source reliability weights (based on historical accuracy)
  private sourceWeights: Record<ForecastSource, number> = {
    nws: 0.40,       // NWS is most accurate and is resolution source
    openweathermap: 0.25,
    accuweather: 0.20,
    weathercom: 0.15,
    ensemble: 1.0,   // Already combined
  };

  constructor() {
    this.nwsClient = axios.create({
      baseURL: 'https://api.weather.gov',
      timeout: 15000,
      headers: {
        'Accept': 'application/geo+json',
        'User-Agent': this.config.weather.nwsUserAgent,
      },
    });

    this.owmClient = axios.create({
      baseURL: 'https://api.openweathermap.org/data/3.0',
      timeout: 15000,
    });
  }

  /**
   * Get ensemble forecast for a city and date
   */
  async getEnsembleForecast(
    cityCode: string,
    forecastDate: Date
  ): Promise<EnsembleForecast | null> {
    const cacheKey = `${cityCode}_${forecastDate.toISOString().split('T')[0]}`;
    
    // Check cache (valid for 30 minutes)
    const cached = this.forecastCache.get(cacheKey);
    const lastFetch = this.lastFetchTime.get(cacheKey);
    if (cached && lastFetch && Date.now() - lastFetch.getTime() < 30 * 60 * 1000) {
      return cached;
    }

    const city = (await import('./types')).SUPPORTED_CITIES[cityCode];
    if (!city) {
      logger.warn(`Unsupported city: ${cityCode}`);
      return null;
    }

    logger.forecast(cityCode, { date: forecastDate.toISOString(), action: 'fetching' });

    // Fetch from all available sources in parallel
    const forecasts = await Promise.all([
      this.fetchNWSForecast(city, forecastDate),
      this.fetchOpenWeatherForecast(city, forecastDate),
    ]);

    // Filter out null results
    const validForecasts = forecasts.filter((f): f is WeatherForecast => f !== null);

    if (validForecasts.length === 0) {
      logger.warn(`No valid forecasts for ${cityCode}`);
      return null;
    }

    // Create ensemble from valid forecasts
    const ensemble = this.createEnsemble(city, forecastDate, validForecasts);
    
    // Cache result
    this.forecastCache.set(cacheKey, ensemble);
    this.lastFetchTime.set(cacheKey, new Date());

    logger.forecast(cityCode, {
      sources: validForecasts.length,
      tempHigh: ensemble.temperatureHigh.mean.toFixed(1),
      tempLow: ensemble.temperatureLow.mean.toFixed(1),
      precipProb: (ensemble.precipProbability * 100).toFixed(0),
    });

    return ensemble;
  }

  /**
   * Fetch forecast from National Weather Service
   */
  private async fetchNWSForecast(
    city: CityInfo,
    forecastDate: Date
  ): Promise<WeatherForecast | null> {
    try {
      const { office, gridX, gridY } = city.nwsGridpoint;
      const response = await this.nwsClient.get<NWSForecastResponse>(
        `/gridpoints/${office}/${gridX},${gridY}/forecast`
      );

      const periods = response.data.properties.periods;
      const targetDate = forecastDate.toISOString().split('T')[0];

      // Find day and night periods for target date
      const dayPeriod = periods.find(p => {
        const periodDate = new Date(p.startTime).toISOString().split('T')[0];
        return periodDate === targetDate && p.isDaytime;
      });

      const nightPeriod = periods.find(p => {
        const periodDate = new Date(p.startTime).toISOString().split('T')[0];
        return periodDate === targetDate && !p.isDaytime;
      });

      if (!dayPeriod && !nightPeriod) {
        // Try next day if target date not found
        const tomorrow = new Date(forecastDate);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        
        const tomorrowDay = periods.find(p => {
          const periodDate = new Date(p.startTime).toISOString().split('T')[0];
          return periodDate === tomorrowStr && p.isDaytime;
        });

        if (tomorrowDay) {
          return this.parseNWSPeriod(city, forecastDate, tomorrowDay, undefined);
        }
        return null;
      }

      return this.parseNWSPeriod(city, forecastDate, dayPeriod, nightPeriod);
    } catch (error) {
      logger.debug('NWS forecast fetch failed', { city: city.code, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Parse NWS forecast period into our format
   */
  private parseNWSPeriod(
    city: CityInfo,
    forecastDate: Date,
    dayPeriod?: NWSForecastResponse['properties']['periods'][0],
    nightPeriod?: NWSForecastResponse['properties']['periods'][0]
  ): WeatherForecast {
    const high = dayPeriod?.temperature || 75;
    const low = nightPeriod?.temperature || 55;
    
    // NWS provides probability of precipitation
    const precipProb = (
      (dayPeriod?.probabilityOfPrecipitation?.value || 0) +
      (nightPeriod?.probabilityOfPrecipitation?.value || 0)
    ) / (dayPeriod && nightPeriod ? 2 : 1) / 100;

    // Extract snow probability from detailed forecast
    const detailedForecast = `${dayPeriod?.detailedForecast || ''} ${nightPeriod?.detailedForecast || ''}`.toLowerCase();
    const snowProb = detailedForecast.includes('snow') ? precipProb * 0.8 : 0;

    return {
      city: city.code,
      state: city.state,
      lat: city.lat,
      lon: city.lon,
      forecastDate,
      generatedAt: new Date(),
      source: 'nws',
      
      temperatureHigh: {
        value: high,
        unit: 'F',
        // NWS typically accurate within 3-4°F
        stdDev: 3,
        min: high - 6,
        max: high + 6,
      },
      
      temperatureLow: {
        value: low,
        unit: 'F',
        stdDev: 3,
        min: low - 6,
        max: low + 6,
      },
      
      temperatureMean: {
        value: (high + low) / 2,
        unit: 'F',
        stdDev: 4,
      },
      
      precipProbability: precipProb,
      precipAmount: {
        value: precipProb > 0.3 ? 0.2 : 0.05,
        unit: 'in',
        min: 0,
        max: precipProb > 0.5 ? 1.0 : 0.3,
        probability: precipProb,
      },
      
      snowProbability: snowProb,
      snowAmount: {
        value: snowProb > 0.3 ? 2 : 0,
        unit: 'in',
        min: 0,
        max: snowProb > 0.5 ? 8 : 2,
        probability: snowProb,
      },
      
      confidence: 0.85, // NWS is highly reliable
    };
  }

  /**
   * Fetch forecast from OpenWeatherMap
   */
  private async fetchOpenWeatherForecast(
    city: CityInfo,
    forecastDate: Date
  ): Promise<WeatherForecast | null> {
    if (!this.config.weather.openWeatherMapApiKey) {
      return null;
    }

    try {
      const response = await this.owmClient.get<OpenWeatherResponse>('/onecall', {
        params: {
          lat: city.lat,
          lon: city.lon,
          exclude: 'current,minutely,hourly,alerts',
          units: 'imperial',
          appid: this.config.weather.openWeatherMapApiKey,
        },
      });

      const targetTimestamp = forecastDate.getTime() / 1000;
      const daily = response.data.daily.find(d => {
        const dayStart = new Date(d.dt * 1000).setHours(0, 0, 0, 0);
        const targetStart = new Date(forecastDate).setHours(0, 0, 0, 0);
        return Math.abs(dayStart - targetStart) < 86400000;
      });

      if (!daily) return null;

      return {
        city: city.code,
        state: city.state,
        lat: city.lat,
        lon: city.lon,
        forecastDate,
        generatedAt: new Date(),
        source: 'openweathermap',
        
        temperatureHigh: {
          value: daily.temp.max,
          unit: 'F',
          stdDev: 4,
          min: daily.temp.max - 8,
          max: daily.temp.max + 8,
        },
        
        temperatureLow: {
          value: daily.temp.min,
          unit: 'F',
          stdDev: 4,
          min: daily.temp.min - 8,
          max: daily.temp.min + 8,
        },
        
        temperatureMean: {
          value: daily.temp.day,
          unit: 'F',
          stdDev: 5,
        },
        
        precipProbability: daily.pop,
        precipAmount: {
          value: daily.rain || 0,
          unit: 'in',
          min: 0,
          max: (daily.rain || 0) * 2,
          probability: daily.pop,
        },
        
        snowProbability: daily.snow ? daily.pop : 0,
        snowAmount: {
          value: daily.snow || 0,
          unit: 'in',
          min: 0,
          max: (daily.snow || 0) * 2,
          probability: daily.snow ? daily.pop : 0,
        },
        
        windSpeed: {
          value: daily.wind_speed,
          min: daily.wind_speed * 0.5,
          max: daily.wind_speed * 1.5,
          unit: 'mph',
        },
        
        humidity: daily.humidity,
        
        confidence: 0.75,
      };
    } catch (error) {
      logger.debug('OpenWeatherMap fetch failed', { city: city.code, error: (error as Error).message });
      return null;
    }
  }

  /**
   * Create ensemble forecast from multiple sources
   */
  private createEnsemble(
    city: CityInfo,
    forecastDate: Date,
    forecasts: WeatherForecast[]
  ): EnsembleForecast {
    const sources = forecasts.map(f => f.source);
    
    // Calculate weighted averages
    const tempHighs = this.aggregateDistribution(
      forecasts.map(f => ({
        value: f.temperatureHigh?.value || 75,
        stdDev: f.temperatureHigh?.stdDev || 5,
        weight: this.sourceWeights[f.source],
      }))
    );

    const tempLows = this.aggregateDistribution(
      forecasts.map(f => ({
        value: f.temperatureLow?.value || 55,
        stdDev: f.temperatureLow?.stdDev || 5,
        weight: this.sourceWeights[f.source],
      }))
    );

    // Precipitation probability (weighted average)
    const precipProb = this.weightedAverage(
      forecasts.map(f => ({
        value: f.precipProbability || 0,
        weight: this.sourceWeights[f.source],
      }))
    );

    // Precipitation amount distribution
    const precipAmounts = this.aggregateDistribution(
      forecasts
        .filter(f => f.precipAmount)
        .map(f => ({
          value: f.precipAmount!.value,
          stdDev: (f.precipAmount!.max! - f.precipAmount!.min!) / 4 || 0.2,
          weight: this.sourceWeights[f.source],
        }))
    );

    // Snow
    const snowProb = this.weightedAverage(
      forecasts.map(f => ({
        value: f.snowProbability || 0,
        weight: this.sourceWeights[f.source],
      }))
    );

    const snowAmounts = this.aggregateDistribution(
      forecasts
        .filter(f => f.snowAmount)
        .map(f => ({
          value: f.snowAmount!.value,
          stdDev: (f.snowAmount!.max! - f.snowAmount!.min!) / 4 || 1,
          weight: this.sourceWeights[f.source],
        }))
    );

    // Overall confidence
    const confidence = this.weightedAverage(
      forecasts.map(f => ({
        value: f.confidence,
        weight: this.sourceWeights[f.source],
      }))
    );

    return {
      city: city.code,
      state: city.state,
      forecastDate,
      sources,
      temperatureHigh: tempHighs,
      temperatureLow: tempLows,
      precipProbability: precipProb,
      precipAmount: precipAmounts,
      snowProbability: snowProb,
      snowAmount: snowAmounts,
      confidence,
    };
  }

  /**
   * Aggregate multiple distributions into one
   */
  private aggregateDistribution(
    inputs: Array<{ value: number; stdDev: number; weight: number }>
  ): ProbabilityDistribution {
    if (inputs.length === 0) {
      return {
        mean: 0,
        stdDev: 0,
        min: 0,
        max: 0,
        percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      };
    }

    const totalWeight = inputs.reduce((sum, i) => sum + i.weight, 0);
    
    // Weighted mean
    const mean = inputs.reduce((sum, i) => sum + i.value * i.weight, 0) / totalWeight;
    
    // Combined standard deviation (using variance pooling)
    const variance = inputs.reduce((sum, i) => {
      const w = i.weight / totalWeight;
      return sum + w * (i.stdDev * i.stdDev + (i.value - mean) ** 2);
    }, 0);
    const stdDev = Math.sqrt(variance);

    // Min/max from all sources
    const min = Math.min(...inputs.map(i => i.value - 2 * i.stdDev));
    const max = Math.max(...inputs.map(i => i.value + 2 * i.stdDev));

    // Percentiles using normal distribution
    const percentiles = {
      p10: jstat.normalInv(0.10, mean, stdDev),
      p25: jstat.normalInv(0.25, mean, stdDev),
      p50: mean, // median = mean for normal
      p75: jstat.normalInv(0.75, mean, stdDev),
      p90: jstat.normalInv(0.90, mean, stdDev),
    };

    return { mean, stdDev, min, max, percentiles };
  }

  /**
   * Calculate weighted average
   */
  private weightedAverage(inputs: Array<{ value: number; weight: number }>): number {
    if (inputs.length === 0) return 0;
    const totalWeight = inputs.reduce((sum, i) => sum + i.weight, 0);
    return inputs.reduce((sum, i) => sum + i.value * i.weight, 0) / totalWeight;
  }

  /**
   * Calculate probability that a value exceeds a threshold
   */
  calculateProbabilityAbove(
    distribution: ProbabilityDistribution,
    threshold: number
  ): number {
    // P(X >= threshold) = 1 - CDF(threshold)
    return 1 - jstat.normalCdf(threshold, distribution.mean, distribution.stdDev);
  }

  /**
   * Calculate probability that a value is below a threshold
   */
  calculateProbabilityBelow(
    distribution: ProbabilityDistribution,
    threshold: number
  ): number {
    return jstat.normalCdf(threshold, distribution.mean, distribution.stdDev);
  }

  /**
   * Calculate probability between two values
   */
  calculateProbabilityBetween(
    distribution: ProbabilityDistribution,
    lower: number,
    upper: number
  ): number {
    return (
      jstat.normalCdf(upper, distribution.mean, distribution.stdDev) -
      jstat.normalCdf(lower, distribution.mean, distribution.stdDev)
    );
  }

  /**
   * Calculate market edge
   */
  async calculateEdge(market: WeatherMarket): Promise<MarketEdge | null> {
    const forecast = await this.getEnsembleForecast(
      market.city,
      market.resolutionDate
    );

    if (!forecast) {
      logger.debug('No forecast available for edge calculation', { market: market.id });
      return null;
    }

    let ourProbability: number;

    // Calculate probability based on market condition
    switch (market.condition?.type) {
      case 'temperature': {
        const distribution = market.condition.metric === 'low' 
          ? forecast.temperatureLow 
          : forecast.temperatureHigh;
        
        if (market.condition.comparison === 'gte' || market.condition.comparison === 'gt') {
          ourProbability = this.calculateProbabilityAbove(distribution, market.condition.threshold);
        } else if (market.condition.comparison === 'lte' || market.condition.comparison === 'lt') {
          ourProbability = this.calculateProbabilityBelow(distribution, market.condition.threshold);
        } else if (market.condition.comparison === 'between' && market.condition.upperBound) {
          ourProbability = this.calculateProbabilityBetween(
            distribution,
            market.condition.threshold,
            market.condition.upperBound
          );
        } else {
          ourProbability = 0.5;
        }
        break;
      }

      case 'precipitation': {
        if (market.condition.threshold <= 0.01) {
          // "Any rain" market
          ourProbability = forecast.precipProbability;
        } else {
          // "Rain > X inches" - need to account for amount distribution
          // P(rain > X) = P(rain) * P(amount > X | rain)
          const conditionalProb = this.calculateProbabilityAbove(
            forecast.precipAmount,
            market.condition.threshold
          );
          ourProbability = forecast.precipProbability * conditionalProb;
        }
        break;
      }

      case 'snow': {
        if (market.condition.threshold <= 0.1) {
          ourProbability = forecast.snowProbability;
        } else {
          const conditionalProb = this.calculateProbabilityAbove(
            forecast.snowAmount,
            market.condition.threshold
          );
          ourProbability = forecast.snowProbability * conditionalProb;
        }
        break;
      }

      default:
        ourProbability = 0.5;
    }

    // Clamp probability
    ourProbability = Math.max(0.01, Math.min(0.99, ourProbability));

    // Market implied probability is the Yes price
    const marketProbability = market.yesPrice;

    // Edge calculation
    const edge = ourProbability - marketProbability;
    const absEdge = Math.abs(edge);

    // Determine trading side
    let side: 'yes' | 'no' | 'none' = 'none';
    if (edge > this.config.trading.minEdgeThreshold) {
      side = 'yes'; // Market underpricing Yes
    } else if (edge < -this.config.trading.minEdgeThreshold) {
      side = 'no'; // Market overpricing Yes (underpricing No)
    }

    // Expected value calculation
    // EV = p_win * payout - p_lose * cost
    // For Yes: EV = ourProb * (1 - yesPrice) - (1 - ourProb) * yesPrice
    // Simplified: EV = ourProb - yesPrice = edge
    const expectedValue = side === 'yes' 
      ? edge 
      : side === 'no' 
        ? -edge 
        : 0;

    // Kelly criterion: f* = (bp - q) / b
    // b = odds = (1/price - 1) for Yes
    // p = our probability, q = 1-p
    const price = side === 'yes' ? market.yesPrice : market.noPrice;
    const b = (1 / price) - 1;
    const p = side === 'yes' ? ourProbability : (1 - ourProbability);
    const q = 1 - p;
    const kellyFraction = Math.max(0, (b * p - q) / b);

    // Apply safety factor to Kelly
    const adjustedKelly = kellyFraction * this.config.trading.kellyFraction;
    const recommendedSize = Math.min(
      adjustedKelly * this.config.trading.maxTotalExposureUsdc,
      this.config.trading.maxPositionSizeUsdc
    );

    return {
      market,
      forecast,
      ourProbability,
      marketProbability,
      edge,
      absEdge,
      side,
      expectedValue,
      confidence: forecast.confidence,
      kellyFraction: adjustedKelly,
      recommendedSize: side !== 'none' ? recommendedSize : 0,
      calculatedAt: new Date(),
    };
  }

  /**
   * Find all edges above threshold
   */
  async findEdges(markets: WeatherMarket[]): Promise<MarketEdge[]> {
    logger.bot(`Calculating edges for ${markets.length} markets...`);
    
    const edges: MarketEdge[] = [];
    
    for (const market of markets) {
      try {
        const edge = await this.calculateEdge(market);
        if (edge && edge.absEdge >= this.config.trading.minEdgeThreshold) {
          // Sanity check - reject suspiciously large edges
          if (edge.absEdge <= this.config.trading.maxEdgeThreshold) {
            edges.push(edge);
            logger.edge(market.title, edge.edge, {
              ourProb: (edge.ourProbability * 100).toFixed(1),
              marketProb: (edge.marketProbability * 100).toFixed(1),
              side: edge.side,
              recommendedSize: edge.recommendedSize.toFixed(2),
            });
          } else {
            logger.warn(`Rejecting suspiciously large edge: ${edge.absEdge.toFixed(2)}`, {
              market: market.id,
            });
          }
        }
      } catch (error) {
        logger.debug('Edge calculation failed', { market: market.id, error });
      }
    }

    // Sort by absolute edge (highest first)
    edges.sort((a, b) => b.absEdge - a.absEdge);

    logger.bot(`Found ${edges.length} tradeable edges`, {
      topEdge: edges[0]?.absEdge.toFixed(3) || 'none',
    });

    return edges;
  }

  /**
   * Clear forecast cache
   */
  clearCache(): void {
    this.forecastCache.clear();
    this.lastFetchTime.clear();
  }
}

// Export singleton instance
export const forecastEngine = new ForecastEngine();
export default forecastEngine;


