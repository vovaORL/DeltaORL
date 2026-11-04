import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, TrendingUp, DollarSign, Activity, Globe, Flame, Layers } from 'lucide-react';

export interface SymbolItem {
  symbol: string;
  name: string;
  category: 'Forex' | 'Metals' | 'Crypto' | 'Indices' | 'Energy';
  description: string;
}

export const POPULAR_SYMBOLS: SymbolItem[] = [
  // Forex Majors
  { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'Forex', description: 'Основна валютна пара Єврозони' },
  { symbol: 'GBPUSD', name: 'Great Britain Pound / US Dollar', category: 'Forex', description: 'Британський фунт / Долар США' },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', category: 'Forex', description: 'Долар США / Японська єна' },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', category: 'Forex', description: 'Австралійський долар' },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', category: 'Forex', description: 'Долар США / Канадський долар' },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', category: 'Forex', description: 'Долар США / Швейцарський франк' },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', category: 'Forex', description: 'Новозеландський долар' },

  // Forex Crosses
  { symbol: 'EURGBP', name: 'Euro / British Pound', category: 'Forex', description: 'Євро / Британський фунт' },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', category: 'Forex', description: 'Євро / Японська єна' },
  { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', category: 'Forex', description: 'Британський фунт / Японська єна (Dragon)' },
  { symbol: 'EURAUD', name: 'Euro / Australian Dollar', category: 'Forex', description: 'Євро / Австралійський долар' },
  { symbol: 'EURCAD', name: 'Euro / Canadian Dollar', category: 'Forex', description: 'Євро / Канадський долар' },
  { symbol: 'EURCHF', name: 'Euro / Swiss Franc', category: 'Forex', description: 'Євро / Швейцарський франк' },
  { symbol: 'AUDJPY', name: 'Australian Dollar / Japanese Yen', category: 'Forex', description: 'Австралійський долар / Єна' },
  { symbol: 'CADJPY', name: 'Canadian Dollar / Japanese Yen', category: 'Forex', description: 'Канадський долар / Єна' },
  { symbol: 'CHFJPY', name: 'Swiss Franc / Japanese Yen', category: 'Forex', description: 'Франк / Єна' },
  { symbol: 'GBPAUD', name: 'British Pound / Australian Dollar', category: 'Forex', description: 'Фунт / Австралійський долар' },
  { symbol: 'GBPCAD', name: 'British Pound / Canadian Dollar', category: 'Forex', description: 'Фунт / Канадський долар' },
  { symbol: 'GBPCHF', name: 'British Pound / Swiss Franc', category: 'Forex', description: 'Фунт / Швейцарський франк' },

  // Metals
  { symbol: 'XAUUSD', name: 'Gold / US Dollar (Spot Gold)', category: 'Metals', description: 'Золото спот проти Долара' },
  { symbol: 'XAGUSD', name: 'Silver / US Dollar (Spot Silver)', category: 'Metals', description: 'Срібло спот проти Долара' },
  { symbol: 'XPTUSD', name: 'Platinum / US Dollar', category: 'Metals', description: 'Платина проти Долара' },
  { symbol: 'XPDUSD', name: 'Palladium / US Dollar', category: 'Metals', description: 'Паладій проти Долара' },
  { symbol: 'COPPER', name: 'High Grade Copper', category: 'Metals', description: 'Мідь' },

  // Crypto
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', category: 'Crypto', description: 'Головна криптовалюта Bitcoin' },
  { symbol: 'BTCUSDT', name: 'Bitcoin / Tether USDT', category: 'Crypto', description: 'BTC проти Tether спот/фючерс' },
  { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', category: 'Crypto', description: 'Ефіріум смарт-контракти' },
  { symbol: 'ETHUSDT', name: 'Ethereum / Tether USDT', category: 'Crypto', description: 'ETH проти Tether' },
  { symbol: 'SOLUSD', name: 'Solana / US Dollar', category: 'Crypto', description: 'Високошвидкісний блокчейн Solana' },
  { symbol: 'XRPUSD', name: 'Ripple / US Dollar', category: 'Crypto', description: 'Міжбанківські платежі Ripple' },
  { symbol: 'BNBUSD', name: 'Binance Coin / US Dollar', category: 'Crypto', description: 'BNB токен екосистеми' },
  { symbol: 'DOGEUSD', name: 'Dogecoin / US Dollar', category: 'Crypto', description: 'Dogecoin мем-коїн' },

  // Indices
  { symbol: 'US30', name: 'Wall Street 30 (Dow Jones)', category: 'Indices', description: '30 найбільших промислових гігантів США' },
  { symbol: 'US500', name: 'S&P 500 Index', category: 'Indices', description: '500 провідних публічних компаній США' },
  { symbol: 'NAS100', name: 'US Tech 100 (Nasdaq 100)', category: 'Indices', description: 'Топ-100 технологічних компаній' },
  { symbol: 'GER40', name: 'Germany 40 (DAX)', category: 'Indices', description: 'Головний фондовий індекс Німеччини' },
  { symbol: 'UK100', name: 'UK 100 (FTSE 100)', category: 'Indices', description: 'Британський фондовий індекс' },
  { symbol: 'JP225', name: 'Japan 225 (Nikkei)', category: 'Indices', description: 'Японський фондовий індекс' },
  { symbol: 'FRA40', name: 'France 40 (CAC)', category: 'Indices', description: 'Французький біржовий індекс' },
  { symbol: 'ESTX50', name: 'Euro Stoxx 50', category: 'Indices', description: '50 провідних компаній Єврозони' },

  // Energy & Commodities
  { symbol: 'USOIL', name: 'WTI Light Sweet Crude Oil', category: 'Energy', description: 'Американська легка сира нафта' },
  { symbol: 'UKOIL', name: 'Brent Crude Oil', category: 'Energy', description: 'Північноморська нафта сорту Brent' },
  { symbol: 'NGAS', name: 'Natural Gas Henry Hub', category: 'Energy', description: 'Природний газ Henry Hub' }
];

interface SymbolSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

export const SymbolSearchModal: React.FC<SymbolSearchModalProps> = ({
  isOpen,
  onClose,
  currentSymbol,
  onSelectSymbol
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [customSymbolInput, setCustomSymbolInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const filteredSymbols = useMemo(() => {
    const q = query.trim().toUpperCase();
    return POPULAR_SYMBOLS.filter(item => {
      const matchCat = selectedCategory === 'ALL' || item.category === selectedCategory;
      const matchQuery = !q || item.symbol.toUpperCase().includes(q) || item.name.toUpperCase().includes(q) || item.description.toUpperCase().includes(q);
      return matchCat && matchQuery;
    });
  }, [query, selectedCategory]);

  if (!isOpen) return null;

  const handleSelect = (sym: string) => {
    onSelectSymbol(sym.toUpperCase());
    onClose();
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customSymbolInput.trim()) {
      handleSelect(customSymbolInput.trim());
    } else if (filteredSymbols.length > 0) {
      handleSelect(filteredSymbols[0].symbol);
    }
  };

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Forex': return <DollarSign size={14} color="#00F59B" />;
      case 'Metals': return <Flame size={14} color="#FFB800" />;
      case 'Crypto': return <Activity size={14} color="#3B82F6" />;
      case 'Indices': return <TrendingUp size={14} color="#A855F7" />;
      case 'Energy': return <Flame size={14} color="#EF4444" />;
      default: return <Layers size={14} />;
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="modal-content"
        style={{ width: '680px', maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30,
              height: 30,
              borderRadius: 6,
              background: '#1A1D27',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Globe size={18} color="#00F59B" />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#FFFFFF' }}>Вибір Торгового Інструменту (Квантавер / MT5)</div>
              <div style={{ fontSize: '11px', color: '#8E9CAE' }}>Виберіть актив зі списку або введіть будь-який символ вашого брокера</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8E9CAE', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {/* Search Bar */}
        <div style={{ position: 'relative', marginTop: 8, marginBottom: 12 }}>
          <Search size={16} color="#64748B" style={{ position: 'absolute', left: 12, top: 12 }} />
          <input
            ref={inputRef}
            type="text"
            className="input-field"
            placeholder="Швидкий пошук символу... (напр. EUR, GOLD, BTC, US30, JPY)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (filteredSymbols.length > 0) {
                  handleSelect(filteredSymbols[0].symbol);
                } else if (query.trim()) {
                  handleSelect(query.trim());
                }
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
            style={{ paddingLeft: 38, height: 40, fontSize: '13px', width: '100%' }}
          />
        </div>

        {/* Categories Tab Bar */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, borderBottom: '1px solid #1E222D' }}>
          {[
            { id: 'ALL', label: 'Усі активи' },
            { id: 'Forex', label: 'Forex' },
            { id: 'Metals', label: 'Метали' },
            { id: 'Crypto', label: 'Криптовалюта' },
            { id: 'Indices', label: 'Індекси' },
            { id: 'Energy', label: 'Енергія / Сировина' }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                background: selectedCategory === cat.id ? '#232838' : 'transparent',
                color: selectedCategory === cat.id ? '#FFFFFF' : '#8E9CAE',
                border: selectedCategory === cat.id ? '1px solid #3B82F6' : '1px solid transparent',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: selectedCategory === cat.id ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Instruments List */}
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: '380px', marginTop: 10, paddingRight: 4 }}>
          {filteredSymbols.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: '#8E9CAE', fontSize: '13px' }}>
              <div>Інструментів не знайдено за запитом "{query}"</div>
              <div style={{ marginTop: 8, color: '#00F59B' }}>
                Ви можете ввести цей символ нижче як власний символ MT5:
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
              {filteredSymbols.map(item => {
                const isCurrent = item.symbol === currentSymbol;
                return (
                  <div
                    key={item.symbol}
                    onClick={() => handleSelect(item.symbol)}
                    style={{
                      background: isCurrent ? 'rgba(0, 245, 155, 0.1)' : '#10131A',
                      border: isCurrent ? '1px solid #00F59B' : '1px solid #1C202C',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      transition: 'background 0.15s, border-color 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrent) e.currentTarget.style.borderColor = '#3B82F6';
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrent) e.currentTarget.style.borderColor = '#1C202C';
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: isCurrent ? '#00F59B' : '#FFFFFF' }}>
                          {item.symbol}
                        </span>
                        <span style={{
                          fontSize: '10px',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          background: '#1A1E29',
                          color: '#94A3B8',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3
                        }}>
                          {getCategoryIcon(item.category)}
                          {item.category}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748B', marginTop: 2, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                        {item.name}
                      </div>
                    </div>
                    {isCurrent && (
                      <span style={{ fontSize: '11px', color: '#00F59B', fontWeight: 600 }}>АКТИВНИЙ</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom Symbol Input Bar at Bottom */}
        <form onSubmit={handleCustomSubmit} style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid #1E222D',
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '11px', color: '#8E9CAE', marginBottom: 4 }}>
              Або введіть нестандартний тікер вашого брокера (напр. EURUSD.r, XAUUSDm, US500.f, BTCUSDT):
            </div>
            <input
              type="text"
              className="input-field"
              placeholder="Введіть символ..."
              value={customSymbolInput}
              onChange={(e) => setCustomSymbolInput(e.target.value)}
              style={{ width: '100%', height: 36, fontSize: '12px', textTransform: 'uppercase' }}
            />
          </div>
          <button
            type="submit"
            className="btn-pill"
            style={{
              background: '#00F59B',
              color: '#08090C',
              fontWeight: 'bold',
              height: 36,
              alignSelf: 'flex-end',
              padding: '0 16px'
            }}
          >
            Підключити
          </button>
        </form>
      </div>
    </div>
  );
};

