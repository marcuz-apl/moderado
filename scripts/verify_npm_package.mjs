import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export function getNpmInvocation(platform = process.platform, executable = process.execPath, npmExecPath = process.env.npm_execpath) {
  if (platform === 'win32') {
    return {
      command: executable,
      prefix: [npmExecPath ?? join(dirname(executable), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    };
  }
  return { command: 'npm', prefix: [] };
}

export function createNpmEnvironment(cacheDirectory) {
  return { ...process.env, npm_config_cache: cacheDirectory };
}

export function getInstalledCliInvocation(prefix, executable = process.execPath, platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: executable,
      args: [join(prefix, 'node_modules', 'moderado', 'dist', 'index.js'), '--help'],
    };
  }
  return { command: join(prefix, 'bin', 'moderado'), args: ['--help'] };
}

async function runNpm(args, options) {
  const invocation = getNpmInvocation();
  return execFileAsync(invocation.command, [...invocation.prefix, ...args], options);
}

export function verifyPackedFiles(files) {
  for (const file of files) {
    if (file.includes('/node_modules/')) throw new Error(`node_modules is forbidden: ${file}`);
    if (/^package\/(src|tests)\//.test(file)) throw new Error(`source file is forbidden: ${file}`);
    if (/^package\/(\.moderado|logs|sessions|config)/.test(file)) throw new Error(`user data is forbidden: ${file}`);
  }
}

async function pack(cliDirectory, cacheDirectory) {
  const { stdout } = await runNpm(['pack', '--json', '--ignore-scripts'], {
    cwd: cliDirectory,
    env: createNpmEnvironment(cacheDirectory),
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string') {
    throw new Error('npm pack did not return exactly one package result.');
  }
  const files = result[0].files?.map((entry) => `package/${entry.path}`);
  if (!Array.isArray(files)) throw new Error('npm pack did not provide a package file list.');
  verifyPackedFiles(files);
  return join(cliDirectory, result[0].filename);
}

async function installAndSmokeTest(tarball, cacheDirectory) {
  const prefix = await mkdtemp(join(tmpdir(), 'moderado-npm-install-'));
  try {
    await runNpm(['install', '--global', '--prefix', prefix, '--ignore-scripts', tarball], {
      env: createNpmEnvironment(cacheDirectory),
    });
    const invocation = getInstalledCliInvocation(prefix);
    const { stdout } = await execFileAsync(invocation.command, invocation.args);
    if (!stdout.includes('moderado')) throw new Error('Installed CLI did not print the expected help text.');
  } finally {
    await rm(prefix, { force: true, recursive: true });
  }
}

export async function verifyNpmPackage(repoRoot) {
  const cliDirectory = join(resolve(repoRoot), 'apps', 'cli');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'moderado-npm-verify-'));
  try {
    const tarball = await pack(cliDirectory, join(temporaryRoot, 'cache'));
    await installAndSmokeTest(tarball, join(temporaryRoot, 'cache'));
    return basename(tarball);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyNpmPackage(process.cwd()).then((tarball) => {
    console.log(`Verified ${tarball}`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
