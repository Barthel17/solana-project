"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Alert } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { Bell, AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";

interface AlertsFeedProps {
  alerts: Alert[];
}

export function AlertsFeed({ alerts }: AlertsFeedProps) {
  const severityVariant = {
    low: "secondary",
    medium: "warning",
    high: "destructive",
    critical: "destructive",
  } as const;

  const getIcon = (type: string, severity: string) => {
    if (severity === "critical" || severity === "high") {
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
    switch (type) {
      case "trade_executed":
      case "position_closed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "trade_failed":
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const reversedAlerts = [...alerts].reverse();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Activity Feed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          <div className="space-y-3">
            {reversedAlerts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No recent activity
              </p>
            ) : (
              reversedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-lg border p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getIcon(alert.type, alert.severity)}
                      <span className="text-sm font-medium">{alert.title}</span>
                    </div>
                    <Badge variant={severityVariant[alert.severity]} className="text-xs">
                      {alert.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {alert.message}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(alert.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}


