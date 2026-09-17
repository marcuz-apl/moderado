#!/usr/bin/env node

/**
 * Moderado Manual Live Smoke Test Runner
 *
 * Runs live inference against NVIDIA NIM using user-supplied credentials.
 * Automated test suites run 100% offline and never require this script.
 */

import { NvidiaAdapter } from '../packages/providers/dist/index.js';
import { Router } from '../packages/core/dist/index.js';

async function runLiveSmokeTest() {
  const apiKey = process.env.NVIDIA_API_KEY;

  console.log('=== Moderado Live Smoke Test ===\n');

  if (!apiKey) {
    console.log('\x1b[33m[INFO] NVIDIA_API_KEY environment variable is not set.\x1b[0m');
    console.log('Automated unit and integration test coverage runs completely offline.');
    console.log('\nTo execute a live smoke test against hosted NVIDIA NIM:');
    console.log('  1. PowerShell: $env:NVIDIA_API_KEY="nvapi-..."');
    console.log('     POSIX:      export NVIDIA_API_KEY="nvapi-..."');
    console.log('  2. Run:        node scripts/smoke_test.js\n');
    process.exit(0);
  }

  console.log('1. Discovering live models from NVIDIA NIM...');
  const adapter = new NvidiaAdapter({ apiKey });
  const router = new Router();

  try {
    const models = await adapter.discoverModels();
    console.log(`   \x1b[32mSUCCESS:\x1b[0m Discovered ${models.length} live models.`);

    const { selectedModel } = router.selectModel(models);
    console.log(`\n2. Free-First AUTO Router selected: \x1b[1m${selectedModel.id}\x1b[0m (${selectedModel.classification.accessTier})`);

    console.log('\n3. Testing streaming chat completion...');
    let text = '';
    for await (const chunk of adapter.streamChat({
      modelId: selectedModel.id,
      messages: [{ role: 'user', content: 'Say "Moderado Live OK" in 3 words.' }],
    })) {
      if (chunk.contentDelta) {
        text += chunk.contentDelta;
        process.stdout.write(chunk.contentDelta);
      }
    }

    console.log('\n\n\x1b[32m=== LIVE SMOKE TEST PASSED ===\x1b[0m');
  } catch (err) {
    console.error(`\n\x1b[31m[ERROR] Live test failed:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

runLiveSmokeTest();
