import { atom } from 'nanostores';
import { logStore } from './logs';
import { codespaceTheme } from './codespace';
import { findPreset } from '~/lib/themes/presets';
import { mapThemeToVars, applyThemeToDOM } from '~/lib/themes/theme-mapper';

export type Theme = 'dark' | 'light';

export const kTheme = 'hack_cortex_theme';

export function themeIsDark() {
  return themeStore.get() === 'dark';
}

export const DEFAULT_THEME = 'light';

export const themeStore = atom<Theme>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    const persistedTheme = localStorage.getItem(kTheme) as Theme | undefined;
    const themeAttribute = document.querySelector('html')?.getAttribute('data-theme');

    return persistedTheme ?? (themeAttribute as Theme) ?? DEFAULT_THEME;
  }

  return DEFAULT_THEME;
}

export function toggleTheme() {
  const currentTheme = themeStore.get();
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

  // Check if a synced theme is active — if so, re-apply via the mapper
  const synced = codespaceTheme.get();

  if (synced?.accentId) {
    const preset = findPreset(synced.accentId);

    if (preset) {
      const preferDark = newTheme === 'dark';
      const result = mapThemeToVars(preset, preferDark);
      applyThemeToDOM(result);

      // Update stores
      themeStore.set(result.mode);
      localStorage.setItem(kTheme, result.mode);
      codespaceTheme.set({ ...synced, mode: result.mode });

      logStore.logSystem(`Theme changed to ${result.mode} mode (synced theme: ${synced.accentId})`);

      return;
    }
  }

  // No synced theme — standard toggle
  themeStore.set(newTheme);

  // Update localStorage
  localStorage.setItem(kTheme, newTheme);

  // Update the HTML attribute
  document.querySelector('html')?.setAttribute('data-theme', newTheme);

  // Update user profile if it exists
  try {
    const userProfile = localStorage.getItem('hack_cortex_user_profile');

    if (userProfile) {
      const profile = JSON.parse(userProfile);
      profile.theme = newTheme;
      localStorage.setItem('hack_cortex_user_profile', JSON.stringify(profile));
    }
  } catch (error) {
    console.error('Error updating user profile theme:', error);
  }

  logStore.logSystem(`Theme changed to ${newTheme} mode`);
}
