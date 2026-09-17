import fs from 'node:fs';
import path from 'node:path';
import { SecurityViolationError } from './errors.js';

const SENSITIVE_PATTERNS = [
  /^\.git([\\/]|$)/i,
  /^\.env(\.[a-zA-Z0-9_\-]+)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/i,
  /credentials\.json$/i,
];

export function isProtectedPath(relativePath: string): boolean {
  const normalized = relativePath.split(/[\\/]/).filter(Boolean);
  
  // Check if any segment is .git
  if (normalized.includes('.git')) {
    return true;
  }

  const basename = path.basename(relativePath);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(relativePath) || pattern.test(basename)) {
      return true;
    }
  }

  return false;
}

export function canonicalizeRoot(workspaceRoot: string): string {
  if (!fs.existsSync(workspaceRoot)) {
    throw new SecurityViolationError(`Workspace root directory does not exist: '${workspaceRoot}'`);
  }
  const stat = fs.statSync(workspaceRoot);
  if (!stat.isDirectory()) {
    throw new SecurityViolationError(`Workspace root is not a directory: '${workspaceRoot}'`);
  }
  return fs.realpathSync(workspaceRoot);
}

export function resolveInJail(workspaceRoot: string, targetPath: string): string {
  if (!targetPath || targetPath.trim() === '') {
    throw new SecurityViolationError("Path argument cannot be empty.");
  }

  const canonicalRoot = canonicalizeRoot(workspaceRoot);
  const absoluteTarget = path.resolve(canonicalRoot, targetPath);

  // Check if target exists; if so, resolve canonical symlinks
  let canonicalTarget: string;
  if (fs.existsSync(absoluteTarget)) {
    canonicalTarget = fs.realpathSync(absoluteTarget);
  } else {
    // For non-existent paths (e.g. write_file to new file), resolve the deepest existing parent
    let currentDir = path.dirname(absoluteTarget);
    const uncreatedSegments: string[] = [path.basename(absoluteTarget)];

    while (!fs.existsSync(currentDir)) {
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      uncreatedSegments.unshift(path.basename(currentDir));
      currentDir = parent;
    }

    if (fs.existsSync(currentDir)) {
      const canonicalParent = fs.realpathSync(currentDir);
      canonicalTarget = path.resolve(canonicalParent, ...uncreatedSegments);
    } else {
      canonicalTarget = absoluteTarget;
    }
  }

  // Jail containment check
  const isInside = canonicalTarget === canonicalRoot || canonicalTarget.startsWith(canonicalRoot + path.sep);
  if (!isInside) {
    throw new SecurityViolationError(
      `Access denied: path '${targetPath}' resolves to '${canonicalTarget}', which escapes workspace jail '${canonicalRoot}'.`
    );
  }

  // Relative path from canonical root to check protected file blacklist
  const relativeFromRoot = path.relative(canonicalRoot, canonicalTarget);
  if (isProtectedPath(relativeFromRoot)) {
    throw new SecurityViolationError(
      `Access denied: path '${targetPath}' refers to protected or sensitive metadata.`
    );
  }

  return canonicalTarget;
}
