import type { ChartThemeSettings } from '../types';

export function getProfileColors(theme: ChartThemeSettings): { buyer: string; seller: string } {
  if (theme.volumeHistogramPalette === 'MONOCHROME') return { buyer: '#FFFFFF', seller: '#181C26' };
  if (theme.volumeHistogramPalette === 'STEEL_BLUE') return { buyer: '#527EAD', seller: '#2B4564' };
  if (theme.volumeHistogramPalette === 'BLACK') return { buyer: '#727985', seller: '#343943' };
  return { buyer: theme.volumeDeltaBuyerColor || '#228B68', seller: theme.volumeDeltaSellerColor || '#A62639' };
}

export function applySharedVolumeColors(
  theme: ChartThemeSettings,
  buyerColor = theme.volumeDeltaBuyerColor || '#228B68',
  sellerColor = theme.volumeDeltaSellerColor || '#A62639'
): ChartThemeSettings {
  const isBlack = theme.volumeHistogramPalette === 'BLACK';
  const activeBuyerColor = isBlack ? '#818995' : theme.volumeHistogramPalette === 'MONOCHROME' ? '#FFFFFF'
    : theme.volumeHistogramPalette === 'STEEL_BLUE' ? '#60A5FA' : buyerColor;
  const activeSellerColor = isBlack ? '#414852' : theme.volumeHistogramPalette === 'MONOCHROME' ? '#181C26'
    : theme.volumeHistogramPalette === 'STEEL_BLUE' ? '#27354A' : sellerColor;
  return {
    ...theme,
    ...(isBlack ? {
      bullishCandleColor: '#C4CAD2',
      bearishCandleColor: '#626A76',
      bearishCandleBorder: '#626A76'
    } : {}),
    volumeDeltaBuyerColor: buyerColor, volumeDeltaSellerColor: sellerColor,
    clusterBuyerColor: activeBuyerColor, clusterSellerColor: activeSellerColor,
    buyImbalanceColor: activeBuyerColor, sellImbalanceColor: activeSellerColor,
    horizontalBuyerColor: activeBuyerColor, horizontalSellerColor: activeSellerColor,
    verticalBuyerColor: activeBuyerColor, verticalSellerColor: activeSellerColor
  };
}

export function getDeltaCellColor(
  delta: number,
  theme: Partial<Pick<ChartThemeSettings, 'volumeDeltaBuyerColor' | 'volumeDeltaSellerColor'>>
): string | null {
  if (delta > 0) return theme.volumeDeltaBuyerColor || '#228B68';
  if (delta < 0) return theme.volumeDeltaSellerColor || '#A62639';
  return null;
}
