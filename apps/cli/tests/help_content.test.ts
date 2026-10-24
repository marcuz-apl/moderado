import { describe, expect, it } from 'vitest';
import { getHelpCommandLines } from '../src/ui/help_content.js';

describe('organized help commands', () => {
  it('groups commands by purpose in a stable order', () => {
    expect(getHelpCommandLines()).toEqual([
      'Configuration',
      '  /budget      - Set a per-task token limit (/budget 5000, /budget off)',
      '  /connect     - Choose a Gateway, hosted, or local provider',
      '  /model       - Switch active AI model',
      '  /mcp         - Manage local MCP servers',
      '  /skills      - List skills; use /skills on|off NAME|PATTERN (* for all)',
      'Workspace',
      '  /init        - Scaffold AGENTS.md from workspace scan',
      '  /map         - Show a compact workspace file map',
      '  /review      - Review current workspace changes for bugs',
      'Session',
      '  /btw         - Ask an ephemeral side question (no session pollution)',
      '  /queue       - Add, inspect, or clear queued follow-up commands',
      '  /session     - Create, resume, undo, redo, share, export, or compact sessions',
      '  /transcript  - Read the whole conversation in your pager (PgUp/PgDn scrolls the answer)',
      '  /workflow    - Inspect Git, build plans, or undo agent changes',
      'Help',
      '  /clear       - Reset conversation memory',
      '  /help        - Display commands & shortcuts',
      '  /about       - Show version and copyright info',
      '  /exit        - Exit Moderado',
    ]);
  });
});
