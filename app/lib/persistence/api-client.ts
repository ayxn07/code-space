/**
 * Codespace API Client
 *
 * Makes authenticated calls to the parent app's REST API for
 * persisting chat history and messages to Supabase.
 *
 * Used by the rewritten db.ts to replace IndexedDB with server storage.
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

function getBaseUrl(): string {
  const url = codespaceApiBaseUrl.get();

  if (url) {
    return url;
  }

  // Fallback: try to derive from document.referrer (parent app)
  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const origin = new URL(document.referrer).origin;
      codespaceApiBaseUrl.set(origin);

      return origin;
    } catch {
      // ignore
    }
  }

  throw new Error('[codespace-api] API base URL not configured. Set CODESPACE_API_BASE_URL.');
}

function getToken(): string {
  const token = codespaceToken.get();

  if (!token) {
    throw new Error('[codespace-api] No auth token available.');
  }

  return token;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const token = getToken();

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
 */
export async function apiListChats(): Promise<ApiChat[]> {
  const data = await apiFetch<{ chats: ApiChat[] }>('/api/codespace/chats');
  return data.chats;
}

/**
 * Gets a single chat by ID.
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
 */
export async function apiUpdateChat(
  chatId: string,
  body: {
    title?: string;
    model?: string;
    provider?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<ApiChat> {
  const data = await apiFetch<{ chat: ApiChat }>(`/api/codespace/chats/${chatId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return data.chat;
}

/**
 * Deletes a chat and all its messages.
 */
export async function apiDeleteChat(chatId: string): Promise<void> {
  await apiFetch(`/api/codespace/chats/${chatId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Message CRUD
// ---------------------------------------------------------------------------

/**
 * Lists all messages for a chat, chronological order.
 */
export async function apiListMessages(chatId: string): Promise<ApiMessage[]> {
  const data = await apiFetch<{ messages: ApiMessage[] }>(`/api/codespace/chats/${chatId}/messages`);
  return data.messages;
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
 */
export async function apiBulkCreateMessages(
  chatId: string,
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, unknown>;
  }>,
): Promise<number> {
  const data = await apiFetch<{ count: number }>(`/api/codespace/chats/${chatId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ messages }),
  });
  return data.count;
}
