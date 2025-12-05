/**
 * Basic Backtester for Weather Prediction Markets
 * Uses historical weather data and simulated market prices
 */

import { logger } from './logger';
import { getConfig } from './config';
import { SUPPORTED_CITIES } from './types';
import type { CityInfo, WeatherCategory } from './types';

interface HistoricalDay {
  date: Date;
  city: string;
  actualHigh: number;
  actualLow: number;
  actualPrecip: number;
  actualSnow: number;
}

interface SimulatedMarket {
  id: string;
  city: string;
  date: Date;
  category: WeatherCategory;
  threshold: number;
  yesPrice: number; // Simulated market price
  actualOutcome: boolean; // Did yes win?
}

interface BacktestTrade {
  market: SimulatedMarket;
  ourProbability: number;
  edge: number;
  side: 'yes' | 'no';
  size: number;
  outcome: 'win' | 'loss';
  pnl: number;
}

interface BacktestResult {
  period: { start: Date; end: Date };
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  avgPnlPerTrade: number;
  avgEdge: number;
  sharpeRatio: number;
  maxDrawdown: number;
  trades: BacktestTrade[];
}

export class Backtester {
  private config = getConfig();

  /**
   * Run backtest with simulated data
   */
  async runBacktest(
    startDate: Date,
    endDate: Date,
    cities: string[] = ['NYC', 'LAX', 'CHI', 'MIA', 'DEN']
  ): Promise<BacktestResult> {
    logger.bot('Starting backtest...', {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      cities,
    });

    // Generate historical data (simulated)
    const historicalData = this.generateHistoricalData(startDate, endDate, cities);
    
    // Generate simulated markets
    const markets = this.generateSimulatedMarkets(historicalData);
    
    // Run trading simulation
    const trades = this.simulateTrades(markets);
    
    // Calculate results
    const result = this.calculateResults(startDate, endDate, trades);
    
    this.printResults(result);
    
    return result;
  }

