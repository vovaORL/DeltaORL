import React from 'react';
import { DOMTuple } from '../types';

interface DOMWidgetProps {
  dom: DOMTuple[];
  tickSize: number;
}

export const DOMWidget: React.FC<DOMWidgetProps> = ({ dom, tickSize }) => {
  // Sort into asks (descending) and bids (descending)
  const asks = dom.filter(d => d[2] === 2).sort((a, b) => b[0] - a[0]);
  const bids = dom.filter(d => d[2] === 1).sort((a, b) => b[0] - a[0]);

  let maxVol = 1.0;
  dom.forEach(d => {
    if (d[1] > maxVol) maxVol = d[1];
  });

  return (
    <div className="sidebar-tab">
      <div className="sidebar-title">
        <span>Depth of Market (DOM)</span>
        <span style={{ fontSize: '10px', color: '#546274' }}>L2 ORDERBOOK</span>
      </div>

      <div style={{
        display: 'flex',
        padding: '4px 10px',
        fontSize: '10px',
        color: '#546274',
        borderBottom: '1px solid #1A2333',
        fontFamily: 'JetBrains Mono, monospace'
      }}>
        <span style={{ width: '80px' }}>PRICE</span>
        <span style={{ flex: 1, textAlign: 'right' }}>LIQUIDITY</span>
      </div>

      <div className="dom-ladder">
        {/* Asks (Sells) */}
        {asks.map((a, i) => {
          const barWidth = Math.min(100, (a[1] / maxVol) * 100);
          return (
            <div key={`ask-${i}`} className="dom-row ask">
              <div className="dom-bar" style={{ width: `${barWidth}%` }} />
              <span className="dom-price" style={{ color: '#00F59B' }}>
                {a[0].toFixed(tickSize < 0.001 ? 5 : 2)}
              </span>
              <span className="dom-vol">{a[1].toFixed(1)}</span>
            </div>
          );
        })}

        {/* Spread Divider */}
        {asks.length > 0 && bids.length > 0 && (
          <div style={{
            padding: '4px 10px',
            background: 'rgba(21, 29, 44, 0.7)',
            textAlign: 'center',
            fontSize: '10px',
            color: '#8E9CAE',
            fontFamily: 'JetBrains Mono, monospace'
          }}>
            SPREAD: {Math.abs(asks[asks.length - 1][0] - bids[0][0]).toFixed(tickSize < 0.001 ? 5 : 2)}
          </div>
        )}

        {/* Bids (Buys) */}
        {bids.map((b, i) => {
          const barWidth = Math.min(100, (b[1] / maxVol) * 100);
          return (
            <div key={`bid-${i}`} className="dom-row bid">
              <div className="dom-bar" style={{ width: `${barWidth}%` }} />
              <span className="dom-price" style={{ color: '#FF3366' }}>
                {b[0].toFixed(tickSize < 0.001 ? 5 : 2)}
              </span>
              <span className="dom-vol">{b[1].toFixed(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
