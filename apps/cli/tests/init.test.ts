import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IApprovalHandler, ApprovalRequest, ApprovalDecision } from '@moderado/contracts';
import { scanWorkspaceProject, generateAgentsScaffold, initWorkspace } from '../src/commands/init.js';

describe('/init Workspace Scaffolding', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moderado-init-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('scans package.json and project directories', () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'sample-project',
      description: 'A test project for /init',
      scripts: { test: 'vitest', build: 'tsc' },
    }));
    fs.mkdirSync(path.join(tempDir, 'src'));
    fs.mkdirSync(path.join(tempDir, 'docs'));

    const scan = scanWorkspaceProject(tempDir);
    expect(scan.name).toBe('sample-project');
    expect(scan.description).toBe('A test project for /init');
    expect(scan.scripts).toEqual({ test: 'vitest', build: 'tsc' });
    expect(scan.directories).toContain('src');
    expect(scan.directories).toContain('docs');
  });

  it('generates AGENTS.md markdown content containing scanned commands', () => {
    const scan = {
      name: 'weather-app',
      description: 'Weather forecasting app',
      ecosystem: 'Node.js / TypeScript',
      scripts: { test: 'npm test', start: 'node server.js' },
      directories: ['src', 'public'],
      hasReadme: true,
    };

    const scaffold = generateAgentsScaffold(scan);
    expect(scaffold).toContain('# weather-app Agent Guidelines (`AGENTS.md`)');
    expect(scaffold).toContain('npm run test');
    expect(scaffold).toContain('npm run start');
    expect(scaffold).toContain('src/');
    expect(scaffold).toContain('Minimalist Engineering');
  });

  it('requires write_file approval and writes AGENTS.md upon approval', async () => {
    let requested: ApprovalRequest | undefined;
    const approvalHandler: IApprovalHandler = {
      async requestApproval(request) {
        requested = request;
        return { requestId: request.requestId, status: 'approved' };
      },
    };

    let drawnLines: string[] = [];
    const drawFrame = (lines: string[]) => { drawnLines = lines; };

    const ok = await initWorkspace(tempDir, drawFrame, { approval: approvalHandler });
    expect(ok).toBe(true);
    expect(requested).toBeDefined();
    expect(requested?.toolName).toBe('write_file');
    expect(requested?.exactPayload).toMatchObject({ targetFile: 'AGENTS.md' });

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(agentsPath)).toBe(true);
    const content = fs.readFileSync(agentsPath, 'utf8');
    expect(content).toContain('Agent Guidelines (`AGENTS.md`)');
    expect(drawnLines.join('\n')).toContain('Successfully scaffolded AGENTS.md');
  });

  it('aborts without writing when approval is denied', async () => {
    const approvalHandler: IApprovalHandler = {
      async requestApproval(request) {
        return { requestId: request.requestId, status: 'rejected', reason: 'User denied' };
      },
    };

    let drawnLines: string[] = [];
    const drawFrame = (lines: string[]) => { drawnLines = lines; };

    const ok = await initWorkspace(tempDir, drawFrame, { approval: approvalHandler });
    expect(ok).toBe(false);

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    expect(fs.existsSync(agentsPath)).toBe(false);
    expect(drawnLines.join('\n')).toContain('was not approved');
  });
});
