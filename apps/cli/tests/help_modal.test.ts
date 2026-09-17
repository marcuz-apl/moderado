import { describe, it, expect } from 'vitest';
import { showHelpModal } from '../src/ui/help_modal.js';

describe('Help Modal Window', () => {
  it('is an exported function and handles aborted signal without error', async () => {
    expect(typeof showHelpModal).toBe('function');

    const controller = new AbortController();
    controller.abort();

    await expect(
      showHelpModal('v0.1.8', 'd:\\projects\\moderado', controller.signal)
    ).resolves.toBeUndefined();
  });
});
