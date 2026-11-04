import React, { useState, useRef, useEffect } from 'react';
import { ClusterDisplayMode, EngineStats, ChartTemplate, BUILTIN_TEMPLATES } from '../types';
import { BarChart2, Activity, Layers, Sliders, AlignVerticalJustifyStart, BarChart3, FolderOpen, Search, ChevronDown, Clock, Palette, Bookmark, Check } from 'lucide-react';

interface HeaderProps {
  currentSymbol: string;
  onOpenSymbolSearch: () => void;
  timeframe: number;
  onTimeframeChange: (tf: number) => void;
  clusterMode: ClusterDisplayMode;
  onClusterModeChange: (mode: ClusterDisplayMode) => void;
  showCVD: boolean;
  onToggleCVD: () => void;
  showRSI: boolean;
  onToggleRSI: () => void;
  showStochastic: boolean;
  onToggleStochastic: () => void;
  showValueArea: boolean;
  onToggleValueArea: () => void;
  showVerticalVolume: boolean;
  onToggleVerticalVolume: () => void;
  showHorizontalProfile: boolean;
  onToggleHorizontalProfile: () => void;
  stats: EngineStats | null;
  isConnected: boolean;
  onOpenSettings: (tab?: 'TEMPLATES' | 'APPEARANCE' | 'MT5') => void;
  templates?: ChartTemplate[];
  activeTemplateId?: string;
  onApplyTemplate?: (template: ChartTemplate) => void;
  onSaveTemplate?: (name: string) => void;
}

const TIMEFRAME_PRESETS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1H', seconds: 3600 },
  { label: '4H', seconds: 14400 },
  { label: '1D', seconds: 86400 }
];

const ALL_TIMEFRAMES = [
  {
    category: 'СЕКУНДИ',
    items: [
      { label: '5s', seconds: 5 },
      { label: '15s', seconds: 15 },
      { label: '30s', seconds: 30 }
    ]
  },
  {
    category: 'ХВИЛИНИ',
    items: [
      { label: '1m', seconds: 60 },
      { label: '2m', seconds: 120 },
      { label: '3m', seconds: 180 },
      { label: '5m', seconds: 300 },
      { label: '10m', seconds: 600 },
      { label: '15m', seconds: 900 },
      { label: '30m', seconds: 1800 },
      { label: '45m', seconds: 2700 }
    ]
  },
  {
    category: 'ГОДИНИ',
    items: [
      { label: '1H', seconds: 3600 },
      { label: '2H', seconds: 7200 },
      { label: '3H', seconds: 10800 },
      { label: '4H', seconds: 14400 }
    ]
  },
  {
    category: 'ДНІ',
    items: [
      { label: '1D', seconds: 86400 }
    ]
  }
];

