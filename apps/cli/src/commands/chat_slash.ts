/**
 * Slash-command routing: the canonical command list, a typo-distance helper, and
 * the advice shown when the user types something the CLI does not recognise.
 *
 * Split out of `chat.ts`, which had grown to carry command routing, turn
 * execution, usage accounting and rendering at once.
 */

export const STANDARD_SLASH_COMMANDS = [
  '/connect',
  '/model',
  '/init',
  '/btw',
  '/mcp',
  '/session',
  '/transcript',
  '/queue',
  '/workflow',
  '/review',
  '/map',
  '/budget',
  '/skills',
  '/clear',
  '/help',
  '/exit',
  '/quit',
] as const;

export function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix: number[][] = [];
  for (let i = 0; i <= bn; i++) matrix[i] = [i];
  for (let j = 0; j <= an; j++) matrix[0][j] = j;

  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[bn][an];
}

export interface SlashCommandAdvice {
  isSlashCommand: boolean;
  isValid: boolean;
  suggestion?: string;
  advice?: string;
}

export function findSlashCommandAdvice(rawInput: string): SlashCommandAdvice {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('/')) {
    return { isSlashCommand: false, isValid: false };
  }

  const slashToken = trimmed.split(/\s+/)[0];
  const exactMatch = STANDARD_SLASH_COMMANDS.find((cmd) => cmd === slashToken);
  if (exactMatch) {
    return { isSlashCommand: true, isValid: true };
  }

  const lower = slashToken.toLowerCase();

  // Handle common shorthand like /? or /h
  if (lower === '/?' || lower === '/h') {
    return {
      isSlashCommand: true,
      isValid: false,
      suggestion: '/help',
      advice: `Unknown command "${slashToken}". Did you mean "/help"? Type /help to see available commands.`,
    };
  }

  // Check exact case-insensitive match (e.g. /EXIT -> /exit)
  const caseMatch = STANDARD_SLASH_COMMANDS.find((cmd) => cmd === lower);
  if (caseMatch) {
    return {
      isSlashCommand: true,
      isValid: false,
      suggestion: caseMatch,
      advice: `Unknown command "${slashToken}". Did you mean "${caseMatch}"? (Commands are lowercase). Type /help to see available commands.`,
    };
  }

  // Levenshtein distance check against standard commands
  let bestMatch: string | undefined;
  let bestDistance = Infinity;

  for (const cmd of STANDARD_SLASH_COMMANDS) {
    const dist = levenshteinDistance(lower, cmd);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = cmd;
    }
  }

  if (bestMatch && bestDistance <= 3) {
    return {
      isSlashCommand: true,
      isValid: false,
      suggestion: bestMatch,
      advice: `Unknown command "${slashToken}". Did you mean "${bestMatch}"? Type /help to see available commands.`,
    };
  }

  return {
    isSlashCommand: true,
    isValid: false,
    advice: `Unknown command "${slashToken}". Type /help to see available commands.`,
  };
}
