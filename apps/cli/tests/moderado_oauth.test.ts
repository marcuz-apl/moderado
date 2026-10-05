import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createModeradoOAuthRequest, exchangeModeradoOAuthCode, validateModeradoOAuthCallback } from '../src/moderado_oauth.js';

describe('Moderado Cloud browser authorization', () => {
  it('creates a state-bound S256 authorization request for the exact loopback URI', () => {
    const request = createModeradoOAuthRequest('http://127.0.0.1:45123/callback');
    const url = new URL(request.authorizationUrl);
    expect(url.origin + url.pathname).toBe('https://mod.alfazen.org/authorize');
    expect(url.searchParams.get('client_id')).toBe('moderado-cli');
    expect(url.searchParams.get('redirect_uri')).toBe(request.redirectUri);
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(request.state).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(request.verifier).digest('base64url'));
    expect(request.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('exchanges codes using the same client id and redirect URI and validates 30-day token expiry', async () => {
    const request = createModeradoOAuthRequest('http://127.0.0.1:45123/callback');
    let sent: Record<string, unknown> | undefined;
    const credential = await exchangeModeradoOAuthCode('auth-code', request, async (_url, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ access_token: 'mrd_browser-token', token_type: 'Bearer', expires_in: 2592000 }));
    });
    expect(sent).toEqual({ code: 'auth-code', verifier: request.verifier, client_id: 'moderado-cli', redirect_uri: request.redirectUri });
    expect(credential).toEqual({ accessToken: 'mrd_browser-token', expiresAt: expect.any(Number) });
  });

  it('rejects a callback URI outside the exact loopback callback shape', () => {
    expect(() => createModeradoOAuthRequest('http://localhost:45123/callback')).toThrow('127.0.0.1');
    expect(() => createModeradoOAuthRequest('http://127.0.0.1:45123/other')).toThrow('callback');
  });

  it('accepts only the exact loopback callback origin and matching state', () => {
    const request = createModeradoOAuthRequest('http://127.0.0.1:45123/callback');
    expect(validateModeradoOAuthCallback(`/callback?code=one-time&state=${request.state}`, request)).toBe('one-time');
    expect(() => validateModeradoOAuthCallback(`/callback?code=one-time&state=wrong`, request)).toThrow(/state/);
    expect(() => validateModeradoOAuthCallback(`http://evil.test:45123/callback?code=x&state=${request.state}`, request)).toThrow(/callback/);
    expect(() => validateModeradoOAuthCallback(`http://127.0.0.1:45124/callback?code=x&state=${request.state}`, request)).toThrow(/callback/);
    expect(() => validateModeradoOAuthCallback(`/x/../callback?code=x&state=${request.state}`, request)).toThrow(/callback/);
    expect(() => validateModeradoOAuthCallback(`/callback/../callback?code=x&state=${request.state}`, request)).toThrow(/callback/);
    expect(() => validateModeradoOAuthCallback(`/callback?code=x&code=y&state=${request.state}`, request)).toThrow(/duplicate|exactly one/i);
    expect(() => validateModeradoOAuthCallback(`/callback?code=x&state=${request.state}&state=${request.state}`, request)).toThrow(/duplicate|exactly one/i);
  });

  it('pins token exchange to the fixed HTTPS endpoint and forbids redirects', async () => {
    const request = createModeradoOAuthRequest('http://127.0.0.1:45123/callback');
    let target = '';
    let redirect: unknown;
    await exchangeModeradoOAuthCode('auth-code', request, async (url, init) => {
      target = String(url);
      redirect = init?.redirect;
      return new Response(JSON.stringify({ access_token: 'mrd_browser-token', token_type: 'Bearer', expires_in: 2592000 }));
    });
    expect(target).toBe('https://mod.alfazen.org/oauth/token');
    expect(redirect).toBe('error');
  });

  it('rejects malformed or non-30-day token responses', async () => {
    const request = createModeradoOAuthRequest('http://127.0.0.1:45123/callback');
    await expect(exchangeModeradoOAuthCode('auth-code', request, async () =>
      new Response(JSON.stringify({ access_token: 'mrd_bad', token_type: 'Bearer', expires_in: 60 }))
    )).rejects.toThrow('invalid or expired token response');
  });
});
