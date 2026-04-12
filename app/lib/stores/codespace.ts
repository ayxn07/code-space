/**
 * Codespace State Store
 *
 * Nanostores atoms for state received from the parent app via postMessage.
 * These are populated by the postMessage bridge in root.tsx.
 *
 * IMPORTANT: The atoms are pre-seeded from window globals set by the inline
 * <script> in <head>. This ensures values are available immediately when
 * modules load — before App()'s useEffect runs (which fires last because
 * React effects execute bottom-up, children before parents).
 */
import { atom } from 'nanostores';

/*
 * ---------------------------------------------------------------------------
 * SSR-safe window global reader
 * ---------------------------------------------------------------------------
 */

function readGlobal<T>(key: string): T | null {
  if (typeof window !== 'undefined') {
    return ((window as unknown as Record<string, unknown>)[key] as T) ?? null;
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * Auth Token
 * ---------------------------------------------------------------------------
 */

/** The current JWT token (set from URL param on load, refreshed via postMessage) */
export const codespaceToken = atom<string | null>(readGlobal<string>('__CODESPACE_TOKEN__'));

/*
 * ---------------------------------------------------------------------------
 * Theme
 * ---------------------------------------------------------------------------
 */

export interface CodespaceTheme {
  mode: 'light' | 'dark';
  accentId: string;
}

/** Theme state synced from the parent app */
export const codespaceTheme = atom<CodespaceTheme | null>(readGlobal<CodespaceTheme>('__CODESPACE_THEME__'));

/*
 * ---------------------------------------------------------------------------
 * GitHub
 * ---------------------------------------------------------------------------
 */

export interface CodespaceGitHub {
  connected: boolean;
  token: string | null;
  username: string | null;
}

/** GitHub connection state from the parent app */
export const codespaceGitHub = atom<CodespaceGitHub | null>(readGlobal<CodespaceGitHub>('__CODESPACE_GITHUB__'));

/*
 * ---------------------------------------------------------------------------
 * API Base URL
 * ---------------------------------------------------------------------------
 */

/**
 * The base URL of the parent Next.js app's API (e.g., "https://yourdomain.com").
 * Set from CODESPACE_API_BASE_URL env var or derived from document.referrer.
 *
 * Pre-seeded from __CODESPACE_REFERRER_ORIGIN__ (set by inline script from
 * document.referrer or localStorage). May be overridden by App()'s useEffect
 * if the root loader provides a server-side value.
 */
export const codespaceApiBaseUrl = atom<string | null>(readGlobal<string>('__CODESPACE_REFERRER_ORIGIN__'));

/*
 * ---------------------------------------------------------------------------
 * User Profile (decoded from JWT)
 * ---------------------------------------------------------------------------
 */

export interface CodespaceProfile {
  username: string;
  email: string;
  userId: string;
  workspaceId: string;
}

/** User profile extracted from the JWT token claims */
export const codespaceProfile = atom<CodespaceProfile | null>(readGlobal<CodespaceProfile>('__CODESPACE_PROFILE__'));

/*
 * ---------------------------------------------------------------------------
 * Dashboard URL (derived from API base + workspace ID)
 * ---------------------------------------------------------------------------
 */

/**
 * Returns the URL to navigate back to the main Hack Cortex dashboard.
 * Format: {codespaceApiBaseUrl}/workspace/{workspaceId}
 */
export function getDashboardUrl(): string | null {
  const baseUrl = codespaceApiBaseUrl.get();
  const profile = codespaceProfile.get();

  if (!baseUrl || !profile?.workspaceId) {
    return null;
  }

  return `${baseUrl.replace(/\/$/, '')}/workspace/${profile.workspaceId}`;
}
