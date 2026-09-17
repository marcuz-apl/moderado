import { NvidiaAdapter } from '@moderado/providers';
import { Router } from '@moderado/core';
import { CliParsedArgs } from '../args.js';

export async function handleModelsCommand(args: CliParsedArgs): Promise<number> {
  const provider = new NvidiaAdapter();
  const router = new Router();

  try {
    const inventory = await provider.discoverModels();

    if (args.json) {
      const output = inventory.map((entry) => ({
        id: entry.id,
        created: entry.created,
        ownedBy: entry.owned_by,
        classification: router.classifyModel(entry.id, args.profile.includes('local')),
      }));
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return 0;
    }

    process.stdout.write(`\n\x1b[1mDiscovered ${inventory.length} models from NVIDIA NIM:\x1b[0m\n\n`);
    process.stdout.write(
      `${'MODEL ID'.padEnd(46)} ${'ACCESS TIER'.padEnd(14)} ${'TOOL SUPPORT'.padEnd(14)} EVIDENCE\n`
    );
    process.stdout.write(`${'─'.repeat(46)} ${'─'.repeat(14)} ${'─'.repeat(14)} ${'─'.repeat(16)}\n`);

    for (const entry of inventory) {
      const meta = router.classifyModel(entry.id, args.profile.includes('local'));

      const accessColor =
        meta.accessTier === 'free_trial'
          ? '\x1b[32m'
          : meta.accessTier === 'local'
          ? '\x1b[36m'
          : meta.accessTier === 'paid'
          ? '\x1b[33m'
          : '\x1b[90m';

      const toolColor =
        meta.toolSupport === 'supported'
          ? '\x1b[32m'
          : meta.toolSupport === 'unsupported'
          ? '\x1b[31m'
          : '\x1b[90m';

      const formattedId = entry.id.length > 44 ? entry.id.slice(0, 41) + '...' : entry.id;

      process.stdout.write(
        `${formattedId.padEnd(46)} ${accessColor}${meta.accessTier.padEnd(14)}\x1b[0m ${toolColor}${meta.toolSupport.padEnd(14)}\x1b[0m ${meta.source}\n`
      );
    }

    process.stdout.write('\n');
    return 0;
  } catch (err: any) {
    process.stderr.write(`\x1b[1;31mFailed to discover models:\x1b[0m ${err.message}\n`);
    return 1;
  }
}
