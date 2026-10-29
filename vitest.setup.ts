/**
 * The suite is offline by contract (AGENTS.md §5.2): unit and integration tests
 * use the fake provider and local loopback servers. A test that quietly reaches
 * a real service passes only while that service behaves, so every non-loopback
 * fetch is refused here instead.
 */
const loopbackFetch = globalThis.fetch;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '0.0.0.0', 'localhost']);

function isLoopbackUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  // `new URL('http://[::1]:1234')` reports the hostname with brackets.
  return LOOPBACK_HOSTS.has(parsed.hostname.replace(/^\[(.*)\]$/, '$1'));
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (!isLoopbackUrl(url)) {
    throw new Error(
      `Offline test guard: refused fetch to '${url}'. Serve it from a loopback server, or stub global fetch / inject a fetch implementation.`,
    );
  }
  return loopbackFetch(input as RequestInfo, init);
};
