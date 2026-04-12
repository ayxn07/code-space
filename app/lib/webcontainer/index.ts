import { WebContainer } from '@webcontainer/api';
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

const logger = {
  info: (...a: any[]) => console.log('[WebContainer]', ...a),
  error: (...a: any[]) => console.error('[WebContainer]', ...a),
};

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<WebContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        return WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        const response = await fetch('/inspector-script.js');
        const inspectorScript = await response.text();
        await webcontainer.setPreviewScript(inspectorScript);

        // Listen for preview errors
        webcontainer.on('preview-message', (message) => {
          console.log('WebContainer preview message:', message);

          // Handle both uncaught exceptions and unhandled promise rejections
          if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
            const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
            const title = isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception';
            workbenchStore.actionAlert.set({
              type: 'preview',
              title,
              description: 'message' in message ? message.message : 'Unknown error',
              content: `Error occurred at ${message.pathname}${message.search}${message.hash}\nPort: ${message.port}\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
              source: 'preview',
            });
          }
        });

        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}

/**
 * Wipes all files and directories inside the WebContainer working directory.
 * This is used when switching between chats to ensure complete workspace
 * isolation — no files from a previous chat leak into the new one.
 *
 * We enumerate top-level entries inside the workdir and `rm -rf` each one
 * rather than removing the workdir itself (which would break the watcher
 * and the WebContainer's internal state).
 */
export async function wipeWebContainerFiles(): Promise<void> {
  const wc = await webcontainer;

  try {
    const entries = await wc.fs.readdir(wc.workdir, { withFileTypes: true });

    for (const entry of entries) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const isDir = typeof entry === 'string' ? false : entry.isDirectory();

      try {
        if (isDir) {
          await wc.fs.rm(name, { recursive: true });
        } else {
          await wc.fs.rm(name);
        }
      } catch (err) {
        // Some entries may already be gone if the watcher triggered cleanup
        logger.error(`Failed to remove ${name}:`, err);
      }
    }

    logger.info('WebContainer workdir wiped successfully');
  } catch (err) {
    logger.error('Failed to wipe WebContainer workdir:', err);
  }
}
