import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))); });

// Git Bash on Windows mangles native paths (C:\...) passed as arguments,
// so convert fixture paths to POSIX form before handing them to bash.
// NOTE: resolve Git Bash explicitly — C:\Windows\System32\bash.exe is WSL,
// which cannot see Windows temp paths.
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
function posix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
}

async function fixtureServer(root: string, tag: string, assetSha: string, manifestSha: string): Promise<{ port: number; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    if (req.url === '/repos/o/r/releases/latest') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ tag_name: tag }));
    } else if (req.url === `/releases/download/${tag}/moderado-linux-x64`) {
      res.end('binary-bytes');
    } else if (req.url === `/releases/download/${tag}/moderado-linux-x64.sha256`) {
      res.end(`${assetSha}  moderado-linux-x64\n`);
    } else if (req.url === `/releases/download/${tag}/manifest.json`) {
      res.end(JSON.stringify({ version: tag, revision: 'rev', artifacts: [{ target: 'node22-linux-x64', filename: 'moderado-linux-x64', platform: 'linux', architecture: 'x64', size: 12, checksum: manifestSha, signed: false }] }));
    } else {
      res.statusCode = 404;
      res.end('nope');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  void root;
  return { port, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

it('installs the binary only when asset and manifest checksums agree', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moderado-install-'));
  dirs.push(dir);
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update('binary-bytes').digest('hex');
  const scriptTemplate = await readFile('scripts/install.sh', 'utf8');
  const script = scriptTemplate.split('REPO="marcuz-apl/moderado"').join('REPO="o/r"')
    .split('https://api.github.com/repos/${REPO}/releases/latest').join('http://127.0.0.1:PORT_PLACEHOLDER/repos/o/r/releases/latest')
    .split('https://github.com/${REPO}/releases/download/${TAG}').join('http://127.0.0.1:PORT_PLACEHOLDER/releases/download/${TAG}');
  const { port, close } = await fixtureServer(dir, 'v9.9.9', sha, sha);
  try {
    const runner = join(dir, 'run.sh');
    await writeFile(runner, script.split('PORT_PLACEHOLDER').join(String(port)));
    await chmod(runner, 0o755);
    const home = await mkdtemp(join(tmpdir(), 'moderado-home-'));
    dirs.push(home);
    const target = join(dir, 'bin');
    const { stdout } = await execFileAsync(GIT_BASH, [posix(runner), '--dir', posix(target)], { env: { ...process.env, HOME: home, FAKE_OS: 'Linux', FAKE_ARCH: 'x86_64' } });
    expect(stdout).toContain('Installed moderado v9.9.9');
    expect(await readFile(join(target, 'moderado'), 'utf8')).toBe('binary-bytes');
  } finally { await close(); }
});

it('refuses to install when the checksum disagrees with the manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moderado-install-'));
  dirs.push(dir);
  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update('binary-bytes').digest('hex');
  const scriptTemplate = await readFile('scripts/install.sh', 'utf8');
  const script = scriptTemplate.split('REPO="marcuz-apl/moderado"').join('REPO="o/r"')
    .split('https://api.github.com/repos/${REPO}/releases/latest').join('http://127.0.0.1:PORT_PLACEHOLDER/repos/o/r/releases/latest')
    .split('https://github.com/${REPO}/releases/download/${TAG}').join('http://127.0.0.1:PORT_PLACEHOLDER/releases/download/${TAG}');
  const { port, close } = await fixtureServer(dir, 'v9.9.9', sha, '0'.repeat(64));
  try {
    const runner = join(dir, 'run.sh');
    await writeFile(runner, script.split('PORT_PLACEHOLDER').join(String(port)));
    await chmod(runner, 0o755);
    const home = await mkdtemp(join(tmpdir(), 'moderado-home-'));
    dirs.push(home);
    await expect(execFileAsync(GIT_BASH, [posix(runner), '--dir', posix(join(dir, 'bin'))], { env: { ...process.env, HOME: home, FAKE_OS: 'Linux', FAKE_ARCH: 'x86_64' } })).rejects.toThrow('manifest');
  } finally { await close(); }
});