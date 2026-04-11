import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types';
import {
  apiListChats,
  apiGetChat,
  apiCreateChat,
  apiUpdateChat,
  apiDeleteChat,
  apiListMessages,
  apiReplaceMessages,
  isPersistenceAvailable,
  type ApiChat,
  type ApiMessage,
} from './api-client';

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;
}

const logger = createScopedLogger('ChatHistory');

// ---------------------------------------------------------------------------
// IndexedDB — kept ONLY for snapshots (too large for API, local-only is fine)
// ---------------------------------------------------------------------------

export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('boltHistory', 2);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

// ---------------------------------------------------------------------------
// Conversion helpers: ApiChat/ApiMessage ↔ ChatHistoryItem
// ---------------------------------------------------------------------------

function apiChatToHistoryItem(chat: ApiChat, messages: Message[]): ChatHistoryItem {
  return {
    id: chat.id,
    urlId: chat.id, // API uses UUIDs as IDs — use same for urlId
    description: chat.title || undefined,
    messages,
    timestamp: chat.created_at,
    metadata: (chat.metadata as unknown as IChatMetadata) || undefined,
  };
}

function apiMessageToAiMessage(msg: ApiMessage): Message {
  // The API stores the full AI SDK Message as JSON in the content field
  // If it was stored as a serialized Message object, parse it back
  try {
    const parsed = JSON.parse(msg.content);

    // If parsed result has the expected Message shape, use it
    if (parsed && typeof parsed === 'object' && 'role' in parsed && 'content' in parsed) {
      return {
        ...parsed,
        id: parsed.id || msg.id,
      } as Message;
    }
  } catch {
    // Not JSON — treat content as plain text
  }

  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
  } as Message;
}

