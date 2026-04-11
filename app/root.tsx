import { useStore } from '@nanostores/react';
import type { LinksFunction, LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from '@remix-run/react';
import tailwindReset from '@unocss/reset/tailwind-compat.css?url';
import { themeStore } from './lib/stores/theme';
import { stripIndents } from './utils/stripIndent';
import { createHead } from 'remix-island';
import { useEffect } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ClientOnly } from 'remix-utils/client-only';
import { cssTransition, ToastContainer } from 'react-toastify';

import reactToastifyStyles from 'react-toastify/dist/ReactToastify.css?url';
import globalStyles from './styles/index.scss?url';
import xtermStyles from '@xterm/xterm/css/xterm.css?url';

import 'virtual:uno.css';

const toastAnimation = cssTransition({
  enter: 'animated fadeInRight',
  exit: 'animated fadeOutRight',
});

export const links: LinksFunction = () => [
  {
    rel: 'icon',
    href: '/favicon.svg',
    type: 'image/svg+xml',
  },
  { rel: 'stylesheet', href: reactToastifyStyles },
  { rel: 'stylesheet', href: tailwindReset },
  { rel: 'stylesheet', href: globalStyles },
  { rel: 'stylesheet', href: xtermStyles },
  {
    rel: 'preconnect',
    href: 'https://fonts.googleapis.com',
  },
  {
    rel: 'preconnect',
    href: 'https://fonts.gstatic.com',
    crossOrigin: 'anonymous',
  },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
];

// ---------------------------------------------------------------------------
// Root Loader — passes server-side env vars to the client
// ---------------------------------------------------------------------------

export async function loader({ context }: LoaderFunctionArgs) {
  const env = (context.cloudflare?.env || {}) as unknown as Record<string, string>;

  return json({
    codespaceApiBaseUrl: env.CODESPACE_API_BASE_URL || process.env.CODESPACE_API_BASE_URL || null,
  });
}

const inlineThemeCode = stripIndents`
  setTutorialKitTheme();

  function setTutorialKitTheme() {
    // Migrate old bolt_ keys to hack_cortex_ on first load
    (function migrateKeys() {
      var oldKeys = [
        'bolt_theme', 'bolt_user_profile', 'bolt_profile', 'bolt_settings',
        'bolt_tab_configuration', 'bolt_viewed_features', 'bolt_developer_mode',
        'bolt_acknowledged_connection_issue', 'bolt_acknowledged_debug_issues',
        'bolt_read_logs', 'bolt_last_acknowledged_version', 'bolt_chat_history',
        'bolt_current_model', 'bolt_current_provider', 'bolt_project_type', 'bolt_git_info'
      ];
      for (var i = 0; i < oldKeys.length; i++) {
        var oldKey = oldKeys[i];
        var newKey = oldKey.replace('bolt_', 'hack_cortex_');
        var val = localStorage.getItem(oldKey);
        if (val !== null && localStorage.getItem(newKey) === null) {
          localStorage.setItem(newKey, val);
        }
        localStorage.removeItem(oldKey);
      }
    })();

    // Try to extract theme_id from JWT in URL
    var themeId = null;
    try {
      var params = new URLSearchParams(window.location.search);
      var tk = params.get('token');
      if (tk) {
        var parts = tk.split('.');
        if (parts.length === 3) {
          var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          var payload = JSON.parse(atob(b64));
          if (payload && payload.theme_id) {
            themeId = payload.theme_id;
            window.__CODESPACE_THEME_ID__ = themeId;
          }
        }
      }
    } catch(e) {}

    // If we got a synced theme, detect dark/light from preset background luminance
    // The full theme colors will be applied by React once hydrated
    var mode = localStorage.getItem('hack_cortex_theme');
    if (!mode) {
      mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // For synced themes, always default to dark mode (most presets are dark-first)
    if (themeId && themeId !== 'dark' && themeId !== 'light') {
      mode = 'dark';
    }

    document.querySelector('html')?.setAttribute('data-theme', mode);
  }
`;

