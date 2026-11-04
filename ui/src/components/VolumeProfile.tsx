import React from 'react';
import { VolumeProfileLevel } from '../types';

interface VolumeProfileProps {
  levels: VolumeProfileLevel[];
  tickSize: number;
}

export const VolumeProfile: React.FC<VolumeProfileProps> = ({ levels, tickSize }) => {
  // Sort descending by price
  const sorted = [...levels].sort((a, b) => b[0] - a[0]);

  let maxTotal = 1.0;
  let pocPrice = 0;
  let pocMax = 0;

  sorted.forEach(lvl => {
    const tot = lvl[1] + lvl[2];
    if (tot > maxTotal) {
      maxTotal = tot;
      pocPrice = lvl[0];
      pocMax = tot;
    }
  });

  return (
    <div className="sidebar-tab">
      <div className="sidebar-title">
        <span>Session Volume Profile</span>
        <span style={{ fontSize: '10px', color: '#FFB800' }}>
          POC: {pocPrice ? pocPrice.toFixed(tickSize < 0.001 ? 5 : 2) : '-'}
        </span>
      </div>

      <div style={{
        display: 'flex',
        padding: '4px 10px',
        fontSize: '10px',
        color: '#546274',
        borderBottom: '1px solid #1A2333',
        fontFamily: 'JetBrains Mono, monospace'
      }}>
        <span style={{ width: '65px' }}>PRICE</span>
        <span style={{ flex: 1 }}>BID / ASK DISTRIBUTION</span>
        <span style={{ textAlign: 'right' }}>TOTAL</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sorted.map((lvl, index) => {
          const price = lvl[0];
          const bid = lvl[1];
          const ask = lvl[2];
          const total = bid + ask;
          const isPOC = Math.abs(price - pocPrice) < (tickSize * 0.5);

          const bidW = Math.min(60, (bid / maxTotal) * 60);
          const askW = Math.min(60, (ask / maxTotal) * 60);

          return (
            <div
              key={`prof-${index}`}
              className="profile-row"
              style={{
                backgroundColor: isPOC ? 'rgba(255, 184, 0, 0.08)' : 'transparent',
                borderLeft: isPOC ? '2px solid #FFB800' : 'none'
              }}
            >
              <span className="profile-price" style={{ color: isPOC ? '#FFB800' : undefined, fontWeight: isPOC ? 700 : 400 }}>
                {price.toFixed(tickSize < 0.001 ? 5 : 2)}
              </span>

              {/* Volume Bars */}
              <div style={{ position: 'relative', flex: 1, height: '14px', margin: '0 6px' }}>
                <div
                  className="profile-bid-bar"
                  style={{ width: `${bidW}px`, left: '0' }}
                />
                <div
                  className="profile-ask-bar"
                  style={{ width: `${askW}px`, left: `${bidW + 2}px` }}
                />
              </div>

              <span className="profile-total">
                {total.toFixed(0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
