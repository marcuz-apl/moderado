import fs from 'node:fs';
import path from 'node:path';
import { ApprovalRequest, IApprovalHandler } from '@moderado/contracts';
import { resolveInJail, WriteFileTool } from '@moderado/tools';
import { renderBoxLines } from '../ui/popup.js';

export interface ProjectScanSummary {
  name: string;
  description: string;
  ecosystem: string;
  scripts: Record<string, string>;
  directories: string[];
  hasReadme: boolean;
}

/**
 * Scan workspace jail safely to extract project metadata for AGENTS.md.
 */
export function scanWorkspaceProject(workspaceRoot: string): ProjectScanSummary {
  let name = path.basename(workspaceRoot);
  let description = 'Project workspace for AI agent collaboration';
  let ecosystem = 'Node.js / TypeScript';
  const scripts: Record<string, string> = {};
  const directories: string[] = [];
  let hasReadme = false;

  try {
    const pkgPath = resolveInJail(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (raw.name) name = String(raw.name);
      if (raw.description) description = String(raw.description);
      if (raw.scripts && typeof raw.scripts === 'object') {
        for (const [k, v] of Object.entries(raw.scripts)) {
          if (typeof v === 'string') scripts[k] = v;
        }
      }
    }
  } catch {
    // Non-fatal if package.json does not exist or cannot be parsed
  }

  try {
    const readmePath = resolveInJail(workspaceRoot, 'README.md');
    if (fs.existsSync(readmePath)) {
      hasReadme = true;
      const readme = fs.readFileSync(readmePath, 'utf8');
      const firstHeading = readme.match(/^#\s+(.+)$/m);
      if (firstHeading && !name) {
        name = firstHeading[1].trim();
      }
    }
  } catch {
    // Non-fatal
  }

  // Detect other ecosystems if package.json wasn't present
  if (Object.keys(scripts).length === 0) {
    if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      ecosystem = 'Rust / Cargo';
    } else if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || fs.existsSync(path.join(workspaceRoot, 'requirements.txt'))) {
      ecosystem = 'Python';
    } else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
      ecosystem = 'Go';
    }
  }

  // Scan top-level dirs
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        directories.push(entry.name);
      }
    }
  } catch {
    // Non-fatal
  }

  return { name, description, ecosystem, scripts, directories, hasReadme };
}

/**
 * Generate standard, ponytail-compliant AGENTS.md content based on workspace scan.
 */
export function generateAgentsScaffold(scan: ProjectScanSummary): string {
  const scriptLines = Object.entries(scan.scripts).length > 0
    ? Object.entries(scan.scripts).map(([k, v]) => `- \`npm run ${k}\`: \`${v}\``).join('\n')
    : '- `npm test`: Run automated test suites\n- `npm run build`: Compile and build project artifacts';

  const dirList = scan.directories.length > 0
    ? scan.directories.map((d) => `- \`${d}/\`: Application components and source code`).join('\n')
    : '- `src/`: Core source files';

  return `# ${scan.name} Agent Guidelines (\`AGENTS.md\`)

> **Scope**: Guidelines and operating manual for AI coding agents and human contributors to \`${scan.name}\`.
> **Description**: ${scan.description}
> **Ecosystem**: ${scan.ecosystem}

---

## 1. Core Engineering Philosophy: Minimalist Engineering

Follow the Decision Ladder:
1. **YAGNI**: If speculative or unrequested, do not write it.
2. **Reuse**: Check for existing utilities, contracts, or schemas before authoring new ones.
3. **Standard Library**: Prefer runtime built-ins over adding third-party dependencies.
4. **Safety**: Validate boundary inputs with schemas and handle errors explicitly. Never fail silently.

---

## 2. Directory Layout & Architecture

${dirList}

---

## 3. Development Commands & Verification

${scriptLines}

---

## 4. Operational Boundaries & Security

- **Human-in-the-Loop**: All state mutations (file writes, edits, process executions) require interactive approval.
- **Workspace Jail**: Filesystem operations must remain inside the workspace jail. Never traverse outside the root.
- **Offline Integrity**: Automated unit tests must run offline without external API requirements.
`;
}

export interface InitWorkspaceContext {
  approval?: IApprovalHandler;
  signal?: AbortSignal;
}

/**
 * Perform /init workflow: scan workspace, scaffold AGENTS.md, request write_file approval,
 * and execute write through the workspace jail.
 */
export async function initWorkspace(
  workspaceRoot: string,
  drawFrame?: (popupLines: string[]) => void,
  context: InitWorkspaceContext = {}
): Promise<boolean> {
  const scan = scanWorkspaceProject(workspaceRoot);
  const content = generateAgentsScaffold(scan);
  const targetPath = 'AGENTS.md';

  if (context.approval) {
    const request: ApprovalRequest = {
      requestId: `init_agents_${Date.now()}`,
      toolName: 'write_file',
      actionSummary: `Scaffold AGENTS.md for ${scan.name}`,
      exactPayload: { targetFile: targetPath, contentPreview: content },
      timestamp: Date.now(),
    };

    const decision = await context.approval.requestApproval(request, context.signal);
    if (decision.status !== 'approved') {
      if (drawFrame) {
        drawFrame(renderBoxLines('Scaffold AGENTS.md', [
          'Scaffolding AGENTS.md was not approved.',
          '',
          'Press Esc or Enter to return.',
        ], 70));
      }
      return false;
    }
  }

  const write = await WriteFileTool.execute({ path: targetPath, content }, { workspaceRoot });
  if (write.status !== 'success') {
    if (drawFrame) {
      drawFrame(renderBoxLines('Scaffold AGENTS.md', [
        'Failed to write AGENTS.md:',
        write.output,
        '',
        'Press Esc or Enter to return.',
      ], 72));
    }
    return false;
  }

  if (drawFrame) {
    drawFrame(renderBoxLines('Scaffold AGENTS.md', [
      'Successfully scaffolded AGENTS.md.',
      `Project: ${scan.name}`,
      `Ecosystem: ${scan.ecosystem}`,
      '',
      'Press Esc or Enter to return.',
    ], 72));
  }
  return true;
}
