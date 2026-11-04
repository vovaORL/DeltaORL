import React, { useRef, useEffect, useCallback, useState } from 'react';
import { computeIndicators } from './indicators';
import { Candle, ClusterDisplayMode, ChartThemeSettings, IndicatorHeights, defaultIndicatorHeights } from '../types';

interface FootprintChartProps {
  candles: Candle[];
  tickSize: number;
  symbol: string;
  timeframe: number;
  displayMode: ClusterDisplayMode;
  showCVD: boolean;
  showRSI: boolean;
  showStochastic: boolean;
  showValueArea: boolean;
  showHorizontalProfile: boolean;
  showVerticalVolume: boolean;
  chartTheme: ChartThemeSettings;
  indicatorHeights?: IndicatorHeights;
  onIndicatorHeightsChange?: (heights: IndicatorHeights) => void;
}

interface MeasureState {
  active: boolean;
  startX: number;
  startY: number;
  startPrice: number;
  startCandleTime: number;
  currentX: number;
  currentY: number;
  currentPrice: number;
  currentCandleTime: number;
}

type PanelResizeTarget = 'VOLUME' | 'CVD' | 'RSI' | 'STOCH' | null;

function getHexLuminance(colorStr?: string): number {
  if (!colorStr) return 0;
  if (colorStr.startsWith('#')) {
    const hex = colorStr.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }
  if (colorStr.startsWith('rgb')) {
    const match = colorStr.match(/\d+/g);
    if (match && match.length >= 3) {
      const r = parseInt(match[0], 10);
      const g = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return 0;
}

export const FootprintChart: React.FC<FootprintChartProps> = ({
  candles,
  tickSize,
  symbol,
  timeframe,
  displayMode,
  showCVD,
  showRSI,
  showStochastic,
  showValueArea,
  showHorizontalProfile,
  showVerticalVolume,
  chartTheme,
  indicatorHeights = defaultIndicatorHeights,
  onIndicatorHeightsChange
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const indicatorCache = useRef<{ candles: Candle[] | null; value: ReturnType<typeof computeIndicators> }>({
    candles: null, value: { rsi: [], stochK: [], stochD: [] }
  });

  // Viewport transformation state in mutable ref (zero React re-render lag)
  const viewportRef = useRef({
    candleWidth: 68,
    candleSpacing: 26,
    priceScale: 140000,
    centerPrice: 0,
    offsetX: 1300,
    autoScroll: true
  });

  // Auto-scroll state for UI toggle
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(true);

  // Track previous symbol, timeframe and candles metadata for reliable auto-centering
  const lastFittedRef = useRef<{ symbol: string; timeframe: number; firstTime: number; lastTime: number; candleCount: number }>({
    symbol: '',
    timeframe: 0,
    firstTime: 0,
    lastTime: 0,
    candleCount: 0
  });

  // Crosshair coordinates in mutable ref
  const crosshairRef = useRef<{ x: number; y: number; price: number } | null>(null);

  // Measure state (TradingView Shift-measure tool)
  const measureRef = useRef<MeasureState | null>(null);

  // Interactive panel resize state
  const resizeTargetRef = useRef<PanelResizeTarget>(null);
  const hoveredDividerRef = useRef<PanelResizeTarget>(null);

  // Drag state
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const dragModeRef = useRef<'PAN' | 'PRICE_SCALE' | 'TIME_SCALE' | 'PANEL_RESIZE' | 'MEASURE' | null>(null);

  // Dynamic props & candles refs so continuous render loop always reads latest data
  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;

  const propsRef = useRef({
    tickSize,
    symbol,
    timeframe,
    displayMode,
    showCVD,
    showRSI,
    showStochastic,
    showValueArea,
    showHorizontalProfile,
    showVerticalVolume,
    chartTheme,
    indicatorHeights,
    onIndicatorHeightsChange
  });
  propsRef.current = {
    tickSize,
    symbol,
    timeframe,
    displayMode,
    showCVD,
    showRSI,
    showStochastic,
    showValueArea,
    showHorizontalProfile,
    showVerticalVolume,
    chartTheme,
    indicatorHeights,
    onIndicatorHeightsChange
  };

  const getPanelDividers = useCallback((height: number) => {
    const p = propsRef.current;
    const indH = p.indicatorHeights || defaultIndicatorHeights;
    const volH = p.showVerticalVolume ? indH.volume : 0;
    const cvdH = p.showCVD ? indH.cvd : 0;
    const rsiH = p.showRSI ? indH.rsi : 0;
    const stochH = p.showStochastic ? indH.stoch : 0;
    const bottomTotal = volH + cvdH + rsiH + stochH;
    const chartH = Math.max(80, height - bottomTotal);

    const dividers: { type: 'VOLUME' | 'CVD' | 'RSI' | 'STOCH'; y: number }[] = [];
    let curY = chartH;
    if (volH > 0) {
      dividers.push({ type: 'VOLUME', y: curY });
      curY += volH;
    }
    if (cvdH > 0) {
      dividers.push({ type: 'CVD', y: curY });
      curY += cvdH;
    }
    if (rsiH > 0) {
      dividers.push({ type: 'RSI', y: curY });
      curY += rsiH;
    }
    if (stochH > 0) {
      dividers.push({ type: 'STOCH', y: curY });
      curY += stochH;
    }
    return { dividers, chartH, volH, cvdH, rsiH, stochH, bottomTotal };
  }, []);

  const calculateAutoFit = useCallback((candlesList: Candle[]) => {
    if (candlesList.length === 0) return;

    const containerH = containerRef.current?.clientHeight || 650;
    const containerW = containerRef.current?.clientWidth || 1200;
    const p = propsRef.current;
    const vp = viewportRef.current;
    const indH = p.indicatorHeights || defaultIndicatorHeights;

    const volumeHeight = p.showVerticalVolume ? indH.volume : 0;
    const cvdHeight = p.showCVD ? indH.cvd : 0;
    const rsiHeight = p.showRSI ? indH.rsi : 0;
    const stochHeight = p.showStochastic ? indH.stoch : 0;
    const chartHeight = Math.max(100, containerH - volumeHeight - cvdHeight - rsiHeight - stochHeight);
    const priceScaleWidth = 64;

    const candlePitch = vp.candleWidth + vp.candleSpacing;
    const visibleCount = Math.max(8, Math.floor((containerW - priceScaleWidth - 110) / candlePitch));
    const recentCandles = candlesList.slice(-visibleCount);

    let minPrice = Infinity;
    let maxPrice = -Infinity;

    recentCandles.forEach(c => {
      if (c.l < minPrice) minPrice = c.l;
      if (c.h > maxPrice) maxPrice = c.h;
    });

    if (!isFinite(minPrice) || !isFinite(maxPrice)) {
      const latest = candlesList[candlesList.length - 1];
      minPrice = latest.l;
      maxPrice = latest.h;
    }

    const priceRange = Math.max(maxPrice - minPrice, p.tickSize * 8);
    const fitScale = (chartHeight * 0.72) / priceRange;
    const centerPrice = (maxPrice + minPrice) / 2;
    const targetOffsetX = containerW - priceScaleWidth - vp.candleWidth - 25;

    vp.priceScale = fitScale;
    vp.centerPrice = centerPrice;
    vp.offsetX = targetOffsetX;
    vp.autoScroll = true;
  }, []);

  // Auto-fit to latest candles on first load, symbol/timeframe switch, or if price is offscreen
  useEffect(() => {
    if (candles.length > 0) {
      const first = candles[0];
      const latest = candles[candles.length - 1];
      const prev = lastFittedRef.current;

      const symbolChanged = prev.symbol !== symbol;
      const tfChanged = prev.timeframe !== timeframe;
      const dataReset = candles.length < prev.candleCount || first.time < prev.firstTime || Math.abs(candles.length - prev.candleCount) > 4;
      const isInitial = viewportRef.current.centerPrice === 0;

      // Detect if latest candle is off-screen
      const vp = viewportRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      const chartH = rect ? rect.height : 600;
      const isOffscreen = vp.autoScroll && (vp.centerPrice === 0 || (latest.c > 0 && Math.abs(latest.c - vp.centerPrice) * vp.priceScale > chartH * 0.75));

      if (symbolChanged || tfChanged || dataReset || isInitial || isOffscreen) {
        calculateAutoFit(candles);
        setIsAutoScroll(true);
      }
      lastFittedRef.current = { symbol, timeframe, firstTime: first.time, lastTime: latest.time, candleCount: candles.length };
    }
  }, [candles, symbol, timeframe, calculateAutoFit]);

  // Main high-performance render loop
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    // Retina / HiDPI crisp pixel resolution scaling
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetW = Math.round(rect.width * dpr);
    const targetH = Math.round(rect.height * dpr);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }

    const width = rect.width;
    const height = rect.height;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    const vp = viewportRef.current;
    const p = propsRef.current;
    const theme = p.chartTheme;
    const currentCandles = candlesRef.current;
    const crosshair = crosshairRef.current;

    // Layout Heights (Dynamic user-configured)
    const indH = p.indicatorHeights || defaultIndicatorHeights;
    const volumeHeight = p.showVerticalVolume ? indH.volume : 0;
    const cvdHeight = p.showCVD ? indH.cvd : 0;
    const rsiHeight = p.showRSI ? indH.rsi : 0;
    const stochHeight = p.showStochastic ? indH.stoch : 0;
    const chartHeight = Math.max(80, height - volumeHeight - cvdHeight - rsiHeight - stochHeight);
    const chartCenterY = chartHeight / 2;

    // Layout Widths (Price Scale & Profile)
    const profileWidth = p.showHorizontalProfile ? (theme.horizontalProfileWidth || 100) : 0;
    const priceScaleWidth = 64;
    const chartStartX = profileWidth;
    const chartEndX = width - priceScaleWidth;

    // Direct coordinate transformations
    const priceToY = (priceVal: number) => {
      return Math.round(chartCenterY - (priceVal - vp.centerPrice) * vp.priceScale);
    };
    const yToPrice = (yVal: number) => {
      return vp.centerPrice - (yVal - chartCenterY) / vp.priceScale;
    };

    // Auto-Scroll: gently keep latest candle and live price smoothly in view
    if (vp.autoScroll && currentCandles.length > 0 && !isDraggingRef.current) {
      const targetOffsetX = width - priceScaleWidth - vp.candleWidth - 25;
      if (Math.abs(vp.offsetX - targetOffsetX) > 2) {
        vp.offsetX += Math.round((targetOffsetX - vp.offsetX) * 0.25);
      }

      const latest = currentCandles[currentCandles.length - 1];
      const liveY = priceToY(latest.c);
      if (liveY < chartHeight * 0.18 || liveY > chartHeight * 0.82) {
        vp.centerPrice += (latest.c - vp.centerPrice) * 0.08;
      }
    }

    // Visible Price Bounds
    const maxVisiblePrice = yToPrice(0);
    const minVisiblePrice = yToPrice(chartHeight);

    // Deep matte black professional background
    ctx.fillStyle = theme.backgroundColor || '#08090C';
    ctx.fillRect(0, 0, width, height);

    if (currentCandles.length === 0) {
      ctx.fillStyle = '#8E9CAE';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Завантаження котирувань DeltaORL...', width / 2, height / 2);
      ctx.restore();
      return;
    }

    const candlePitch = vp.candleWidth + vp.candleSpacing;
    const totalCandles = currentCandles.length;

    // Optional Grid lines (Dashed / Dotted / Solid)
    if (theme.showGrid && theme.gridStyle !== 'OFF') {
      ctx.save();
      ctx.strokeStyle = theme.gridColor || '#141822';
      ctx.lineWidth = 1;
      if (theme.gridStyle === 'DASHED') ctx.setLineDash([4, 4]);
      else if (theme.gridStyle === 'DOTTED') ctx.setLineDash([1, 3]);
      else ctx.setLineDash([]);

      const visiblePriceRange = maxVisiblePrice - minVisiblePrice;
      const rawStep = visiblePriceRange / 16;
      const gridStep = Math.max(p.tickSize, Math.pow(10, Math.floor(Math.log10(rawStep))) * Math.ceil(rawStep / Math.pow(10, Math.floor(Math.log10(rawStep)))));
      const firstGridPrice = Math.floor(minVisiblePrice / gridStep) * gridStep;

      // Horizontal price lines
      for (let priceVal = firstGridPrice; priceVal <= maxVisiblePrice + gridStep; priceVal += gridStep) {
        const y = priceToY(priceVal);
        if (y >= 0 && y <= chartHeight) {
          ctx.beginPath();
          ctx.moveTo(chartStartX, y);
          ctx.lineTo(chartEndX, y);
          ctx.stroke();
        }
      }

      // Vertical time lines
      currentCandles.forEach((c, index) => {
        if (index % 5 === 0) {
          const x = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch + vp.candleWidth / 2);
          if (x >= chartStartX && x <= chartEndX) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, chartHeight);
            ctx.stroke();
          }
        }
      });
      ctx.restore();
    }

    // 2. Aggregate Horizontal Profile on the LEFT for all visible candles
    const visiblePriceLevels: { [priceIdx: number]: { price: number; bid: number; ask: number } } = {};
    let maxVisibleCandleVolume = 1.0;

    currentCandles.forEach((c, index) => {
      const candleX = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch);

      if (candleX + vp.candleWidth >= chartStartX && candleX <= chartEndX) {
        if (c.v > maxVisibleCandleVolume) {
          maxVisibleCandleVolume = c.v;
        }

        c.clusters.forEach(lvl => {
          const price = lvl[0];
          const bid = lvl[1];
          const ask = lvl[2];
          const idx = Math.round(price / p.tickSize);

          if (!visiblePriceLevels[idx]) {
            visiblePriceLevels[idx] = { price, bid: 0, ask: 0 };
          }
          visiblePriceLevels[idx].bid += bid;
          visiblePriceLevels[idx].ask += ask;
        });
      }
    });

    // 3. Render Footprint Candles (Slim Candlestick Bar + Cluster Elements)
    currentCandles.forEach((c, index) => {
      const candleX = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch);

      // Viewport culling horizontally
      if (candleX + vp.candleWidth < chartStartX || candleX > chartEndX) {
        return;
      }

      const highY = priceToY(c.h);
      const lowY = priceToY(c.l);
      const openY = priceToY(c.o);
      const closeY = priceToY(c.c);

      // Candlestick coloring: Price Open/Close vs Net Delta (Delta River feature)
      const isBullish = (theme.candleColorMode === 'DELTA') ? (c.d >= 0) : (c.c >= c.o);

      const bodyTop = Math.min(openY, closeY);
      const bodyBottom = Math.max(openY, closeY);
      const bodyHeight = Math.max(2, bodyBottom - bodyTop);

      // --- Candlestick Bar (User Configurable Dimensions) ---
      const configuredBarW = theme.candlestickWidth ?? 8;
      const configuredBarGap = theme.candlestickGap ?? 5;
      const barW = Math.max(3, Math.min(26, configuredBarW));
      const barGap = Math.max(1, Math.min(20, configuredBarGap));
      const barX = candleX - barW - barGap;
      const barCenter = barX + barW / 2;

      // 1. Upper Shadow (Wick)
      ctx.strokeStyle = isBullish ? theme.bullishCandleColor : theme.bearishCandleBorder;
      ctx.lineWidth = theme.wickWidth ?? 1.5;
      ctx.beginPath();
      ctx.moveTo(barCenter, highY);
      ctx.lineTo(barCenter, bodyTop);
      ctx.stroke();

      // Top Wick Cap (T-shaped theme on wick ends - Delta River style)
      if (theme.showWickCaps) {
        const capW = theme.wickCapWidth ?? 4;
        ctx.beginPath();
        ctx.moveTo(barCenter - capW, highY);
        ctx.lineTo(barCenter + capW, highY);
        ctx.stroke();
      }

      // 2. Lower Shadow (Wick)
      ctx.beginPath();
      ctx.moveTo(barCenter, bodyBottom);
      ctx.lineTo(barCenter, lowY);
      ctx.stroke();

      // Bottom Wick Cap (T-shaped theme on wick ends - Delta River style)
      if (theme.showWickCaps) {
        const capW = theme.wickCapWidth ?? 4;
        ctx.beginPath();
        ctx.moveTo(barCenter - capW, lowY);
        ctx.lineTo(barCenter + capW, lowY);
        ctx.stroke();
      }

      // 3. Candlestick Body (Classic Candlestick Bar)
      if (isBullish) {
        ctx.fillStyle = theme.bullishCandleColor;
        ctx.fillRect(barX, bodyTop, barW, bodyHeight);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(barX, bodyTop, barW, bodyHeight);
      } else {
        ctx.fillStyle = theme.bearishCandleColor;
        ctx.fillRect(barX, bodyTop, barW, bodyHeight);
        ctx.strokeStyle = theme.bearishCandleBorder;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX, bodyTop, barW, bodyHeight);
      }

      // Highlight Value Area in Candle if enabled
      if ((p.showValueArea || theme.showClusterValueArea) && c.val > 0 && c.vah > 0) {
        const vaTop = priceToY(c.vah);
        const vaBottom = priceToY(c.val);
        const vaH = Math.max(2, vaBottom - vaTop);
        ctx.fillStyle = theme.valueAreaColor || 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(candleX, vaTop, vp.candleWidth, vaH);
      }

      // --- D. Cluster Level Cell Rendering ---
      let maxClusterVol = 1.0;
      c.clusters.forEach(lvl => {
        const total = lvl[1] + lvl[2];
        if (total > maxClusterVol) maxClusterVol = total;
      });

      const levelPixelH = Math.max(3, Math.abs(priceToY(c.o + p.tickSize) - priceToY(c.o)));
      const showClusterPOC = theme.showClusterPOC !== false;
      const rounding = theme.clusterBarRounding ?? 0;
      const opacity = theme.clusterBarOpacity ?? 1.0;

      c.clusters.forEach(lvl => {
        const price = lvl[0];
        const bidVol = lvl[1];
        const askVol = lvl[2];
        const buyImb = lvl[5] === 1;
        const sellImb = lvl[6] === 1;

        const levelY = priceToY(price) - Math.round(levelPixelH / 2);

        // Vertical culling
        if (levelY + levelPixelH < 0 || levelY > chartHeight) return;

        const isPOC = Math.abs(price - c.poc) < (p.tickSize * 0.5);
        const totalVol = bidVol + askVol;

        // Do not draw anything for empty zero-volume levels unless it's POC
        if (totalVol <= 0 && !isPOC) return;

        // If POC and user has cluster POC enabled, draw clean golden border
        if (isPOC && showClusterPOC) {
          ctx.strokeStyle = theme.clusterPOCColor;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(candleX, levelY, vp.candleWidth, levelPixelH);
        }

        ctx.save();
        if (opacity < 1.0) ctx.globalAlpha = opacity;

        if (p.displayMode === 'BID_ASK') {
          const halfW = vp.candleWidth / 2;
          const bidBarW = bidVol > 0 ? Math.min(halfW - 2, (bidVol / maxClusterVol) * (halfW - 2)) : 0;
          const askBarW = askVol > 0 ? Math.min(halfW - 2, (askVol / maxClusterVol) * (halfW - 2)) : 0;
          const isSellImb = (theme.showImbalanceHighlights !== false) && Boolean(sellImb);
          const isBuyImb = (theme.showImbalanceHighlights !== false) && Boolean(buyImb);

          // Bid Volume Bar (Sellers / Bears)
          if (bidVol > 0) {
            ctx.fillStyle = isSellImb ? (theme.sellImbalanceColor || '#FF3B69') : theme.clusterSellerColor;
            ctx.fillRect(candleX + halfW - bidBarW, levelY + 1, bidBarW, Math.max(1, levelPixelH - 2));
            ctx.strokeStyle = '#2E3646';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(candleX + halfW - bidBarW, levelY + 1, bidBarW, Math.max(1, levelPixelH - 2));
          }

          // Ask Volume Bar (Buyers / Bulls)
          if (askVol > 0) {
            ctx.fillStyle = isBuyImb ? (theme.buyImbalanceColor || '#00F59B') : theme.clusterBuyerColor;
            ctx.fillRect(candleX + halfW, levelY + 1, askBarW, Math.max(1, levelPixelH - 2));
          }

          // Center Divider
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          ctx.beginPath();
          ctx.moveTo(candleX + halfW, levelY);
          ctx.lineTo(candleX + halfW, levelY + levelPixelH);
          ctx.stroke();

          // High Contrast Sharp Numbers (Guaranteed 100% legibility on any background/bar)
          if (theme.showClusterNumbers && levelPixelH >= 8) {
            const fSize = theme.clusterFontSize === 'LARGE'
              ? (levelPixelH >= 12 ? 'bold 11px' : 'bold 9px')
              : (theme.clusterFontSize === 'SMALL'
                ? (levelPixelH >= 12 ? 'bold 8.5px' : 'bold 7.5px')
                : (levelPixelH >= 12 ? 'bold 9.5px' : 'bold 8px'));
            ctx.font = `${fSize} JetBrains Mono, monospace`;
            const textY = levelY + levelPixelH / 2 + (levelPixelH >= 12 ? 3.5 : 2.5);

            if (bidVol > 0) {
              const bidText = bidVol.toFixed(0);
              const textW = ctx.measureText(bidText).width;
              const isInsideBar = bidBarW >= (textW + 6);
              const barLum = isSellImb ? getHexLuminance(theme.sellImbalanceColor || '#FF3B69') : getHexLuminance(theme.clusterSellerColor);
              // If fully inside a bright bar, use dark text. Otherwise (on dark canvas or dark bar), ALWAYS crisp white!
              const textClr = (isInsideBar && barLum > 140) ? '#08090C' : '#FFFFFF';

              ctx.textAlign = 'right';
              ctx.strokeStyle = '#08090C';
              ctx.lineWidth = 2;
              ctx.strokeText(bidText, candleX + halfW - 4, textY);
              ctx.fillStyle = textClr;
              ctx.fillText(bidText, candleX + halfW - 4, textY);
            }

            if (askVol > 0) {
              const askText = askVol.toFixed(0);
              const textW = ctx.measureText(askText).width;
              const isInsideBar = askBarW >= (textW + 6);
              const barLum = isBuyImb ? getHexLuminance(theme.buyImbalanceColor || '#00F59B') : getHexLuminance(theme.clusterBuyerColor);
              // If fully inside a bright bar (e.g. white), use dark text. When bar is short/thin on dark canvas, ALWAYS crisp white!
              const textClr = (isInsideBar && barLum > 140) ? '#08090C' : '#FFFFFF';

              ctx.textAlign = 'left';
              ctx.strokeStyle = '#08090C';
              ctx.lineWidth = 2;
              ctx.strokeText(askText, candleX + halfW + 4, textY);
              ctx.fillStyle = textClr;
              ctx.fillText(askText, candleX + halfW + 4, textY);
            }
          }
        } else if (p.displayMode === 'DELTA') {
          const delta = askVol - bidVol;
          if (Math.abs(delta) > 0 || isPOC) {
            const deltaRatio = Math.min(1.0, Math.abs(delta) / maxClusterVol);

            // Font & text measurements for positioning
            const fSize = theme.clusterFontSize === 'LARGE' ? 'bold 11px' : (theme.clusterFontSize === 'SMALL' ? 'bold 8px' : 'bold 9.5px');
            ctx.font = `${fSize} JetBrains Mono, monospace`;
            const deltaText = `${delta > 0 ? '+' : ''}${delta.toFixed(0)}`;
            const textW = ctx.measureText(deltaText).width;

            // Cap histogram bar width so there's always a clean gap for the number on the right
            const maxBarW = Math.max(6, Math.min(Math.round(vp.candleWidth * 0.52), vp.candleWidth - textW - 14));
            const barW = Math.max(2, Math.round(deltaRatio * maxBarW));

            // Positive = Bulls (Білий), Negative = Bears (Чорний)
            ctx.fillStyle = delta >= 0 ? theme.clusterBuyerColor : theme.clusterSellerColor;
            if (rounding > 0 && typeof (ctx as any).roundRect === 'function') {
              ctx.beginPath();
              (ctx as any).roundRect(candleX + 2, levelY + 1, barW, Math.max(1, levelPixelH - 2), rounding);
              ctx.fill();
            } else {
              ctx.fillRect(candleX + 2, levelY + 1, barW, Math.max(1, levelPixelH - 2));
            }

            if (delta < 0) {
              ctx.strokeStyle = '#2E3646';
              ctx.lineWidth = 0.5;
              ctx.strokeRect(candleX + 2, levelY + 1, barW, Math.max(1, levelPixelH - 2));
            }

            if (theme.showClusterNumbers && levelPixelH >= 8) {
              const textY = levelY + levelPixelH / 2 + (levelPixelH >= 12 ? 3.5 : 2.5);
              // Position number with a clean 6px gap to the right of the histogram bar (never overlapping!)
              const rawTextX = candleX + 2 + barW + 6;
              const textX = Math.min(candleX + vp.candleWidth - textW - 2, rawTextX);

              ctx.textAlign = 'left';
              ctx.strokeStyle = '#08090C';
              ctx.lineWidth = 2;
              ctx.strokeText(deltaText, textX, textY);
              ctx.fillStyle = '#FFFFFF';
              ctx.fillText(deltaText, textX, textY);
            }
          }
        } else if (p.displayMode === 'VOLUME') {
          if (totalVol > 0 || isPOC) {
            const volRatio = maxClusterVol > 0 ? (totalVol / maxClusterVol) : 0;
            const barW = Math.max(2, Math.round(volRatio * (vp.candleWidth - 4)));
            const isMonochrome = theme.volumeHistogramPalette === 'MONOCHROME';

            // High Volume Nodes (HVN) vs Low Volume Nodes (LVN)
            let fillColor: string;
            let accentColor: string | null = null;

            if (isPOC && showClusterPOC) {
              fillColor = 'rgba(234, 179, 8, 0.45)';
              accentColor = '#EAB308';
            } else if (isMonochrome) {
              // --- ЧОРНО-БІЛИЙ МОНОХРОМ (Чіткі контрастні відтінки графіту та сталі) ---
              if (volRatio >= 0.75) {
                fillColor = '#465063'; // Яскравий сталево-графітовий
                accentColor = '#FFFFFF'; // Чистий білий чіткий вертикальний акцент
              } else if (volRatio >= 0.45) {
                fillColor = '#2F3644'; // Середній графіт
                accentColor = '#94A3B8';
              } else if (volRatio >= 0.20) {
                fillColor = '#1F242E'; // Темний графіт
              } else {
                fillColor = '#13161D'; // Глибокий тон для низьких об'ємів
              }
            } else {
              // --- СТАЛЕВО-СИНІЙ КОНТРАСТНИЙ ---
              if (volRatio >= 0.75) {
                fillColor = '#3B5377'; // Strong HVN
                accentColor = '#60A5FA';
              } else if (volRatio >= 0.45) {
                fillColor = '#27354A'; // Medium-high volume node
                accentColor = '#3B82F6';
              } else if (volRatio >= 0.20) {
                fillColor = '#1C2534'; // Medium volume node
              } else {
                fillColor = '#121722'; // LVN
              }
            }

            ctx.fillStyle = fillColor;
            if (rounding > 0 && typeof (ctx as any).roundRect === 'function') {
              ctx.beginPath();
              (ctx as any).roundRect(candleX + 2, levelY + 1, barW, Math.max(1, levelPixelH - 2), rounding);
              ctx.fill();
            } else {
              ctx.fillRect(candleX + 2, levelY + 1, barW, Math.max(1, levelPixelH - 2));
            }

            // Edge accent on prominent volume nodes
            if (accentColor && barW > 6) {
              ctx.fillStyle = accentColor;
              ctx.fillRect(candleX + 2 + barW - 1.5, levelY + 1, 1.5, Math.max(1, levelPixelH - 2));
            }

            if (theme.showClusterNumbers && levelPixelH >= 8) {
              const fSize = theme.clusterFontSize === 'LARGE' ? 'bold 11px' : (theme.clusterFontSize === 'SMALL' ? 'bold 8.5px' : 'bold 10px');
              ctx.font = `${fSize} JetBrains Mono, monospace`;
              ctx.textAlign = 'left';
              const textClr = (isPOC && showClusterPOC)
                ? '#FDE047'
                : (volRatio >= 0.65 ? '#FFFFFF' : (isMonochrome ? '#CBD5E1' : '#94A3B8'));
              const volText = totalVol > 0 ? totalVol.toFixed(0) : '0';
              const textY = levelY + levelPixelH / 2 + (levelPixelH >= 12 ? 3.5 : 2.5);
              ctx.strokeStyle = '#08090C';
              ctx.lineWidth = 2;
              ctx.strokeText(volText, candleX + 6, textY);
              ctx.fillStyle = textClr;
              ctx.fillText(volText, candleX + 6, textY);
            }
          }
        }
        ctx.restore();
      });
    });

    // 4. Render Horizontal Split Volume Profile on the LEFT SIDE
    if (p.showHorizontalProfile && profileWidth > 0) {
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, 0, profileWidth, chartHeight);
      ctx.strokeStyle = '#181C24';
      ctx.beginPath();
      ctx.moveTo(profileWidth, 0);
      ctx.lineTo(profileWidth, chartHeight);
      ctx.stroke();

      let maxProfTotal = 1.0;
      let sessionPOCPrice = 0;
      let sessionPOCMax = 0;

      Object.values(visiblePriceLevels).forEach(lvl => {
        const tot = lvl.bid + lvl.ask;
        if (tot > maxProfTotal) maxProfTotal = tot;
        if (tot > sessionPOCMax) {
          sessionPOCMax = tot;
          sessionPOCPrice = lvl.price;
        }
      });

      const levelPixelH = Math.max(2, Math.abs(priceToY(minVisiblePrice + p.tickSize) - priceToY(minVisiblePrice)));
      const showHorizontalPOC = theme.showHorizontalPOC !== false;

      Object.values(visiblePriceLevels).forEach(lvl => {
        const y = priceToY(lvl.price) - Math.round(levelPixelH / 2);
        if (y + levelPixelH < 0 || y > chartHeight) return;

        const total = lvl.bid + lvl.ask;
        const totalBarW = Math.min(profileWidth - 24, (total / maxProfTotal) * (profileWidth - 24));
        const sellerFraction = total > 0 ? (lvl.bid / total) : 0.5;

        const bidW = totalBarW * sellerFraction;
        const askW = totalBarW * (1 - sellerFraction);

        const isSessionPOC = showHorizontalPOC && Math.abs(lvl.price - sessionPOCPrice) < (p.tickSize * 0.5);

        // Seller bar (Продавці: Червоний)
        const sellerColor = (theme.horizontalSellerColor && theme.horizontalSellerColor !== '#181C26') ? theme.horizontalSellerColor : '#A62639';
        const buyerColor = (theme.horizontalBuyerColor && theme.horizontalBuyerColor !== '#FFFFFF') ? theme.horizontalBuyerColor : '#228B68';

        ctx.fillStyle = isSessionPOC ? theme.horizontalPOCColor : sellerColor;
        ctx.fillRect(3, y, bidW, Math.max(1, levelPixelH - 1));

        // Buyer bar (Покупці: Зелений)
        ctx.fillStyle = isSessionPOC ? '#D4AF37' : buyerColor;
        ctx.fillRect(3 + bidW, y, askW, Math.max(1, levelPixelH - 1));

        // Numeric text on profile (High-contrast light silver)
        if (levelPixelH >= 11) {
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.fillStyle = isSessionPOC ? theme.horizontalPOCColor : '#CBD5E1';
          ctx.textAlign = 'right';
          ctx.fillText(total.toFixed(0), profileWidth - 4, y + levelPixelH / 2 + 3);
        }
      });

      // Header title
      ctx.fillStyle = '#64748B';
      ctx.font = 'bold 8.5px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('PROFILE', 6, 13);
    }

    // 5. Right Price Scale (Compact, Minimalist, Always Visible Numbers)
    ctx.fillStyle = '#08090C';
    ctx.fillRect(chartEndX, 0, priceScaleWidth, chartHeight);
    ctx.strokeStyle = '#181C24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartEndX, 0);
    ctx.lineTo(chartEndX, chartHeight);
    ctx.stroke();

    const visiblePriceRange = maxVisiblePrice - minVisiblePrice;
    const rawStep = visiblePriceRange / 16;
    const gridStep = Math.max(p.tickSize, Math.pow(10, Math.floor(Math.log10(rawStep))) * Math.ceil(rawStep / Math.pow(10, Math.floor(Math.log10(rawStep)))));
    const firstGridPrice = Math.floor(minVisiblePrice / gridStep) * gridStep;

    ctx.font = '9.5px JetBrains Mono, monospace';
    ctx.fillStyle = '#788292';
    ctx.textAlign = 'right';

    for (let priceVal = firstGridPrice; priceVal <= maxVisiblePrice + gridStep; priceVal += gridStep) {
      const y = priceToY(priceVal);
      if (y >= 10 && y <= chartHeight - 10) {
        // Subtle tick mark
        ctx.strokeStyle = '#222834';
        ctx.beginPath();
        ctx.moveTo(chartEndX, y);
        ctx.lineTo(chartEndX + 3, y);
        ctx.stroke();

        // High contrast price text
        ctx.fillText(priceVal.toFixed(p.tickSize < 0.001 ? 5 : (p.tickSize < 0.1 ? 2 : 1)), chartEndX + priceScaleWidth - 5, y + 3.5);
      }
    }

    // 6. Active Live Price Line, Badge & Candle Countdown Timer (Убуваючий таймер)
    if (currentCandles.length > 0) {
      const latest = currentCandles[currentCandles.length - 1];
      const livePriceY = priceToY(latest.c);

      // Countdown Timer Calculation (Убуваючий таймер закриття свічки)
      let timerStr = '';
      if (p.timeframe > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        let remainingSec = 0;

        const candleEnd = latest.time + p.timeframe;
        if (nowSec >= latest.time && nowSec < candleEnd + 3600) {
          remainingSec = Math.max(0, candleEnd - nowSec);
        } else {
          remainingSec = (p.timeframe - (nowSec % p.timeframe)) % p.timeframe;
        }

        if (p.timeframe >= 3600) {
          const hh = Math.floor(remainingSec / 3600).toString().padStart(2, '0');
          const mm = Math.floor((remainingSec % 3600) / 60).toString().padStart(2, '0');
          const ss = (remainingSec % 60).toString().padStart(2, '0');
          timerStr = `${hh}:${mm}:${ss}`;
        } else {
          const mm = Math.floor(remainingSec / 60).toString().padStart(2, '0');
          const ss = (remainingSec % 60).toString().padStart(2, '0');
          timerStr = `${mm}:${ss}`;
        }
      }

      if (livePriceY >= 0 && livePriceY <= chartHeight) {
        // Dashed horizontal price line across the chart
        if (theme.showLivePriceLine !== false) {
          ctx.strokeStyle = '#CBD5E1';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(chartStartX, livePriceY);
          ctx.lineTo(chartEndX, livePriceY);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // 1. Live Price Badge on Axis (Crisp white badge with bold dark text)
        const priceBadgeH = 16;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(chartEndX + 1, livePriceY - 8, priceScaleWidth - 1, priceBadgeH);
        ctx.fillStyle = '#08090C';
        ctx.font = 'bold 9.5px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(latest.c.toFixed(p.tickSize < 0.001 ? 5 : 2), chartEndX + priceScaleWidth / 2, livePriceY + 3.5);

        // 2. Candle Countdown Timer Badge (Убуваючий таймер свічки біля ціни)
        if (theme.showCountdownTimer !== false && timerStr) {
          const timerH = 13;
          const timerY = (livePriceY + 8 + timerH <= chartHeight - 2) ? (livePriceY + 9) : (livePriceY - 8 - timerH);

          ctx.fillStyle = '#11141C';
          ctx.fillRect(chartEndX + 2, timerY, priceScaleWidth - 3, timerH);
          ctx.strokeStyle = '#283244';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(chartEndX + 2, timerY, priceScaleWidth - 3, timerH);

          ctx.fillStyle = '#FFD166'; // Elegant amber countdown timer
          ctx.font = 'bold 8.5px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(timerStr, chartEndX + priceScaleWidth / 2, timerY + timerH / 2 + 2.5);
        }
      } else if (livePriceY < 0) {
        // Live price is ABOVE the visible chart view (Clickable jump indicator)
        ctx.fillStyle = '#15803D';
        ctx.fillRect(chartEndX + 1, 2, priceScaleWidth - 1, 22);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`▲ ${latest.c.toFixed(p.tickSize < 0.001 ? 5 : 2)}`, chartEndX + priceScaleWidth / 2, 11);
        if (timerStr) {
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.fillStyle = '#FFD166';
          ctx.fillText(timerStr, chartEndX + priceScaleWidth / 2, 20);
        }
      } else if (livePriceY > chartHeight) {
        // Live price is BELOW the visible chart view (Clickable jump indicator)
        ctx.fillStyle = '#B91C1C';
        ctx.fillRect(chartEndX + 1, chartHeight - 24, priceScaleWidth - 1, 22);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 9px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`▼ ${latest.c.toFixed(p.tickSize < 0.001 ? 5 : 2)}`, chartEndX + priceScaleWidth / 2, chartHeight - 14);
        if (timerStr) {
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.fillStyle = '#FFD166';
          ctx.fillText(timerStr, chartEndX + priceScaleWidth / 2, chartHeight - 5);
        }
      }
    }

    // Compute Indicators (RSI & Stochastic)
    if ((p.showRSI || p.showStochastic) && indicatorCache.current.candles !== currentCandles) {
      indicatorCache.current = { candles: currentCandles, value: computeIndicators(currentCandles) };
    }
    const indicators = indicatorCache.current.value;

    // 6. Render Vertical Volume Histogram (Split Buyers vs Sellers)
    if (p.showVerticalVolume && volumeHeight > 0) {
      const volPanelY = chartHeight;

      ctx.fillStyle = '#080A0E';
      ctx.fillRect(0, volPanelY, width, volumeHeight);
      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(0, volPanelY);
      ctx.lineTo(width, volPanelY);
      ctx.stroke();

      ctx.fillStyle = '#5A6375';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('VERTICAL VOLUME (SELLERS / BUYERS SPLIT)', 12, volPanelY + 13);

      const badgeHeight = 13;
      const baseY = volPanelY + volumeHeight - 3;
      const badgeY = baseY - badgeHeight;
      const barBottomY = badgeY - 2;
      const maxBarH = Math.max(14, barBottomY - volPanelY - 15);

      currentCandles.forEach((c, index) => {
        const candleX = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch);
        if (candleX + vp.candleWidth < chartStartX || candleX > chartEndX) return;

        const totalVol = c.v;
        const bidVol = (c.bv !== undefined && c.bv > 0) ? c.bv : Math.max(0, (totalVol - c.d) * 0.5);
        const askVol = (c.av !== undefined && c.av > 0) ? c.av : Math.max(0, (totalVol + c.d) * 0.5);

        const barH = Math.max(3, (totalVol / maxVisibleCandleVolume) * maxBarH);
        const sellerRatio = (bidVol + askVol > 0) ? (bidVol / (bidVol + askVol)) : 0.5;

        const sellerH = Math.round(barH * sellerRatio);
        const buyerH = barH - sellerH;

        const barW = Math.max(6, vp.candleWidth - 8);
        const barX = candleX + 4;

        // Theme colors (fallback to crisp institutional crimson & emerald)
        const sellerColor = (theme.verticalSellerColor && theme.verticalSellerColor !== '#181C26') ? theme.verticalSellerColor : '#A62639';
        const buyerColor = (theme.verticalBuyerColor && theme.verticalBuyerColor !== '#FFFFFF') ? theme.verticalBuyerColor : '#228B68';

        // 1. Seller volume (bottom of bar)
        ctx.fillStyle = sellerColor;
        ctx.fillRect(barX, barBottomY - sellerH, barW, sellerH);

        // 2. Buyer volume (stacked on top of seller volume)
        ctx.fillStyle = buyerColor;
        ctx.fillRect(barX, barBottomY - sellerH - buyerH, barW, buyerH);

        // 3. Total volume number on top of bar (Crisp silver font)
        if (vp.candleWidth >= 34) {
          ctx.font = 'bold 8.5px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#CBD5E1';
          const volStr = totalVol > 99999 ? (totalVol / 1000).toFixed(1) + 'K' : totalVol.toFixed(0);
          ctx.fillText(volStr, barX + barW / 2, barBottomY - barH - 2);
        }

        // 4. Dedicated Stat Badges at bottom (Guaranteed 100% visible, no black-on-black or white-on-white!)
        if (vp.candleWidth >= 55) {
          const badgeW = Math.floor((barW - 2) / 2);

          // Left badge: Sellers (Bid Volume) - Dark Red container with Pure White text
          ctx.fillStyle = '#7F1D1D';
          ctx.fillRect(barX, badgeY, badgeW, badgeHeight);
          ctx.strokeStyle = '#991B1B';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(barX, badgeY, badgeW, badgeHeight);

          ctx.font = 'bold 8px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(bidVol.toFixed(0), barX + badgeW / 2, badgeY + badgeHeight / 2 + 2.5);

          // Right badge: Buyers (Ask Volume) - Dark Emerald container with Pure White text
          const askX = barX + badgeW + 2;
          ctx.fillStyle = '#065F46';
          ctx.fillRect(askX, badgeY, badgeW, badgeHeight);
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(askX, badgeY, badgeW, badgeHeight);

          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(askVol.toFixed(0), askX + badgeW / 2, badgeY + badgeHeight / 2 + 2.5);
        } else if (vp.candleWidth >= 36) {
          // Compact Delta Pill
          const delta = askVol - bidVol;
          const isPos = delta >= 0;
          ctx.fillStyle = isPos ? '#065F46' : '#7F1D1D';
          ctx.fillRect(barX, badgeY, barW, badgeHeight);

          ctx.font = 'bold 8px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(`${delta > 0 ? '+' : ''}${delta.toFixed(0)}`, barX + barW / 2, badgeY + badgeHeight / 2 + 2.5);
        }
      });
    }

    // 7. Render Cumulative Volume Delta (CVD) Pane (Optional, OFF by default)
    if (p.showCVD && cvdHeight > 0) {
      const cvdY = chartHeight + volumeHeight;
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, cvdY, width, cvdHeight);

      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(0, cvdY);
      ctx.lineTo(width, cvdY);
      ctx.stroke();

      ctx.fillStyle = '#5A6375';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText('CUMULATIVE VOLUME DELTA (CVD)', 12, cvdY + 14);

      let minCVD = Infinity;
      let maxCVD = -Infinity;
      currentCandles.forEach(c => {
        if (c.cvd < minCVD) minCVD = c.cvd;
        if (c.cvd > maxCVD) maxCVD = c.cvd;
      });
      if (minCVD === maxCVD) { minCVD -= 10; maxCVD += 10; }

      const cvdRange = maxCVD - minCVD;
      const cvdToY = (val: number) => {
        return cvdY + 18 + ((maxCVD - val) / cvdRange) * (cvdHeight - 26);
      };

      ctx.beginPath();
      let started = false;
      currentCandles.forEach((c, index) => {
        const x = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch + vp.candleWidth / 2);
        if (x < chartStartX - 50 || x > chartEndX + 50) return;
        const y = cvdToY(c.cvd);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 8. Render RSI Indicator Pane (Optional, OFF by default)
    if (p.showRSI && rsiHeight > 0) {
      const rsiY = chartHeight + volumeHeight + cvdHeight;
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, rsiY, width, rsiHeight);

      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(0, rsiY);
      ctx.lineTo(width, rsiY);
      ctx.stroke();

      ctx.fillStyle = '#0E1015';
      ctx.fillRect(chartEndX, rsiY, priceScaleWidth, rsiHeight);
      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(chartEndX, rsiY);
      ctx.lineTo(chartEndX, rsiY + rsiHeight);
      ctx.stroke();

      const rsiToY = (val: number) => {
        return rsiY + 12 + ((100 - val) / 100) * (rsiHeight - 22);
      };

      const y70 = rsiToY(70);
      const y30 = rsiToY(30);
      const y50 = rsiToY(50);

      // Zone Fill
      ctx.fillStyle = 'rgba(168, 85, 247, 0.04)';
      ctx.fillRect(chartStartX, y70, chartEndX - chartStartX, y30 - y70);

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(chartStartX, y70);
      ctx.lineTo(chartEndX, y70);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.beginPath();
      ctx.moveTo(chartStartX, y30);
      ctx.lineTo(chartEndX, y30);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.beginPath();
      ctx.moveTo(chartStartX, y50);
      ctx.lineTo(chartEndX, y50);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#EF4444';
      ctx.fillText('70', width - 10, y70 + 3);
      ctx.fillStyle = '#10B981';
      ctx.fillText('30', width - 10, y30 + 3);

      const latestRsi = indicators.rsi[totalCandles - 1];
      ctx.fillStyle = '#C084FC';
      ctx.font = 'bold 9.5px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`RSI (14): ${latestRsi !== null ? latestRsi.toFixed(1) : '--'}`, 12, rsiY + 14);

      // RSI Line
      ctx.beginPath();
      let started = false;
      currentCandles.forEach((c, index) => {
        const val = indicators.rsi[index];
        if (val === null) return;
        const x = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch + vp.candleWidth / 2);
        if (x < chartStartX - 50 || x > chartEndX + 50) return;
        const y = rsiToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = '#A855F7';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 9. Render Stochastic Oscillator Pane (Optional, OFF by default)
    if (p.showStochastic && stochHeight > 0) {
      const stochY = chartHeight + volumeHeight + cvdHeight + rsiHeight;
      ctx.fillStyle = '#08090C';
      ctx.fillRect(0, stochY, width, stochHeight);

      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(0, stochY);
      ctx.lineTo(width, stochY);
      ctx.stroke();

      ctx.fillStyle = '#0E1015';
      ctx.fillRect(chartEndX, stochY, priceScaleWidth, stochHeight);
      ctx.strokeStyle = '#1D212B';
      ctx.beginPath();
      ctx.moveTo(chartEndX, stochY);
      ctx.lineTo(chartEndX, stochY + stochHeight);
      ctx.stroke();

      const stochToY = (val: number) => {
        return stochY + 12 + ((100 - val) / 100) * (stochHeight - 22);
      };

      const y80 = stochToY(80);
      const y20 = stochToY(20);

      ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(chartStartX, y80);
      ctx.lineTo(chartEndX, y80);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.beginPath();
      ctx.moveTo(chartStartX, y20);
      ctx.lineTo(chartEndX, y20);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#EF4444';
      ctx.fillText('80', width - 10, y80 + 3);
      ctx.fillStyle = '#10B981';
      ctx.fillText('20', width - 10, y20 + 3);

      const latestK = indicators.stochK[totalCandles - 1];
      const latestD = indicators.stochD[totalCandles - 1];

      ctx.font = 'bold 9.5px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#38BDF8';
      ctx.fillText(`STOCH (14,3,3) %K: ${latestK !== null ? latestK.toFixed(1) : '--'}`, 12, stochY + 14);
      ctx.fillStyle = '#FB923C';
      ctx.fillText(`%D: ${latestD !== null ? latestD.toFixed(1) : '--'}`, 175, stochY + 14);

      // %K Curve (Cyan)
      ctx.beginPath();
      let kStarted = false;
      currentCandles.forEach((c, index) => {
        const val = indicators.stochK[index];
        if (val === null) return;
        const x = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch + vp.candleWidth / 2);
        if (x < chartStartX - 50 || x > chartEndX + 50) return;
        const y = stochToY(val);
        if (!kStarted) {
          ctx.moveTo(x, y);
          kStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // %D Curve (Orange)
      ctx.beginPath();
      let dStarted = false;
      currentCandles.forEach((c, index) => {
        const val = indicators.stochD[index];
        if (val === null) return;
        const x = Math.round(vp.offsetX - (totalCandles - 1 - index) * candlePitch + vp.candleWidth / 2);
        if (x < chartStartX - 50 || x > chartEndX + 50) return;
        const y = stochToY(val);
        if (!dStarted) {
          ctx.moveTo(x, y);
          dStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = '#FB923C';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 10. Interactive Crosshair (Smooth Hardware Coordinates)
    if (crosshair) {
      ctx.strokeStyle = theme.crosshairColor || 'rgba(255, 255, 255, 0.25)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;

      // Vertical line
      ctx.beginPath();
      ctx.moveTo(crosshair.x, 0);
      ctx.lineTo(crosshair.x, height);
      ctx.stroke();

      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(chartStartX, crosshair.y);
      ctx.lineTo(chartEndX, crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price Badge on right axis (Sleek dark pill with 1px border)
      ctx.fillStyle = '#181C26';
      ctx.fillRect(chartEndX + 1, crosshair.y - 8, priceScaleWidth - 1, 16);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartEndX + 1, crosshair.y - 8, priceScaleWidth - 1, 16);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(crosshair.price.toFixed(p.tickSize < 0.001 ? 5 : 2), chartEndX + priceScaleWidth / 2, crosshair.y + 3.5);
    }

    // 11. Render TradingView 1:1 Shift Measure Tool (Линейка)
    if (measureRef.current && measureRef.current.active) {
      const m = measureRef.current;
      const boxLeft = Math.min(m.startX, m.currentX);
      const boxRight = Math.max(m.startX, m.currentX);
      const boxTop = Math.min(m.startY, m.currentY);
      const boxBottom = Math.max(m.startY, m.currentY);
      const boxW = Math.max(2, boxRight - boxLeft);
      const boxH = Math.max(2, boxBottom - boxTop);

      // Semi-transparent blue area
      ctx.fillStyle = 'rgba(41, 98, 255, 0.22)';
      ctx.fillRect(boxLeft, boxTop, boxW, boxH);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

      // Directional arrow through center
      const centerX = (m.startX + m.currentX) / 2;
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, m.startY);
      ctx.lineTo(centerX, m.currentY);
      ctx.stroke();

      // Arrowhead pointing towards currentY
      const isUp = m.currentY < m.startY;
      const arrowDir = isUp ? -1 : 1;
      const aSize = 5;
      ctx.beginPath();
      ctx.moveTo(centerX - aSize, m.currentY - arrowDir * aSize);
      ctx.lineTo(centerX, m.currentY);
      ctx.lineTo(centerX + aSize, m.currentY - arrowDir * aSize);
      ctx.stroke();

      // Horizontal midpoint tick
      const midY = (m.startY + m.currentY) / 2;
      ctx.beginPath();
      ctx.moveTo(centerX - 6, midY);
      ctx.lineTo(centerX + 6, midY);
      ctx.stroke();

      // Compute statistics
      const diffPrice = m.currentPrice - m.startPrice;
      const basePrice = m.startPrice !== 0 ? m.startPrice : 1;
      const diffPercent = (diffPrice / basePrice) * 100;
      const diffTicks = p.tickSize > 0 ? (diffPrice / p.tickSize) : 0;

      let candleCount = 1;
      let totalVol = 0;
      if (currentCandles.length > 0) {
        const t1 = Math.min(m.startCandleTime, m.currentCandleTime);
        const t2 = Math.max(m.startCandleTime, m.currentCandleTime);
        const matchingCandles = currentCandles.filter(c => c.time >= t1 && c.time <= t2);
        if (matchingCandles.length > 0) {
          candleCount = matchingCandles.length;
          matchingCandles.forEach(c => totalVol += c.v);
        }
      }

      const elapsedSec = candleCount * (p.timeframe || 60);
      let timeStr = '';
      if (elapsedSec >= 86400) {
        timeStr = `${(elapsedSec / 86400).toFixed(0)}д`;
      } else if (elapsedSec >= 3600) {
        timeStr = `${(elapsedSec / 3600).toFixed(0)}ч`;
      } else {
        timeStr = `${Math.max(1, Math.round(elapsedSec / 60))}хв`;
      }

      let volStr = '';
      if (totalVol >= 1000000) {
        volStr = (totalVol / 1000000).toFixed(2).replace('.', ',') + 'M';
      } else if (totalVol >= 1000) {
        volStr = (totalVol / 1000).toFixed(2).replace('.', ',') + 'K';
      } else {
        volStr = totalVol.toFixed(0);
      }

      const decPlaces = p.tickSize < 0.001 ? 5 : (p.tickSize < 0.1 ? 2 : 1);
      const signPrefix = diffPrice > 0 ? '+' : '';
      const priceFormatted = `${signPrefix}${diffPrice.toFixed(decPlaces).replace('.', ',')}`;
      const percentFormatted = `(${signPrefix}${diffPercent.toFixed(2).replace('.', ',')}%)`;
      const ticksFormatted = `${signPrefix}${diffTicks.toFixed(1).replace('.', ',')}`;

      // Floating card texts (Ukrainian locale format 1:1 like screenshot)
      const line1 = `${priceFormatted} ${percentFormatted} ${ticksFormatted}`;
      const line2 = `Бары: ${candleCount}, ${timeStr}`;
      const line3 = `Объём ${volStr}`;

      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
      const m1 = ctx.measureText(line1).width;
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      const m2 = ctx.measureText(line2).width;
      const m3 = ctx.measureText(line3).width;
      const cardW = Math.max(m1, m2, m3) + 26;
      const cardH = 62;

      let cardX = centerX - cardW / 2;
      if (cardX < chartStartX + 10) cardX = chartStartX + 10;
      if (cardX + cardW > chartEndX - 10) cardX = chartEndX - 10 - cardW;

      let cardY = boxTop - cardH - 10;
      if (cardY < 10) {
        cardY = boxBottom + 10;
      }

      // Draw TradingView signature solid blue card
      ctx.fillStyle = '#2962FF';
      const rad = 6;
      ctx.beginPath();
      ctx.moveTo(cardX + rad, cardY);
      ctx.lineTo(cardX + cardW - rad, cardY);
      ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + rad);
      ctx.lineTo(cardX + cardW, cardY + cardH - rad);
      ctx.quadraticCurveTo(cardX + cardW, cardY + cardH, cardX + cardW - rad, cardY + cardH);
      ctx.lineTo(cardX + rad, cardY + cardH);
      ctx.quadraticCurveTo(cardX, cardY + cardH, cardX, cardY + cardH - rad);
      ctx.lineTo(cardX, cardY + rad);
      ctx.quadraticCurveTo(cardX, cardY, cardX + rad, cardY);
      ctx.closePath();
      ctx.fill();

      // Card texts (crisp white)
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      const textCenterX = cardX + cardW / 2;

      ctx.font = 'bold 11.5px system-ui, -apple-system, sans-serif';
      ctx.fillText(line1, textCenterX, cardY + 18);

      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.fillText(line2, textCenterX, cardY + 36);

      ctx.fillText(line3, textCenterX, cardY + 52);
    }

    // 12. Draw Interactive Indicator Divider Splitters
    const { dividers } = getPanelDividers(height);
    dividers.forEach(div => {
      const isHovered = hoveredDividerRef.current === div.type;
      const isDragging = dragModeRef.current === 'PANEL_RESIZE' && resizeTargetRef.current === div.type;

      ctx.strokeStyle = isDragging ? '#3B82F6' : (isHovered ? 'rgba(59, 130, 246, 0.7)' : '#1D212B');
      ctx.lineWidth = (isHovered || isDragging) ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(0, div.y);
      ctx.lineTo(width, div.y);
      ctx.stroke();

      if (isHovered || isDragging) {
        ctx.fillStyle = '#3B82F6';
        ctx.fillRect(width / 2 - 20, div.y - 2, 40, 4);
      }
    });

    ctx.restore();
  }, [getPanelDividers]);

  // Escape key cancels measurement tool
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && measureRef.current) {
        measureRef.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Continuous 60-120 FPS high-performance render loop
  useEffect(() => {
    let animId: number;
    const loop = () => {
      render();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [render]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvasRef.current.width = Math.round(rect.width * dpr);
        canvasRef.current.height = Math.round(rect.height * dpr);
        canvasRef.current.style.width = `${rect.width}px`;
        canvasRef.current.style.height = `${rect.height}px`;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mouse wheel: 1:1 TRADINGVIEW ZOOM & PAN
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const vp = viewportRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    const priceScaleWidth = 64;

    const p = propsRef.current;
    const indH = p.indicatorHeights || defaultIndicatorHeights;
    const volumeHeight = p.showVerticalVolume ? indH.volume : 0;
    const cvdHeight = p.showCVD ? indH.cvd : 0;
    const rsiHeight = p.showRSI ? indH.rsi : 0;
    const stochHeight = p.showStochastic ? indH.stoch : 0;
    const bottomPanelsHeight = volumeHeight + cvdHeight + rsiHeight + stochHeight;
    const chartHeight = Math.max(80, height - bottomPanelsHeight);
    const chartCenterY = chartHeight / 2;

    const candlePitch = vp.candleWidth + vp.candleSpacing;

    if (e.shiftKey) {
      // TradingView: Shift + Wheel scrolls horizontally (Time pan)
      const panStep = Math.round(candlePitch * 3);
      vp.offsetX -= Math.sign(e.deltaY) * panStep;
      viewportRef.current.autoScroll = false;
      setIsAutoScroll(false);
    } else if (x >= width - priceScaleWidth || e.ctrlKey) {
      // TradingView: Wheel on Price Scale OR Ctrl+Wheel zooms Price Scale vertically
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      const cursorPrice = vp.centerPrice - (y - chartCenterY) / vp.priceScale;
      vp.priceScale = Math.max(1e-8, Math.min(1e12, vp.priceScale * zoomFactor));
      vp.centerPrice = cursorPrice + (y - chartCenterY) / vp.priceScale;
    } else {
      // TradingView: Standard Wheel on Chart ZOOMS CANDLES anchored at mouse cursor X!
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      const oldPitch = vp.candleWidth + vp.candleSpacing;
      const candleRelIdx = (vp.offsetX - x) / oldPitch;
      const newWidth = Math.max(20, Math.min(260, Math.round(vp.candleWidth * zoomFactor)));
      const newSpacing = Math.max(8, Math.round(newWidth * 0.38));
      const newPitch = newWidth + newSpacing;

      vp.candleWidth = newWidth;
      vp.candleSpacing = newSpacing;
      vp.offsetX = Math.round(x + candleRelIdx * newPitch);
    }
  };

  // Pointer Down (uses Pointer Capture for buttery-smooth uninhibited dragging)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 0 || e.button === 2) {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}

      isDraggingRef.current = true;
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;
      const priceScaleWidth = 64;

      const p = propsRef.current;
      const indH = p.indicatorHeights || defaultIndicatorHeights;
      const volumeHeight = p.showVerticalVolume ? indH.volume : 0;
      const cvdHeight = p.showCVD ? indH.cvd : 0;
      const rsiHeight = p.showRSI ? indH.rsi : 0;
      const stochHeight = p.showStochastic ? indH.stoch : 0;
      const bottomPanelsHeight = volumeHeight + cvdHeight + rsiHeight + stochHeight;
      const chartHeight = Math.max(80, height - bottomPanelsHeight);
      const chartCenterY = chartHeight / 2;
      const vp = viewportRef.current;
      const currentCandles = candlesRef.current;
      const totalCandles = currentCandles.length;

      const priceToY = (priceVal: number) => Math.round(chartCenterY - (priceVal - vp.centerPrice) * vp.priceScale);
      const yToPrice = (yVal: number) => vp.centerPrice - (yVal - chartCenterY) / vp.priceScale;

      // 1. Shift + Click / Drag: TradingView Measure Tool
      if (e.shiftKey) {
        const clickPrice = yToPrice(y);
        const candlePitch = vp.candleWidth + vp.candleSpacing;
        const candleIdx = Math.max(0, Math.min(totalCandles - 1, Math.round(totalCandles - 1 - (vp.offsetX - x) / candlePitch)));
        const candleTime = currentCandles[candleIdx]?.time || 0;

        measureRef.current = {
          active: true,
          startX: x,
          startY: y,
          startPrice: clickPrice,
          startCandleTime: candleTime,
          currentX: x,
          currentY: y,
          currentPrice: clickPrice,
          currentCandleTime: candleTime
        };
        dragModeRef.current = 'MEASURE';
        if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
        return;
      }

      // If clicked without Shift, clear any pinned measure
      if (measureRef.current) {
        measureRef.current = null;
      }

      // 2. Check if clicking on an indicator panel divider line for resizing
      const { dividers } = getPanelDividers(height);
      for (const div of dividers) {
        if (Math.abs(y - div.y) <= 4) {
          dragModeRef.current = 'PANEL_RESIZE';
          resizeTargetRef.current = div.type;
          if (canvasRef.current) canvasRef.current.style.cursor = 'ns-resize';
          return;
        }
      }

      // 3. Right Price Scale
      if (x >= width - priceScaleWidth) {
        // Check if clicking top/bottom offscreen price jump indicator
        if (currentCandles.length > 0) {
          const latest = currentCandles[currentCandles.length - 1];
          const liveY = priceToY(latest.c);
          if (liveY < 0 && y <= 26) {
            calculateAutoFit(currentCandles);
            viewportRef.current.autoScroll = true;
            setIsAutoScroll(true);
            return;
          } else if (liveY > chartHeight && y >= chartHeight - 26 && y <= chartHeight) {
            calculateAutoFit(currentCandles);
            viewportRef.current.autoScroll = true;
            setIsAutoScroll(true);
            return;
          }
        }

        dragModeRef.current = 'PRICE_SCALE';
        if (canvasRef.current) canvasRef.current.style.cursor = 'ns-resize';
      } else if (y >= height - bottomPanelsHeight) {
        dragModeRef.current = 'TIME_SCALE';
        if (canvasRef.current) canvasRef.current.style.cursor = 'ew-resize';
      } else {
        dragModeRef.current = 'PAN';
        viewportRef.current.autoScroll = false;
        setIsAutoScroll(false);
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      }
    }
  };

  // Pointer Move - 100% Zero-Latency, direct ref mutation
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;
    const priceScaleWidth = 64;

    const vp = viewportRef.current;
    const p = propsRef.current;
    const indH = p.indicatorHeights || defaultIndicatorHeights;
    const volumeHeight = p.showVerticalVolume ? indH.volume : 0;
    const cvdHeight = p.showCVD ? indH.cvd : 0;
    const rsiHeight = p.showRSI ? indH.rsi : 0;
    const stochHeight = p.showStochastic ? indH.stoch : 0;
    const bottomPanelsHeight = volumeHeight + cvdHeight + rsiHeight + stochHeight;
    const chartHeight = Math.max(80, height - bottomPanelsHeight);
    const chartCenterY = chartHeight / 2;

    const price = vp.centerPrice - (y - chartCenterY) / vp.priceScale;
    const currentCandles = candlesRef.current;
    const totalCandles = currentCandles.length;
    crosshairRef.current = { x, y, price };

    // Not dragging - check hover states
    if (!isDraggingRef.current) {
      const { dividers } = getPanelDividers(height);
      let hovered: PanelResizeTarget = null;
      for (const div of dividers) {
        if (Math.abs(y - div.y) <= 4) {
          hovered = div.type;
          break;
        }
      }
      hoveredDividerRef.current = hovered;

      if (canvasRef.current) {
        if (hovered) {
          canvasRef.current.style.cursor = 'ns-resize';
        } else if (x >= width - priceScaleWidth) {
          canvasRef.current.style.cursor = 'ns-resize';
        } else if (y >= height - bottomPanelsHeight) {
          canvasRef.current.style.cursor = 'ew-resize';
        } else {
          canvasRef.current.style.cursor = 'crosshair';
        }
      }
      return;
    }

    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    if (dragModeRef.current === 'MEASURE' && measureRef.current) {
      const candlePitch = vp.candleWidth + vp.candleSpacing;
      const candleIdx = Math.max(0, Math.min(totalCandles - 1, Math.round(totalCandles - 1 - (vp.offsetX - x) / candlePitch)));
      const candleTime = currentCandles[candleIdx]?.time || 0;

      measureRef.current.currentX = x;
      measureRef.current.currentY = y;
      measureRef.current.currentPrice = price;
      measureRef.current.currentCandleTime = candleTime;
    } else if (dragModeRef.current === 'PANEL_RESIZE' && resizeTargetRef.current) {
      const target = resizeTargetRef.current;
      // Dragging up increases panel height, dragging down decreases
      const deltaH = -dy;
      const key = target.toLowerCase() as keyof IndicatorHeights;
      const curH = indH[key];
      const newH = Math.max(30, Math.min(220, curH + deltaH));
      if (newH !== curH && p.onIndicatorHeightsChange) {
        p.onIndicatorHeightsChange({
          ...indH,
          [key]: newH
        });
      }
    } else if (dragModeRef.current === 'PRICE_SCALE') {
      const factor = 1 - (dy * 0.006);
      const cursorPrice = vp.centerPrice - (y - chartCenterY) / vp.priceScale;
      vp.priceScale = Math.max(1e-8, Math.min(1e12, vp.priceScale * factor));
      vp.centerPrice = cursorPrice + (y - chartCenterY) / vp.priceScale;
    } else if (dragModeRef.current === 'TIME_SCALE') {
      const oldPitch = vp.candleWidth + vp.candleSpacing;
      const candleRelIdx = (vp.offsetX - x) / oldPitch;
      const newWidth = Math.max(20, Math.min(260, Math.round(vp.candleWidth + dx * 0.5)));
      const newSpacing = Math.max(8, Math.round(newWidth * 0.38));
      const newPitch = newWidth + newSpacing;
      vp.candleWidth = newWidth;
      vp.candleSpacing = newSpacing;
      vp.offsetX = Math.round(x + candleRelIdx * newPitch);
    } else if (dragModeRef.current === 'PAN') {
      // TradingView 1:1 Direct 2D Pan (Both Horizontal and Vertical follow mouse smoothly)
      vp.offsetX = Math.round(vp.offsetX + dx);
      vp.centerPrice += (dy / vp.priceScale);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    // If we were measuring, leave measure active & pinned on screen until clicked or Esc
    if (dragModeRef.current === 'MEASURE') {
      dragModeRef.current = null;
      return;
    }
    dragModeRef.current = null;
    resizeTargetRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (canvasRef.current) {
      canvasRef.current.style.cursor = 'crosshair';
    }
  };

  const handlePointerLeave = () => {
    if (!isDraggingRef.current) {
      crosshairRef.current = null;
    }
  };

  const handleShowChart = () => {
    if (candlesRef.current.length > 0) {
      calculateAutoFit(candlesRef.current);
      viewportRef.current.autoScroll = true;
      setIsAutoScroll(true);
    }
  };

  const p = propsRef.current;
  const indH = p.indicatorHeights || defaultIndicatorHeights;
  const bottomOffset = 10 +
    (p.showCVD ? indH.cvd : 0) +
    (p.showVerticalVolume ? indH.volume : 0) +
    (p.showRSI ? indH.rsi : 0) +
    (p.showStochastic ? indH.stoch : 0);

  return (
    <div
      ref={containerRef}
      className="chart-panel-container"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleShowChart}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          cursor: 'crosshair'
        }}
      />
      <div style={{ position: 'absolute', bottom: bottomOffset, right: 72, zIndex: 5 }}>
        <button
          className="btn-pill"
          onClick={handleShowChart}
          title="Миттєво показати та відцентрувати графік за поточною ціною"
          style={{
            background: '#12151D',
            border: '1px solid #2B3345',
            color: '#FFFFFF',
            fontSize: '11px',
            fontWeight: 600,
            padding: '5px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: '4px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5)'
          }}
        >
          <span style={{ fontSize: '12px' }}>⊡</span>
          Показати графік
        </button>
      </div>
    </div>
  );
};
