/**
 * Node 24 on Windows aborts inside libuv with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), win/async.c:94`
 * when `process.exit()` runs while undici's async handle is still closing —
 * which is every command that called `fetch()` and then exited hard.
 *
 * Closing the pooled connections and letting the event loop drain avoids the
 * race entirely; an idle keep-alive socket otherwise delays that drain by about
 * a second. Node does not expose undici's dispatcher publicly, so this is a
 * best-effort lookup: when it is absent the process still exits on its own.
 */
export async function closeHttpConnections(): Promise<void> {
  const dispatcher = (globalThis as Record<symbol, unknown>)[Symbol.for('undici.globalDispatcher.1')] as
    | { close?: () => Promise<void> }
    | undefined;
  try {
    await dispatcher?.close?.();
  } catch {
    // An unclosed pool only delays the natural exit; it is never fatal.
  }
}
