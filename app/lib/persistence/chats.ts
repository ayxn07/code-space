/**
 * Functions for managing chat data — delegates to API client.
 *
 * This file is used by import/export features (DataTab, importExportService).
 * Rewritten from IndexedDB to use the parent app's REST API.
 */

import type { Message } from 'ai';
import type { IChatMetadata } from './db';
import {
  apiListChats,
  apiGetChat,
  apiCreateChat,
  apiDeleteChat,
  apiListMessages,
  apiBulkCreateMessages,
} from './api-client';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Chat {
  id: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  urlId?: string;
  metadata?: IChatMetadata;
}

/**
 * Get all chats from the API.
 * The `db` parameter is kept for signature compatibility but ignored.
 */
export async function getAllChats(_db: IDBDatabase): Promise<Chat[]> {
  try {
    const apiChats = await apiListChats();

    return apiChats.map((chat) => ({
      id: chat.id,
      description: chat.title || undefined,
      messages: [], // Messages loaded on demand
      timestamp: chat.created_at,
      urlId: chat.id,
      metadata: (chat.metadata as unknown as IChatMetadata) || undefined,
    }));
  } catch (error) {
    console.error('getAllChats: Error fetching from API:', error);
    return [];
  }
}

/**
 * Get a chat by ID, including its messages.
 */
export async function getChatById(_db: IDBDatabase, id: string): Promise<Chat | null> {
  try {
    const chat = await apiGetChat(id);

    if (!chat) {
      return null;
    }

    const apiMessages = await apiListMessages(id);

    // Deserialize messages from JSON content
    const messages: Message[] = apiMessages.map((msg) => {
      try {
        const parsed = JSON.parse(msg.content);

        if (parsed && typeof parsed === 'object' && 'role' in parsed && 'content' in parsed) {
          return { ...parsed, id: parsed.id || msg.id } as Message;
        }
      } catch {
        // Not JSON
      }

      return { id: msg.id, role: msg.role, content: msg.content } as Message;
    });

    return {
      id: chat.id,
      description: chat.title || undefined,
      messages,
      timestamp: chat.created_at,
      urlId: chat.id,
      metadata: (chat.metadata as unknown as IChatMetadata) || undefined,
    };
  } catch (error) {
    console.error('getChatById: Error fetching from API:', error);
    return null;
  }
}

/**
 * Save a chat to the API.
 */
export async function saveChat(_db: IDBDatabase, chat: Chat): Promise<void> {
  try {
    const existing = await apiGetChat(chat.id);

    if (!existing) {
      // Create new
      const created = await apiCreateChat({
        title: chat.description,
        metadata: (chat.metadata as unknown as Record<string, unknown>) || {},
      });

      // Sync messages
      if (chat.messages.length > 0) {
        const apiMessages = chat.messages.map((msg) => ({
          role: (['user', 'assistant', 'system'].includes(msg.role) ? msg.role : 'assistant') as
            | 'user'
            | 'assistant'
            | 'system',
          content: JSON.stringify(msg),
          metadata: { originalId: msg.id },
        }));

        const CHUNK_SIZE = 50;

        for (let i = 0; i < apiMessages.length; i += CHUNK_SIZE) {
          await apiBulkCreateMessages(created.id, apiMessages.slice(i, i + CHUNK_SIZE));
        }
      }
    }

    // If exists, we don't update — saveChat is mainly used for import
  } catch (error) {
    console.error('saveChat: Error saving to API:', error);
    throw error;
  }
}

/**
 * Delete a chat by ID.
 */
export async function deleteChat(_db: IDBDatabase, id: string): Promise<void> {
  try {
    await apiDeleteChat(id);
  } catch (error) {
    console.error('deleteChat: Error deleting from API:', error);
    throw error;
  }
}

/**
 * Delete all chats.
 * Note: The API doesn't have a bulk-delete endpoint, so we delete one by one.
 */
export async function deleteAllChats(_db: IDBDatabase): Promise<void> {
  try {
    const chats = await apiListChats();

    for (const chat of chats) {
      await apiDeleteChat(chat.id);
    }
  } catch (error) {
    console.error('deleteAllChats: Error deleting from API:', error);
    throw error;
  }
}
