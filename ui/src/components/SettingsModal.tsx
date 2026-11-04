import React, { useState, useEffect } from 'react';
import { X, Check, FolderOpen, Database, Zap, Download, CheckCircle, Palette, Sliders, RotateCcw, Bookmark, Plus, Trash2, Copy, FileText } from 'lucide-react';
import {
  MT5TerminalInfo,
  ChartThemeSettings,
  defaultChartTheme,
  IndicatorHeights,
  defaultIndicatorHeights,
  ChartTemplate,
  BUILTIN_TEMPLATES,
  CandleColorMode,
  GridLineStyle,
  ClusterFontSize
} from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chartTheme: ChartThemeSettings;
  onSaveChartTheme: (theme: ChartThemeSettings) => void;
  indicatorHeights?: IndicatorHeights;
  onSaveIndicatorHeights?: (heights: IndicatorHeights) => void;
  // Template props
  templates?: ChartTemplate[];
  activeTemplateId?: string;
  onApplyTemplate?: (template: ChartTemplate) => void;
  onSaveTemplate?: (name: string, description?: string) => void;
  onDeleteTemplate?: (id: string) => void;
  // Imbalance and MT5 props
  currentRatio: number;
  currentMinVol: number;
  onSaveImbalance: (ratio: number, minVol: number) => void;
  detectedTerminals: MT5TerminalInfo[];
  currentSymbol: string;
  isMT5Connected: boolean;
  brokerInfo?: string;
  ticksPerSec: number;
  onConnectMT5: (path: string) => void;
  onInstallEA: (path: string) => void;
  loadStatus: string | null;
  eaInstallStatus: string | null;
  initialTab?: 'TEMPLATES' | 'APPEARANCE' | 'MT5';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  chartTheme,
  onSaveChartTheme,
  indicatorHeights = defaultIndicatorHeights,
  onSaveIndicatorHeights,
  templates = BUILTIN_TEMPLATES,
  activeTemplateId = 'delta-river-classic',
  onApplyTemplate,
  onSaveTemplate,
  onDeleteTemplate,
  currentRatio,
  currentMinVol,
  onSaveImbalance,
  detectedTerminals,
  currentSymbol,
  isMT5Connected,
  brokerInfo,
  ticksPerSec,
  onConnectMT5,
  onInstallEA,
  loadStatus,
  eaInstallStatus,
  initialTab = 'TEMPLATES'
}) => {
  const [activeTab, setActiveTab] = useState<'TEMPLATES' | 'APPEARANCE' | 'MT5'>(initialTab);
  const [theme, setTheme] = useState<ChartThemeSettings>(chartTheme);
  const [heights, setHeights] = useState<IndicatorHeights>(indicatorHeights);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Synchronize when external theme / heights change
  useEffect(() => {
    setTheme(chartTheme);
  }, [chartTheme]);

  useEffect(() => {
    setHeights(indicatorHeights);
  }, [indicatorHeights]);

  // New Template Input State
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // MT5 State
  const [ratio, setRatio] = useState(currentRatio);
  const [minVol, setMinVol] = useState(currentMinVol);
  useEffect(() => { setRatio(currentRatio); setMinVol(currentMinVol); }, [currentRatio, currentMinVol]);
  const [mt5Path, setMt5Path] = useState<string>(
    'C:\\Program Files\\MetaTrader 5\\terminal64.exe'
  );

  if (!isOpen) return null;

  const handleSaveTheme = (newTheme: ChartThemeSettings) => {
    setTheme(newTheme);
    onSaveChartTheme(newTheme);
  };

  const handleUpdateHeight = (key: keyof IndicatorHeights, val: number) => {
    const updated = { ...heights, [key]: val };
    setHeights(updated);
    if (onSaveIndicatorHeights) {
      onSaveIndicatorHeights(updated);
    }
  };

  const handleResetTheme = () => {
    handleSaveTheme(defaultChartTheme);
    const resetHeights = defaultIndicatorHeights;
    setHeights(resetHeights);
    if (onSaveIndicatorHeights) onSaveIndicatorHeights(resetHeights);
  };

  const handleCreateNewTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    if (onSaveTemplate) {
      onSaveTemplate(newTemplateName.trim(), newTemplateDesc.trim());
      setSaveSuccessMsg(`✓ Шаблон "${newTemplateName.trim()}" успішно збережено!`);
      setNewTemplateName('');
      setNewTemplateDesc('');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    }
  };

  const handleCopyJSON = async () => {
    try {
      const exportData = JSON.stringify(templates, null, 2);
      await navigator.clipboard.writeText(exportData);
      setSaveSuccessMsg('✓ JSON шаблонів скопійовано в буфер обміну!');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (_) {}
  };

  const handleSaveImbalanceClick = () => {
    onSaveImbalance(ratio, minVol);
  };

  const handleConnectDirect = () => {
    onConnectMT5(mt5Path);
  };

  const handleInstallEAClick = () => {
    onInstallEA(mt5Path);
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 110 }}>
      <div
        className="modal-content"
        style={{ width: '740px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '15px' }}>
            <Sliders size={18} color="#00F59B" />
            Налаштування Терміналу DeltaORL
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8E9CAE', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #1E222D', paddingBottom: 10, marginBottom: 16 }}>
          <button
            onClick={() => setActiveTab('TEMPLATES')}
            style={{
              background: activeTab === 'TEMPLATES' ? '#232838' : 'transparent',
              color: activeTab === 'TEMPLATES' ? '#FFFFFF' : '#8E9CAE',
              border: activeTab === 'TEMPLATES' ? '1px solid #00F59B' : '1px solid transparent',
              borderRadius: '6px',
              padding: '8px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7
            }}
          >
            <Bookmark size={15} color="#00F59B" />
            Шаблони (Templates)
          </button>

          <button
            onClick={() => setActiveTab('APPEARANCE')}
            style={{
              background: activeTab === 'APPEARANCE' ? '#232838' : 'transparent',
              color: activeTab === 'APPEARANCE' ? '#FFFFFF' : '#8E9CAE',
              border: activeTab === 'APPEARANCE' ? '1px solid #3B82F6' : '1px solid transparent',
              borderRadius: '6px',
              padding: '8px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7
            }}
          >
            <Palette size={15} color="#3B82F6" />
            Графік, Свічки та Кастомізація
          </button>

          <button
            onClick={() => setActiveTab('MT5')}
            style={{
              background: activeTab === 'MT5' ? '#232838' : 'transparent',
              color: activeTab === 'MT5' ? '#FFFFFF' : '#8E9CAE',
              border: activeTab === 'MT5' ? '1px solid #00F59B' : '1px solid transparent',
              borderRadius: '6px',
              padding: '8px 14px',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7
            }}
          >
            <Database size={15} color="#00F59B" />
            MT5 та Дисбаланс
          </button>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
          {/* TAB 1: TEMPLATES (DELTA RIVER STYLE) */}
          {activeTab === 'TEMPLATES' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Notification Banner */}
              {saveSuccessMsg && (
                <div style={{
                  background: 'rgba(0, 245, 155, 0.12)',
                  border: '1px solid #00F59B',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  fontSize: '12px',
                  color: '#00F59B',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <CheckCircle size={16} />
                  {saveSuccessMsg}
                </div>
              )}

              {/* 1. Save Current View as New Template */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Bookmark size={15} color="#00F59B" />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF' }}>
                    Зберегти поточні налаштування як новий шаблон
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: 12 }}>
                  Зберігає весь поточний вигляд: кольори, свічки, Т-засічки, розміри кластерів, сітку та висоту індикаторів
                </div>

                <form onSubmit={handleCreateNewTemplate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="Назва шаблону (напр. Scalp EURUSD M5, My Order Flow)..."
                    style={{
                      flex: '1 1 240px',
                      background: '#131824',
                      border: '1px solid #232B3B',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: '#FFFFFF',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  <input
                    type="text"
                    value={newTemplateDesc}
                    onChange={(e) => setNewTemplateDesc(e.target.value)}
                    placeholder="Опис шаблону (опціонально)..."
                    style={{
                      flex: '1 1 200px',
                      background: '#131824',
                      border: '1px solid #232B3B',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: '#CBD5E1',
                      fontSize: '12px',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!newTemplateName.trim()}
                    style={{
                      background: newTemplateName.trim() ? '#00F59B' : '#1E2433',
                      color: newTemplateName.trim() ? '#07090E' : '#64748B',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 16px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: newTemplateName.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <Plus size={15} />
                    Зберегти шаблон
                  </button>
                </form>
              </div>

              {/* 2. Ready-to-Use Presets (Built-in) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 4 }}>
                  Готові професійні пресети Delta River & Quantower
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: 12 }}>
                  Класичні налаштовані робочі простори для аналізу об'ємів, скальпінгу та теплокарт
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                  {templates.filter(t => t.isBuiltIn).map(tpl => {
                    const isActive = activeTemplateId === tpl.id;
                    return (
                      <div
                        key={tpl.id}
                        style={{
                          background: isActive ? '#141E2E' : '#11141D',
                          border: isActive ? '1px solid #00F59B' : '1px solid #1E2536',
                          borderRadius: '6px',
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: isActive ? '#00F59B' : '#FFFFFF' }}>
                              {tpl.name}
                            </span>
                            {isActive && (
                              <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(0, 245, 155, 0.2)', color: '#00F59B', padding: '1px 6px', borderRadius: '4px' }}>
                                АКТИВНИЙ
                              </span>
                            )}
                          </div>
                          {tpl.description && (
                            <div style={{ fontSize: '11px', color: '#8E9CAE', marginTop: 2 }}>
                              {tpl.description}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => onApplyTemplate && onApplyTemplate(tpl)}
                          style={{
                            background: isActive ? '#1E293B' : '#00F59B',
                            color: isActive ? '#CBD5E1' : '#08090C',
                            border: 'none',
                            borderRadius: '5px',
                            padding: '6px 14px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {isActive ? 'Застосовано' : 'Застосувати'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. User Saved Custom Templates */}
              {templates.filter(t => !t.isBuiltIn).length > 0 && (
                <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 4 }}>
                    Мої збережені шаблони
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: 12 }}>
                    Створені вами конфігурації
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    {templates.filter(t => !t.isBuiltIn).map(tpl => {
                      const isActive = activeTemplateId === tpl.id;
                      return (
                        <div
                          key={tpl.id}
                          style={{
                            background: isActive ? '#141E2E' : '#11141D',
                            border: isActive ? '1px solid #00F59B' : '1px solid #1E2536',
                            borderRadius: '6px',
                            padding: '10px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '13px', fontWeight: 700, color: isActive ? '#00F59B' : '#FFFFFF' }}>
                                {tpl.name}
                              </span>
                              {isActive && (
                                <span style={{ fontSize: '9px', fontWeight: 700, background: 'rgba(0, 245, 155, 0.2)', color: '#00F59B', padding: '1px 6px', borderRadius: '4px' }}>
                                  АКТИВНИЙ
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '10px', color: '#64748B', marginTop: 2 }}>
                              {tpl.description || 'Користувацький шаблон'} • {new Date(tpl.createdAt).toLocaleString()}
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <button
                              onClick={() => onApplyTemplate && onApplyTemplate(tpl)}
                              style={{
                                background: isActive ? '#1E293B' : '#00F59B',
                                color: isActive ? '#CBD5E1' : '#08090C',
                                border: 'none',
                                borderRadius: '5px',
                                padding: '6px 12px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer'
                              }}
                            >
                              {isActive ? 'Застосовано' : 'Застосувати'}
                            </button>
                            <button
                              onClick={() => onDeleteTemplate && onDeleteTemplate(tpl.id)}
                              title="Видалити цей шаблон"
                              style={{
                                background: 'transparent',
                                border: '1px solid #334155',
                                color: '#EF4444',
                                borderRadius: '5px',
                                padding: '6px 8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 4. Export Templates JSON */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  onClick={handleCopyJSON}
                  style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    color: '#94A3B8',
                    borderRadius: '5px',
                    padding: '6px 12px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Copy size={13} />
                  Скопіювати JSON шаблонів
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: APPEARANCE (DETAILED DEEP CUSTOMIZATION) */}
          {activeTab === 'APPEARANCE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* 1. Свічки та Т-подібні засічки тіней (Candlesticks & Wicks) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 12 }}>
                  Свічки та Т-подібні засічки тіней (Candlesticks & Wicks)
                </div>

                {/* T-shaped Wick Caps Toggle (Delta River Style) */}
                <div style={{
                  background: '#131824',
                  border: '1px solid #232B3B',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12
                }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                      Т-подібні засічки на кінцях тіней (T-Wick Caps - Delta River style)
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#8896AB', marginTop: 2 }}>
                      Додає горизонтальні засічки на максимумі та мінімумі свічки, як у терміналі Delta River
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(theme.showWickCaps)}
                      onChange={(e) => handleSaveTheme({ ...theme, showWickCaps: e.target.checked })}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: theme.showWickCaps ? '#00F59B' : '#334155',
                      borderRadius: 22,
                      transition: '0.2s'
                    }}>
                      <span style={{
                        position: 'absolute',
                        left: theme.showWickCaps ? 20 : 3,
                        top: 3,
                        width: 16,
                        height: 16,
                        backgroundColor: '#FFFFFF',
                        borderRadius: '50%',
                        transition: '0.2s'
                      }}></span>
                    </span>
                  </label>
                </div>

                {/* Candle Coloring Mode: By Price vs By Delta (Delta River classic) */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 6 }}>
                    Режим забарвлення свічок:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleSaveTheme({ ...theme, candleColorMode: 'PRICE' })}
                      style={{
                        background: (theme.candleColorMode !== 'DELTA') ? '#1E293B' : '#11141D',
                        border: (theme.candleColorMode !== 'DELTA') ? '1px solid #00F59B' : '1px solid #1E2536',
                        color: (theme.candleColorMode !== 'DELTA') ? '#00F59B' : '#94A3B8',
                        padding: '7px 10px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      За ціною (Open vs Close)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveTheme({ ...theme, candleColorMode: 'DELTA' })}
                      style={{
                        background: (theme.candleColorMode === 'DELTA') ? '#1E293B' : '#11141D',
                        border: (theme.candleColorMode === 'DELTA') ? '1px solid #00F59B' : '1px solid #1E2536',
                        color: (theme.candleColorMode === 'DELTA') ? '#00F59B' : '#94A3B8',
                        padding: '7px 10px',
                        borderRadius: '5px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      За дельтою (Net Delta - Delta River)
                    </button>
                  </div>
                </div>

                {/* Sliders: Width, Gap, Wick Width, Wick Cap Width */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Ширина свічкового бару:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                        {theme.candlestickWidth ?? 8}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={22}
                      step={1}
                      value={theme.candlestickWidth ?? 8}
                      onChange={(e) => handleSaveTheme({ ...theme, candlestickWidth: parseInt(e.target.value, 10) })}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Відступ свічки від кластера:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                        {theme.candlestickGap ?? 5}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={14}
                      step={1}
                      value={theme.candlestickGap ?? 5}
                      onChange={(e) => handleSaveTheme({ ...theme, candlestickGap: parseInt(e.target.value, 10) })}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Товщина тіні свічки:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                        {theme.wickWidth ?? 1.5}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={0.5}
                      value={theme.wickWidth ?? 1.5}
                      onChange={(e) => handleSaveTheme({ ...theme, wickWidth: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>

                  {theme.showWickCaps && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <label style={{ fontSize: '11px', color: '#94A3B8' }}>Ширина Т-засічки на тінях:</label>
                        <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                          {theme.wickCapWidth ?? 4}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={2}
                        max={10}
                        step={1}
                        value={theme.wickCapWidth ?? 4}
                        onChange={(e) => handleSaveTheme({ ...theme, wickCapWidth: parseInt(e.target.value, 10) })}
                        style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                      />
                    </div>
                  )}
                </div>

                {/* Candle Colors */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                      Бичача свічка (Тіло & Тінь):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={theme.bullishCandleColor}
                        onChange={(e) => handleSaveTheme({ ...theme, bullishCandleColor: e.target.value })}
                        style={{ width: 34, height: 30, background: 'transparent', border: 'none', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: '#E2E8F0', fontFamily: 'monospace' }}>
                        {theme.bullishCandleColor}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                      Ведмежа свічка (Контур):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={theme.bearishCandleBorder}
                        onChange={(e) => handleSaveTheme({ ...theme, bearishCandleBorder: e.target.value })}
                        style={{ width: 34, height: 30, background: 'transparent', border: 'none', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: '#E2E8F0', fontFamily: 'monospace' }}>
                        {theme.bearishCandleBorder}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Стиль палітри гістограми об'ємів (Чорно-білий монохром vs Контрастний сталевий) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 4 }}>
                  Стиль гістограми об'ємів кластерів (Volume Histogram Palette)
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: 12 }}>
                  Оберіть стиль відображення градієнта об'єму для максимальної чіткості сприйняття
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {/* Option 1: Чорно-білий монохром */}
                  <div
                    onClick={() => handleSaveTheme({ ...theme, volumeHistogramPalette: 'MONOCHROME' })}
                    style={{
                      background: (theme.volumeHistogramPalette === 'MONOCHROME') ? '#161D2B' : '#0F1218',
                      border: (theme.volumeHistogramPalette === 'MONOCHROME') ? '2px solid #00F59B' : '1px solid #232B3B',
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#FFFFFF' }}>
                        Чорно-білий монохром
                      </span>
                      {theme.volumeHistogramPalette === 'MONOCHROME' && (
                        <Check size={16} color="#00F59B" />
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 26, background: '#08090C', padding: '3px 6px', borderRadius: '4px' }}>
                      <div style={{ width: '15%', height: '35%', background: '#1A1E27', borderRadius: '2px' }} />
                      <div style={{ width: '25%', height: '55%', background: '#2B3240', borderRadius: '2px' }} />
                      <div style={{ width: '35%', height: '80%', background: '#3F4859', borderRadius: '2px' }} />
                      <div style={{ width: '25%', height: '100%', background: '#596478', borderRight: '2px solid #FFFFFF', borderRadius: '2px' }} />
                    </div>
                    <span style={{ fontSize: '10.5px', color: '#8E9CAE', lineHeight: 1.3 }}>
                      Чіткі відтінки графіту та сталі з білим акцентом для пікових об'ємів (HVN).
                    </span>
                  </div>

                  {/* Option 2: Контрастний сталевий */}
                  <div
                    onClick={() => handleSaveTheme({ ...theme, volumeHistogramPalette: 'STEEL_BLUE' })}
                    style={{
                      background: (theme.volumeHistogramPalette === 'STEEL_BLUE') ? '#161D2B' : '#0F1218',
                      border: (theme.volumeHistogramPalette === 'STEEL_BLUE') ? '2px solid #00F59B' : '1px solid #232B3B',
                      borderRadius: '8px',
                      padding: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#FFFFFF' }}>
                        Контрастний сталевий
                      </span>
                      {theme.volumeHistogramPalette === 'STEEL_BLUE' && (
                        <Check size={16} color="#00F59B" />
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 26, background: '#08090C', padding: '3px 6px', borderRadius: '4px' }}>
                      <div style={{ width: '15%', height: '35%', background: '#141E2E', borderRadius: '2px' }} />
                      <div style={{ width: '25%', height: '55%', background: '#203049', borderRadius: '2px' }} />
                      <div style={{ width: '35%', height: '80%', background: '#2E4466', borderRadius: '2px' }} />
                      <div style={{ width: '25%', height: '100%', background: '#3D5E8C', borderRight: '2px solid #60A5FA', borderRadius: '2px' }} />
                    </div>
                    <span style={{ fontSize: '10.5px', color: '#8E9CAE', lineHeight: 1.3 }}>
                      Сучасна теплокарта в сталево-синіх тонах з блакитним підсвічуванням піків.
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Кластери, числа та дисбаланси (Clusters, Numbers & Imbalances) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 12 }}>
                  Кластери, числа та вигляд гістограми
                </div>

                {/* Numbers inside clusters toggle */}
                <div style={{
                  background: '#131824',
                  border: '1px solid #232B3B',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12
                }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                      Числові значення в кластерах (Numbers Inside Clusters)
                    </div>
                    <div style={{ fontSize: '10.5px', color: '#8896AB', marginTop: 2 }}>
                      Увімкніть для перегляду точних чисел об'ємів або вимкніть для чистої форми теплокарти
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={theme.showClusterNumbers}
                      onChange={(e) => handleSaveTheme({ ...theme, showClusterNumbers: e.target.checked })}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: theme.showClusterNumbers ? '#00F59B' : '#334155',
                      borderRadius: 22,
                      transition: '0.2s'
                    }}>
                      <span style={{
                        position: 'absolute',
                        left: theme.showClusterNumbers ? 20 : 3,
                        top: 3,
                        width: 16,
                        height: 16,
                        backgroundColor: '#FFFFFF',
                        borderRadius: '50%',
                        transition: '0.2s'
                      }}></span>
                    </span>
                  </label>
                </div>

                {/* Font Size Selector */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 6 }}>
                    Розмір шрифту чисел у кластерах:
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {(['SMALL', 'MEDIUM', 'LARGE'] as ClusterFontSize[]).map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => handleSaveTheme({ ...theme, clusterFontSize: size })}
                        style={{
                          background: (theme.clusterFontSize === size || (!theme.clusterFontSize && size === 'MEDIUM')) ? '#1E293B' : '#11141D',
                          border: (theme.clusterFontSize === size || (!theme.clusterFontSize && size === 'MEDIUM')) ? '1px solid #00F59B' : '1px solid #1E2536',
                          color: (theme.clusterFontSize === size || (!theme.clusterFontSize && size === 'MEDIUM')) ? '#00F59B' : '#94A3B8',
                          padding: '6px 10px',
                          borderRadius: '5px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {size === 'SMALL' ? 'Дрібний (8px)' : (size === 'MEDIUM' ? 'Звичайний (10px)' : 'Великий (11.5px)')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Rounding & Opacity sliders */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Заокруглення країв смуг гістограми:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                        {theme.clusterBarRounding ?? 0}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={6}
                      step={1}
                      value={theme.clusterBarRounding ?? 0}
                      onChange={(e) => handleSaveTheme({ ...theme, clusterBarRounding: parseInt(e.target.value, 10) })}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Прозорість заливки гістограми:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>
                        {Math.round((theme.clusterBarOpacity ?? 1.0) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.3}
                      max={1.0}
                      step={0.05}
                      value={theme.clusterBarOpacity ?? 1.0}
                      onChange={(e) => handleSaveTheme({ ...theme, clusterBarOpacity: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                {/* Diagonal Imbalances and Value Area */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontSize: '11.5px', color: '#FFFFFF', fontWeight: 600 }}>
                      Підсвічування дисбалансів (Imbalances)
                    </span>
                    <input
                      type="checkbox"
                      checked={theme.showImbalanceHighlights !== false}
                      onChange={(e) => handleSaveTheme({ ...theme, showImbalanceHighlights: e.target.checked })}
                      style={{ accentColor: '#00F59B', cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </div>

                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{ fontSize: '11.5px', color: '#FFFFFF', fontWeight: 600 }}>
                      Підсвічувати Value Area (VA 70%)
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(theme.showClusterValueArea)}
                      onChange={(e) => handleSaveTheme({ ...theme, showClusterValueArea: e.target.checked })}
                      style={{ accentColor: '#00F59B', cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </div>
                </div>

                {/* Colors: Buyers, Sellers */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                      Покупці (Ask Volume):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={theme.clusterBuyerColor}
                        onChange={(e) => handleSaveTheme({ ...theme, clusterBuyerColor: e.target.value })}
                        style={{ width: 34, height: 30, background: 'transparent', border: 'none', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: '#72F0BC', fontFamily: 'monospace' }}>
                        {theme.clusterBuyerColor}
                      </span>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                      Продавці (Bid Volume):
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={theme.clusterSellerColor}
                        onChange={(e) => handleSaveTheme({ ...theme, clusterSellerColor: e.target.value })}
                        style={{ width: 34, height: 30, background: 'transparent', border: 'none', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '12px', color: '#FFA0AC', fontFamily: 'monospace' }}>
                        {theme.clusterSellerColor}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 4. Рівні максимального об'єму (POC) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 12 }}>
                  Відображення рівнів максимального об'єму (POC)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {/* Toggle 1: POC в кластерах */}
                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                        POC у кластерах свічок
                      </div>
                      <div style={{ fontSize: '10px', color: '#8896AB', marginTop: 2 }}>
                        Золота рамка максимального об'єму свічки
                      </div>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={theme.showClusterPOC !== false}
                        onChange={(e) => handleSaveTheme({ ...theme, showClusterPOC: e.target.checked })}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: (theme.showClusterPOC !== false) ? '#00F59B' : '#334155',
                        borderRadius: 22,
                        transition: '0.2s'
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: (theme.showClusterPOC !== false) ? 20 : 3,
                          top: 3,
                          width: 16,
                          height: 16,
                          backgroundColor: '#FFFFFF',
                          borderRadius: '50%',
                          transition: '0.2s'
                        }}></span>
                      </span>
                    </label>
                  </div>

                  {/* Toggle 2: POC у горизонтальному профілі */}
                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                        POC у гориз. об'ємах
                      </div>
                      <div style={{ fontSize: '10px', color: '#8896AB', marginTop: 2 }}>
                        Золота лінія та виділення рівня профілю
                      </div>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={theme.showHorizontalPOC !== false}
                        onChange={(e) => handleSaveTheme({ ...theme, showHorizontalPOC: e.target.checked })}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: (theme.showHorizontalPOC !== false) ? '#00F59B' : '#334155',
                        borderRadius: 22,
                        transition: '0.2s'
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: (theme.showHorizontalPOC !== false) ? 20 : 3,
                          top: 3,
                          width: 16,
                          height: 16,
                          backgroundColor: '#FFFFFF',
                          borderRadius: '50%',
                          transition: '0.2s'
                        }}></span>
                      </span>
                    </label>
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                    Колір POC (Золотий):
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={theme.clusterPOCColor}
                      onChange={(e) => handleSaveTheme({ ...theme, clusterPOCColor: e.target.value })}
                      style={{ width: 34, height: 30, background: 'transparent', border: 'none', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '12px', color: '#FFB800', fontFamily: 'monospace' }}>
                      {theme.clusterPOCColor}
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Сітка графіка, фон та таймери (Grid & Canvas) */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 12 }}>
                  Сітка графіка, фон та таймери (Canvas & Grid)
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  {/* Grid Toggle */}
                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                        Сітка графіка (Price & Time Grid)
                      </div>
                      <div style={{ fontSize: '10px', color: '#8896AB', marginTop: 2 }}>
                        Координатні лінії цін та свічок
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(theme.showGrid)}
                      onChange={(e) => handleSaveTheme({ ...theme, showGrid: e.target.checked })}
                      style={{ accentColor: '#00F59B', cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </div>

                  {/* Countdown Timer Toggle */}
                  <div style={{
                    background: '#131824',
                    border: '1px solid #232B3B',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#FFFFFF' }}>
                        Таймер закриття свічки
                      </div>
                      <div style={{ fontSize: '10px', color: '#8896AB', marginTop: 2 }}>
                        Убуваючий таймер на шкалі біля ціни
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={theme.showCountdownTimer !== false}
                      onChange={(e) => handleSaveTheme({ ...theme, showCountdownTimer: e.target.checked })}
                      style={{ accentColor: '#00F59B', cursor: 'pointer', width: 16, height: 16 }}
                    />
                  </div>
                </div>

                {/* Grid Style Selector */}
                {theme.showGrid && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: 4 }}>
                      Стиль ліній сітки:
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                      {(['DASHED', 'DOTTED', 'SOLID'] as GridLineStyle[]).map(style => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => handleSaveTheme({ ...theme, gridStyle: style })}
                          style={{
                            background: (theme.gridStyle === style || (!theme.gridStyle && style === 'DASHED')) ? '#1E293B' : '#11141D',
                            border: (theme.gridStyle === style || (!theme.gridStyle && style === 'DASHED')) ? '1px solid #00F59B' : '1px solid #1E2536',
                            color: (theme.gridStyle === style || (!theme.gridStyle && style === 'DASHED')) ? '#00F59B' : '#94A3B8',
                            padding: '6px 10px',
                            borderRadius: '5px',
                            fontSize: '11px',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }}
                        >
                          {style === 'DASHED' ? 'Пунктирна' : (style === 'DOTTED' ? 'Крапкова' : 'Суцільна')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 6. Регулювання розмірів / висоти індикаторів на екрані */}
              <div style={{ background: '#0D111A', border: '1px solid #1E293B', borderRadius: '8px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#FFFFFF', marginBottom: 12 }}>
                  Регулювання висоти панелей індикаторів (px)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Вертикальний об'єм (Volume):</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>{heights.volume}px</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={140}
                      step={2}
                      value={heights.volume}
                      onChange={(e) => handleUpdateHeight('volume', parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>CVD (Кумулятивна дельта):</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>{heights.cvd}px</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={140}
                      step={2}
                      value={heights.cvd}
                      onChange={(e) => handleUpdateHeight('cvd', parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>RSI (Індекс сили):</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>{heights.rsi}px</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={140}
                      step={2}
                      value={heights.rsi}
                      onChange={(e) => handleUpdateHeight('rsi', parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <label style={{ fontSize: '11px', color: '#94A3B8' }}>Stochastic Oscillator:</label>
                      <span style={{ fontSize: '11px', color: '#00F59B', fontFamily: 'monospace', fontWeight: 700 }}>{heights.stoch}px</span>
                    </div>
                    <input
                      type="range"
                      min={35}
                      max={140}
                      step={2}
                      value={heights.stoch}
                      onChange={(e) => handleUpdateHeight('stoch', parseInt(e.target.value, 10))}
                      style={{ width: '100%', accentColor: '#00F59B', cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </div>

              {/* Reset to Default */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button
                  onClick={handleResetTheme}
                  className="btn-pill"
                  style={{
                    background: '#1E2433',
                    border: '1px solid #334155',
                    color: '#94A3B8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <RotateCcw size={13} />
                  Скинути всі налаштування за замовчуванням
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: MT5 DIRECT & IMBALANCE */}
          {activeTab === 'MT5' && (
            <div>
              {/* Live MT5 Connection Status Banner */}
              <div style={{
                background: isMT5Connected ? 'rgba(0, 245, 155, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                border: isMT5Connected ? '1px solid #00F59B' : '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: isMT5Connected ? '#00F59B' : '#EF4444',
                    boxShadow: isMT5Connected ? '0 0 8px #00F59B' : 'none'
                  }}></span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: isMT5Connected ? '#00F59B' : '#F87171' }}>
                      {isMT5Connected ? 'MT5 ПІДКЛЮЧЕНО (LIVE СТРІМІНГ ТІКІВ)' : 'MT5 НЕ ПІДКЛЮЧЕНО'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      {isMT5Connected
                        ? `Брокер: ${brokerInfo || 'MetaQuotes'} | Потік: ${ticksPerSec.toFixed(1)} тіків/сек | Свічки формуються в реальному часі`
                        : 'Вкажіть шлях до terminal64.exe та натисніть "Підключити MT5 Direct"'}
                    </div>
                  </div>
                </div>
                {isMT5Connected && (
                  <span style={{ fontSize: '11px', background: '#00F59B', color: '#07090E', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>
                    ONLINE
                  </span>
                )}
              </div>

              {/* MT5 Direct Connection */}
              <div style={{ background: '#0D111A', padding: '14px', borderRadius: '8px', border: '1px solid #1E293B', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '8px' }}>
                  <Zap size={15} color="#00F59B" />
                  <strong style={{ fontSize: '13px', color: '#E2E8F0' }}>
                    Пряме підключення до MetaTrader 5 (MT5 Direct)
                  </strong>
                </div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                  Термінал бере котирування напряму через високошвидкісний IPC-інтерфейс terminal64.exe.
                </p>

                {/* Detected Terminals Auto-Suggest */}
                {detectedTerminals.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '6px' }}>
                      Знайдені термінали на комп'ютері:
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {detectedTerminals.map(term => (
                        <button
                          key={term.id}
                          onClick={() => setMt5Path(term.path)}
                          style={{
                            background: mt5Path === term.path ? 'rgba(0, 245, 155, 0.1)' : '#161B26',
                            border: mt5Path === term.path ? '1px solid #00F59B' : '1px solid #232C3D',
                            color: mt5Path === term.path ? '#00F59B' : '#E2E8F0',
                            borderRadius: '6px',
                            padding: '6px 10px',
                            textAlign: 'left',
                            fontSize: '11px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}
                        >
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            📁 {term.path}
                          </span>
                          {term.servers.length > 0 && (
                            <span style={{ color: '#8E9CAE', fontSize: '10px' }}>{term.servers[0]}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="input-field"
                    value={mt5Path}
                    onChange={(e) => setMt5Path(e.target.value)}
                    placeholder="C:\Program Files\MetaTrader 5\terminal64.exe"
                    style={{ flex: 1, fontSize: '12px' }}
                  />
                  <button
                    onClick={handleConnectDirect}
                    className="btn-pill"
                    style={{ background: '#00F59B', color: '#07090E', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                  >
                    Підключити MT5
                  </button>
                </div>

                {loadStatus && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: loadStatus.includes('✓') ? '#00F59B' : '#F87171' }}>
                    {loadStatus}
                  </div>
                )}
              </div>

              {/* Install EA Bridge */}
              <div style={{ background: '#0D111A', padding: '14px', borderRadius: '8px', border: '1px solid #1E293B', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '8px' }}>
                  <Download size={15} color="#00F59B" />
                  <strong style={{ fontSize: '13px', color: '#E2E8F0' }}>
                    Встановлення радника DeltaBridge (Alternative)
                  </strong>
                </div>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 10px 0', lineHeight: 1.4 }}>
                  Встановлює радник `DeltaBridge.mq5` у папку `MQL5/Experts` обраного терміналу.
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={handleInstallEAClick}
                    className="btn-pill"
                    style={{ background: '#1A2333', color: '#00F59B', border: '1px solid #00F59B', fontWeight: 'bold', fontSize: '11.5px', padding: '6px 14px' }}
                  >
                    Встановити DeltaBridge.mq5 в термінал
                  </button>
                </div>
                {eaInstallStatus && (
                  <div style={{ marginTop: '10px', fontSize: '12px', color: eaInstallStatus.includes('✓') ? '#00F59B' : '#F87171' }}>
                    {eaInstallStatus}
                  </div>
                )}
              </div>

              {/* Imbalance Settings */}
              <div style={{ background: '#0D111A', padding: '14px', borderRadius: '8px', border: '1px solid #1E293B' }}>
                <strong style={{ fontSize: '13px', color: '#E2E8F0', display: 'block', marginBottom: '8px' }}>
                  Налаштування виявлення дисбалансів (Imbalance Ratio)
                </strong>
                <p style={{ fontSize: '11px', color: '#94A3B8', margin: '0 0 12px 0' }}>
                  Визначає співвідношення діагональних об'ємів Ask/Bid для підсвічування аномальної активності.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>
                      Співвідношення (Ratio):
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="1.5"
                      max="10.0"
                      className="input-field"
                      value={ratio}
                      onChange={(e) => setRatio(parseFloat(e.target.value) || 3.0)}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}>
                      Мін. об'єм (Min Volume):
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      className="input-field"
                      value={minVol}
                      onChange={(e) => setMinVol(parseFloat(e.target.value) || 1.0)}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <button
                  onClick={handleSaveImbalanceClick}
                  className="btn-pill"
                  style={{ background: '#00F59B', color: '#07090E', fontWeight: 'bold', fontSize: '11.5px', padding: '6px 14px' }}
                >
                  Зберегти параметри дисбалансу
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
