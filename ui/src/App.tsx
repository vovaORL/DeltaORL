import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { FootprintChart } from './chart/FootprintChart';
import { SettingsModal } from './components/SettingsModal';
import { SymbolSearchModal } from './components/SymbolSearchModal';

import { mergeCandles } from './services/candles';
import { wsService } from './services/wsClient';
import {
  Candle,
  EngineStats,
  ClusterDisplayMode,
  ChartThemeSettings,
  defaultChartTheme,
  IndicatorHeights,
  defaultIndicatorHeights,
  ChartTemplate,
  BUILTIN_TEMPLATES
} from './types';

export const App: React.FC = () => {
  const streamRef = useRef({ symbol: 'EURUSD', timeframe: 60 });
  const [candles, setCandles] = useState<Candle[]>([]);
  const [stats, setStats] = useState<EngineStats | null>(null);

  const [currentSymbol, setCurrentSymbol] = useState<string>('EURUSD');
  const [tickSize, setTickSize] = useState<number>(0.0001);
  const [timeframe, setTimeframe] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('deltaorl_timeframe');
      if (saved) {
        const val = parseInt(saved, 10);
        if (val > 0 && val <= 86400) return val;
      }
    } catch (_) {}
    return 60;
  });
  const [clusterMode, setClusterMode] = useState<ClusterDisplayMode>('VOLUME');

  const [showCVD, setShowCVD] = useState<boolean>(false);
  const [showRSI, setShowRSI] = useState<boolean>(false);
  const [showStochastic, setShowStochastic] = useState<boolean>(false);
  const [showValueArea, setShowValueArea] = useState<boolean>(false);
  const [showVerticalVolume, setShowVerticalVolume] = useState<boolean>(true);
  const [showHorizontalProfile, setShowHorizontalProfile] = useState<boolean>(true);

  // Indicator Panel Heights (Adjustable by user)
  const [indicatorHeights, setIndicatorHeights] = useState<IndicatorHeights>(() => {
    try {
      const saved = localStorage.getItem('deltaorl_indicator_heights');
      if (saved) return { ...defaultIndicatorHeights, ...JSON.parse(saved) };
    } catch (_) {}
    return defaultIndicatorHeights;
  });

  const handleIndicatorHeightsChange = (newHeights: IndicatorHeights) => {
    setIndicatorHeights(newHeights);
    try {
      localStorage.setItem('deltaorl_indicator_heights', JSON.stringify(newHeights));
    } catch (_) {}
  };

  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isSymbolSearchOpen, setIsSymbolSearchOpen] = useState<boolean>(false);

  // Custom visual theme & cluster numbers settings with localStorage persistence
  const [chartTheme, setChartTheme] = useState<ChartThemeSettings>(() => {
    try {
      const saved = localStorage.getItem('deltaorl_theme_bw');
      if (saved) return { ...defaultChartTheme, ...JSON.parse(saved) };
    } catch (_) {}
    return defaultChartTheme;
  });

  const handleSaveChartTheme = (newTheme: ChartThemeSettings) => {
    setChartTheme(newTheme);
    try {
      localStorage.setItem('deltaorl_theme_bw', JSON.stringify(newTheme));
    } catch (_) {}
  };

  // Template Management (Delta River Style)
  const [templates, setTemplates] = useState<ChartTemplate[]>(() => {
    try {
      const saved = localStorage.getItem('deltaorl_templates');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return BUILTIN_TEMPLATES;
  });

  const [activeTemplateId, setActiveTemplateId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('deltaorl_active_template');
      if (saved) return saved;
    } catch (_) {}
    return 'delta-river-classic';
  });

  const [settingsInitialTab, setSettingsInitialTab] = useState<'TEMPLATES' | 'APPEARANCE' | 'MT5'>('TEMPLATES');

  const handleApplyTemplate = (tpl: ChartTemplate) => {
    setActiveTemplateId(tpl.id);
    setChartTheme({ ...defaultChartTheme, ...tpl.theme });
    if (tpl.showCVD !== undefined) setShowCVD(tpl.showCVD);
    if (tpl.showRSI !== undefined) setShowRSI(tpl.showRSI);
    if (tpl.showStochastic !== undefined) setShowStochastic(tpl.showStochastic);
    if (tpl.showVerticalVolume !== undefined) setShowVerticalVolume(tpl.showVerticalVolume);
    if (tpl.showHorizontalProfile !== undefined) setShowHorizontalProfile(tpl.showHorizontalProfile);
    if (tpl.showValueArea !== undefined) setShowValueArea(tpl.showValueArea);
    if (tpl.indicatorHeights) {
      setIndicatorHeights(tpl.indicatorHeights);
      try {
        localStorage.setItem('deltaorl_indicator_heights', JSON.stringify(tpl.indicatorHeights));
      } catch (_) {}
    }
    if (tpl.clusterMode) {
      setClusterMode(tpl.clusterMode);
    }
    try {
      localStorage.setItem('deltaorl_active_template', tpl.id);
      localStorage.setItem('deltaorl_theme_bw', JSON.stringify(tpl.theme));
    } catch (_) {}
  };

  const handleSaveTemplate = (name: string, description?: string) => {
    const newTpl: ChartTemplate = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      description: description?.trim() || 'Користувацький шаблон',
      isCustom: true,
      createdAt: Date.now(),
      theme: { ...chartTheme },
      indicatorHeights: { ...indicatorHeights },
      clusterMode, showCVD, showRSI, showStochastic, showVerticalVolume, showHorizontalProfile, showValueArea
    };

    const updated = [newTpl, ...templates];
    setTemplates(updated);
    setActiveTemplateId(newTpl.id);
    try {
      localStorage.setItem('deltaorl_templates', JSON.stringify(updated));
      localStorage.setItem('deltaorl_active_template', newTpl.id);
    } catch (_) {}
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = templates.filter(t => t.id !== id);
    setTemplates(updated);
    if (activeTemplateId === id) {
      handleApplyTemplate(BUILTIN_TEMPLATES[0]);
    }
    try {
      localStorage.setItem('deltaorl_templates', JSON.stringify(updated));
    } catch (_) {}
  };

  // Imbalance parameters
  const [imbalanceRatio, setImbalanceRatio] = useState<number>(3.0);
  const [imbalanceMinVol, setImbalanceMinVol] = useState<number>(1.0);

  const [detectedTerminals, setDetectedTerminals] = useState<import('./types').MT5TerminalInfo[]>([]);
  const [loadStatus, setLoadStatus] = useState<string | null>(null);
  const [eaInstallStatus, setEaInstallStatus] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    // 1. Connection status
    unsubscribers.push(wsService.onConnectionChange((connected) => {
      setIsConnected(connected);
      if (!connected) setStats(null);
      if (connected) {
        try {
          const savedTf = parseInt(localStorage.getItem('deltaorl_timeframe') || '', 10);
          if (savedTf > 0 && savedTf <= 86400) wsService.setTimeframe(savedTf);
        } catch (_) {}
      }
    }));

    // 2. Snapshot (Receives historical candles)
    unsubscribers.push(wsService.onSnapshot((data) => {
      streamRef.current = { symbol: data.symbol, timeframe: data.timeframe };
      setCurrentSymbol(data.symbol);
      setTickSize(data.tick_size);
      setTimeframe(data.timeframe);
      setCandles(mergeCandles([], data.candles));
    }));

    // 3. Candle update (live 30 FPS updates)
    unsubscribers.push(wsService.onCandleUpdate((data) => {
      if (data.symbol !== streamRef.current.symbol || (data.timeframe && data.timeframe !== streamRef.current.timeframe)) return;
      setCandles(prev => mergeCandles(prev, data.candles ?? [data.candle]));
    }));

    // 4. Engine Stats
    unsubscribers.push(wsService.onStats((newStats) => {
      setStats(newStats);
      if (newStats.symbol) setCurrentSymbol(newStats.symbol);
      if (newStats.tick_size) setTickSize(newStats.tick_size);
      if (newStats.timeframe) setTimeframe(newStats.timeframe);
    }));

    // 5. Detected MT5 Terminals
    unsubscribers.push(wsService.onMT5Terminals((terms) => {
      setDetectedTerminals(terms);
    }));

    // 6. MT5 Connect / Load Result
    unsubscribers.push(wsService.onMT5LoadResult((res) => {
      if (res.count > 0) {
        setLoadStatus(`✓ MT5 Direct: ${res.msg || `Підключення для ${res.symbol} успішно активне!`}`);
      } else {
        setLoadStatus(res.msg || `Не вдалося підключитися для ${res.symbol}. Перевірте шлях до terminal64.exe.`);
      }
    }));

    // 7. Install EA Result
    unsubscribers.push(wsService.onInstallEAResult((res) => {
      if (res.success) {
        setEaInstallStatus(`✓ Радник DeltaBridge.mq5 успішно встановлено в: ${res.destination}`);
      } else {
        setEaInstallStatus('Помилка: не знайдено папку MQL5/Experts у вказаному каталозі.');
      }
    }));
    unsubscribers.push(wsService.onError(res => setLoadStatus(res.msg)));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, []);

  const handleSymbolChange = (sym: string) => {
    wsService.setSymbol(sym);
  };

  const handleTimeframeChange = (tf: number) => {
    try {
      localStorage.setItem('deltaorl_timeframe', tf.toString());
    } catch (_) {}
    wsService.setTimeframe(tf);
  };

  const handleSaveImbalance = (ratio: number, minVol: number) => {
    setImbalanceRatio(ratio);
    setImbalanceMinVol(minVol);
    wsService.setImbalance(ratio, minVol);
  };

  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;

  return (
    <div className="app-container">
      {/* Top Navigation & Controls */}
      <Header
        currentSymbol={currentSymbol}
        onOpenSymbolSearch={() => setIsSymbolSearchOpen(true)}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        clusterMode={clusterMode}
        onClusterModeChange={setClusterMode}
        showCVD={showCVD}
        onToggleCVD={() => setShowCVD(!showCVD)}
        showRSI={showRSI}
        onToggleRSI={() => setShowRSI(!showRSI)}
        showStochastic={showStochastic}
        onToggleStochastic={() => setShowStochastic(!showStochastic)}
        showValueArea={showValueArea}
        onToggleValueArea={() => setShowValueArea(!showValueArea)}
        showVerticalVolume={showVerticalVolume}
        onToggleVerticalVolume={() => setShowVerticalVolume(!showVerticalVolume)}
        showHorizontalProfile={showHorizontalProfile}
        onToggleHorizontalProfile={() => setShowHorizontalProfile(!showHorizontalProfile)}
        stats={stats}
        isConnected={isConnected}
        onOpenSettings={(tab) => {
          if (tab) setSettingsInitialTab(tab);
          setIsSettingsOpen(true);
        }}
        templates={templates}
        activeTemplateId={activeTemplateId}
        onApplyTemplate={handleApplyTemplate}
        onSaveTemplate={(name) => handleSaveTemplate(name)}
      />

      {/* Main Full-Screen Footprint & Volume Workspace */}
      <div className="workspace-grid">
        <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
          {/* Simulator Notice when MT5 is not connected */}
          {isConnected && !stats?.mt5_connected && (
            <div style={{
              position: 'absolute',
              top: '32px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              background: 'rgba(18, 22, 30, 0.90)',
              border: '1px solid #2B3346',
              borderRadius: '4px',
              padding: '4px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              color: '#CBD5E1',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'none'
            }}>
              <span>{stats?.demo ? "Демонстраційні дані — MT5 не підключено" : `MT5: ${stats?.mt5_status || "Connecting"} — очікування котирувань DeltaBridge`}</span>
            </div>
          )}

          {/* Quick HUD Overlay */}
          {latestCandle && (
            <div className="chart-header-overlay" style={{
              position: 'absolute',
              top: '6px',
              left: showHorizontalProfile ? '108px' : '10px',
              zIndex: 5,
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              pointerEvents: 'none'
            }}>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>ЦІНА:</span>
                <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{latestCandle.c.toFixed(tickSize < 0.001 ? 5 : 2)}</span>
              </div>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>ДЕЛЬТА:</span>
                <span style={{ color: latestCandle.d >= 0 ? '#CBD5E1' : '#94A3B8', fontWeight: 700 }}>
                  {latestCandle.d >= 0 ? '+' : ''}{latestCandle.d.toFixed(1)}
                </span>
              </div>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>ОБ'ЄМ:</span>
                <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{latestCandle.v.toFixed(1)}</span>
              </div>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>ПРОДАВЦІ:</span>
                <span style={{ color: '#E2E8F0', fontWeight: 600 }}>
                  {latestCandle.bv !== undefined ? latestCandle.bv.toFixed(1) : ((latestCandle.v - latestCandle.d) * 0.5).toFixed(1)}
                </span>
              </div>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>ПОКУПЦІ:</span>
                <span style={{ color: '#E2E8F0', fontWeight: 600 }}>
                  {latestCandle.av !== undefined ? latestCandle.av.toFixed(1) : ((latestCandle.v + latestCandle.d) * 0.5).toFixed(1)}
                </span>
              </div>
              <div className="metric-tag" style={{ background: 'rgba(12, 15, 20, 0.85)', border: '1px solid #1F2532', padding: '2px 8px', borderRadius: '3px', fontSize: '10.5px' }}>
                <span style={{ color: '#64748B', marginRight: 4 }}>POC:</span>
                <span style={{ color: '#D4AF37', fontWeight: 700 }}>
                  {latestCandle.poc.toFixed(tickSize < 0.001 ? 5 : 2)}
                </span>
              </div>
            </div>
          )}

          <FootprintChart
            candles={candles}
            tickSize={tickSize}
            symbol={currentSymbol}
            timeframe={timeframe}
            displayMode={clusterMode}
            showCVD={showCVD}
            showRSI={showRSI}
            showStochastic={showStochastic}
            showValueArea={showValueArea}
            showHorizontalProfile={showHorizontalProfile}
            showVerticalVolume={showVerticalVolume}
            indicatorHeights={indicatorHeights}
            onIndicatorHeightsChange={handleIndicatorHeightsChange}
            chartTheme={chartTheme}
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <footer className="footer-bar" style={{ height: '22px', padding: '0 10px', fontSize: '10px' }}>
        <div className="footer-left" style={{ gap: '12px' }}>
          <span>СИМВОЛ: <strong style={{ color: '#FFFFFF' }}>{currentSymbol}</strong></span>
          <span>КРОК ЦІНИ: <strong style={{ color: '#CBD5E1' }}>{tickSize}</strong></span>
          <span>ТАЙМФРЕЙМ: <strong style={{ color: '#FFFFFF' }}>{timeframe < 60 ? `${timeframe}s` : (timeframe < 3600 ? `${Math.round(timeframe / 60)}m` : (timeframe < 86400 ? `${Math.round(timeframe / 3600)}H` : `${Math.round(timeframe / 86400)}D`))}</strong></span>
          <span>СВІЧОК: <strong style={{ color: '#CBD5E1' }}>{candles.length}</strong></span>
          <span style={{ color: '#4A5568' }}>| Колесо: переміщення по історії | Ctrl+Колесо: масштаб кластерів | Права шкала: розтягування ціни</span>
        </div>
        <div className="footer-right" style={{ gap: '12px' }}>
          <span>CVD: <strong style={{ color: stats && stats.cvd >= 0 ? '#FFFFFF' : '#94A3B8' }}>{stats?.cvd.toFixed(1) || '0.0'}</strong></span>
          <span>C++ CORE: <strong style={{ color: isConnected ? '#FFFFFF' : '#64748B' }}>{isConnected ? 'ONLINE (127.0.0.1:9191)' : 'CONNECTING...'}</strong></span>
        </div>
      </footer>

      {/* Quantower Symbol Search Modal */}
      <SymbolSearchModal
        isOpen={isSymbolSearchOpen}
        onClose={() => setIsSymbolSearchOpen(false)}
        currentSymbol={currentSymbol}
        onSelectSymbol={handleSymbolChange}
      />

      {/* Settings Modal (Appearance, Colors, Numbers, MT5, Indicator Heights) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsInitialTab}
        chartTheme={chartTheme}
        onSaveChartTheme={handleSaveChartTheme}
        indicatorHeights={indicatorHeights}
        onSaveIndicatorHeights={handleIndicatorHeightsChange}
        templates={templates}
        activeTemplateId={activeTemplateId}
        onApplyTemplate={handleApplyTemplate}
        onSaveTemplate={handleSaveTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        currentRatio={imbalanceRatio}
        currentMinVol={imbalanceMinVol}
        onSaveImbalance={handleSaveImbalance}
        detectedTerminals={detectedTerminals}
        currentSymbol={currentSymbol}
        isMT5Connected={isConnected && Boolean(stats?.mt5_connected)}
        brokerInfo={stats?.broker}
        ticksPerSec={stats?.ticks_per_sec || 0}
        onConnectMT5={(path) => {
          setLoadStatus('Підключення до MT5...');
          wsService.loadMT5Path(path, currentSymbol);
        }}
        onInstallEA={(path) => {
          wsService.installEA(path);
        }}
        loadStatus={loadStatus}
        eaInstallStatus={eaInstallStatus}
      />
    </div>
  );
};

export default App;
