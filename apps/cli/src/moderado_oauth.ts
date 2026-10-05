import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const MODERADO_OAUTH_CLIENT_ID = 'moderado-cli';
const AUTHORIZE_URL = 'https://mod.alfazen.org/authorize';
const TOKEN_URL = 'https://mod.alfazen.org/oauth/token';
const TOKEN_LIFETIME_SECONDS = 2_592_000;

export interface ModeradoOAuthRequest {
  state: string;
  verifier: string;
  redirectUri: string;
  authorizationUrl: string;
}

export function createModeradoOAuthRequest(redirectUri: string): ModeradoOAuthRequest {
  const callback = new URL(redirectUri);
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' || callback.pathname !== '/callback' || callback.search || callback.hash || callback.username || callback.password) {
    throw new Error('Moderado browser login requires an exact 127.0.0.1 /callback redirect URI.');
  }
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: MODERADO_OAUTH_CLIENT_ID,
    redirect_uri: callback.toString(),
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  }).toString();
  return { state, verifier, redirectUri: callback.toString(), authorizationUrl: authorize.toString() };
}

export function validateModeradoOAuthCallback(callbackUrl: string, request: ModeradoOAuthRequest): string {
  const expected = new URL(request.redirectUri);
  const rawPath = callbackUrl.startsWith('/')
    ? callbackUrl.split(/[?#]/, 1)[0]
    : callbackUrl.match(/^https?:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? '';
  if (rawPath !== expected.pathname) {
    throw new Error('Moderado browser login callback did not match the exact loopback callback path.');
  }
  let callback: URL;
  try { callback = new URL(callbackUrl, expected); }
  catch { throw new Error('Moderado browser login returned an invalid callback.'); }
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash) {
    throw new Error('Moderado browser login callback did not match the exact loopback callback.');
  }
  const states = callback.searchParams.getAll('state');
  const codes = callback.searchParams.getAll('code');
  if (states.length !== 1 || codes.length !== 1) throw new Error('Moderado browser login callback must include exactly one code and state.');
  if (states[0] !== request.state) {
    throw new Error('Moderado browser login callback failed state validation.');
  }
  const code = codes[0];
  if (!code || code.length > 2048) throw new Error('Moderado browser login callback did not include a valid code.');
  return code;
}

const tokenResponseSchema = z.object({
  access_token: z.string().regex(/^mrd_.+/),
  token_type: z.string().regex(/^Bearer$/i),
  expires_in: z.literal(TOKEN_LIFETIME_SECONDS),
});

export async function exchangeModeradoOAuthCode(
  code: string,
  request: ModeradoOAuthRequest,
  requestFetch: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  if (!code || code.length > 2048) throw new Error('Moderado browser login returned an invalid authorization code.');
  const response = await requestFetch(TOKEN_URL, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      code,
      verifier: request.verifier,
      client_id: MODERADO_OAUTH_CLIENT_ID,
      redirect_uri: request.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`Moderado browser login token exchange failed (HTTP ${response.status}).`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Moderado browser login returned an invalid token response.'); }
  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Moderado browser login returned an invalid or expired token response.');
  return { accessToken: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
}
