/**
 * Codespace JWT Authentication
 *
 * Validates JWT tokens issued by the parent app (hack-agent).
 * Used by the function handler to gate access and by API routes
 * to identify the user/workspace.
 */
import { jwtVerify } from 'jose';

export const COOKIE_NAME = 'codespace_auth';

export interface CodespacePayload {
  sub: string; // user_id
  email: string;
  name: string;
  workspace_id: string;
  role: string; // workspace role
  iss: string; // "hack-agent"
  aud: string; // "codespace"
  iat: number;
  exp: number;
}

/**
 * Verifies a Codespace JWT token.
 * Returns the decoded payload if valid, or null if invalid/expired.
 *
 * The secret can come from either:
 * - Cloudflare env binding (in function handler)
 * - process.env (in Docker/Railway)
 */
export async function verifyToken(token: string, secret?: string): Promise<CodespacePayload | null> {
  const jwtSecret = secret || (typeof process !== 'undefined' ? process.env?.CODESPACE_JWT_SECRET : undefined);

  if (!jwtSecret) {
    console.error('[codespace-auth] CODESPACE_JWT_SECRET is not configured');
    return null;
  }

  try {
    const secretKey = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secretKey, {
      issuer: 'hack-agent',
      audience: 'codespace',
    });

    if (!payload.sub || !payload.workspace_id) {
      return null;
    }

    return payload as unknown as CodespacePayload;
  } catch {
    return null;
  }
}

/**
 * Extracts the JWT token from a Cookie header string.
 */
export function getTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map((c) => c.trim());

  for (const cookie of cookies) {
    if (cookie.startsWith(`${COOKIE_NAME}=`)) {
      return cookie.slice(COOKIE_NAME.length + 1);
    }
  }

  return null;
}

/**
 * Creates a Set-Cookie header value for the codespace auth token.
 */
export function makeAuthCookie(token: string, maxAgeSec = 3600): string {
  // SameSite=None + Secure required for cross-origin iframe cookies
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAgeSec}`;
}

/**
 * Creates the 401 Unauthorized HTML response.
 */
export function unauthorizedResponse(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Unauthorized</title>
<style>
  body { font-family: system-ui, sans-serif; display: flex; align-items: center;
         justify-content: center; min-height: 100vh; margin: 0; background: #0f0f0f; color: #e5e5e5; }
  .box { text-align: center; max-width: 400px; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p { color: #888; font-size: 0.875rem; line-height: 1.6; }
</style>
</head>
<body>
  <div class="box">
    <h1>Unauthorized</h1>
    <p>A valid authentication token is required to access Codespace.
       Please return to the main application and try again.</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  });
}