function aiMessageToApiFormat(msg: Message): {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
} {
  // Serialize the full Message object as JSON to preserve all fields
  // (annotations, tool calls, data, etc.)
  const role = (['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'assistant') as
    | 'user'
    | 'assistant'
    | 'system';

  return {
    role,
    content: JSON.stringify(msg),
    metadata: { originalId: msg.id },
  };
}

// ---------------------------------------------------------------------------
// Chat CRUD — delegated to API client
// The `db: IDBDatabase` parameter is kept for signature compatibility but
// ignored for chat operations. Callers still pass the IDB instance.
// ---------------------------------------------------------------------------

/**
 * Lists all chats (newest first).
 */
export async function getAll(_db: IDBDatabase): Promise<ChatHistoryItem[]> {
  try {
    const chats = await apiListChats();

    // For listing, we return chats without messages (they'll be loaded on demand)
    return chats.map((chat) =>
      apiChatToHistoryItem(chat, []),
    );
  } catch (error) {
    logger.error('Failed to list chats from API', error);
    return [];
  }
}

/**
 * Saves/updates a chat and its messages.
 */
export async function setMessages(
  _db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  // Gracefully skip if persistence API is not configured
  if (!isPersistenceAvailable()) {
    return;
  }

  if (timestamp && isNaN(Date.parse(timestamp))) {
    throw new Error('Invalid timestamp');
  }

  try {
    // Try to get existing chat first
    const existing = await apiGetChat(id);

    if (existing) {
      // Update existing chat
      await apiUpdateChat(id, {
        title: description,
        metadata: metadata as unknown as Record<string, unknown>,
      });
    } else {
      // Create new chat — pass the client-generated UUID so server uses it as PK.
      // This keeps the client chatId nanostore, the URL, and the server record in sync.
      await apiCreateChat({
        id,
        title: description,
        metadata: (metadata as unknown as Record<string, unknown>) || {},
      });
    }

    // Sync messages: replace all (idempotent — no duplicates on repeated saves)
    if (messages.length > 0) {
      const apiMessages = messages.map(aiMessageToApiFormat);
      await apiReplaceMessages(id, apiMessages);
    }
  } catch (error) {
    // Log but do NOT re-throw — persistence errors should not
    // break the chat experience or trigger toast errors
    logger.error(`Failed to save chat ${id} (${messages.length} messages) to API`, error);
  }
}

/**
 * Gets a chat by ID or urlId.
 */
export async function getMessages(_db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return (await getMessagesById(_db, id)) || (await getMessagesByUrlId(_db, id));
}

/**
 * Gets a chat by urlId. Since API uses UUIDs as both id and urlId,
 * this is equivalent to getMessagesById.
 */
export async function getMessagesByUrlId(_db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return getMessagesById(_db, id);
}

/**
 * Gets a chat by its primary ID, including all messages.
 */
export async function getMessagesById(_db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  try {
    const chat = await apiGetChat(id);

    if (!chat) {
      return undefined as unknown as ChatHistoryItem;
    }

    const apiMessages = await apiListMessages(id);
    const messages = apiMessages.map(apiMessageToAiMessage);

    return apiChatToHistoryItem(chat, messages);
  } catch (error) {
    logger.error('Failed to get chat from API', error);
    return undefined as unknown as ChatHistoryItem;
  }
}

/**
 * Deletes a chat by ID. Also deletes the local snapshot.
 */
export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  if (isPersistenceAvailable()) {
    try {
      await apiDeleteChat(id);
    } catch (error) {
      logger.error('Failed to delete chat from API', error);

      // Don't re-throw — still try to clean up local snapshot
    }
  }

  // Also delete local snapshot (IndexedDB — best-effort, may not be available)
  if (db) {
    try {
      await deleteSnapshot(db, id);
    } catch {
      // Snapshot deletion is best-effort
    }
  }
}

/**
 * Gets the next available chat ID. With API-backed storage,
 * the server assigns UUIDs, but we still need a temporary ID
 * for the client until the chat is created server-side.
 */
export async function getNextId(_db: IDBDatabase): Promise<string> {
  // Generate a temporary UUID-like ID
  // The actual UUID will be assigned by the server on creation
  return crypto.randomUUID ? crypto.randomUUID() : `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Gets a unique URL-friendly ID. With API-backed storage, we use
 * the chat UUID directly as the URL ID.
 */
export async function getUrlId(_db: IDBDatabase, id: string): Promise<string> {
  // With API storage, the UUID is unique — just return it
  return id;
}

/**
 * Forks a chat at a specific message.
 */
export async function forkChat(_db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(_db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(_db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

/**
 * Duplicates a chat with all its messages.
 */
export async function duplicateChat(_db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(_db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(_db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

/**
 * Creates a new chat from a set of messages.
 */
export async function createChatFromMessages(
  _db: IDBDatabase,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  // If persistence is not available, return a local ID — chat will work
  // in-memory but won't be saved server-side
  if (!isPersistenceAvailable()) {
    return crypto.randomUUID ? crypto.randomUUID() : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  try {
    // Generate a UUID for the new chat and pass it to the server
    // so client and server stay in sync
    const newId = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const created = await apiCreateChat({
      id: newId,
      title: description,
      metadata: metadata as unknown as Record<string, unknown>,
    });

    // Insert messages for the new chat
    if (messages.length > 0) {
      const apiMessages = messages.map(aiMessageToApiFormat);
      await apiReplaceMessages(created.id, apiMessages);
    }

    return created.id; // Return the API-assigned UUID for navigation
  } catch (error) {
    logger.error('Failed to create chat from messages', error);
    throw error;
  }
}

/**
 * Updates a chat's description (title).
 */
export async function updateChatDescription(_db: IDBDatabase, id: string, description: string): Promise<void> {
  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  if (!isPersistenceAvailable()) {
    return;
  }

  try {
    await apiUpdateChat(id, { title: description });
  } catch (error) {
    logger.error('Failed to update chat description', error);
  }
}

/**
 * Updates a chat's metadata.
 */
export async function updateChatMetadata(
  _db: IDBDatabase,
  id: string,
  metadata: IChatMetadata | undefined,
): Promise<void> {
  if (!isPersistenceAvailable()) {
    return;
  }

  try {
    await apiUpdateChat(id, { metadata: metadata as unknown as Record<string, unknown> });
  } catch (error) {
    logger.error('Failed to update chat metadata', error);
  }
}

// ---------------------------------------------------------------------------
// Snapshot CRUD — stays 100% IndexedDB (snapshots are large file maps,
// local-only storage is acceptable)
// ---------------------------------------------------------------------------

export async function getSnapshot(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.get(chatId);

    request.onsuccess = () => resolve(request.result?.snapshot as Snapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function setSnapshot(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.put({ chatId, snapshot });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSnapshot(db: IDBDatabase, chatId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.delete(chatId);

    request.onsuccess = () => resolve();

    request.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        resolve();
      } else {
        reject(request.error);
      }
    };
  });
}
