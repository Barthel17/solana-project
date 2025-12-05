/**
 * Alert System
 * Send notifications via Telegram and Discord
 */

import axios from 'axios';
import { logger } from './logger';
import { getConfig } from './config';
import type { Alert, AlertType, AlertSeverity, MarketEdge, Trade } from './types';

export class AlertManager {
  private config = getConfig();
  private alerts: Alert[] = [];
  private alertCount = 0;

  /**
   * Send an alert
   */
  async sendAlert(
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    data?: Record<string, unknown>
  ): Promise<void> {
    const alert: Alert = {
      id: `alert_${Date.now()}_${++this.alertCount}`,
      type,
      severity,
      title,
      message,
      data,
      createdAt: new Date(),
      sentVia: ['log'],
    };

    // Always log
    const logMethod = severity === 'critical' || severity === 'high' ? 'error' : 
                      severity === 'medium' ? 'warn' : 'info';
    logger[logMethod](`[ALERT] ${title}: ${message}`, data);

    // Check if we should send external alerts
    const shouldSend = 
      (type === 'trade_executed' && this.config.alerts.alertOnTrades) ||
      (type === 'trade_failed' && this.config.alerts.alertOnTrades) ||
      (type === 'edge_found' && this.config.alerts.alertOnEdges) ||
      (type === 'error' && this.config.alerts.alertOnErrors) ||
      severity === 'critical' ||
      severity === 'high';

    if (shouldSend) {
      // Send to Telegram
      if (this.config.alerts.telegramBotToken && this.config.alerts.telegramChatId) {
        try {
          await this.sendTelegram(alert);
          alert.sentVia.push('telegram');
        } catch (error) {
          logger.debug('Telegram alert failed', { error });
        }
      }

      // Send to Discord
      if (this.config.alerts.discordWebhookUrl) {
        try {
          await this.sendDiscord(alert);
          alert.sentVia.push('discord');
        } catch (error) {
          logger.debug('Discord alert failed', { error });
        }
      }
    }

    // Store alert
    this.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  /**
   * Send Telegram message
   */
  private async sendTelegram(alert: Alert): Promise<void> {
    const { telegramBotToken, telegramChatId } = this.config.alerts;
    if (!telegramBotToken || !telegramChatId) return;

    const emoji = this.getEmoji(alert.type, alert.severity);
    const text = `${emoji} *${this.escapeMarkdown(alert.title)}*\n\n${this.escapeMarkdown(alert.message)}`;

    await axios.post(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        chat_id: telegramChatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_notification: alert.severity === 'low',
      }
    );
  }

  /**
   * Send Discord webhook
   */
  private async sendDiscord(alert: Alert): Promise<void> {
    const { discordWebhookUrl } = this.config.alerts;
    if (!discordWebhookUrl) return;

    const color = this.getDiscordColor(alert.severity);
    const emoji = this.getEmoji(alert.type, alert.severity);

    await axios.post(discordWebhookUrl, {
      embeds: [{
        title: `${emoji} ${alert.title}`,
        description: alert.message,
        color,
        timestamp: alert.createdAt.toISOString(),
        fields: alert.data ? Object.entries(alert.data).slice(0, 5).map(([key, value]) => ({
          name: key,
          value: String(value).slice(0, 100),
          inline: true,
        })) : [],
        footer: {
          text: 'Weather Market Bot',
        },
      }],
    });
  }

  /**
   * Get emoji for alert type
   */
  private getEmoji(type: AlertType, severity: AlertSeverity): string {
    if (severity === 'critical') return '🚨';
    if (severity === 'high') return '⚠️';
    
    switch (type) {
      case 'edge_found': return '📊';
      case 'trade_executed': return '✅';
      case 'trade_failed': return '❌';
      case 'position_closed': return '💰';
      case 'error': return '🔴';
      case 'warning': return '🟡';
      case 'info': return '🔵';
      default: return '📌';
    }
  }

