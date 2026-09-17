import readline from 'node:readline';

export interface PromptOptions {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

export async function askQuestion(
  query: string,
  options: PromptOptions = {}
): Promise<string> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  try {
    if (stdin === process.stdin && typeof (stdin as any).read === 'function') {
      while ((stdin as any).read() !== null) {}
    }
  } catch {
    // ignore
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout,
    });

    const onAbort = () => {
      rl.close();
      resolve('');
    };

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    rl.question(query, (answer) => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function askSecret(
  query: string,
  options: PromptOptions = {}
): Promise<string> {
  // In Node terminal, askQuestion with clean prompt
  return askQuestion(query, options);
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  tag?: string;
}

export async function askSelect(
  title: string,
  choices: SelectOption[],
  defaultIndex = 0,
  options: PromptOptions = {}
): Promise<SelectOption> {
  const stdout = options.stdout ?? process.stdout;

  stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
  stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');

  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i];
    const isDefault = i === defaultIndex;
    const num = `[${i + 1}]`;
    const defaultTag = isDefault ? ' \x1b[32m(Default)\x1b[0m' : '';
    const tagText = choice.tag ? ` \x1b[36m[${choice.tag}]\x1b[0m` : '';

    stdout.write(`  \x1b[1m${num}\x1b[0m ${choice.label}${tagText}${defaultTag}\n`);
    if (choice.description) {
      stdout.write(`      \x1b[90m${choice.description}\x1b[0m\n`);
    }
  }

  stdout.write('\x1b[90m─────────────────────────────────────────────────────────────\x1b[0m\n');

  const answer = await askQuestion(
    `Select an option [1-${choices.length}] (default: ${defaultIndex + 1}): `,
    options
  );

  if (!answer) {
    return choices[defaultIndex];
  }

  const selectedNum = parseInt(answer, 10);
  if (!isNaN(selectedNum) && selectedNum >= 1 && selectedNum <= choices.length) {
    return choices[selectedNum - 1];
  }

  stdout.write(`\x1b[33mInvalid selection "${answer}". Using default: ${choices[defaultIndex].label}\x1b[0m\n`);
  return choices[defaultIndex];
}
