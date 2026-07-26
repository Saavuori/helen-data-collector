import {
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import { createContext, useContext } from 'react';

/** Helen blue, expanded into a Fluent brand ramp. */
const brand: BrandVariants = {
  10: '#04161B',
  20: '#062730',
  30: '#073745',
  40: '#08485A',
  50: '#095A6F',
  60: '#0A6C85',
  70: '#0B7F9B',
  80: '#0C92B2',
  90: '#0DA5C9',
  100: '#11B9DE',
  110: '#22D3EE',
  120: '#3EDDF3',
  130: '#5FE5F6',
  140: '#86EDF9',
  150: '#B0F3FA',
  160: '#D9F9FD',
};

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", ' +
  'Roboto, "Helvetica Neue", Arial, sans-serif';

/** Every colour the app paints with. Both themes expose the same keys so
 *  components can stay theme-agnostic. */
export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;
  /** Translucent backdrop for the sticky app bar / tab bar. */
  glass: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  /** Series colours — energy, spot price, cost. Tuned per theme so the
   *  chart keeps its contrast on both backgrounds. */
  energy: string;
  spot: string;
  cost: string;
  energySoft: string;
  spotSoft: string;
  costSoft: string;
  positive: string;
  negative: string;
  grid: string;
  shadowCard: string;
  shadowRaised: string;
  tooltipBg: string;
}

const dark: Palette = {
  scheme: 'dark',
  bg: '#080A0F',
  glass: 'rgba(8, 10, 15, 0.72)',
  surface: '#11141C',
  surfaceAlt: '#181D27',
  border: '#232936',
  borderStrong: '#333B4C',
  text: '#EAEEF5',
  textMuted: '#98A2B5',
  textFaint: '#6B7488',
  energy: '#22D3EE',
  spot: '#F0B429',
  cost: '#A78BFA',
  energySoft: 'rgba(34, 211, 238, 0.14)',
  spotSoft: 'rgba(240, 180, 41, 0.14)',
  costSoft: 'rgba(167, 139, 250, 0.14)',
  positive: '#4ADE80',
  negative: '#F87171',
  grid: 'rgba(255, 255, 255, 0.06)',
  shadowCard: '0 1px 2px rgba(0, 0, 0, 0.4)',
  shadowRaised: '0 12px 32px -16px rgba(0, 0, 0, 0.9)',
  tooltipBg: 'rgba(17, 20, 28, 0.96)',
};

const light: Palette = {
  scheme: 'light',
  bg: '#F2F5F9',
  glass: 'rgba(242, 245, 249, 0.8)',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF1F7',
  border: '#DFE5EE',
  borderStrong: '#C7D0DE',
  text: '#0C1119',
  textMuted: '#576076',
  textFaint: '#858FA3',
  energy: '#0E7490',
  spot: '#B57F04',
  cost: '#6D45E8',
  energySoft: 'rgba(14, 116, 144, 0.10)',
  spotSoft: 'rgba(181, 127, 4, 0.10)',
  costSoft: 'rgba(109, 69, 232, 0.10)',
  positive: '#15803D',
  negative: '#DC2626',
  grid: 'rgba(12, 17, 25, 0.07)',
  shadowCard: '0 1px 2px rgba(12, 17, 25, 0.05)',
  shadowRaised: '0 12px 32px -16px rgba(12, 17, 25, 0.35)',
  tooltipBg: 'rgba(255, 255, 255, 0.98)',
};

export const PALETTES = { dark, light } as const;

/** Fluent's own tokens are re-pointed at the palette so its inputs, switches
 *  and message bars sit flush with the hand-rolled surfaces. */
const applyToFluent = (base: Theme, p: Palette): Theme => ({
  ...base,
  fontFamilyBase: FONT_FAMILY,
  colorNeutralBackground1: p.surface,
  colorNeutralBackground2: p.surfaceAlt,
  colorNeutralBackground3: p.surfaceAlt,
  colorNeutralForeground1: p.text,
  colorNeutralForeground2: p.text,
  colorNeutralForeground3: p.textMuted,
  colorNeutralForeground4: p.textFaint,
  colorNeutralStroke1: p.borderStrong,
  colorNeutralStroke2: p.border,
  colorNeutralStroke3: p.border,
});

export const darkTheme: Theme = {
  ...applyToFluent(createDarkTheme(brand), dark),
  // The generated dark ramp picks a brand foreground that is too dim on our
  // near-black background.
  colorBrandForeground1: brand[110],
  colorBrandForeground2: brand[120],
};

export const lightTheme: Theme = applyToFluent(createLightTheme(brand), light);

/** Mirror the palette onto CSS custom properties so plain CSS (and Griffel
 *  rules, which are static) can reference the active theme. */
export function applyPaletteToDocument(p: Palette) {
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--glass': p.glass,
    '--surface': p.surface,
    '--surface-alt': p.surfaceAlt,
    '--border': p.border,
    '--border-strong': p.borderStrong,
    '--text': p.text,
    '--text-muted': p.textMuted,
    '--text-faint': p.textFaint,
    '--energy': p.energy,
    '--spot': p.spot,
    '--cost': p.cost,
    '--energy-soft': p.energySoft,
    '--spot-soft': p.spotSoft,
    '--cost-soft': p.costSoft,
    '--positive': p.positive,
    '--negative': p.negative,
    '--shadow-card': p.shadowCard,
    '--shadow-raised': p.shadowRaised,
  };
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
  root.dataset.theme = p.scheme;
  root.style.colorScheme = p.scheme;

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

const PaletteContext = createContext<Palette>(dark);
export const PaletteProvider = PaletteContext.Provider;

/** Colours for anything that can't go through CSS variables — Recharts props,
 *  inline SVG fills and the like. */
export const usePalette = () => useContext(PaletteContext);