  /**
   * Generate simulated historical weather data
   */
  private generateHistoricalData(
    startDate: Date,
    endDate: Date,
    cities: string[]
  ): HistoricalDay[] {
    const data: HistoricalDay[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      for (const cityCode of cities) {
        const city = SUPPORTED_CITIES[cityCode];
        if (!city) continue;

        // Generate realistic weather based on city and season
        const monthTemp = this.getSeasonalTemp(city, currentDate.getMonth());
        
        // Add some randomness
        const variance = 10 + Math.random() * 10;
        const actualHigh = monthTemp.avgHigh + (Math.random() - 0.5) * variance;
        const actualLow = monthTemp.avgLow + (Math.random() - 0.5) * variance;
        
        // Precipitation (more likely in some cities)
        const precipChance = this.getPrecipChance(city, currentDate.getMonth());
        const hadPrecip = Math.random() < precipChance;
        const actualPrecip = hadPrecip ? Math.random() * 0.5 : 0;
        
        // Snow (only in cold conditions)
        const snowChance = actualHigh < 35 ? precipChance * 0.5 : 0;
        const hadSnow = Math.random() < snowChance;
        const actualSnow = hadSnow ? Math.random() * 4 : 0;

        data.push({
          date: new Date(currentDate),
          city: cityCode,
          actualHigh,
          actualLow,
          actualPrecip,
          actualSnow,
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return data;
  }

  /**
   * Get seasonal temperature baseline for a city
   */
  private getSeasonalTemp(city: CityInfo, month: number): { avgHigh: number; avgLow: number } {
    // Simplified seasonal temperatures by region
    const isWinter = month >= 11 || month <= 2;
    const isSummer = month >= 5 && month <= 8;
    
    // Base temperatures vary by latitude
    const latFactor = (city.lat - 25) / 25; // 0 for Miami, ~1 for Seattle
    
    if (isSummer) {
      return {
        avgHigh: 90 - latFactor * 15,
        avgLow: 70 - latFactor * 10,
      };
    } else if (isWinter) {
      return {
        avgHigh: 60 - latFactor * 30,
        avgLow: 40 - latFactor * 25,
      };
    } else {
      return {
        avgHigh: 75 - latFactor * 20,
        avgLow: 55 - latFactor * 15,
      };
    }
  }

  /**
   * Get precipitation chance for a city/month
   */
  private getPrecipChance(city: CityInfo, month: number): number {
    // Seattle is rainy, Phoenix is dry
    const baseChance: Record<string, number> = {
      SEA: 0.45,
      MIA: 0.35,
      NYC: 0.30,
      CHI: 0.30,
      ATL: 0.30,
      BOS: 0.30,
      DEN: 0.20,
      LAX: 0.15,
      PHX: 0.10,
      DFW: 0.25,
    };
    
    return baseChance[city.code] || 0.25;
  }

  /**
   * Generate simulated prediction markets from historical data
   */
  private generateSimulatedMarkets(historicalData: HistoricalDay[]): SimulatedMarket[] {
    const markets: SimulatedMarket[] = [];

    for (const day of historicalData) {
      // Temperature high markets
      for (const threshold of [75, 80, 85, 90, 95]) {
        // Market price is what other traders think the probability is
        // Simulate market being somewhat efficient but not perfect
        const trueProbability = day.actualHigh >= threshold ? 1 : 0;
        const marketNoise = (Math.random() - 0.5) * 0.3; // ±15% noise
        const marketPrice = Math.max(0.05, Math.min(0.95, 
          (trueProbability === 1 ? 0.65 : 0.35) + marketNoise
        ));

        markets.push({
          id: `temp_high_${day.city}_${threshold}_${day.date.toISOString().split('T')[0]}`,
          city: day.city,
          date: day.date,
          category: 'temperature_high',
          threshold,
          yesPrice: marketPrice,
          actualOutcome: day.actualHigh >= threshold,
        });
      }

      // Temperature low markets
      for (const threshold of [32, 40, 50, 60]) {
        const trueProbability = day.actualLow <= threshold ? 1 : 0;
        const marketNoise = (Math.random() - 0.5) * 0.3;
        const marketPrice = Math.max(0.05, Math.min(0.95,
          (trueProbability === 1 ? 0.65 : 0.35) + marketNoise
        ));

        markets.push({
          id: `temp_low_${day.city}_${threshold}_${day.date.toISOString().split('T')[0]}`,
          city: day.city,
          date: day.date,
          category: 'temperature_low',
          threshold,
          yesPrice: marketPrice,
          actualOutcome: day.actualLow <= threshold,
        });
      }

      // Precipitation markets
      for (const threshold of [0.01, 0.1, 0.25]) {
        const trueProbability = day.actualPrecip >= threshold ? 1 : 0;
        const marketNoise = (Math.random() - 0.5) * 0.25;
        const marketPrice = Math.max(0.05, Math.min(0.95,
          (trueProbability === 1 ? 0.60 : 0.30) + marketNoise
        ));

        markets.push({
          id: `precip_${day.city}_${threshold}_${day.date.toISOString().split('T')[0]}`,
          city: day.city,
          date: day.date,
          category: 'precipitation',
          threshold,
          yesPrice: marketPrice,
          actualOutcome: day.actualPrecip >= threshold,
        });
      }
    }

    return markets;
  }

  /**
   * Simulate trading on markets
   */
  private simulateTrades(markets: SimulatedMarket[]): BacktestTrade[] {
    const trades: BacktestTrade[] = [];
    const minEdge = this.config.trading.minEdgeThreshold;

    for (const market of markets) {
      // Simulate our probability estimate
      // Our estimate is better than market but not perfect
      const correctProbability = market.actualOutcome ? 0.85 : 0.15;
      const ourNoise = (Math.random() - 0.5) * 0.2; // ±10% noise
      const ourProbability = Math.max(0.05, Math.min(0.95, correctProbability + ourNoise));

      const edge = ourProbability - market.yesPrice;
      const absEdge = Math.abs(edge);

      // Only trade if edge exceeds threshold
      if (absEdge >= minEdge) {
        const side: 'yes' | 'no' = edge > 0 ? 'yes' : 'no';
        
        // Kelly sizing
        const price = side === 'yes' ? market.yesPrice : (1 - market.yesPrice);
        const b = (1 / price) - 1;
        const p = side === 'yes' ? ourProbability : (1 - ourProbability);
        const kellyFraction = Math.max(0, (b * p - (1 - p)) / b);
        const size = Math.min(
          kellyFraction * this.config.trading.kellyFraction * 1000, // $1000 bankroll
          this.config.trading.maxPositionSizeUsdc
        );

        if (size >= 5) { // Minimum $5 trade
          // Determine outcome
          const didWin = (side === 'yes' && market.actualOutcome) || 
                        (side === 'no' && !market.actualOutcome);
          
          // Calculate PnL
          // If win: get $1 per token, paid price per token
          // If lose: lose the cost
          const pnl = didWin 
            ? size * (1 / price - 1) // Win: (1 - price) / price * size
            : -size; // Lose entire stake

          trades.push({
            market,
            ourProbability,
            edge,
            side,
            size,
            outcome: didWin ? 'win' : 'loss',
            pnl,
          });
        }
      }
    }

    return trades;
  }

  /**
   * Calculate backtest results
   */
  private calculateResults(
    startDate: Date,
    endDate: Date,
    trades: BacktestTrade[]
  ): BacktestResult {
    const winningTrades = trades.filter(t => t.outcome === 'win');
    const losingTrades = trades.filter(t => t.outcome === 'loss');
    
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const avgPnlPerTrade = trades.length > 0 ? totalPnl / trades.length : 0;
    const avgEdge = trades.length > 0 
      ? trades.reduce((sum, t) => sum + Math.abs(t.edge), 0) / trades.length 
      : 0;

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    
    for (const trade of trades) {
      cumulative += trade.pnl;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Sharpe ratio (simplified)
    const returns = trades.map(t => t.pnl / t.size);
    const avgReturn = returns.length > 0 
      ? returns.reduce((a, b) => a + b, 0) / returns.length 
      : 0;
    const stdReturn = returns.length > 1
      ? Math.sqrt(returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / (returns.length - 1))
      : 0;
    const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    return {
      period: { start: startDate, end: endDate },
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: trades.length > 0 ? winningTrades.length / trades.length : 0,
      totalPnl,
      avgPnlPerTrade,
      avgEdge,
      sharpeRatio,
      maxDrawdown,
      trades,
    };
  }

  /**
   * Print backtest results
   */
  private printResults(result: BacktestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log('BACKTEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Period: ${result.period.start.toDateString()} - ${result.period.end.toDateString()}`);
    console.log('-'.repeat(60));
    console.log(`Total Trades:     ${result.totalTrades}`);
    console.log(`Winning Trades:   ${result.winningTrades}`);
    console.log(`Losing Trades:    ${result.losingTrades}`);
    console.log(`Win Rate:         ${(result.winRate * 100).toFixed(1)}%`);
    console.log('-'.repeat(60));
    console.log(`Total PnL:        $${result.totalPnl.toFixed(2)}`);
    console.log(`Avg PnL/Trade:    $${result.avgPnlPerTrade.toFixed(2)}`);
    console.log(`Avg Edge:         ${(result.avgEdge * 100).toFixed(2)}%`);
    console.log('-'.repeat(60));
    console.log(`Sharpe Ratio:     ${result.sharpeRatio.toFixed(2)}`);
    console.log(`Max Drawdown:     $${result.maxDrawdown.toFixed(2)}`);
    console.log('='.repeat(60));

    // Show sample trades
    console.log('\nSample Trades (first 10):');
    for (const trade of result.trades.slice(0, 10)) {
      console.log(
        `  ${trade.market.city} ${trade.market.category} >${trade.market.threshold}: ` +
        `${trade.side.toUpperCase()} $${trade.size.toFixed(0)} | ` +
        `Edge: ${(trade.edge * 100).toFixed(1)}% | ` +
        `${trade.outcome.toUpperCase()} $${trade.pnl.toFixed(2)}`
      );
    }
  }
}

// CLI entry point
async function main(): Promise<void> {
  console.log('\n🌤️  Weather Market Backtester\n');

  const backtester = new Backtester();
  
  // Run backtest for last 30 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  await backtester.runBacktest(startDate, endDate);
}

main().catch(console.error);

export { Backtester };
export default Backtester;


