"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Market, Edge } from "@/lib/api";
import { formatPercent, formatUSD, formatDate, getEdgeColor, getEdgeBgColor } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, TrendingUp } from "lucide-react";

interface MarketsTableProps {
  markets: Market[];
  edges: Edge[];
  onTrade?: (market: Market, side: "yes" | "no") => void;
}

export function MarketsTable({ markets, edges, onTrade }: MarketsTableProps) {
  // Create a map of edges by market ID
  const edgeMap = new Map(edges.map((e) => [e.marketId, e]));

  // Sort markets by edge (highest first)
  const sortedMarkets = [...markets].sort((a, b) => {
    const edgeA = edgeMap.get(a.id);
    const edgeB = edgeMap.get(b.id);
    return (edgeB?.absEdge || 0) - (edgeA?.absEdge || 0);
  });

  return (
    <Card className="col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Active Weather Markets
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[500px] pr-4">
          <div className="space-y-4">
            {sortedMarkets.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No markets available. Start the bot to fetch markets.
              </p>
            ) : (
              sortedMarkets.map((market) => {
                const edge = edgeMap.get(market.id);
                const hasEdge = edge && Math.abs(edge.edge) >= 0.08;

                return (
                  <div
                    key={market.id}
                    className={`rounded-lg border p-4 transition-colors ${
                      hasEdge ? getEdgeBgColor(edge.edge) : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{market.city}</Badge>
                          <span className="text-sm text-muted-foreground">
                            Resolves {formatDate(market.resolutionDate)}
                          </span>
                        </div>
                        <h4 className="font-medium">{market.title}</h4>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">
                          Vol: {formatUSD(market.volume24h)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-5 gap-4 items-center">
                      {/* Yes Price */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          Yes Price
                        </div>
                        <div className="font-mono font-bold text-green-600">
                          {formatPercent(market.yesPrice)}
                        </div>
                      </div>

                      {/* No Price */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          No Price
                        </div>
                        <div className="font-mono font-bold text-red-600">
                          {formatPercent(market.noPrice)}
                        </div>
                      </div>

                      {/* Our Probability */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          Our Prob
                        </div>
                        <div className="font-mono font-bold">
                          {edge ? formatPercent(edge.ourProbability) : "-"}
                        </div>
                      </div>

                      {/* Edge */}
                      <div>
                        <div className="text-xs text-muted-foreground mb-1">
                          Edge
                        </div>
                        {edge ? (
                          <div
                            className={`font-mono font-bold flex items-center gap-1 ${getEdgeColor(
                              edge.edge
                            )}`}
                          >
                            {edge.edge > 0 ? (
                              <ArrowUpRight className="h-4 w-4" />
                            ) : (
                              <ArrowDownRight className="h-4 w-4" />
                            )}
                            {formatPercent(Math.abs(edge.edge))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>

                      {/* Trade Button */}
                      <div className="flex gap-2 justify-end">
                        {hasEdge && (
                          <>
                            {edge.side === "yes" && (
                              <Button
                                size="sm"
                                variant="success"
                                onClick={() => onTrade?.(market, "yes")}
                              >
                                Buy Yes
                              </Button>
                            )}
                            {edge.side === "no" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => onTrade?.(market, "no")}
                              >
                                Buy No
                              </Button>
                            )}
                          </>
                        )}
                        {!hasEdge && (
                          <span className="text-xs text-muted-foreground">
                            No edge
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Recommended Size */}
                    {hasEdge && edge.recommendedSize > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Recommended size: {formatUSD(edge.recommendedSize)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}


