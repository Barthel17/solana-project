/**
 * Automated Trading Agent
 * Executes trades on Solana using Jupiter aggregator
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
  type Commitment,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';
import { logger } from './logger';
import { getConfig, getSolanaPrivateKey } from './config';
import { marketFetcher } from './marketFetcher';
import type {
  Trade,
  TradeSignal,
  TradeStatus,
  MarketEdge,
  Position,
  WeatherMarket,
  JupiterQuote,
} from './types';

// Constants
const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

export class Trader {
  private config = getConfig();
  private connection: Connection;
  private wallet: Keypair | null = null;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private totalExposure = 0;
  private isInitialized = false;

  constructor() {
    this.connection = new Connection(
      this.config.solana.rpcUrl,
      this.config.solana.commitment as Commitment
    );
  }

  /**
   * Initialize the trader with wallet
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const privateKey = getSolanaPrivateKey();
      const secretKey = bs58.decode(privateKey);
      this.wallet = Keypair.fromSecretKey(secretKey);
      
      logger.bot('Trader initialized', {
        wallet: this.wallet.publicKey.toBase58(),
        rpc: this.config.solana.rpcUrl,
      });

      // Check USDC balance
      const usdcBalance = await this.getUsdcBalance();
      logger.bot(`USDC Balance: $${usdcBalance.toFixed(2)}`);

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize trader', error);
      throw error;
    }
  }

  /**
   * Get USDC balance
   */
  async getUsdcBalance(): Promise<number> {
    if (!this.wallet) throw new Error('Trader not initialized');

    try {
      const ata = await getAssociatedTokenAddress(USDC_MINT, this.wallet.publicKey);
      const account = await getAccount(this.connection, ata);
      return Number(account.amount) / Math.pow(10, USDC_DECIMALS);
    } catch {
      return 0;
    }
  }

  /**
   * Get SOL balance (for gas)
   */
  async getSolBalance(): Promise<number> {
    if (!this.wallet) throw new Error('Trader not initialized');
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return balance / 1e9;
  }

  /**
   * Create trade signal from edge
   */
  createTradeSignal(edge: MarketEdge): TradeSignal | null {
    if (edge.side === 'none' || edge.recommendedSize <= 0) {
      return null;
    }

    // Check exposure limits
    const remainingExposure = this.config.trading.maxTotalExposureUsdc - this.totalExposure;
    if (remainingExposure <= 0) {
      logger.warn('Maximum exposure reached, skipping trade');
      return null;
    }

    // Adjust size based on remaining exposure
    let sizeUsdc = Math.min(edge.recommendedSize, remainingExposure);
    
    // Use fixed size if configured
    if (this.config.trading.positionSizingMethod === 'fixed') {
      sizeUsdc = Math.min(this.config.trading.fixedPositionSizeUsdc, remainingExposure);
    }

    // Minimum trade size
    if (sizeUsdc < 5) {
      logger.debug('Trade size too small, skipping');
      return null;
    }

    const tokenMint = edge.side === 'yes' 
      ? edge.market.yesTokenMint 
      : edge.market.noTokenMint;
    
    const price = edge.side === 'yes' ? edge.market.yesPrice : edge.market.noPrice;
    const expectedTokens = sizeUsdc / price;

    // Calculate risk metrics
    const maxLoss = sizeUsdc;
    const expectedProfit = sizeUsdc * edge.expectedValue;
    const riskRewardRatio = Math.abs(expectedProfit / maxLoss);

    return {
      market: edge.market,
      edge,
      side: edge.side === 'yes' ? 'buy_yes' : 'buy_no',
      sizeUsdc,
      expectedTokens,
      slippage: this.config.trading.slippageTolerance,
      priority: edge.absEdge > 0.15 ? 'high' : edge.absEdge > 0.10 ? 'medium' : 'low',
      maxLoss,
      expectedProfit,
      riskRewardRatio,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minute expiry
    };
  }

  /**
   * Execute a trade signal
   */
  async executeTrade(signal: TradeSignal): Promise<Trade> {
    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      signal,
      status: 'pending',
      createdAt: new Date(),
      retryCount: 0,
    };

    // Check if auto-trading is enabled
    if (!this.config.trading.autoTradeEnabled) {
      logger.trade('Paper trade (auto-trade disabled)', {
        market: signal.market.title,
        side: signal.side,
        size: signal.sizeUsdc.toFixed(2),
        edge: (signal.edge.edge * 100).toFixed(2) + '%',
      });
      
      trade.status = 'cancelled';
      this.trades.push(trade);
      return trade;
    }

    if (!this.wallet) {
      logger.error('Cannot execute trade: wallet not initialized');
      trade.status = 'failed';
      trade.error = 'Wallet not initialized';
      this.trades.push(trade);
      return trade;
    }

    try {
      logger.trade('Executing trade', {
        market: signal.market.title,
        side: signal.side,
        size: signal.sizeUsdc.toFixed(2),
        edge: (signal.edge.edge * 100).toFixed(2) + '%',
      });

      // Get Jupiter quote
      const tokenMint = signal.side === 'buy_yes' 
        ? signal.market.yesTokenMint 
        : signal.market.noTokenMint;

      const quote = await this.getJupiterQuote(
        USDC_MINT.toBase58(),
        tokenMint,
        Math.floor(signal.sizeUsdc * Math.pow(10, USDC_DECIMALS)),
        Math.floor(signal.slippage * 10000)
      );

      if (!quote) {
        trade.status = 'failed';
        trade.error = 'Failed to get Jupiter quote';
        this.trades.push(trade);
        return trade;
      }

      // Get swap transaction
      const swapResponse = await this.getJupiterSwapTransaction(quote);
      if (!swapResponse) {
        trade.status = 'failed';
        trade.error = 'Failed to get swap transaction';
        this.trades.push(trade);
        return trade;
      }

      // Execute swap
      trade.status = 'submitted';
      const txSignature = await this.executeSwap(swapResponse.swapTransaction);
      
      if (txSignature) {
        trade.status = 'confirmed';
        trade.txSignature = txSignature;
        trade.executedAt = new Date();
        trade.executedPrice = signal.side === 'buy_yes' 
          ? signal.market.yesPrice 
          : signal.market.noPrice;
        trade.executedSize = signal.sizeUsdc;
        trade.tokensReceived = parseInt(quote.outAmount) / Math.pow(10, 6);

        // Update position tracking
        this.updatePosition(signal.market, signal.side, trade);
        
        logger.trade('Trade confirmed', {
          txSignature,
          tokensReceived: trade.tokensReceived?.toFixed(4),
        });
      } else {
        trade.status = 'failed';
        trade.error = 'Transaction failed';
      }

    } catch (error) {
      trade.status = 'failed';
      trade.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Trade execution failed', error);
    }

    this.trades.push(trade);
    return trade;
  }

  /**
   * Get Jupiter quote
   */
  private async getJupiterQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number
  ): Promise<JupiterQuote | null> {
    try {
      const response = await axios.get(`${JUPITER_API_URL}/quote`, {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps,
          onlyDirectRoutes: false,
        },
      });
      return response.data;
    } catch (error) {
      logger.error('Jupiter quote failed', error);
      return null;
    }
  }

  /**
   * Get Jupiter swap transaction
   */
  private async getJupiterSwapTransaction(
    quote: JupiterQuote
  ): Promise<{ swapTransaction: string } | null> {
    if (!this.wallet) return null;

    try {
      const response = await axios.post(`${JUPITER_API_URL}/swap`, {
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      });
      return response.data;
    } catch (error) {
      logger.error('Jupiter swap request failed', error);
      return null;
    }
  }

  /**
   * Execute the swap transaction
   */
  private async executeSwap(swapTransaction: string): Promise<string | null> {
    if (!this.wallet) return null;

    try {
      const transactionBuf = Buffer.from(swapTransaction, 'base64');
      
      // Try as VersionedTransaction first
      try {
        const transaction = VersionedTransaction.deserialize(transactionBuf);
        transaction.sign([this.wallet]);
        
        const txSignature = await this.connection.sendTransaction(transaction, {
          maxRetries: 3,
          skipPreflight: false,
        });
        
        // Confirm transaction
        const latestBlockhash = await this.connection.getLatestBlockhash();
        await this.connection.confirmTransaction({
          signature: txSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }, 'confirmed');
        
        return txSignature;
      } catch {
        // Fallback to legacy transaction
        const transaction = Transaction.from(transactionBuf);
        transaction.sign(this.wallet);
        
        const txSignature = await sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.wallet],
          { commitment: 'confirmed' }
        );
        
        return txSignature;
      }
    } catch (error) {
      logger.error('Swap execution failed', error);
      return null;
    }
  }

  /**
   * Update position tracking after trade
   */
  private updatePosition(market: WeatherMarket, side: 'buy_yes' | 'buy_no', trade: Trade): void {
    const positionKey = `${market.id}_${side}`;
    const existing = this.positions.get(positionKey);

    if (existing) {
      // Add to existing position
      const totalCost = existing.totalCost + (trade.executedSize || 0);
      const totalTokens = existing.tokens + (trade.tokensReceived || 0);
      existing.tokens = totalTokens;
      existing.totalCost = totalCost;
      existing.avgEntryPrice = totalCost / totalTokens;
      existing.updatedAt = new Date();
    } else {
      // Create new position
      this.positions.set(positionKey, {
        market,
        side: side === 'buy_yes' ? 'yes' : 'no',
        tokens: trade.tokensReceived || 0,
        avgEntryPrice: trade.executedPrice || 0,
        totalCost: trade.executedSize || 0,
        currentPrice: trade.executedPrice || 0,
        currentValue: trade.tokensReceived || 0,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryEdge: trade.signal.edge.edge,
        currentEdge: trade.signal.edge.edge,
        openedAt: new Date(),
        updatedAt: new Date(),
      });
    }

    this.totalExposure += trade.executedSize || 0;
  }

  /**
   * Update position values
   */
  async updatePositions(): Promise<void> {
    for (const [key, position] of this.positions) {
      try {
        // Get current price
        const tokenMint = position.side === 'yes' 
          ? position.market.yesTokenMint 
          : position.market.noTokenMint;
        
        const currentPrice = await marketFetcher.getTokenPrice(tokenMint);
        if (currentPrice !== null) {
          position.currentPrice = currentPrice;
          position.currentValue = position.tokens * currentPrice;
          position.unrealizedPnl = position.currentValue - position.totalCost;
          position.unrealizedPnlPercent = position.unrealizedPnl / position.totalCost;
          position.updatedAt = new Date();
        }
      } catch (error) {
        logger.debug('Failed to update position', { key, error });
      }
    }
  }

  /**
   * Check for take-profit conditions
   */
  async checkTakeProfit(): Promise<Position[]> {
    const positionsToClose: Position[] = [];
    
    for (const position of this.positions.values()) {
      // Check if edge has disappeared
      if (Math.abs(position.currentEdge) < this.config.trading.takeProfitEdge) {
        positionsToClose.push(position);
      }
      
      // Check if market is about to resolve (within 1 hour)
      const timeToResolution = position.market.resolutionDate.getTime() - Date.now();
      if (timeToResolution < 60 * 60 * 1000 && timeToResolution > 0) {
        positionsToClose.push(position);
      }
    }

    return positionsToClose;
  }

  /**
   * Close a position (sell tokens back)
   */
  async closePosition(position: Position): Promise<Trade | null> {
    if (!this.config.trading.autoTradeEnabled || !this.wallet) {
      logger.trade('Paper close position (auto-trade disabled)', {
        market: position.market.title,
        side: position.side,
        tokens: position.tokens.toFixed(4),
        pnl: position.unrealizedPnl.toFixed(2),
      });
      return null;
    }

    try {
      const tokenMint = position.side === 'yes' 
        ? position.market.yesTokenMint 
        : position.market.noTokenMint;

      const tokenDecimals = 6; // Assuming 6 decimals
      const amount = Math.floor(position.tokens * Math.pow(10, tokenDecimals));

      // Get quote for selling tokens back to USDC
      const quote = await this.getJupiterQuote(
        tokenMint,
        USDC_MINT.toBase58(),
        amount,
        Math.floor(this.config.trading.slippageTolerance * 10000)
      );

      if (!quote) {
        logger.error('Failed to get quote for closing position');
        return null;
      }

      const swapResponse = await this.getJupiterSwapTransaction(quote);
      if (!swapResponse) {
        logger.error('Failed to get swap transaction for closing position');
        return null;
      }

      const txSignature = await this.executeSwap(swapResponse.swapTransaction);
      
      if (txSignature) {
        logger.trade('Position closed', {
          market: position.market.title,
          side: position.side,
          tokens: position.tokens.toFixed(4),
          pnl: position.unrealizedPnl.toFixed(2),
          txSignature,
        });

        // Remove position
        const positionKey = `${position.market.id}_buy_${position.side}`;
        this.positions.delete(positionKey);
        this.totalExposure -= position.totalCost;

        return {
          id: `close_${Date.now()}`,
          signal: {
            market: position.market,
            edge: {
              market: position.market,
              forecast: null as never,
              ourProbability: 0,
              marketProbability: 0,
              edge: 0,
              absEdge: 0,
              side: 'none',
              expectedValue: 0,
              confidence: 0,
              kellyFraction: 0,
              recommendedSize: 0,
              calculatedAt: new Date(),
            },
            side: position.side === 'yes' ? 'buy_no' : 'buy_yes', // Opposite to close
            sizeUsdc: position.tokens * position.currentPrice,
            expectedTokens: 0,
            slippage: this.config.trading.slippageTolerance,
            priority: 'high',
            maxLoss: 0,
            expectedProfit: position.unrealizedPnl,
            riskRewardRatio: 0,
            createdAt: new Date(),
            expiresAt: new Date(),
          },
          status: 'confirmed',
          txSignature,
          executedPrice: position.currentPrice,
          executedSize: position.tokens * position.currentPrice,
          tokensReceived: parseInt(quote.outAmount) / Math.pow(10, USDC_DECIMALS),
          executedAt: new Date(),
          createdAt: new Date(),
          retryCount: 0,
        };
      }
    } catch (error) {
      logger.error('Failed to close position', error);
    }

    return null;
  }

  /**
   * Process all edges and execute trades
   */
  async processEdges(edges: MarketEdge[]): Promise<Trade[]> {
    const executedTrades: Trade[] = [];

    for (const edge of edges) {
      // Skip if we already have a position in this market
      const existingYes = this.positions.get(`${edge.market.id}_buy_yes`);
      const existingNo = this.positions.get(`${edge.market.id}_buy_no`);
      
      if (existingYes || existingNo) {
        logger.debug('Skipping - already have position', { market: edge.market.id });
        continue;
      }

      const signal = this.createTradeSignal(edge);
      if (signal) {
        const trade = await this.executeTrade(signal);
        executedTrades.push(trade);

        // Add small delay between trades
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return executedTrades;
  }

  /**
   * Get all positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get all trades
   */
  getTrades(): Trade[] {
    return this.trades;
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit = 20): Trade[] {
    return this.trades.slice(-limit);
  }

  /**
   * Get total PnL
   */
  getTotalPnl(): { realized: number; unrealized: number; total: number } {
    const realized = this.trades
      .filter(t => t.status === 'confirmed')
      .reduce((sum, t) => {
        // Simplified - would need actual resolution data
        return sum;
      }, 0);

    const unrealized = Array.from(this.positions.values())
      .reduce((sum, p) => sum + p.unrealizedPnl, 0);

    return {
      realized,
      unrealized,
      total: realized + unrealized,
    };
  }

  /**
   * Get total exposure
   */
  getTotalExposure(): number {
    return this.totalExposure;
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Export singleton instance
export const trader = new Trader();
export default trader;


