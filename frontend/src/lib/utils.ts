import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getEdgeColor(edge: number): string {
  const absEdge = Math.abs(edge);
  if (absEdge >= 0.15) return 'text-green-500';
  if (absEdge >= 0.10) return 'text-yellow-500';
  if (absEdge >= 0.08) return 'text-orange-500';
  return 'text-gray-500';
}

export function getEdgeBgColor(edge: number): string {
  const absEdge = Math.abs(edge);
  if (absEdge >= 0.15) return 'bg-green-500/10';
  if (absEdge >= 0.10) return 'bg-yellow-500/10';
  if (absEdge >= 0.08) return 'bg-orange-500/10';
  return 'bg-gray-500/10';
}