/**
 * PostMessage bridge script — injected inline in <head> so it runs before
 * React hydrates. Handles bidirectional communication with the parent app.
 *
 * Protocol (codespace: namespace):
 *   Parent → iframe:
 *     - codespace:auth-token   { token: string }
 *     - codespace:theme-sync   { mode: "light"|"dark", accentId: string }
 *     - codespace:github-token { connected: boolean, token: string|null, username: string|null }
 *   iframe → Parent:
 *     - codespace:ready
 *     - codespace:request-token-refresh
 *     - codespace:request-github-token
 */
const postMessageBridgeCode = stripIndents`
  (function() {
    // Signal to the parent that the iframe is ready
    function sendReady() {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'codespace:ready' }, '*');
      }
    }

    // Listen for messages from parent app
    window.addEventListener('message', function(event) {
      // Only process messages with our namespace
      var data = event.data;
      if (!data || typeof data.type !== 'string' || data.type.indexOf('codespace:') !== 0) {
        return;
      }

      switch (data.type) {
        case 'codespace:auth-token':
          if (data.token) {
            // Store the token so nanostores can pick it up
            window.__CODESPACE_TOKEN__ = data.token;
            // Also update the cookie via a lightweight fetch to ourselves
            document.cookie = 'codespace_auth=' + data.token + '; path=/; secure; samesite=none; max-age=3600';
            // Dispatch custom event so React components can react
            window.dispatchEvent(new CustomEvent('codespace:token-updated', { detail: { token: data.token } }));
          }
          break;

        case 'codespace:theme-sync':
          // Store the themeId for React to pick up and apply via theme mapper.
          // The inline script cannot import ES modules, so full theme application
          // happens in the React onThemeUpdated listener.
          if (data.themeId) {
            window.__CODESPACE_THEME_ID__ = data.themeId;
            window.__CODESPACE_THEME__ = { mode: data.mode || 'dark', accentId: data.themeId };
            window.dispatchEvent(new CustomEvent('codespace:theme-updated', { detail: { themeId: data.themeId, mode: data.mode } }));
          } else if (data.mode) {
            // Fallback: simple dark/light toggle without a preset
            document.querySelector('html')?.setAttribute('data-theme', data.mode);
            localStorage.setItem('hack_cortex_theme', data.mode);
            window.__CODESPACE_THEME__ = { mode: data.mode, accentId: data.accentId || '' };
            window.dispatchEvent(new CustomEvent('codespace:theme-updated', { detail: window.__CODESPACE_THEME__ }));
          }
          break;

        case 'codespace:github-token':
          window.__CODESPACE_GITHUB__ = {
            connected: !!data.connected,
            token: data.token || null,
            username: data.username || null
          };
          window.dispatchEvent(new CustomEvent('codespace:github-updated', { detail: window.__CODESPACE_GITHUB__ }));
          break;
      }
    });

    // Extract initial token from URL (before redirect strips it)
    var params = new URLSearchParams(window.location.search);
    var urlToken = params.get('token');
    if (urlToken) {
      window.__CODESPACE_TOKEN__ = urlToken;
      // Persist to cookie so token survives full-page navigations (e.g. sidebar <a> clicks)
      document.cookie = 'codespace_auth=' + urlToken + '; path=/; secure; samesite=none; max-age=3600';
    }

    // Also try to extract from cookie
    if (!window.__CODESPACE_TOKEN__) {
      var match = document.cookie.match(/(?:^|;\\s*)codespace_auth=([^;]*)/);
      if (match) {
        window.__CODESPACE_TOKEN__ = match[1];
      }
    }

    // Decode JWT payload to extract user profile (name, email)
    // JWT format: header.payload.signature — payload is base64url-encoded JSON
    if (window.__CODESPACE_TOKEN__) {
      try {
        var parts = window.__CODESPACE_TOKEN__.split('.');
        if (parts.length === 3) {
          // base64url → base64 → decode
          var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          var payload = JSON.parse(atob(b64));
          if (payload && (payload.name || payload.email)) {
            window.__CODESPACE_PROFILE__ = {
              username: payload.name || payload.email || '',
              email: payload.email || '',
              userId: payload.sub || '',
              workspaceId: payload.workspace_id || ''
            };
          }
        }
      } catch(e) {
        // JWT decode failed — ignore, profile will use fallback
      }
    }

    // Capture the referrer origin as a fallback for the dashboard URL.
    // When the user is redirected from the main app, document.referrer
    // contains the main app URL before navigation clears it.
    // Persist to localStorage so it survives in-app navigation.
    if (document.referrer) {
      try {
        var refOrigin = new URL(document.referrer).origin;
        // Only store if it's a different origin (i.e., the parent app, not self)
        if (refOrigin !== window.location.origin) {
          window.__CODESPACE_REFERRER_ORIGIN__ = refOrigin;
          localStorage.setItem('hack_cortex_dashboard_origin', refOrigin);
        }
      } catch(e) {}
    }
    // Fall back to previously stored origin
    if (!window.__CODESPACE_REFERRER_ORIGIN__) {
      var stored = localStorage.getItem('hack_cortex_dashboard_origin');
      if (stored) {
        window.__CODESPACE_REFERRER_ORIGIN__ = stored;
      }
    }

    // Send ready signal once DOM is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', sendReady);
    } else {
      sendReady();
    }
  })();
`;

