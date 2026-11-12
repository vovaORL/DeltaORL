// Tuple: [price, bid_vol, ask_vol, bid_trades, ask_trades, buy_imbalance, sell_imbalance]
export type ClusterLevelTuple = [number, number, number, number, number, number, number];

export interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  bv: number; // Seller (Bid) Volume
  av: number; // Buyer (Ask) Volume
  d: number;
  cvd: number;
  poc: number;
  poc_v: number;
  vah: number;
  val: number;
  clusters: ClusterLevelTuple[];
}

export interface LiveTick {
  sym: string;
  p: number;
  v: number;
  s: number; // 1 = Buy, -1 = Sell, 0 = Unknown
  t: number; // timestamp in ms
}

// Tuple: [price, volume, type (1 = Bid, 2 = Ask)]
export type DOMTuple = [number, number, number];

export interface EngineStats {
  mt5_connected: boolean;
  mt5_status?: 'Connecting' | 'Connected' | 'Disconnected';
  demo?: boolean;
  symbol: string;
  tick_size: number;
  timeframe: number;
  ticks_per_sec: number;
  cvd: number;
  broker?: string;
  ui_clients: number;
}

export type ClusterDisplayMode = 'BID_ASK' | 'DELTA' | 'VOLUME' | 'IMBALANCE';

// [price, bid_vol, ask_vol]
export type VolumeProfileLevel = [number, number, number];

export interface MT5TerminalInfo {
  id: string;
  path: string;
  servers: string[];
}

export interface IndicatorHeights {
  volume: number;
  cvd: number;
  rsi: number;
  stoch: number;
}

export const defaultIndicatorHeights: IndicatorHeights = {
  volume: 58,
  cvd: 65,
  rsi: 65,
  stoch: 65
};

export type VolumeHistogramPalette = 'STEEL_BLUE' | 'MONOCHROME';
export type CandleColorMode = 'PRICE' | 'DELTA';
export type GridLineStyle = 'DASHED' | 'DOTTED' | 'SOLID' | 'OFF';
export type ClusterFontSize = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface ChartThemeSettings {
  // --- Candlesticks & Wicks ---
  candlestickWidth: number; // 4 to 24px (default 8)
  candlestickGap: number; // 2 to 16px (default 5)
  wickWidth: number; // 1 to 4px (default 1.5)
  showWickCaps: boolean; // T-shaped caps on wick ends (Delta River style)
  wickCapWidth: number; // width of T-cap, 2 to 10px (default 4)
  candleColorMode: CandleColorMode; // 'PRICE' (Open vs Close) or 'DELTA' (Candle colored by net volume delta)
  bullishCandleColor: string;
  bearishCandleColor: string;
  bearishCandleBorder: string;

  // --- Clusters & Footprint ---
  volumeHistogramPalette: VolumeHistogramPalette;
  clusterBarRounding: number; // 0 to 6px
  clusterBarOpacity: number; // 0.3 to 1.0 (default 1.0)
  clusterSpacing: number; // vertical spacing between levels 0 to 3px (default 1)
  showClusterNumbers: boolean;
  clusterFontSize: ClusterFontSize;
  showClusterPOC: boolean;
  clusterPOCColor: string;
  showClusterValueArea: boolean; // Highlight 70% Value Area
  valueAreaColor: string;
  showImbalanceHighlights: boolean; // Highlight diagonal imbalances
  buyImbalanceColor: string;
  sellImbalanceColor: string;
  clusterBuyerColor: string;
  clusterBuyerText: string;
  clusterSellerColor: string;
  clusterSellerText: string;

  // --- Profiles & Scales ---
  showHorizontalPOC: boolean;
  horizontalPOCColor: string;
  horizontalProfileWidth: number; // 60 to 160px (default 100)
  verticalBuyerColor: string;
  verticalSellerColor: string;
  horizontalBuyerColor: string;
  horizontalSellerColor: string;

  // --- Canvas, Grid & Live Badges ---
  showGrid: boolean;
  gridColor: string;
  gridStyle: GridLineStyle;
  backgroundColor: string;
  crosshairColor: string;
  showCountdownTimer: boolean;
  showLivePriceLine: boolean;
}

export const defaultChartTheme: ChartThemeSettings = {
  // Candlesticks & Wicks
  candlestickWidth: 8,
  candlestickGap: 5,
  wickWidth: 1.5,
  showWickCaps: false,
  wickCapWidth: 4,
  candleColorMode: 'PRICE',
  bullishCandleColor: '#FFFFFF',
  bearishCandleColor: '#08090C',
  bearishCandleBorder: '#FFFFFF',

  // Clusters & Footprint
  volumeHistogramPalette: 'MONOCHROME',
  clusterBarRounding: 0,
  clusterBarOpacity: 1.0,
  clusterSpacing: 1,
  showClusterNumbers: true,
  clusterFontSize: 'MEDIUM',
  showClusterPOC: true,
  clusterPOCColor: '#D4AF37',
  showClusterValueArea: false,
  valueAreaColor: 'rgba(255, 255, 255, 0.05)',
  showImbalanceHighlights: true,
  buyImbalanceColor: '#00F59B',
  sellImbalanceColor: '#FF3B69',
  clusterBuyerColor: '#FFFFFF',
  clusterBuyerText: '#FFFFFF',
  clusterSellerColor: '#181C26',
  clusterSellerText: '#FFFFFF',

  // Profiles & Scales
  showHorizontalPOC: true,
  horizontalPOCColor: '#D4AF37',
  horizontalProfileWidth: 100,
  verticalBuyerColor: '#228B68',
  verticalSellerColor: '#A62639',
  horizontalBuyerColor: '#228B68',
  horizontalSellerColor: '#A62639',

  // Canvas, Grid & Live Badges
  showGrid: false,
  gridColor: '#161A24',
  gridStyle: 'DASHED',
  backgroundColor: '#08090C',
  crosshairColor: 'rgba(255, 255, 255, 0.25)',
  showCountdownTimer: true,
  showLivePriceLine: true
};