export const Header: React.FC<HeaderProps> = ({
  currentSymbol,
  onOpenSymbolSearch,
  timeframe,
  onTimeframeChange,
  clusterMode,
  onClusterModeChange,
  showCVD,
  onToggleCVD,
  showRSI,
  onToggleRSI,
  showStochastic,
  onToggleStochastic,
  showValueArea,
  onToggleValueArea,
  showVerticalVolume,
  onToggleVerticalVolume,
  showHorizontalProfile,
  onToggleHorizontalProfile,
  stats,
  isConnected,
  onOpenSettings,
  templates = BUILTIN_TEMPLATES,
  activeTemplateId = 'delta-river-classic',
  onApplyTemplate,
  onSaveTemplate
}) => {
  const [isTfDropdownOpen, setIsTfDropdownOpen] = useState(false);
  const tfDropdownRef = useRef<HTMLDivElement>(null);

  const [isTemplateDropdownOpen, setIsTemplateDropdownOpen] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click (capture phase so clicking on canvas closes them immediately)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (tfDropdownRef.current && !tfDropdownRef.current.contains(e.target as Node)) {
        setIsTfDropdownOpen(false);
      }
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setIsTemplateDropdownOpen(false);
      }
    };
    if (isTfDropdownOpen || isTemplateDropdownOpen) {
      window.addEventListener('pointerdown', handleClickOutside, true);
    }
    return () => window.removeEventListener('pointerdown', handleClickOutside, true);
  }, [isTfDropdownOpen, isTemplateDropdownOpen]);

  const activeTemplate = templates.find(t => t.id === activeTemplateId) || templates[0];

  const getTimeframeLabel = (sec: number) => {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${Math.round(sec / 3600)}H`;
    return `${Math.round(sec / 86400)}D`;
  };

  return (
    <header className="header-bar">
      {/* Left: Logo, Symbol Search & Timeframes */}
      <div className="header-left">
        <div className="logo-badge" style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'default' }}>
          <div className="logo-icon">Δ</div>
          <span style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.4px', color: '#F1F5F9' }}>
            DELTA<span style={{ color: '#475569', fontWeight: 600 }}>ORL</span>
          </span>
        </div>

        {/* Quantower Symbol Search Button */}
        <button
          onClick={onOpenSymbolSearch}
          title="Вибір або пошук будь-якого символу (Квантавер / MT5)"
          style={{
            height: 20,
            background: '#0D1016',
            border: '1px solid #1C222E',
            color: '#E2E8F0',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 700,
            fontSize: '10px',
            padding: '0 6px',
            borderRadius: 2,
            cursor: 'pointer'
          }}
        >
          <Search size={10} color="#94A3B8" />
          <span>{currentSymbol}</span>
          <ChevronDown size={9} color="#64748B" />
        </button>

        {/* Minimalist Timeframe Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, position: 'relative' }} ref={tfDropdownRef}>
          <div className="btn-group" style={{ height: 21 }}>
            {TIMEFRAME_PRESETS.map(preset => {
              const isActive = timeframe === preset.seconds;
              return (
                <button
                  key={preset.seconds}
                  onClick={() => onTimeframeChange(preset.seconds)}
                  style={{
                    height: 17,
                    minWidth: 24,
                    padding: '0 5px',
                    fontSize: '10px',
                    fontFamily: 'var(--font-sans)',
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? '#FFFFFF' : '#8E9CAE',
                    background: isActive ? '#202634' : 'transparent',
                    border: 'none',
                    borderRadius: 2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Timeframe Dropdown Toggle */}
          <button
            onClick={() => setIsTfDropdownOpen(!isTfDropdownOpen)}
            title="Більше таймфреймів (TradingView)"
            style={{
              height: 21,
              padding: '0 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: '10px',
              fontFamily: 'var(--font-sans)',
              color: isTfDropdownOpen ? '#FFFFFF' : '#8E9CAE',
              background: isTfDropdownOpen ? '#202634' : '#0D1016',
              border: '1px solid #1C222E',
              borderRadius: 2,
              cursor: 'pointer'
            }}
          >
            <Clock size={10} />
            <span style={{ fontSize: '10px' }}>{getTimeframeLabel(timeframe)}</span>
            <ChevronDown size={9} />
          </button>

          {/* TradingView Timeframe Dropdown Menu */}
          {isTfDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: 4,
                background: '#0B0D13',
                border: '1px solid #1F2432',
                borderRadius: '4px',
                padding: '6px 8px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.8)',
                zIndex: 90,
                minWidth: '190px'
              }}
            >
              {ALL_TIMEFRAMES.map((group, idx) => (
                <div key={group.category} style={{ marginBottom: idx === ALL_TIMEFRAMES.length - 1 ? 0 : 6 }}>
                  <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748B', marginBottom: 3, letterSpacing: '0.5px' }}>
                    {group.category}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
                    {group.items.map(tf => {
                      const isActive = timeframe === tf.seconds;
                      return (
                        <button
                          key={tf.seconds}
                          onClick={() => {
                            onTimeframeChange(tf.seconds);
                            setIsTfDropdownOpen(false);
                          }}
                          style={{
                            background: isActive ? '#202634' : '#13161F',
                            color: isActive ? '#FFFFFF' : '#CBD5E1',
                            border: isActive ? '1px solid #384357' : '1px solid #1E2330',
                            borderRadius: '2px',
                            padding: '3px 0',
                            fontSize: '10px',
                            fontFamily: 'var(--font-sans)',
                            fontWeight: isActive ? 700 : 500,
                            cursor: 'pointer',
                            textAlign: 'center'
                          }}
                        >
                          {tf.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Cluster Visualization Modes & Volume Layers (Minimalist & Sleek) */}
      <div className="header-center">
        {/* Cluster Mode Segmented Selector */}
        <div className="btn-group" style={{ height: 21 }}>
          {(['VOLUME', 'BID_ASK', 'DELTA'] as const).map(mode => {
            const isActive = clusterMode === mode;
            const label = mode === 'BID_ASK' ? 'BID x ASK' : mode;
            return (
              <button
                key={mode}
                onClick={() => onClusterModeChange(mode)}
                style={{
                  height: 17,
                  padding: '0 8px',
                  fontSize: '10px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: '0.3px',
                  color: isActive ? '#FFFFFF' : '#8E9CAE',
                  background: isActive ? '#202634' : 'transparent',
                  border: 'none',
                  borderRadius: 2,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                  transition: 'all 0.08s ease'
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 14, background: '#1A1F2C', margin: '0 2px' }} />

        {/* Minimalist Overlay & Indicator Toggles (Gray/White Emblem Palette) */}
        <button
          className={`header-toggle-btn ${showVerticalVolume ? 'active' : ''}`}
          onClick={onToggleVerticalVolume}
          title="Вертикальний об'єм свічок з поділом на покупців і продавців"
        >
          <AlignVerticalJustifyStart size={10} />
          <span>ОБ'ЄМ</span>
        </button>

        <button
          className={`header-toggle-btn ${showHorizontalProfile ? 'active' : ''}`}
          onClick={onToggleHorizontalProfile}
          title="Горизонтальний профіль об'єму (Buy/Sell split)"
        >
          <BarChart3 size={10} />
          <span>ПРОФІЛЬ</span>
        </button>

        <button
          className={`header-toggle-btn ${showValueArea ? 'active' : ''}`}
          onClick={onToggleValueArea}
          title="Value Area 70%"
        >
          <Layers size={10} />
          <span>VA 70%</span>
        </button>

        <button
          className={`header-toggle-btn ${showCVD ? 'active' : ''}`}
          onClick={onToggleCVD}
          title="Кумулятивна дельта (CVD)"
        >
          <BarChart2 size={10} />
          <span>CVD</span>
        </button>

        <button
          className={`header-toggle-btn ${showRSI ? 'active' : ''}`}
          onClick={onToggleRSI}
          title="Relative Strength Index (RSI 14)"
        >
          <Activity size={10} />
          <span>RSI</span>
        </button>

        <button
          className={`header-toggle-btn ${showStochastic ? 'active' : ''}`}
          onClick={onToggleStochastic}
          title="Stochastic Oscillator (14, 3, 3)"
        >
          <BarChart3 size={10} />
          <span>STOCH</span>
        </button>
      </div>

      {/* Right: Status & Settings (Ultra Compact & Emblem Palette) */}
      <div className="header-right">
        {/* MT5 Status */}
        <div
          className="status-pill"
          onClick={() => onOpenSettings('MT5')}
          style={{ cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '9.5px' }}
          title={stats?.mt5_connected ? `Підключено: ${stats.broker || 'MetaTrader 5'}` : 'MT5 не підключено. Натисніть для налаштування'}
        >
          <span className={`status-dot ${stats?.mt5_connected ? 'online' : (isConnected ? 'sim' : 'offline')}`}></span>
          <span style={{ color: stats?.mt5_connected ? '#FFFFFF' : '#8E9CAE' }}>
            {stats?.mt5_connected ? 'MT5: LIVE' : (isConnected ? 'SIMULATOR' : 'OFFLINE')}
          </span>
        </div>

        {/* Ticks/Sec */}
        <div className="status-pill" style={{ fontFamily: 'var(--font-sans)', fontSize: '9.5px' }} title="Потік тіків за секунду">
          <Activity size={10} color="#64748B" />
          <span style={{ color: '#CBD5E1' }}>{stats ? stats.ticks_per_sec.toFixed(1) : '0.0'} TPS</span>
        </div>

        {/* MT5 Source Button */}
        <button
          onClick={() => onOpenSettings('MT5')}
          title="Підключення MetaTrader 5 та радника"
          style={{
            height: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#CBD5E1',
            border: '1px solid #222836',
            background: '#12151D',
            fontSize: '10px',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            padding: '0 7px',
            borderRadius: 2,
            cursor: 'pointer'
          }}
        >
          <FolderOpen size={10} color="#CBD5E1" />
          <span>MT5</span>
        </button>

        {/* Templates Quick Selector (Emblem Theme) */}
        <div style={{ position: 'relative' }} ref={templateDropdownRef}>
          <button
            onClick={() => setIsTemplateDropdownOpen(!isTemplateDropdownOpen)}
            title="Швидкий вибір збереженого шаблону графіка"
            style={{
              height: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#FFFFFF',
              border: '1px solid #2A3142',
              background: '#161922',
              fontSize: '10px',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              padding: '0 8px',
              borderRadius: 2,
              cursor: 'pointer'
            }}
          >
            <Bookmark size={10} color="#CBD5E1" />
            <span style={{ maxWidth: 95, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {activeTemplate?.name || 'ШАБЛОНИ'}
            </span>
            <ChevronDown size={9} color="#8E9CAE" style={{ transform: isTemplateDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
          </button>

          {isTemplateDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                width: 240,
                background: '#0E1118',
                border: '1px solid #1F2533',
                borderRadius: 4,
                boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
                zIndex: 1000,
                padding: '4px 0',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              <div style={{ padding: '4px 10px 4px', fontSize: '9px', fontWeight: 700, color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', borderBottom: '1px solid #161A24' }}>
                Шаблони графіка (Presets)
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                {templates.map(t => {
                  const isAct = t.id === activeTemplateId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        onApplyTemplate?.(t);
                        setIsTemplateDropdownOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        padding: '6px 10px',
                        background: isAct ? '#202634' : 'transparent',
                        color: isAct ? '#FFFFFF' : '#CBD5E1',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '10.5px',
                        fontFamily: 'var(--font-sans)',
                        fontWeight: isAct ? 600 : 400,
                        textAlign: 'left'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = isAct ? '#283142' : '#141822')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = isAct ? '#202634' : 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Bookmark size={10} color={isAct ? '#FFFFFF' : '#64748B'} />
                        <span>{t.name}</span>
                      </div>
                      {isAct && <Check size={11} color="#FFFFFF" />}
                    </button>
                  );
                })}
              </div>
              <div style={{ borderTop: '1px solid #161A24', paddingTop: 3, marginTop: 3 }}>
                <button
                  onClick={() => {
                    setIsTemplateDropdownOpen(false);
                    onOpenSettings('TEMPLATES');
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    width: '100%',
                    padding: '5px 10px',
                    background: 'transparent',
                    color: '#8E9CAE',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontFamily: 'var(--font-sans)'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#141822')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Sliders size={10} color="#8E9CAE" />
                  <span>Управління шаблонами...</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Minimalist Settings Button (Emblem Palette) */}
        <button
          onClick={() => onOpenSettings('APPEARANCE')}
          title="Налаштування візуалізації, чисел та кольорів"
          style={{
            height: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: '#FFFFFF',
            border: '1px solid #2A3142',
            background: '#161922',
            fontSize: '10px',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            padding: '0 8px',
            borderRadius: 2,
            cursor: 'pointer'
          }}
        >
          <Sliders size={10} color="#CBD5E1" />
          <span>НАЛАШТУВАННЯ</span>
        </button>
      </div>
    </header>
  );
};
