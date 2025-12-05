"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BotStats, BotStatus } from "@/lib/api";
import { formatUSD, formatPercent } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  DollarSign,
  BarChart3,
  Clock,
  Zap,
} from "lucide-react";

interface StatsCardsProps {
  stats: BotStats | null;
  status: BotStatus | null;
}

export function StatsCards({ stats, status }: StatsCardsProps) {
  const statusVariant = {
    idle: "secondary",
    running: "success",
    trading: "info",
    error: "destructive",
    paused: "warning",
  } as const;

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Bot Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Bot Status</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[status?.status || "idle"]}>
              {status?.status?.toUpperCase() || "UNKNOWN"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {status?.lastRun
              ? `Last run: ${new Date(status.lastRun).toLocaleTimeString()}`
              : "Never run"}
          </p>
        </CardContent>
      </Card>

      {/* Total PnL */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total PnL</CardTitle>
          {(stats?.totalPnl || 0) >= 0 ? (
            <TrendingUp className="h-4 w-4 text-green-500" />
          ) : (
            <TrendingDown className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${
              (stats?.totalPnl || 0) >= 0 ? "text-green-500" : "text-red-500"
            }`}
          >
            {formatUSD(stats?.totalPnl || 0)}
          </div>
          <p className="text-xs text-muted-foreground">
            Realized: {formatUSD(stats?.realizedPnl || 0)} | Unrealized:{" "}
            {formatUSD(stats?.unrealizedPnl || 0)}
          </p>
        </CardContent>
      </Card>

      {/* Win Rate */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          <Target className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatPercent(stats?.winRate || 0)}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats?.winningTrades || 0}W / {stats?.losingTrades || 0}L of{" "}
            {stats?.totalTrades || 0} trades
          </p>
        </CardContent>
      </Card>

      {/* Average Edge */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Avg Edge</CardTitle>
          <Zap className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatPercent(stats?.avgEdge || 0)}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats?.edgesFound || 0} edges found today
          </p>
        </CardContent>
      </Card>

      {/* Markets Scanned */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Markets</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats?.marketsScanned || 0}</div>
          <p className="text-xs text-muted-foreground">Active weather markets</p>
        </CardContent>
      </Card>

      {/* Trades Executed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Trades</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {stats?.tradesExecuted || 0}
          </div>
          <p className="text-xs text-muted-foreground">
            {stats?.lastTradeAt
              ? `Last: ${new Date(stats.lastTradeAt).toLocaleTimeString()}`
              : "No trades yet"}
          </p>
        </CardContent>
      </Card>

      {/* Max Drawdown */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Max Drawdown</CardTitle>
          <TrendingDown className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-500">
            {formatUSD(stats?.maxDrawdown || 0)}
          </div>
          <p className="text-xs text-muted-foreground">Largest peak-to-trough</p>
        </CardContent>
      </Card>

      {/* Uptime */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Uptime</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatUptime(stats?.uptimeSeconds || 0)}
          </div>
          <p className="text-xs text-muted-foreground">
            {status?.nextRun
              ? `Next run: ${new Date(status.nextRun).toLocaleTimeString()}`
              : "Not scheduled"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}


