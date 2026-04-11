import type { ServerBuild } from '@remix-run/cloudflare';
import { createPagesFunctionHandler } from '@remix-run/cloudflare-pages';
import { verifyToken, getTokenFromCookie, makeAuthCookie, unauthorizedResponse, COOKIE_NAME } from '../app/lib/auth/codespace-auth';

/**
 * Cloudflare Pages function handler — catches ALL requests before Remix routes.
 *
 * Auth flow:
 * 1. If `?token=xxx` query param → validate JWT → set cookie → redirect to clean URL
 * 2. If `codespace_auth` cookie present → validate JWT → proceed to Remix
 * 3. Otherwise → 401 Unauthorized
 *
 * Static assets (.js, .css, .svg, etc.) are served by Wrangler before this
 * function runs, so they bypass auth automatically.
 */
export const onRequest: PagesFunction = async (context) => {
  const request = context.request;
  const url = new URL(request.url);

  // -----------------------------------------------------------------------
  // Health check — bypass auth so Railway/Docker healthcheck gets a 200
  // -----------------------------------------------------------------------
  if (url.pathname === '/health') {
    return new Response('OK', { status: 200 });
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

    // Strip the token param and redirect to clean URL
    url.searchParams.delete('token');

    const response = new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        'Set-Cookie': makeAuthCookie(tokenParam),
      },
    });

    return response;
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

      return handler(context);
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
