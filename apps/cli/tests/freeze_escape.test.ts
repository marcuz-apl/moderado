import { afterEach, describe, expect, it, vi } from 'vitest';
import { forceExit } from '../src/http_shutdown.js';

/**
 * Regression cover for the "frozen CLI" report: raw-mode TUIs swallow the first
 * Ctrl+C as a keypress, so a stalled stream or hung tool used to trap the user.
 * `forceExit` is the escape hatch — it must always terminate with the requested
 * exit code (process.exit is stubbed so the test runner survives).
 */
describe('forceExit escape hatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with the requested code', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await forceExit(130);
    expect(exit).toHaveBeenCalledWith(130);
  });

  it('exits even when undici has no global dispatcher', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    // No undici.globalDispatcher.1 in the vitest environment — closeHttpConnections
    // must still resolve instead of hanging the escape hatch.
    await forceExit(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
