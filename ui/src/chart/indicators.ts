import { Candle } from '../types';

interface IndicatorResults {
  rsi: (number | null)[];
  stochK: (number | null)[];
  stochD: (number | null)[];
}

export function computeIndicators(candles: Candle[]): IndicatorResults {
  const n = candles.length;
  const rsi: (number | null)[] = new Array(n).fill(null);
  const stochK: (number | null)[] = new Array(n).fill(null);
  const stochD: (number | null)[] = new Array(n).fill(null);

  if (n === 0) return { rsi, stochK, stochD };

  // 1. RSI (Period 14)
  const rsiPeriod = 14;
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i < n; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    if (i < rsiPeriod) {
      avgGain += gain;
      avgLoss += loss;
    } else if (i === rsiPeriod) {
      avgGain = (avgGain + gain) / rsiPeriod;
      avgLoss = (avgLoss + loss) / rsiPeriod;
      rsi[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + avgGain / avgLoss));
    } else {
      avgGain = (avgGain * (rsiPeriod - 1) + gain) / rsiPeriod;
      avgLoss = (avgLoss * (rsiPeriod - 1) + loss) / rsiPeriod;
      rsi[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - (100 / (1 + avgGain / avgLoss));
    }
  }

  // 2. Stochastic Oscillator (14, 3, 3)
  const stochKPeriod = 14;
  const rawK: number[] = new Array(n).fill(50);

  for (let i = 0; i < n; i++) {
    if (i < stochKPeriod - 1) {
      rawK[i] = 50;
    } else {
      let minLow = Infinity;
      let maxHigh = -Infinity;
      for (let j = i - stochKPeriod + 1; j <= i; j++) {
        if (candles[j].l < minLow) minLow = candles[j].l;
        if (candles[j].h > maxHigh) maxHigh = candles[j].h;
      }
      const range = maxHigh - minLow;
      rawK[i] = range > 0 ? ((candles[i].c - minLow) / range) * 100 : 50;
    }
  }

  // Smooth %K (3-period SMA)
  for (let i = 0; i < n; i++) {
    if (i >= stochKPeriod + 1) {
      const sumK = rawK[i] + rawK[i - 1] + rawK[i - 2];
      stochK[i] = sumK / 3;
    }
  }

  // %D (3-period SMA of smooth %K)
  for (let i = 0; i < n; i++) {
    if (i >= 2 && stochK[i] !== null && stochK[i - 1] !== null && stochK[i - 2] !== null) {
      stochD[i] = (stochK[i]! + stochK[i - 1]! + stochK[i - 2]!) / 3;
    }
  }

  return { rsi, stochK, stochD };
}

