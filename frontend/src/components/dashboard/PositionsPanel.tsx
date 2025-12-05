"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import type { Position } from "@/lib/api";
import { formatPercent, formatUSD } from "@/lib/utils";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";

interface PositionsPanelProps {
  positions: Position[];
}

export function PositionsPanel({ positions }: PositionsPanelProps) {
  const totalValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Open Positions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Summary */}
        <div className="mb-4 p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Value</span>
            <span className="font-mono font-bold">{formatUSD(totalValue)}</span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-sm text-muted-foreground">Unrealized PnL</span>
            <span
              className={`font-mono font-bold ${
                totalPnl >= 0 ? "text-green-500" : "text-red-500"
              }`}
            >
              {totalPnl >= 0 ? "+" : ""}
              {formatUSD(totalPnl)}
            </span>
          </div>
        </div>

        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {positions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No open positions
              </p>
            ) : (
              positions.map((position, idx) => (
                <div key={idx} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge
                      variant={position.side === "yes" ? "success" : "destructive"}
                    >
                      {position.side.toUpperCase()}
                    </Badge>
                    <div className="flex items-center gap-1">
                      {position.unrealizedPnl >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-500" />
                      )}
                      <span
                        className={`font-mono text-sm font-bold ${
                          position.unrealizedPnl >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {position.unrealizedPnl >= 0 ? "+" : ""}
                        {formatUSD(position.unrealizedPnl)}
                      </span>
                    </div>
                  </div>

                  <div className="text-sm font-medium truncate">
                    {position.market.title}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Tokens: </span>
                      <span className="font-mono">{position.tokens.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Entry: </span>
                      <span className="font-mono">
                        {formatPercent(position.avgEntryPrice)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Current: </span>
                      <span className="font-mono">
                        {formatPercent(position.currentPrice)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">PnL %: </span>
                      <span
                        className={`font-mono ${
                          position.unrealizedPnlPercent >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {formatPercent(position.unrealizedPnlPercent)}
                      </span>
                    </div>
                  </div>

                  {/* Visual progress bar */}
                  <div className="mt-2">
                    <Progress
                      value={Math.min(position.currentPrice * 100, 100)}
                      className="h-1"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}


