import React, { useState } from 'react';
import { LiveTick } from '../types';
import { Filter } from 'lucide-react';

interface TimeAndSalesProps {
  ticks: LiveTick[];
  tickSize: number;
}

export const TimeAndSales: React.FC<TimeAndSalesProps> = ({ ticks, tickSize }) => {
  const [minVolume, setMinVolume] = useState<number>(0);

  const filteredTicks = ticks.filter(t => t.v >= minVolume);

  return (
    <div className="sidebar-tab">
      <div className="sidebar-title">
        <span>Time & Sales (Tape)</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Filter size={11} color="#546274" />
          <select
            className="select-box"
            style={{ padding: '2px 6px', fontSize: '10px', height: '22px' }}
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value))}
          >
            <option value={0}>Всі угоди</option>
            <option value={2}>&gt; 2.0</option>
            <option value={5}>&gt; 5.0 (Big)</option>
            <option value={10}>&gt; 10.0 (Whale)</option>
          </select>
        </div>
      </div>

      {/* Table Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '55px 75px 60px 45px',
        padding: '4px 10px',
        fontSize: '10px',
        color: '#546274',
        borderBottom: '1px solid #1A2333',
        fontFamily: 'JetBrains Mono, monospace'
      }}>
        <span>TIME</span>
        <span>PRICE</span>
        <span style={{ textAlign: 'right' }}>SIZE</span>
        <span style={{ textAlign: 'right' }}>SIDE</span>
      </div>

      {/* Tape Rows */}
      <div className="tape-list">
        {filteredTicks.slice(0, 50).map((t, index) => {
          const date = new Date(t.t);
          const timeStr = `${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(Math.floor(date.getMilliseconds() / 100))}`;
          const isBuy = t.s === 1;
          const isBig = t.v >= 5.0;

          return (
            <div
              key={`${t.t}-${index}`}
              className={`tape-row ${isBuy ? 'buy' : 'sell'} ${isBig ? 'big-trade' : ''}`}
            >
              <span>{timeStr}</span>
              <span style={{ fontWeight: 600 }}>{t.p.toFixed(tickSize < 0.001 ? 5 : 2)}</span>
              <span style={{ textAlign: 'right', fontWeight: isBig ? 700 : 400 }}>{t.v.toFixed(1)}</span>
              <span style={{ textAlign: 'right', fontSize: '10px' }}>{isBuy ? 'BUY' : 'SELL'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
