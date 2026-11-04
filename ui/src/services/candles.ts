import { Candle } from '../types';

// Updates can include the final version of the previous candle and multiple
// newly closed candles between broadcasts. Merge by time, keeping bounded history.
export function mergeCandles(previous: Candle[], incoming: Candle[], limit = 1000): Candle[] {
  const byTime = new Map(previous.map(candle => [candle.time, candle]));
  for (const candle of incoming) {
    if (Number.isFinite(candle.time)) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-limit);
}
