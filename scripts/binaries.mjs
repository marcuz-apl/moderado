import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepareNpmPackage } from './prepare_npm_package.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export function binaryTargets() {
  return [
    { target: 'node22-win-x64', filename: 'moderado-win-x64.exe', platform: 'win32', architecture: 'x64' },
    { target: 'node22-macos-arm64', filename: 'moderado-macos-arm64', platform: 'darwin', architecture: 'arm64' },
    { target: 'node22-linux-x64', filename: 'moderado-linux-x64', platform: 'linux', architecture: 'x64' },
  ];
}

export function artifactDirectory(root, version, target) {
  return join(root, version, target.target);
}

export function buildCommand(target, entry, outputDirectory) {
  return ['pkg', entry, '--target', target.target, '--output', join(outputDirectory, target.filename)];
}

export function pkgInvocation(executable, pkgBin, command) {
  return { command: executable, args: [pkgBin, ...command.slice(1)] };
}

export function pkgEnvironment(cacheDirectory) {
  return { ...process.env, PKG_CACHE_PATH: cacheDirectory };
}

function findTarget(name) {
  const target = binaryTargets().find((candidate) => candidate.target === name);
  if (!target) throw new Error(`Unsupported binary target: ${name}`);
  return target;
}

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function assertArtifactShape(artifact) {
  if (!artifact || typeof artifact !== 'object'
    || typeof artifact.target !== 'string' || typeof artifact.filename !== 'string'
    || typeof artifact.platform !== 'string' || typeof artifact.architecture !== 'string'
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1
    || !/^[a-f0-9]{64}$/.test(artifact.checksum) || artifact.signed !== false) {
    throw new Error('Artifact manifest contains an invalid artifact entry.');
  }
}

export async function writeArtifactManifest(directory, version, revision, targets) {
  if (!version.startsWith('v') || !revision) throw new Error('Artifact manifest version or revision is invalid.');
  if (new Set(targets.map((target) => target.target)).size !== targets.length) throw new Error('Artifact manifest contains duplicate targets.');
  const artifacts = await Promise.all(targets.map(async (target) => {
    const file = join(directory, target.filename);
    const checksum = await digest(file);
    const info = await stat(file);
    await writeFile(`${file}.sha256`, `${checksum}  ${target.filename}\n`);
    return { ...target, size: info.size, checksum, signed: false };
  }));
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify({ version, revision, artifacts }, null, 2)}\n`);
}

export async function verifyArtifactManifest(directory, version) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || typeof manifest.revision !== 'string' || !manifest.revision || !Array.isArray(manifest.artifacts)) {
    throw new Error('Artifact manifest version is invalid.');
  }
  const names = new Set();
  for (const artifact of manifest.artifacts) {
    assertArtifactShape(artifact);
    if (names.has(artifact.target)) throw new Error('Artifact manifest contains duplicate targets.');
    names.add(artifact.target);
    const file = join(directory, artifact.filename);
    const checksum = await digest(file);
    const checksumFile = await readFile(`${file}.sha256`, 'utf8').catch(() => {
      throw new Error(`Artifact checksum file is missing for ${artifact.filename}.`);
    });
    if (checksumFile !== `${artifact.checksum}  ${artifact.filename}\n` || checksum !== artifact.checksum) {
      throw new Error(`Artifact checksum verification failed for ${artifact.filename}.`);
    }
    if ((await stat(file)).size !== artifact.size) throw new Error(`Artifact size verification failed for ${artifact.filename}.`);
  }
  return undefined;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { shell: false, stdio: 'inherit', ...options });
    child.on('error', rejectRun);
    child.on('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with code ${code ?? 'unknown'}.`)));
  });
}

async function readVersion(repoRoot) {
  return (await readFile(join(repoRoot, 'VERSION'), 'utf8')).trim();
}

async function readRevision(repoRoot, supplied) {
  if (supplied) return supplied;
  try {
    return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
  } catch {
    return 'unknown';
  }
}

export async function buildBinary(repoRoot, targetName, suppliedRevision) {
  const root = resolve(repoRoot);
  const target = findTarget(targetName);
  const version = await readVersion(root);
  const revision = await readRevision(root, suppliedRevision);
  const directory = artifactDirectory(join(root, 'artifacts'), version, target);
  await prepareNpmPackage(root);
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  const command = buildCommand(target, join(root, 'apps', 'cli', 'dist', 'index.js'), directory);
  const invocation = pkgInvocation(process.execPath, require.resolve('@yao-pkg/pkg/lib-es5/bin.js'), command);
  await run(invocation.command, invocation.args, { cwd: root, env: pkgEnvironment(join(root, '.pkg-cache')) });
  await writeArtifactManifest(directory, version, revision, [target]);
  return directory;
}

export async function verifyBinaryArtifacts(directory, version, targetName) {
  await verifyArtifactManifest(directory, version);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const host = manifest.artifacts.find((artifact) => artifact.platform === process.platform && artifact.architecture === process.arch);
  if (!host) return manifest;
  if (targetName && host.target !== targetName) throw new Error(`Host artifact does not match requested target ${targetName}.`);
  const { stdout } = await execFileAsync(join(directory, host.filename), ['--help']);
  if (!stdout.includes('moderado')) throw new Error('Standalone binary did not print the expected help text.');
  return manifest;
}

export async function mergeArtifactManifests(inputDirectories, outputDirectory, version, revision) {
  await Promise.all(inputDirectories.map((directory) => verifyArtifactManifest(directory, version)));
  const manifests = await Promise.all(inputDirectories.map(async (directory) =>
    JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  ));
  const artifacts = manifests.flatMap((manifest) => manifest.artifacts);
  if (new Set(artifacts.map((artifact) => artifact.target)).size !== artifacts.length) throw new Error('Cannot merge duplicate binary targets.');
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  for (const [index, manifest] of manifests.entries()) {
    for (const artifact of manifest.artifacts) await cp(join(inputDirectories[index], artifact.filename), join(outputDirectory, artifact.filename));
  }
  await writeArtifactManifest(outputDirectory, version, revision, artifacts.map(({ size, checksum, signed, ...target }) => target));
}

function option(args, name, required = true) {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (!value && required) throw new Error(`Missing ${name} option.`);
  return value;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  const root = process.cwd();
  const version = await readVersion(root);
  if (action === 'build') {
    await buildBinary(root, option(args, '--target'), option(args, '--revision', false));
  } else if (action === 'verify') {
    const targetName = option(args, '--target', false);
    const directory = option(args, '--directory', false) ?? (targetName ? artifactDirectory(join(root, 'artifacts'), version, findTarget(targetName)) : undefined);
    if (!directory) throw new Error('Missing --directory or --target option.');
    await verifyBinaryArtifacts(directory, version, targetName);
  } else if (action === 'merge') {
    const sources = option(args, '--source').split(',').map((directory) => resolve(root, directory));
    await mergeArtifactManifests(sources, resolve(root, option(args, '--output')), version, option(args, '--revision', false) ?? await readRevision(root));
  } else {
    throw new Error('Usage: binaries.mjs <build|verify|merge> --target <target>');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
