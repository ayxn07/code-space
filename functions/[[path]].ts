import type { ServerBuild } from '@remix-run/cloudflare';
import { createPagesFunctionHandler } from '@remix-run/cloudflare-pages';
import { verifyToken, getTokenFromCookie, makeAuthCookie, unauthorizedResponse, COOKIE_NAME } from '../app/lib/auth/codespace-auth';

/**
 * Cross-Origin Isolation headers — required for WebContainers (SharedArrayBuffer).
 * Using "credentialless" COEP instead of "require-corp" so cross-origin
 * subresources (CDN scripts, LLM API calls, etc.) don't need CORS/CORP headers.
 */
const CROSS_ORIGIN_HEADERS: Record<string, string> = {
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/** Apply COOP/COEP headers to an existing Response (clones it). */
function withCrossOriginHeaders(response: Response): Response {
  const patched = new Response(response.body, response);

  for (const [key, value] of Object.entries(CROSS_ORIGIN_HEADERS)) {
    patched.headers.set(key, value);
  }

  return patched;
}

/**
 * Cloudflare Pages function handler — catches ALL requests before Remix routes.
 *
 * Auth flow:
 * 1. If `?token=xxx` query param → validate JWT → serve page directly + set cookie
 *    (NO redirect — credentialless iframes lose cookies during redirects)
 * 2. If `codespace_auth` cookie present → validate JWT → proceed to Remix
 * 3. Otherwise → 401 Unauthorized
 *
 * Static assets (.js, .css, .svg, etc.) are served by Wrangler before this
 * function runs, so they bypass auth automatically.
 *
 * IMPORTANT: Every response sets Cross-Origin-Embedder-Policy and
 * Cross-Origin-Opener-Policy so that `self.crossOriginIsolated === true`,
 * which WebContainers (SharedArrayBuffer) requires.
 */
export const onRequest: PagesFunction = async (context) => {
  const request = context.request;
  const url = new URL(request.url);

  // -----------------------------------------------------------------------
  // Health check — bypass auth so Railway/Docker healthcheck gets a 200
  // -----------------------------------------------------------------------
  if (url.pathname === '/health') {
    return new Response('OK', {
      status: 200,
      headers: { ...CROSS_ORIGIN_HEADERS },
    });
  }

  // Get the JWT secret from Cloudflare env bindings or process.env
  const secret =
    (context.env as unknown as Record<string, string>)?.CODESPACE_JWT_SECRET ||
    (typeof process !== 'undefined' ? process.env?.CODESPACE_JWT_SECRET : undefined);

  // -----------------------------------------------------------------------
  // Step 1: Check for token in query param (initial load from parent iframe)
  // -----------------------------------------------------------------------
  const tokenParam = url.searchParams.get('token');

  if (tokenParam) {
    const payload = await verifyToken(tokenParam, secret);

    if (!payload) {
      return unauthorizedResponse();
    }

    // Store validated payload in env for Remix routes to access
    (context.env as Record<string, unknown>).__codespace_user = payload;

    const serverBuild = (await import('../build/server')) as unknown as ServerBuild;

    const handler = createPagesFunctionHandler({
      build: serverBuild,
    });

    // Serve the page directly (no redirect). The parent iframe uses the
    // `credentialless` HTML attribute for cross-origin isolation, which
    // gives it an ephemeral cookie jar. Cookies set via Set-Cookie in this
    // response ARE stored in that jar and sent with subsequent same-origin
    // requests. A 302 redirect would lose the cookie in credentialless mode.
    const remixResponse = await handler(context);
    const patched = withCrossOriginHeaders(remixResponse);
    patched.headers.append('Set-Cookie', makeAuthCookie(tokenParam));

    return patched;
  }

  // -----------------------------------------------------------------------
  // Step 2: Check cookie on subsequent requests
  // -----------------------------------------------------------------------
  const cookieHeader = request.headers.get('Cookie');
  const cookieToken = getTokenFromCookie(cookieHeader);

  if (cookieToken) {
    const payload = await verifyToken(cookieToken, secret);

    if (payload) {
      // Store validated payload in env for Remix routes to access
      (context.env as Record<string, unknown>).__codespace_user = payload;

      const serverBuild = (await import('../build/server')) as unknown as ServerBuild;

      const handler = createPagesFunctionHandler({
        build: serverBuild,
      });

      // Run Remix handler and ensure COOP/COEP headers are present
      const remixResponse = await handler(context);

      return withCrossOriginHeaders(remixResponse);
    }

    // Cookie exists but token is invalid/expired — clear it and return 401
    const response = unauthorizedResponse();
    response.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`,
    );

    return response;
  }

  // -----------------------------------------------------------------------
  // Step 3: No auth at all — 401
  // -----------------------------------------------------------------------
  return unauthorizedResponse();
};