export interface ChartTemplate {
  id: string;
  name: string;
  description?: string;
  isBuiltIn?: boolean;
  isCustom?: boolean;
  createdAt: number;
  theme: ChartThemeSettings;
  indicatorHeights?: IndicatorHeights;
  showCVD?: boolean;
  showRSI?: boolean;
  showStochastic?: boolean;
  showVerticalVolume?: boolean;
  showHorizontalProfile?: boolean;
  showValueArea?: boolean;
  clusterMode?: ClusterDisplayMode;
}

export const BUILTIN_TEMPLATES: ChartTemplate[] = [
  {
    id: 'delta-river-classic',
    name: 'Delta River Classic',
    description: 'Класичний Delta River: Т-подібні засічки на тінях свічок, забарвлення за дельтою, золотий POC',
    isBuiltIn: true,
    createdAt: 1700000000000,
    theme: {
      ...defaultChartTheme,
      showWickCaps: true,
      wickCapWidth: 5,
      candleColorMode: 'DELTA',
      volumeHistogramPalette: 'STEEL_BLUE',
      showGrid: true,
      gridColor: '#141822',
      gridStyle: 'DASHED'
    },
    indicatorHeights: { volume: 58, cvd: 65, rsi: 65, stoch: 65 },
    showCVD: false,
    showRSI: false,
    showStochastic: false,
    showVerticalVolume: true,
    showHorizontalProfile: true,
    showValueArea: true,
    clusterMode: 'VOLUME'
  },
  {
    id: 'quantower-mono',
    name: 'Quantower Minimalist',
    description: 'Максимально строгий мінімалістичний чорно-білий стиль без зайвого візуального шуму',
    isBuiltIn: true,
    createdAt: 1700000001000,
    theme: {
      ...defaultChartTheme,
      volumeHistogramPalette: 'MONOCHROME',
      showWickCaps: false,
      showGrid: false
    },
    indicatorHeights: { volume: 54, cvd: 65, rsi: 65, stoch: 65 },
    showCVD: false,
    showRSI: false,
    showStochastic: false,
    showVerticalVolume: true,
    showHorizontalProfile: true,
    showValueArea: false,
    clusterMode: 'VOLUME'
  },
  {
    id: 'order-flow-bid-ask',
    name: 'Order Flow Bid x Ask',
    description: 'Повний поділ на покупців та продавців (Bid x Ask) з підсвічуванням діагональних дисбалансів',
    isBuiltIn: true,
    createdAt: 1700000002000,
    theme: {
      ...defaultChartTheme,
      showImbalanceHighlights: true,
      showWickCaps: true,
      wickCapWidth: 4,
      candlestickWidth: 7,
      candlestickGap: 4
    },
    indicatorHeights: { volume: 58, cvd: 65, rsi: 65, stoch: 65 },
    showCVD: false,
    showRSI: false,
    showStochastic: false,
    showVerticalVolume: true,
    showHorizontalProfile: true,
    showValueArea: false,
    clusterMode: 'BID_ASK'
  },
  {
    id: 'scalper-net-delta',
    name: 'Scalper Net Delta + CVD',
    description: 'Агресивний скальпінг за чистим дисбалансом дельти та графіком CVD',
    isBuiltIn: true,
    createdAt: 1700000003000,
    theme: {
      ...defaultChartTheme,
      candleColorMode: 'DELTA',
      volumeHistogramPalette: 'STEEL_BLUE',
      showWickCaps: false,
      showGrid: true,
      gridColor: '#12151E'
    },
    indicatorHeights: { volume: 50, cvd: 70, rsi: 65, stoch: 65 },
    showCVD: true,
    showRSI: false,
    showStochastic: false,
    showVerticalVolume: true,
    showHorizontalProfile: false,
    showValueArea: false,
    clusterMode: 'DELTA'
  },
  {
    id: 'pure-heatmap-clean',
    name: 'Pure Tape Heatmap',
    description: 'Швидка теплокарта об\'єму без цифр для миттєвого візуального сприйняття рівнів ліквідності',
    isBuiltIn: true,
    createdAt: 1700000004000,
    theme: {
      ...defaultChartTheme,
      showClusterNumbers: false,
      clusterBarRounding: 3,
      volumeHistogramPalette: 'STEEL_BLUE',
      showClusterValueArea: true
    },
    indicatorHeights: { volume: 55, cvd: 65, rsi: 65, stoch: 65 },
    showCVD: false,
    showRSI: false,
    showStochastic: false,
    showVerticalVolume: true,
    showHorizontalProfile: true,
    showValueArea: true,
    clusterMode: 'VOLUME'
  }
];
