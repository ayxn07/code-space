/**
 * Theme Mapper
 *
 * Maps a ThemePreset (from the main app) to bolt.diy's CSS custom properties.
 * Called at runtime — sets properties directly on document.documentElement.style
 * so they override the static SCSS defaults without a rebuild.
 */
import type { ThemePreset } from './presets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "#RRGGBB" → [r, g, b] */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Generate a hex color with alpha (00-FF suffix) */
function hexAlpha(hex: string, opacity: number): string {
  const alpha = Math.round((opacity / 100) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${alpha}`;
}

/** Lighten a hex color by mixing with white */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.min(255, Math.round(c + (255 - c) * amount));
  return `#${mix(r).toString(16).padStart(2, '0')}${mix(g).toString(16).padStart(2, '0')}${mix(b).toString(16).padStart(2, '0')}`;
}

/** Darken a hex color by mixing toward black */
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (c: number) => Math.max(0, Math.round(c * (1 - amount)));
  return `#${mix(r).toString(16).padStart(2, '0')}${mix(g).toString(16).padStart(2, '0')}${mix(b).toString(16).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Accent palette generator
// ---------------------------------------------------------------------------

/**
 * Generates a 50-950 palette from a single accent hex, mimicking the
 * hard-coded purple palette in uno.config.ts.
 */
function generateAccentPalette(hex: string) {
  return {
    50: lighten(hex, 0.92),
    100: lighten(hex, 0.85),
    200: lighten(hex, 0.70),
    300: lighten(hex, 0.55),
    400: lighten(hex, 0.30),
    500: hex,
    600: darken(hex, 0.15),
    700: darken(hex, 0.30),
    800: darken(hex, 0.45),
    900: darken(hex, 0.60),
    950: darken(hex, 0.78),
  };
}

// ---------------------------------------------------------------------------
// Core mapper
// ---------------------------------------------------------------------------

export interface ThemeMappingResult {
  /** 'dark' or 'light' — to set on data-theme attribute */
  mode: 'dark' | 'light';
  /** Map of CSS property name → value */
  vars: Record<string, string>;
}

/**
 * Determines whether a background color is "dark" by checking luminance.
 * Uses the relative luminance formula (ITU-R BT.709).
 */
function isDarkBackground(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

/**
 * Map a ThemePreset to the full set of CSS variables used by the fork.
 *
 * @param preset  The theme preset from the main app
 * @param preferDark  If provided, force dark/light mode. Otherwise auto-detect
 *                    from the preset's background color luminance.
 */
export function mapThemeToVars(
  preset: ThemePreset,
  preferDark?: boolean,
): ThemeMappingResult {
  const mode = preferDark ?? isDarkBackground(preset.background) ? 'dark' : 'light';
  const isLight = mode === 'light';

  // Build the accent palette from the preset's primary color
  const accent = generateAccentPalette(preset.primary);
  // Also build alpha variants of accent.500
  const accentAlpha = {
    10: hexAlpha(accent[500], 10),
    20: hexAlpha(accent[500], 20),
    30: hexAlpha(accent[500], 30),
  };

  const bg = isLight ? preset.backgroundLight : preset.background;
  const bgSecondary = isLight ? preset.secondaryLight : preset.secondary;
  const bgCard = isLight ? preset.cardLight : preset.card;
  const borderColor = isLight ? preset.borderLight : preset.border;
  const mutedFg = isLight ? preset.mutedForegroundLight : preset.mutedForeground;
  const sidebarBg = isLight ? preset.sidebarLight : preset.sidebar;

  const vars: Record<string, string> = {};

  // ── Background depths ──────────────────────────────────────────────
  vars['--bolt-elements-bg-depth-1'] = bg;
  vars['--bolt-elements-bg-depth-2'] = isLight ? '#f5f5f5' : bgSecondary;
  vars['--bolt-elements-bg-depth-3'] = isLight ? '#e5e5e5' : bgCard;
  vars['--bolt-elements-bg-depth-4'] = isLight
    ? hexAlpha('#808080', 5)
    : hexAlpha('#ffffff', 5);

  // ── Text colors ────────────────────────────────────────────────────
  vars['--bolt-elements-textPrimary'] = isLight ? '#0A0A0A' : '#FFFFFF';
  vars['--bolt-elements-textSecondary'] = isLight ? '#525252' : mutedFg;
  vars['--bolt-elements-textTertiary'] = isLight ? '#737373' : mutedFg;

  // ── Border ─────────────────────────────────────────────────────────
  vars['--bolt-elements-borderColor'] = isLight
    ? hexAlpha('#808080', 10)
    : hexAlpha('#ffffff', 10);
  vars['--bolt-elements-borderColorActive'] = accent[500];

  // ── Code blocks ────────────────────────────────────────────────────
  vars['--bolt-elements-code-background'] = isLight ? '#F5F5F5' : bgCard;
  vars['--bolt-elements-code-text'] = isLight ? '#0A0A0A' : '#FFFFFF';

  // ── Buttons: primary ───────────────────────────────────────────────
  vars['--bolt-elements-button-primary-background'] = accentAlpha[10];
  vars['--bolt-elements-button-primary-backgroundHover'] = accentAlpha[20];
  vars['--bolt-elements-button-primary-text'] = accent[500];

  // ── Buttons: secondary ─────────────────────────────────────────────
  vars['--bolt-elements-button-secondary-background'] = isLight
    ? hexAlpha('#808080', 5)
    : hexAlpha('#ffffff', 5);
  vars['--bolt-elements-button-secondary-backgroundHover'] = isLight
    ? hexAlpha('#808080', 10)
    : hexAlpha('#ffffff', 10);
  vars['--bolt-elements-button-secondary-text'] = isLight ? '#0A0A0A' : '#FFFFFF';

  // ── Items (list items, selections) ─────────────────────────────────
  vars['--bolt-elements-item-contentAccent'] = isLight ? accent[700] : accent[500];
  vars['--bolt-elements-item-backgroundAccent'] = accentAlpha[10];

  // ── Loader ─────────────────────────────────────────────────────────
  vars['--bolt-elements-loader-progress'] = accent[500];

  // ── Messages ───────────────────────────────────────────────────────
  vars['--bolt-elements-messages-linkColor'] = accent[500];

  // ── Sidebar ────────────────────────────────────────────────────────
  vars['--bolt-elements-sidebar-background'] = sidebarBg;
  vars['--bolt-elements-sidebar-headerBg'] = isLight
    ? hexAlpha(sidebarBg, 80)
    : hexAlpha(lighten(sidebarBg, 5), 80);
  vars['--bolt-elements-sidebar-border'] = isLight
    ? hexAlpha('#808080', 10)
    : hexAlpha('#ffffff', 8);
  vars['--bolt-elements-sidebar-buttonBackgroundDefault'] = accentAlpha[10];
  vars['--bolt-elements-sidebar-buttonBackgroundHover'] = accentAlpha[20];
  vars['--bolt-elements-sidebar-buttonText'] = isLight ? accent[700] : accent[500];

  // ── Artifacts ──────────────────────────────────────────────────────
  vars['--bolt-elements-artifacts-background'] = isLight ? '#ffffff' : bgSecondary;

  // ── Actions ────────────────────────────────────────────────────────
  vars['--bolt-elements-actions-background'] = isLight ? '#ffffff' : bgSecondary;

  // ── Terminals ──────────────────────────────────────────────────────
  vars['--bolt-elements-terminals-background'] = bg;

  // ── Prompt ─────────────────────────────────────────────────────────
  vars['--bolt-elements-prompt-background'] = isLight
    ? 'rgba(255,255,255,0.80)'
    : 'rgba(128,128,128,0.80)';

  // ── CTA ────────────────────────────────────────────────────────────
  vars['--bolt-elements-cta-background'] = isLight ? '#F5F5F5' : hexAlpha('#ffffff', 10);
  vars['--bolt-elements-cta-text'] = isLight ? '#0A0A0A' : '#FFFFFF';

  // ── Scrollbar ──────────────────────────────────────────────────────
  vars['--modern-scrollbar-thumb-background'] = 'rgba(100,100,100,0.3)';
  vars['--modern-scrollbar-thumb-backgroundHover'] = isLight
    ? 'rgba(74,74,74,0.8)'
    : 'rgba(10,10,10,0.8)';

  // ── BackgroundRays gradient vars (index.scss) ──────────────────────
  const [pr, pg, pb] = hexToRgb(preset.primary);
  const [ar, ag, ab] = hexToRgb(preset.accent);
  const midR = Math.round((pr + ar) / 2);
  const midG = Math.round((pg + ag) / 2);
  const midB = Math.round((pb + ab) / 2);

  vars['--primary-color'] = `rgba(${pr}, ${pg}, ${pb}, var(--gradient-opacity))`;
  vars['--secondary-color'] = `rgba(${midR}, ${midG}, ${midB}, var(--gradient-opacity))`;
  vars['--accent-color'] = `rgba(${ar}, ${ag}, ${ab}, var(--gradient-opacity))`;

  // ── CodeMirror editor tooltip accent ───────────────────────────────
  vars['--cm-tooltip-backgroundColorSelected'] = accentAlpha[30];

  // ── GlowingEffect gradient colors ─────────────────────────────────
  vars['--glow-color-primary'] = accent[600];
  vars['--glow-color-secondary'] = accent[400];
  vars['--glow-color-tertiary'] = accent[500];
  vars['--glow-color-accent'] = preset.accent;

  // ── Theme accent palette as CSS vars (for any direct usage) ───────
  vars['--theme-accent-50'] = accent[50];
  vars['--theme-accent-100'] = accent[100];
  vars['--theme-accent-200'] = accent[200];
  vars['--theme-accent-300'] = accent[300];
  vars['--theme-accent-400'] = accent[400];
  vars['--theme-accent-500'] = accent[500];
  vars['--theme-accent-600'] = accent[600];
  vars['--theme-accent-700'] = accent[700];
  vars['--theme-accent-800'] = accent[800];
  vars['--theme-accent-900'] = accent[900];
  vars['--theme-accent-950'] = accent[950];

  // ── Accent alpha variants (for UnoCSS /10, /20, /30 replacements) ─
  vars['--theme-accent-500-10'] = accentAlpha[10];
  vars['--theme-accent-500-20'] = accentAlpha[20];
  vars['--theme-accent-500-30'] = accentAlpha[30];

  return { mode, vars };
}

// ---------------------------------------------------------------------------
// Apply to DOM
// ---------------------------------------------------------------------------

/**
 * Apply a mapped theme to the document root.
 * Sets `data-theme` and all CSS custom properties.
 */
export function applyThemeToDOM(result: ThemeMappingResult): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', result.mode);

  const s = root.style;
  for (const [prop, value] of Object.entries(result.vars)) {
    s.setProperty(prop, value);
  }
}
