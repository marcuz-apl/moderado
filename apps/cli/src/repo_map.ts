import { listFiles } from '@moderado/tools';

export function formatWorkspaceMap(files: string[]): string {
  if (files.length === 0) return 'Workspace map: no files found.';
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.replace(/[\x00-\x1f\x7f-\x9f]/g, '?').replace(/\\/g, '/').split('/');
    const group = parts.length === 1 ? '(root)' : ['apps', 'packages'].includes(parts[0]) && parts.length > 2
      ? parts.slice(0, 2).join('/') : parts[0];
    const item = group === '(root)' ? parts[0] : parts.slice(group.split('/').length).join('/');
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const ordered = [...groups].sort(([a], [b]) => a.localeCompare(b));
  const lines = [`Workspace map (${files.length}${files.length >= 1000 ? '+' : ''} files scanned):`];
  for (const [group, items] of ordered.slice(0, 14)) {
    const selected = items.sort((a, b) => {
      const rank = (name: string) => name.startsWith('src/') ? 0 : name === 'package.json' || name === 'README.md' ? 1 : 2;
      return rank(a) - rank(b) || a.localeCompare(b);
    }).slice(0, 3);
    lines.push(`${group} (${items.length} ${items.length === 1 ? 'file' : 'files'}): ${selected.join(', ')}${items.length > selected.length ? ', …' : ''}`);
  }
  if (ordered.length > 14) lines.push(`… ${ordered.length - 14} more modules`);
  return lines.join('\n');
}

export async function buildWorkspaceMap(root: string): Promise<string> {
  return formatWorkspaceMap(await listFiles(root, '', { recursive: true, maxDepth: 8, limit: 1000 }));
}
