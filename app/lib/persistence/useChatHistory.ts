import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
import {
  getMessages,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  getSnapshot,
  setSnapshot,
  type IChatMetadata,
} from './db';
import { isPersistenceAvailable, waitForPersistence } from './api-client';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';
import type { ContextAnnotation } from '~/types/context';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

// ---------------------------------------------------------------------------
// Smart save infrastructure — debounced, non-blocking, with retry
// ---------------------------------------------------------------------------

const SAVE_DEBOUNCE_MS = 3000; // 3 seconds after last change
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000; // exponential backoff: 1s, 2s, 4s

/** Tracks whether there are unsaved changes (for beforeunload) */
let _hasUnsavedChanges = false;

/** The pending debounce timer */
let _saveTimerId: ReturnType<typeof setTimeout> | null = null;

/** The last message count we successfully saved */
let _lastSavedMessageCount = 0;

/** Whether the first save for this chat session has been completed */
let _firstSaveDone = false;

/** Args captured for the pending save */
interface PendingSave {
  chatId: string;
  messages: Message[];
  urlId?: string;
  description?: string;
  metadata?: IChatMetadata;
}
let _pendingSave: PendingSave | null = null;

/**
 * Performs the actual save with retry logic.
 * Returns true on success, false on failure after all retries.
 */
