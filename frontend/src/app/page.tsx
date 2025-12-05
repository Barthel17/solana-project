"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { MarketsTable } from "@/components/dashboard/MarketsTable";
import { TradeLog } from "@/components/dashboard/TradeLog";
import { PositionsPanel } from "@/components/dashboard/PositionsPanel";
import { AlertsFeed } from "@/components/dashboard/AlertsFeed";
import {
  getBotState,
  triggerCycle,
  type BotState,
  type BotStatus,
  type BotStats,
  type Market,
  type Edge,
  type Position,
  type Trade,
  type Alert,
} from "@/lib/api";
import {
  RefreshCw,
  Play,
  Sun,
  Cloud,
  CloudRain,
  Snowflake,
  Zap,
} from "lucide-react";

export default function Dashboard() {
  const [state, setState] = useState<BotState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setIsRefreshing(true);
    try {
      const data = await getBotState();
      setState(data);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch bot state:", err);
      setError("Failed to connect to bot. Make sure the bot is running.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleTriggerCycle = async () => {
    setIsTriggering(true);
    try {
      await triggerCycle();
      // Refresh data after triggering (wait a bit for cycle to complete)
      setTimeout(() => {
        fetchData(true);
        setIsTriggering(false);
      }, 3000);
    } catch (err) {
      console.error("Failed to trigger cycle:", err);
      setError("Failed to trigger cycle. Check bot logs.");
      setIsTriggering(false);
    }
  };

  const handleManualTrade = (market: Market, side: "yes" | "no") => {
    console.log("Manual trade:", market.id, side);
    // In production, this would call the API to execute a trade
    alert(`Would execute ${side.toUpperCase()} trade on ${market.title}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Sun className="h-6 w-6 text-yellow-500" />
                <Cloud className="h-5 w-5 text-blue-400 -ml-2" />
                <CloudRain className="h-4 w-4 text-blue-500 -ml-1" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Weather Market Bot</h1>
                <p className="text-xs text-muted-foreground">
                  Automated weather prediction market trading
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {lastUpdate && (
                <span className="text-xs text-muted-foreground">
                  Updated {lastUpdate.toLocaleTimeString()}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchData(true)}
                disabled={isRefreshing || isTriggering}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button 
                size="sm" 
                onClick={handleTriggerCycle}
                disabled={isTriggering || isRefreshing}
              >
                <Play className={`h-4 w-4 mr-2 ${isTriggering ? "animate-pulse" : ""}`} />
                {isTriggering ? "Running..." : "Run Cycle"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {error ? (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
            <Zap className="h-8 w-8 mx-auto text-destructive mb-2" />
            <h3 className="font-semibold text-destructive">Connection Error</h3>
            <p className="text-sm text-muted-foreground mt-1">{error}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Start the bot with: <code className="bg-muted px-1 rounded">npm run bot</code>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fetchData(true)}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Stats Cards */}
            <StatsCards
              stats={state?.stats || null}
              status={
                state
                  ? {
                      status: state.status,
                      lastRun: state.lastRun,
                      nextRun: state.nextRun,
                      errorCount: 0,
                    }
                  : null
              }
            />

            {/* Main Grid */}
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Markets Table - Takes 2 columns */}
              <MarketsTable
                markets={state?.markets || []}
                edges={state?.edges || []}
                onTrade={handleManualTrade}
            />

              {/* Right Column */}
              <div className="space-y-6">
                {/* Positions */}
                <PositionsPanel positions={state?.positions || []} />

                {/* Alerts */}
                <AlertsFeed alerts={state?.recentAlerts || []} />
              </div>
            </div>

            {/* Trade Log - Full Width */}
            <TradeLog trades={state?.recentTrades || []} />

            {/* Footer Info */}
            <div className="text-center text-xs text-muted-foreground py-4 border-t">
              <div className="flex items-center justify-center gap-4">
                <span>
                  Auto-trading:{" "}
                  <Badge
                    variant={
                      process.env.NEXT_PUBLIC_AUTO_TRADE === "true"
                        ? "success"
                        : "secondary"
                    }
                  >
                    {process.env.NEXT_PUBLIC_AUTO_TRADE === "true" ? "ON" : "OFF"}
                  </Badge>
                </span>
                <span>•</span>
                <span>
                  Bot API:{" "}
                  <code className="bg-muted px-1 rounded">
                    {process.env.NEXT_PUBLIC_BOT_API_URL || "localhost:3001"}
                  </code>
                </span>
              </div>
            </div>
        </div>
        )}
      </main>
    </div>
  );
}
