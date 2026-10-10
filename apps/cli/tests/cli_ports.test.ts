import { afterEach, expect, it, vi } from 'vitest';
import * as config from '../src/config.js';
import * as connect from '../src/ui/provider_connect.js';
import * as pricing from '../src/model_pricing.js';
import { renderWelcomeCard, stripAnsi } from '../src/ui/welcome.js';
import { handleModelsCommand } from '../src/commands/models.js';
import { parseCliArgs } from '../src/args.js';

afterEach(() => vi.restoreAllMocks());

it('offers only enabled built-ins plus configured custom providers', () => {
  const choices = connect.buildProviderPresets({ enabled: ['openrouter'], custom: [{ id: 'gateway', name: 'Gateway', baseUrl: 'https://gateway.example/v1' }] });
  expect(choices.map(choice => choice.value)).toEqual(['openrouter', 'custom:gateway']);
});

it('never labels paid output or an unknown aggregator model as free', () => {
  const unknown = { modelId: 'unknown', accessTier: 'free_trial', toolSupport: 'unknown', source: 'heuristic' } as const;
  expect(pricing.isFreeModelOption({ id: 'unknown', pricing: { prompt: '0', completion: '1' } }, unknown, { freeCatalog: true })).toBe(false);
  expect(pricing.isFreeModelOption({ id: 'unknown' }, unknown)).toBe(false);
  expect(pricing.isFreeModelOption({ id: 'orcarouter/notfree' }, unknown, config.freeModelPolicyFor('orcarouter'))).toBe(false);
  expect(pricing.isFreeModelOption({ id: 'orcarouter/free' }, unknown, config.freeModelPolicyFor('orcarouter'))).toBe(true);
});

it('places command suggestions before the input rather than beneath it', () => {
  const lines = stripAnsi(renderWelcomeCard({ model: 'test', tokens: 0, cost: 'unknown', workspace: '.', mode: 'Execute', autoApprove: false, input: '/co' })).split('\n');
  const input = lines.findIndex(line => line.trim().endsWith('/co'));
  const suggestions = lines.findIndex(line => line.includes('/connect'));
  expect(suggestions).toBeGreaterThanOrEqual(0);
  expect(suggestions).toBeLessThan(input);
});

it('reports model discovery failures instead of pretending the catalog is empty', async () => {
  let output = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
  const code = await handleModelsCommand(parseCliArgs(['models', '--provider', 'openrouter', '--json', '--non-interactive']), {
    fetchImpl: async () => { throw new Error('offline fixture'); },
  });
  expect(code).toBe(1);
  expect(JSON.parse(output).OpenRouter.error).toContain('offline fixture');
});
