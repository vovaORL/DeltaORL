export function priceCandleColor(open: number, close: number): string {
  return close > open ? '#22c55e' : close < open ? '#ef4444' : '#94a3b8';
}