  /**
   * Get Discord embed color
   */
  private getDiscordColor(severity: AlertSeverity): number {
    switch (severity) {
      case 'critical': return 0xFF0000; // Red
      case 'high': return 0xFF9900; // Orange
      case 'medium': return 0xFFFF00; // Yellow
      case 'low': return 0x00FF00; // Green
      default: return 0x0099FF; // Blue
    }
  }

  /**
   * Escape markdown special characters for Telegram
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  // Convenience methods for common alerts

  /**
   * Alert for edge found
   */
  async alertEdgeFound(edge: MarketEdge): Promise<void> {
    const severity: AlertSeverity = edge.absEdge > 0.15 ? 'high' : 'medium';
    
    await this.sendAlert(
      'edge_found',
      severity,
      `Edge Found: ${edge.market.city}`,
      `${edge.market.title}\n` +
      `Edge: ${(edge.edge * 100).toFixed(1)}% (${edge.side.toUpperCase()})\n` +
      `Our Prob: ${(edge.ourProbability * 100).toFixed(1)}%\n` +
      `Market: ${(edge.marketProbability * 100).toFixed(1)}%\n` +
      `Recommended: $${edge.recommendedSize.toFixed(2)}`,
      {
        marketId: edge.market.id,
        edge: edge.edge,
        side: edge.side,
        recommendedSize: edge.recommendedSize,
      }
    );
  }

  /**
   * Alert for trade executed
   */
  async alertTradeExecuted(trade: Trade): Promise<void> {
    const isPaperTrade = trade.status === 'cancelled';
    
    await this.sendAlert(
      'trade_executed',
      'medium',
      isPaperTrade ? 'Paper Trade' : 'Trade Executed',
      `${trade.signal.market.title}\n` +
      `Side: ${trade.signal.side}\n` +
      `Size: $${trade.signal.sizeUsdc.toFixed(2)}\n` +
      `Edge: ${(trade.signal.edge.edge * 100).toFixed(1)}%` +
      (trade.txSignature ? `\nTx: ${trade.txSignature.slice(0, 16)}...` : ''),
      {
        tradeId: trade.id,
        marketId: trade.signal.market.id,
        side: trade.signal.side,
        size: trade.signal.sizeUsdc,
        txSignature: trade.txSignature,
      }
    );
  }

  /**
   * Alert for trade failed
   */
  async alertTradeFailed(trade: Trade): Promise<void> {
    await this.sendAlert(
      'trade_failed',
      'high',
      'Trade Failed',
      `${trade.signal.market.title}\n` +
      `Side: ${trade.signal.side}\n` +
      `Size: $${trade.signal.sizeUsdc.toFixed(2)}\n` +
      `Error: ${trade.error || 'Unknown'}`,
      {
        tradeId: trade.id,
        marketId: trade.signal.market.id,
        error: trade.error,
      }
    );
  }

  /**
   * Alert for position closed
   */
  async alertPositionClosed(
    market: string,
    side: string,
    pnl: number,
    txSignature?: string
  ): Promise<void> {
    const severity: AlertSeverity = pnl > 0 ? 'low' : 'medium';
    
    await this.sendAlert(
      'position_closed',
      severity,
      'Position Closed',
      `${market}\n` +
      `Side: ${side}\n` +
      `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` +
      (txSignature ? `\nTx: ${txSignature.slice(0, 16)}...` : ''),
      { market, side, pnl, txSignature }
    );
  }

  /**
   * Alert for bot status
   */
  async alertBotStatus(status: string, details?: Record<string, unknown>): Promise<void> {
    await this.sendAlert(
      'info',
      'low',
      'Bot Status Update',
      status,
      details
    );
  }

  /**
   * Alert for errors
   */
  async alertError(title: string, error: Error | string): Promise<void> {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    
    await this.sendAlert(
      'error',
      'high',
      title,
      message,
      { stack }
    );
  }

  /**
   * Get all alerts
   */
  getAlerts(): Alert[] {
    return this.alerts;
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit = 20): Alert[] {
    return this.alerts.slice(-limit);
  }

  /**
   * Clear alerts
   */
  clearAlerts(): void {
    this.alerts = [];
  }
}

// Export singleton instance
export const alertManager = new AlertManager();
export default alertManager;