async function executeSave(save: PendingSave): Promise<boolean> {
  // We pass `db` to setMessages for signature compat, but it's only used
  // for snapshots internally. Chat data goes through the API.
  const idb = db as IDBDatabase;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await setMessages(
        idb,
        save.chatId,
        save.messages,
        save.urlId,
        save.description,
        undefined,
        save.metadata,
      );
      _lastSavedMessageCount = save.messages.length;
      _hasUnsavedChanges = false;
      _firstSaveDone = true;
      return true;
    } catch (error) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[auto-save] Attempt ${attempt + 1}/${MAX_RETRIES} failed, retrying in ${delay}ms...`, error);

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error('[auto-save] All retry attempts exhausted. Changes may be lost.');
  return false;
}

/**
 * Schedules a debounced save. If called multiple times within SAVE_DEBOUNCE_MS,
 * only the last call's data is saved. The save runs in the background (fire-and-forget).
 *
 * For the FIRST save of a new chat, the save fires immediately (no debounce)
 * to ensure the chat exists in the database before the user can navigate away.
 */
function scheduleSave(save: PendingSave): void {
  // Skip if message count hasn't changed (no new content to save)
  if (save.messages.length === _lastSavedMessageCount && _lastSavedMessageCount > 0) {
    return;
  }

  _pendingSave = save;
  _hasUnsavedChanges = true;

  // Clear any existing timer
  if (_saveTimerId !== null) {
    clearTimeout(_saveTimerId);
  }

  // First save for a new chat: fire immediately so it exists before user navigates
  const delay = _firstSaveDone ? SAVE_DEBOUNCE_MS : 0;

  _saveTimerId = setTimeout(() => {
    _saveTimerId = null;
    const s = _pendingSave;

    if (s) {
      _pendingSave = null;
      executeSave(s).catch((err) => console.error('[auto-save] Unexpected error:', err));
    }
  }, delay);
}

/**
 * Immediately flushes any pending save (no debounce).
 * Used by beforeunload and explicit save triggers.
 */
export async function flushSave(): Promise<void> {
  if (_saveTimerId !== null) {
    clearTimeout(_saveTimerId);
    _saveTimerId = null;
  }

  const save = _pendingSave;

  if (save) {
    _pendingSave = null;
    await executeSave(save);
  }
}

/**
 * Resets save tracking state for a new chat session.
 * Called when loading a different chat or starting fresh.
 */
function resetSaveState(): void {
  _lastSavedMessageCount = 0;
  _firstSaveDone = false;
  _hasUnsavedChanges = false;

  if (_saveTimerId !== null) {
    clearTimeout(_saveTimerId);
    _saveTimerId = null;
  }

  _pendingSave = null;
}

// Register beforeunload handler to flush unsaved changes when the tab closes
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (_hasUnsavedChanges && _pendingSave && isPersistenceAvailable()) {
      // Use sendBeacon for reliable delivery during unload
      // Fall back to sync flush as best-effort
      try {
        // Trigger immediate flush — can't truly await in beforeunload,
        // but starting the promise helps if the browser gives us time
        flushSave();
      } catch {
        // Best effort
      }

      // Signal the browser to show a "you have unsaved changes" dialog
      event.preventDefault();
    }
  });
}

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  // Stable key that only increments on route-level chat switches (when the
  // effect fires due to mixedId changing). This is used as the React key for
  // ChatImpl instead of chatId, so that assigning a new chatId during the
  // first message save does NOT cause a destructive remount.
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    // Increment session key so ChatImpl remounts with fresh useChat state
    setSessionKey((prev) => prev + 1);

    // Reset save state when switching chats
    resetSaveState();

    // CRITICAL: Reset UI state when chat changes so ChatImpl unmounts and
    // remounts with fresh useChat state. Without this, navigating between
    // chats leaves stale messages because useChat only reads initialMessages
    // on mount and _index.tsx / chat.$id.tsx share the same component ref
    // (React re-renders instead of remounting).
    setReady(false);
    setInitialMessages([]);
    setArchivedMessages([]);
    setUrlId(undefined);

    if (mixedId) {
      // ---------------------------------------------------------------------------
      // Loading an existing chat by ID
      // ---------------------------------------------------------------------------
      // We need the persistence API to be available (token + baseUrl).
      // These are set asynchronously from the JWT/referrer in root.tsx,
      // so we wait briefly for them before attempting to load.
      loadChat(mixedId);
    } else {
      // No mixedId — new chat. Reset atoms and mark ready.
      chatId.set(undefined);
      description.set(undefined);
      chatMetadata.set(undefined);
      setReady(true);
    }

    async function loadChat(id: string) {
      try {
        // Wait for persistence API to become available (token + base URL)
        const available = await waitForPersistence(5000);

        if (!available) {
          console.warn('[useChatHistory] Persistence not available — cannot load chat from API.');

          // If persistence is just not configured (standalone mode), that's fine
          if (!persistenceEnabled) {
            setReady(true);
            return;
          }

          // If persistence IS expected but not available, show error but don't block UI
          toast.error('Unable to connect to server. Chat history may be unavailable.');
          setReady(true);
          return;
        }

        // Fetch chat + messages from API, and snapshot from IndexedDB (if available)
        const [storedMessages, snapshot] = await Promise.all([
          getMessages(db as IDBDatabase, id),
          db ? getSnapshot(db, id).catch(() => undefined) : Promise.resolve(undefined),
        ]);

        if (storedMessages && storedMessages.messages.length > 0) {
          // ─── Chat found with messages ───────────────────────────────
          const validSnapshot = snapshot || { chatIndex: '', files: {} };
          const summary = validSnapshot.summary;

          const rewindId = searchParams.get('rewindTo');
          let startingIdx = -1;
          const endingIdx = rewindId
            ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
            : storedMessages.messages.length;
          const snapshotIndex = storedMessages.messages.findIndex((m) => m.id === validSnapshot.chatIndex);

          if (snapshotIndex >= 0 && snapshotIndex < endingIdx) {
            startingIdx = snapshotIndex;
          }

          if (snapshotIndex > 0 && storedMessages.messages[snapshotIndex].id == rewindId) {
            startingIdx = -1;
          }

          let filteredMessages = storedMessages.messages.slice(startingIdx + 1, endingIdx);
          let archivedMsgs: Message[] = [];

          if (startingIdx >= 0) {
            archivedMsgs = storedMessages.messages.slice(0, startingIdx + 1);
          }

          setArchivedMessages(archivedMsgs);

          if (startingIdx > 0) {
            const files = Object.entries(validSnapshot?.files || {})
              .map(([key, value]) => {
                if (value?.type !== 'file') {
                  return null;
                }

                return {
                  content: value.content,
                  path: key,
                };
              })
              .filter((x): x is { content: string; path: string } => !!x);
            const projectCommands = await detectProjectCommands(files);

            const commandActionsString = createCommandActionsString(projectCommands);

            filteredMessages = [
              {
                id: generateId(),
                role: 'user',
                content: `Restore project from snapshot`,
                annotations: ['no-store', 'hidden'],
              },
              {
                id: storedMessages.messages[snapshotIndex].id,
                role: 'assistant',
                content: `Hack Cortex restored your chat from a snapshot. You can revert this message to load the full chat history.
                  <boltArtifact id="restored-project-setup" title="Restored Project & Setup" type="bundled">
                  ${Object.entries(snapshot?.files || {})
                    .map(([key, value]) => {
                      if (value?.type === 'file') {
                        return `
                      <boltAction type="file" filePath="${key}">
${value.content}
                      </boltAction>
                      `;
                      } else {
                        return ``;
                      }
                    })
                    .join('\n')}
                  ${commandActionsString} 
                  </boltArtifact>
                  `,
                annotations: [
                  'no-store',
                  ...(summary
                    ? [
                        {
                          chatId: storedMessages.messages[snapshotIndex].id,
                          type: 'chatSummary',
                          summary,
                        } satisfies ContextAnnotation,
                      ]
                    : []),
                ],
              },
              ...filteredMessages,
            ];
            restoreSnapshot(id);
          }

          setInitialMessages(filteredMessages);
          setUrlId(storedMessages.urlId);
          description.set(storedMessages.description);
          chatId.set(storedMessages.id);
          chatMetadata.set(storedMessages.metadata);

          // Mark that we already have saved messages (for debounce tracking)
          _lastSavedMessageCount = storedMessages.messages.length;
          _firstSaveDone = true;
        } else if (storedMessages) {
          // ─── Chat exists but has 0 messages ─────────────────────────
          // This can happen if the user created a chat and the 3-second
          // debounce hasn't fired yet, or if the first message is still
          // being streamed. DON'T bounce to / — show an empty chat
          // with the correct chatId so new messages will save to it.
          console.info(`[useChatHistory] Chat ${id} found but has 0 messages. Showing empty chat.`);
          chatId.set(storedMessages.id);
          setUrlId(storedMessages.urlId);
          description.set(storedMessages.description);
          chatMetadata.set(storedMessages.metadata);
          setInitialMessages([]);
        } else {
          // ─── Chat not found ─────────────────────────────────────────
          console.warn(`[useChatHistory] Chat ${id} not found. Redirecting to home.`);
          navigate('/', { replace: true });
        }

        setReady(true);
      } catch (error) {
        console.error('[useChatHistory] Failed to load chat:', error);
        logStore.logError('Failed to load chat messages', error instanceof Error ? error : new Error(String(error)));

        // Distinguish error types for user-facing messages
        const msg = error instanceof Error ? error.message : String(error);

        if (msg.includes('401') || msg.toLowerCase().includes('auth') || msg.toLowerCase().includes('token')) {
          toast.error('Authentication failed. Please return to the dashboard and reopen Codespace.');
        } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          toast.error('Network error. Please check your connection and try again.');
        } else {
          toast.error('Failed to load chat: ' + msg);
        }

        // Unblock UI so user isn't stuck on a blank screen
        setReady(true);
      }
    }
  }, [mixedId, navigate, searchParams]);

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        // Snapshots require IndexedDB — gracefully skip if unavailable
        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);

        // Don't toast — snapshot failure is non-critical
      }
    },
    [],
  );

  const restoreSnapshot = useCallback(async (id: string, snapshot?: Snapshot) => {
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      if (value?.type === 'folder') {
        await container.fs.mkdir(key, { recursive: true });
      }
    });
    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (value?.type === 'file') {
        if (key.startsWith(container.workdir)) {
          key = key.replace(container.workdir, '');
        }

        await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      }
    });
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    sessionKey,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!id) {
        return;
      }

      try {
        // Pass db (may be undefined) — setMessages handles it gracefully
        await setMessages(db as IDBDatabase, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (messages.length === 0) {
        return;
      }

      // Don't block on persistence — if API is not ready yet, messages will
      // be saved by the next debounce tick once it becomes available
      if (!isPersistenceAvailable()) {
        console.info('[useChatHistory] Persistence not available yet, skipping save.');
        return;
      }

      const { firstArtifact } = workbenchStore;
      messages = messages.filter((m) => !m.annotations?.includes('no-store'));

      let _urlId = urlId;

      if (!urlId && firstArtifact?.id) {
        const newUrlId = await getUrlId(db as IDBDatabase, firstArtifact.id);
        _urlId = newUrlId;
        navigateChat(newUrlId);
        setUrlId(newUrlId);
      }

      let chatSummary: string | undefined = undefined;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role === 'assistant') {
        const annotations = lastMessage.annotations as JSONValue[];
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary);

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      // Ensure chatId.get() is used here as well
      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(db as IDBDatabase);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId);
        }
      }

      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');

        return;
      }

      // Schedule a debounced, non-blocking save (fire-and-forget).
      // For the first save of a new chat, this fires immediately (no debounce).
      const allMessages = [...archivedMessages, ...messages];
      scheduleSave({
        chatId: finalChatId,
        messages: allMessages,
        urlId: _urlId,
        description: description.get(),
        metadata: chatMetadata.get(),
      });
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!mixedId && !listItemId) {
        return;
      }

      try {
        const newId = await duplicateChat(db as IDBDatabase, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      try {
        const newId = await createChatFromMessages(db as IDBDatabase, description, messages, metadata);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!id) {
        return;
      }

      const chat = await getMessages(db as IDBDatabase, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
