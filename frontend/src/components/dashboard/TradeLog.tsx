"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Trade } from "@/lib/api";
import { formatPercent, formatUSD, formatDate } from "@/lib/utils";
import { History, ExternalLink } from "lucide-react";

interface TradeLogProps {
  trades: Trade[];
}

export function TradeLog({ trades }: TradeLogProps) {
  const statusVariant = {
    pending: "secondary",
    submitted: "info",
    confirmed: "success",
    failed: "destructive",
    cancelled: "warning",
  } as const;

  const reversedTrades = [...trades].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Recent Trades
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-3">
            {reversedTrades.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No trades yet
              </p>
            ) : (
              reversedTrades.map((trade) => (
                <div
                  key={trade.id}
                  className="rounded-lg border p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          trade.signal.side === "buy_yes"
                            ? "success"
                            : "destructive"
                        }
                      >
                        {trade.signal.side === "buy_yes" ? "YES" : "NO"}
                      </Badge>
                      <Badge variant={statusVariant[trade.status]}>
                        {trade.status.toUpperCase()}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(trade.createdAt)}
                    </span>
                  </div>

                  <div className="text-sm font-medium truncate">
                    {trade.signal.market.title}
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Size: {formatUSD(trade.signal.sizeUsdc)}
                    </span>
                    <span className="text-muted-foreground">
                      Edge: {formatPercent(trade.signal.edge.edge)}
                    </span>
                  </div>

                  {trade.txSignature && (
                    <a
                      href={`https://solscan.io/tx/${trade.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600"
                    >
                      View on Solscan
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}


