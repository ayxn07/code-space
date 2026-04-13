/**
 * Codespace API Client
 *
 * Makes authenticated calls to the parent app's REST API for
 * persisting chat history and messages to Supabase.
 *
 * Used by the rewritten db.ts to replace IndexedDB with server storage.
 *
 * IMPORTANT: When CODESPACE_API_BASE_URL is not configured (e.g., running
 * Hack Cortex standalone without the parent app), all functions gracefully
 * return empty data instead of making requests to the wrong host.
 */
import { codespaceToken, codespaceApiBaseUrl } from '~/lib/stores/codespace';

/*
 * ---------------------------------------------------------------------------
 * Types (mirrors the parent app's types)
 * ---------------------------------------------------------------------------
 */

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

/*
 * ---------------------------------------------------------------------------
 * Internal helpers
 * ---------------------------------------------------------------------------
 */

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
  let url = codespaceApiBaseUrl.get();

  if (url) {
    // Ensure protocol prefix (missing https:// causes fetch to treat it as relative path)
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Remove trailing slash for consistent URL construction
    return url.replace(/\/+$/, '');
  }

  // Not configured — log once and return null
  if (!_warnedNoBaseUrl) {
    _warnedNoBaseUrl = true;
    console.info(
      '[codespace-api] CODESPACE_API_BASE_URL not configured. Chat persistence disabled — using local-only mode.',
    );
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

/**
 * Waits for the persistence API to become available (token + baseUrl set).
 * The nanostores are populated asynchronously from JWT/referrer in root.tsx,
 * so on initial page load they may not be set yet when useChatHistory runs.
 *
 * Returns true if persistence became available, false if timed out.
 */
export async function waitForPersistence(timeoutMs = 3000): Promise<boolean> {
  if (isPersistenceAvailable()) {
    return true;
  }

  const pollInterval = 50;
  let elapsed = 0;

  return new Promise<boolean>((resolve) => {
    const timer = setInterval(() => {
      elapsed += pollInterval;

      if (isPersistenceAvailable()) {
        clearInterval(timer);
        resolve(true);
      } else if (elapsed >= timeoutMs) {
        clearInterval(timer);
        console.warn(`[codespace-api] Persistence not available after ${timeoutMs}ms. Token or base URL missing.`);
        resolve(false);
      }
    }, pollInterval);
  });
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

/*
 * ---------------------------------------------------------------------------
 * Chat CRUD
 * ---------------------------------------------------------------------------
 */

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
 * Returns null if persistence is not configured or chat not found.
 * Throws on auth/network errors so callers can distinguish failure modes.
 */
export async function apiGetChat(chatId: string): Promise<ApiChat | null> {
  try {
    const data = await apiFetch<{ chat: ApiChat }>(`/api/codespace/chats/${chatId}`);
    return data.chat;
  } catch (error) {
    // API not configured — graceful no-op
    if (error instanceof ApiNotConfiguredError) {
      return null;
    }

    // 404 / "not found" — the chat genuinely doesn't exist
    const msg = error instanceof Error ? error.message : String(error);

    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
      console.info(`[codespace-api] Chat ${chatId} not found (404).`);
      return null;
    }

    // Auth, network, or other server errors — rethrow so callers can handle
    console.error(`[codespace-api] Failed to get chat ${chatId}:`, msg);
    throw error;
  }
}

/**
 * Creates a new chat.
 * Throws if persistence is not configured (caller should check isPersistenceAvailable first).
 */
export async function apiCreateChat(body: {
  id?: string;
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

/*
 * ---------------------------------------------------------------------------
 * Message CRUD
 * ---------------------------------------------------------------------------
 */

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

/**
 * Replaces ALL messages for a chat (idempotent full sync).
 * Deletes existing messages then inserts the provided set.
 * Returns 0 if persistence is not configured.
 */
export async function apiReplaceMessages(
  chatId: string,
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<number> {
  try {
    const data = await apiFetch<{ count: number }>(`/api/codespace/chats/${chatId}/messages`, {
      method: 'PUT',
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

/*
 * ---------------------------------------------------------------------------
 * Snapshot persistence (Supabase Storage via HackCortex API)
 * ---------------------------------------------------------------------------
 */

/**
 * Compresses a string using gzip via the browser's CompressionStream API.
 * Falls back to sending uncompressed JSON if CompressionStream is unavailable.
 */
async function gzipCompress(data: string): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    // Fallback: send raw JSON bytes (server accepts application/octet-stream too)
    return { bytes: new TextEncoder().encode(data), compressed: false };
  }

  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
  }

  // Concatenate chunks into a single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return { bytes: result, compressed: true };
}

/**
 * Decompresses gzip data using the browser's DecompressionStream API.
 * Falls back to treating input as raw JSON if DecompressionStream is unavailable.
 */
async function gzipDecompress(data: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    // Fallback: assume raw JSON
    return new TextDecoder().decode(data);
  }

  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(result);
  } catch {
    // If decompression fails, try treating as raw JSON
    return new TextDecoder().decode(data);
  }
}

/**
 * Uploads a snapshot (gzip-compressed JSON) to the server.
 * The snapshot replaces any existing snapshot for this chat.
 */
export async function apiUploadSnapshot(
  chatId: string,
  snapshot: { chatIndex: string; files: Record<string, unknown>; summary?: string },
): Promise<void> {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    throw new ApiNotConfiguredError();
  }

  const token = getToken();

  if (!token) {
    throw new Error('[codespace-api] No auth token available.');
  }

  const json = JSON.stringify(snapshot);
  const { bytes, compressed } = await gzipCompress(json);

  const res = await fetch(`${baseUrl}/api/codespace/chats/${chatId}/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': compressed ? 'application/gzip' : 'application/octet-stream',
      Authorization: `Bearer ${token}`,
    },
    body: bytes as unknown as BodyInit,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Snapshot upload failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Downloads a snapshot from the server.
 * Returns the parsed snapshot object, or null if no snapshot exists.
 */
export async function apiDownloadSnapshot(
  chatId: string,
): Promise<{ chatIndex: string; files: Record<string, unknown>; summary?: string } | null> {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    return null; // No persistence configured — no snapshot to download
  }

  const token = getToken();

  if (!token) {
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/api/codespace/chats/${chatId}/snapshot`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 404) {
      return null; // No snapshot stored yet — not an error
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Snapshot download failed: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const json = await gzipDecompress(arrayBuffer);

    return JSON.parse(json);
  } catch (error) {
    if (error instanceof ApiNotConfiguredError) {
      return null;
    }

    console.error('[codespace-api] Failed to download snapshot:', error);

    // Don't throw — snapshot download failure is non-critical
    return null;
  }
}
