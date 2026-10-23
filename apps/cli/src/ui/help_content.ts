const HELP_COMMAND_GROUPS = [
  { name: 'Configuration', commands: [['/budget', 'Set a per-task token limit (/budget 5000, /budget off)'], ['/connect', 'Choose a Gateway, hosted, or local provider'], ['/model', 'Switch active AI model'], ['/mcp', 'Manage local MCP servers'], ['/skills', 'List skills; use /skills on|off NAME|PATTERN (* for all)']] },
  { name: 'Workspace', commands: [['/init', 'Scaffold AGENTS.md from workspace scan'], ['/map', 'Show a compact workspace file map'], ['/review', 'Review current workspace changes for bugs']] },
  { name: 'Session', commands: [['/btw', 'Ask an ephemeral side question (no session pollution)'], ['/queue', 'Add, inspect, or clear queued follow-up commands'], ['/session', 'Create, resume, undo, redo, share, export, or compact sessions'], ['/transcript', 'Read the whole conversation in your pager (PgUp/PgDn scrolls the answer)'], ['/workflow', 'Inspect Git, build plans, or undo agent changes']] },
  { name: 'Help', commands: [['/clear', 'Reset conversation memory'], ['/help', 'Display commands, shortcuts & version'], ['/exit', 'Exit Moderado']] },
] as const;

export function getHelpCommandLines(): string[] {
  // 13 leaves a gap after the longest command (`/transcript`), so the dash column
  // stays aligned instead of running into the name.
  return HELP_COMMAND_GROUPS.flatMap(({ name, commands }) => [name, ...commands.map(([command, description]) => `  ${command.padEnd(13)}- ${description}`)]);
}

export function getHelpCommandGroups(): readonly typeof HELP_COMMAND_GROUPS[number][] {
  return HELP_COMMAND_GROUPS;
}
