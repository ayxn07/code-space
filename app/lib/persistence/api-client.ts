/**
 * Codespace API Client
 *
 * Makes authenticated calls to the parent app's REST API for
 * persisting chat history and messages to Supabase.
 *
 * Used by the rewritten db.ts to replace IndexedDB with server storage.
 *
 * IMPORTANT: When CODESPACE_API_BASE_URL is not configured (e.g., running
 * bolt.diy standalone without the parent app), all functions gracefully
 * return empty data instead of making requests to the wrong host.
 */
import { codespaceToken, codespaceApiBaseUrl } from '~/lib/stores/codespace';

// ---------------------------------------------------------------------------
// Types (mirrors the parent app's types)
// ---------------------------------------------------------------------------

export interface ApiChat {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  model: string | null;
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApiMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

let _warnedNoBaseUrl = false;

/**
 * Returns the API base URL, or `null` if not configured.
 *
 * Resolution order:
 *  1. Nanostore value (set from root loader / postMessage)
 *  2. document.referrer — ONLY when running inside an iframe
 *  3. null (not configured — all API calls will gracefully no-op)
 */
function getBaseUrl(): string | null {
  const url = codespaceApiBaseUrl.get();

  if (url) {
    return url;
  }

  // Fallback: try document.referrer, but ONLY if we're inside an iframe.
  // When accessed directly (not embedded), document.referrer is either empty
  // or points to bolt.diy itself — using it would cause 404 loops.
  if (typeof window !== 'undefined' && window.parent !== window && typeof document !== 'undefined' && document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;

      // Sanity: don't use referrer if it points to our own origin
      if (origin !== window.location.origin) {
        codespaceApiBaseUrl.set(origin);
        return origin;
      }
    } catch {
      // ignore malformed referrer
    }
  }

  // Not configured — log once and return null
  if (!_warnedNoBaseUrl) {
    _warnedNoBaseUrl = true;
    console.info('[codespace-api] CODESPACE_API_BASE_URL not configured. Chat persistence disabled — using local-only mode.');
  }

  return null;
}

function getToken(): string | null {
  return codespaceToken.get() || null;
}

/**
 * Returns true if the persistence API is available (base URL + token configured).
 */
export function isPersistenceAvailable(): boolean {
  return getBaseUrl() !== null && getToken() !== null;
}

class ApiNotConfiguredError extends Error {
  constructor() {
    super('[codespace-api] Persistence API not configured');
    this.name = 'ApiNotConfiguredError';
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    throw new ApiNotConfiguredError();
  }

  const token = getToken();

  if (!token) {
    throw new Error('[codespace-api] No auth token available.');
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `API request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Chat CRUD
// ---------------------------------------------------------------------------

/**
 * Lists all chats for the workspace, newest first.
 * Returns empty array if persistence is not configured.
 */
export async function apiListChats(): Promise<ApiChat[]> {
  try {
    const data = await apiFetch<{ chats: ApiChat[] }>('/api/codespace/chats');
    return data.chats;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return [];
    }

    throw error;
  }
}

/**
 * Gets a single chat by ID.
 * Returns null if persistence is not configured.
 */
export async function apiGetChat(chatId: string): Promise<ApiChat | null> {
  try {
    const data = await apiFetch<{ chat: ApiChat }>(`/api/codespace/chats/${chatId}`);
    return data.chat;
  } catch {
    return null;
  }
}

/**
 * Creates a new chat.
 * Throws if persistence is not configured (caller should check isPersistenceAvailable first).
 */
export async function apiCreateChat(body: {
  title?: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<ApiChat> {
  const data = await apiFetch<{ chat: ApiChat }>('/api/codespace/chats', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.chat;
}

/**
 * Updates a chat.
 * No-ops silently if persistence is not configured.
 */
export async function apiUpdateChat(
  chatId: string,
  body: {
    title?: string;
    model?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ApiChat | null> {
  try {
    const data = await apiFetch<{ chat: ApiChat }>(`/api/codespace/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return data.chat;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return null;
    }

    throw error;
  }
}

/**
 * Deletes a chat and all its messages.
 * No-ops silently if persistence is not configured.
 */
export async function apiDeleteChat(chatId: string): Promise<void> {
  try {
    await apiFetch(`/api/codespace/chats/${chatId}`, { method: 'DELETE' });
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return;
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

/**
 * Lists all messages for a chat, chronological order.
 * Returns empty array if persistence is not configured.
 */
export async function apiListMessages(chatId: string): Promise<ApiMessage[]> {
  try {
    const data = await apiFetch<{ messages: ApiMessage[] }>(`/api/codespace/chats/${chatId}/messages`);
    return data.messages;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return [];
    }

    throw error;
  }
}

/**
 * Creates a single message.
 */
export async function apiCreateMessage(
  chatId: string,
  body: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ApiMessage> {
  const data = await apiFetch<{ message: ApiMessage }>(`/api/codespace/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.message;
}

/**
 * Bulk creates multiple messages (for syncing full chat history).
 * Returns 0 if persistence is not configured.
 */
export async function apiBulkCreateMessages(
  chatId: string,
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<number> {
  try {
    const data = await apiFetch<{ count: number }>(`/api/codespace/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    });
    return data.count;
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return 0;
    }

    throw error;
  }
}