export const Head = createHead(() => (
  <>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <Meta />
    <Links />
    <script dangerouslySetInnerHTML={{ __html: inlineThemeCode }} />
    <script dangerouslySetInnerHTML={{ __html: postMessageBridgeCode }} />
  </>
));

export function Layout({ children }: { children: React.ReactNode }) {
  const theme = useStore(themeStore);

  useEffect(() => {
    document.querySelector('html')?.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <>
      <ClientOnly>{() => <DndProvider backend={HTML5Backend}>{children}</DndProvider>}</ClientOnly>
      <ToastContainer
        closeButton={({ closeToast }) => {
          return (
            <button className="Toastify__close-button" onClick={closeToast}>
              <div className="i-ph:x text-lg" />
            </button>
          );
        }}
        icon={({ type }) => {
          switch (type) {
            case 'success': {
              return <div className="i-ph:check-bold text-bolt-elements-icon-success text-2xl" />;
            }
            case 'error': {
              return <div className="i-ph:warning-circle-bold text-bolt-elements-icon-error text-2xl" />;
            }
          }

          return undefined;
        }}
        position="bottom-right"
        pauseOnFocusLoss
        transition={toastAnimation}
        autoClose={3000}
      />
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

import { logStore } from './lib/stores/logs';
import { codespaceToken, codespaceTheme, codespaceGitHub, codespaceApiBaseUrl, codespaceProfile } from './lib/stores/codespace';
import { profileStore, updateProfile } from './lib/stores/profile';
import { findPreset } from './lib/themes/presets';
import { mapThemeToVars, applyThemeToDOM } from './lib/themes/theme-mapper';

export default function App() {
  const theme = useStore(themeStore);

  // Read server-injected env vars from the root loader
  const loaderData = useLoaderData<typeof loader>();

  useEffect(() => {
    logStore.logSystem('Application initialized', {
      theme,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });

    // Initialize debug logging with improved error handling
    import('./utils/debugLogger')
      .then(({ debugLogger }) => {
        /*
         * The debug logger initializes itself and starts disabled by default
         * It will only start capturing when enableDebugMode() is called
         */
        const status = debugLogger.getStatus();
        logStore.logSystem('Debug logging ready', {
          initialized: status.initialized,
          capturing: status.capturing,
          enabled: status.enabled,
        });
      })
      .catch((error) => {
        logStore.logError('Failed to initialize debug logging', error);
      });

    // -----------------------------------------------------------------------
    // Codespace bridge: Sync window globals → nanostores
    // The inline <script> in <Head> sets window.__CODESPACE_*__ before React
    // hydrates. We read those here and also listen for live updates.
    // -----------------------------------------------------------------------

    // Seed nanostores from globals set by the inline bridge script
    if (typeof window !== 'undefined') {
      const win = window as unknown as Record<string, unknown>;

      if (win.__CODESPACE_TOKEN__) {
        codespaceToken.set(win.__CODESPACE_TOKEN__ as string);
      }

      if (win.__CODESPACE_THEME__) {
        codespaceTheme.set(win.__CODESPACE_THEME__ as { mode: 'light' | 'dark'; accentId: string });
      }

      if (win.__CODESPACE_GITHUB__) {
        codespaceGitHub.set(
          win.__CODESPACE_GITHUB__ as { connected: boolean; token: string | null; username: string | null },
        );
      }

      // Seed user profile from JWT claims
      if (win.__CODESPACE_PROFILE__) {
        const p = win.__CODESPACE_PROFILE__ as { username: string; email: string; userId: string; workspaceId: string };
        codespaceProfile.set(p);

        // Also populate bolt.diy's own profileStore so all existing UI components
        // (Menu, AvatarDropdown, UserMessage) show the real name instead of "Guest User".
        // Only seed if the user hasn't already set a custom profile.
        const existingProfile = profileStore.get();

        if (!existingProfile?.username) {
          updateProfile({ username: p.username });
        }
      }

      // Set API base URL from the root loader (server env → client)
      // Falls back to the referrer origin captured by the inline script
      if (loaderData?.codespaceApiBaseUrl) {
        codespaceApiBaseUrl.set(loaderData.codespaceApiBaseUrl);
      } else if (win.__CODESPACE_REFERRER_ORIGIN__) {
        codespaceApiBaseUrl.set(win.__CODESPACE_REFERRER_ORIGIN__ as string);
      }

      // ─── Apply synced theme from JWT ─────────────────────────────────
      // The inline script extracted theme_id from the JWT before React loaded.
      // Now we apply the full theme colors using the mapper.
      const syncedThemeId = win.__CODESPACE_THEME_ID__ as string | undefined;

      if (syncedThemeId) {
        const preset = findPreset(syncedThemeId);

        if (preset) {
          const result = mapThemeToVars(preset);
          applyThemeToDOM(result);

          // Update the theme store so ThemeSwitch and other components are in sync
          themeStore.set(result.mode);
          localStorage.setItem('hack_cortex_theme', result.mode);

          // Store the synced theme ID for live updates
          codespaceTheme.set({ mode: result.mode, accentId: syncedThemeId });
        }
      }
    }

    // Live update listeners
    const onTokenUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;

      if (detail?.token) {
        codespaceToken.set(detail.token);
      }
    };

    const onThemeUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;

      if (detail?.themeId) {
        // Live theme sync: full preset application via mapper
        const preset = findPreset(detail.themeId);

        if (preset) {
          const result = mapThemeToVars(preset);
          applyThemeToDOM(result);
          themeStore.set(result.mode);
          localStorage.setItem('hack_cortex_theme', result.mode);
          codespaceTheme.set({ mode: result.mode, accentId: detail.themeId });
        }
      } else if (detail) {
        // Simple mode-only update (no preset)
        codespaceTheme.set(detail);
      }
    };

    const onGitHubUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail;

      if (detail) {
        codespaceGitHub.set(detail);
      }
    };

    window.addEventListener('codespace:token-updated', onTokenUpdated);
    window.addEventListener('codespace:theme-updated', onThemeUpdated);
    window.addEventListener('codespace:github-updated', onGitHubUpdated);

    return () => {
      window.removeEventListener('codespace:token-updated', onTokenUpdated);
      window.removeEventListener('codespace:theme-updated', onThemeUpdated);
      window.removeEventListener('codespace:github-updated', onGitHubUpdated);
    };
  }, []);

  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
