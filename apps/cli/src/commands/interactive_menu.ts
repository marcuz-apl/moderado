import { CliParsedArgs, getHelpText } from '../args.js';
import { askQuestion, askSecret, askSelect, SelectOption } from '../ui/prompt.js';
import { handleModelsCommand } from './models.js';
import { handleRunCommand } from './run.js';
import { resolveApiKey, saveConfig, loadConfig } from '../config.js';
import { selectModelInteractive } from '../ui/model_selector.js';
import { exitCleanly } from '../ui/welcome.js';

export async function handleInteractiveMenu(
  args: CliParsedArgs,
  version: string,
  signal?: AbortSignal
): Promise<number> {
  const cwd = process.cwd();
  const config = loadConfig();
  const currentModelDisplay = config.defaultModel ? config.defaultModel : 'Auto (Free-First)';

  process.stdout.write(`\n\x1b[1mModerado ${version}\x1b[0m | Workspace: \x1b[36m${cwd}\x1b[0m\n`);
  process.stdout.write(`Model: \x1b[35m${currentModelDisplay}\x1b[0m | NVIDIA NIM free-first routing\n`);

  const choices: SelectOption[] = [
    {
      label: 'Start a coding task',
      value: 'task',
      tag: 'Interactive',
      description: 'Enter a task prompt and run autonomous coding agent',
    },
    {
      label: `Select Model (Free or Paid)`,
      value: 'model_select',
      tag: currentModelDisplay.includes('Auto') ? 'Auto' : 'Configured',
      description: `Current: ${currentModelDisplay} - switch to Free or Paid models`,
    },
    {
      label: 'Discover models (moderado models)',
      value: 'models',
      tag: 'Catalog',
      description: 'Inspect live NVIDIA NIM models, capability & free trial tiers',
    },
    {
      label: 'Configure API Key',
      value: 'config',
      tag: 'Settings',
      description: 'View or update your persistent NVIDIA API key in ~/.moderado/config.json',
    },
    {
      label: 'View help & command options',
      value: 'help',
      tag: 'Docs',
      description: 'Display CLI flags, environment variables, and usage examples',
    },
    {
      label: 'Exit',
      value: 'exit',
      tag: 'Quit',
      description: 'Exit Moderado',
    },
  ];

  const selection = await askSelect('What would you like to do?', choices, 0, { signal });

  if (selection.value === 'exit') {
    exitCleanly('\x1b[32mGoodbye! Stay Tuned with Moderado!\x1b[0m');
  }

  if (selection.value === 'model_select') {
    await selectModelInteractive({ signal, saveSelectionByDefault: true });
    // Re-display menu with updated model
    return handleInteractiveMenu(args, version, signal);
  }

  if (selection.value === 'help') {
    process.stdout.write(getHelpText());
    return 0;
  }

  if (selection.value === 'models') {
    return handleModelsCommand(args);
  }

  if (selection.value === 'config') {
    const existing = resolveApiKey();
    if (existing) {
      const masked = `${existing.slice(0, 10)}...${existing.slice(-4)}`;
      process.stdout.write(`\nCurrent API key: \x1b[32m${masked}\x1b[0m\n`);
    } else {
      process.stdout.write('\nNo API key currently saved or configured.\n');
    }

    const newKey = await askSecret('Enter new NVIDIA API Key (or press Enter to keep current): ', { signal });
    if (newKey) {
      saveConfig({ apiKey: newKey });
      process.stdout.write('\x1b[32m✔ API key saved to ~/.moderado/config.json\x1b[0m\n\n');
    }
    return 0;
  }

  // selection.value === 'task'
  process.stdout.write('\n');
  const taskPrompt = await askQuestion('Enter task prompt: ', { signal });
  if (!taskPrompt) {
    process.stdout.write('\x1b[33mNo task prompt entered. Exiting.\x1b[0m\n');
    return 0;
  }

  const runArgs: CliParsedArgs = {
    ...args,
    command: 'run',
    task: taskPrompt,
  };

  return handleRunCommand(runArgs, signal);
}
