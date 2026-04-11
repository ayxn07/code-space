/**
 * Codespace State Store
 *
 * Nanostores atoms for state received from the parent app via postMessage.
 * These are populated by the postMessage bridge in root.tsx.
 */
import { atom } from 'nanostores';

// ---------------------------------------------------------------------------
// Auth Token
// ---------------------------------------------------------------------------

/** The current JWT token (set from URL param on load, refreshed via postMessage) */
export const codespaceToken = atom<string | null>(null);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export interface CodespaceTheme {
  mode: 'light' | 'dark';
  accentId: string;
}

/** Theme state synced from the parent app */
export const codespaceTheme = atom<CodespaceTheme | null>(null);

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

export interface CodespaceGitHub {
  connected: boolean;
  token: string | null;
  username: string | null;
}

/** GitHub connection state from the parent app */
export const codespaceGitHub = atom<CodespaceGitHub | null>(null);

// ---------------------------------------------------------------------------
// API Base URL
// ---------------------------------------------------------------------------

/**
 * The base URL of the parent Next.js app's API (e.g., "https://yourdomain.com").
 * Set from CODESPACE_API_BASE_URL env var or derived from document.referrer.
 */
export const codespaceApiBaseUrl = atom<string | null>(null);

// ---------------------------------------------------------------------------
// User Profile (decoded from JWT)
// ---------------------------------------------------------------------------

export interface CodespaceProfile {
  username: string;
  email: string;
  userId: string;
  workspaceId: string;
}

/** User profile extracted from the JWT token claims */
export const codespaceProfile = atom<CodespaceProfile | null>(null);

// ---------------------------------------------------------------------------
// Dashboard URL (derived from API base + workspace ID)
// ---------------------------------------------------------------------------

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
