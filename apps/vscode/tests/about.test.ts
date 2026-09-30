import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildAbout } from '../src/about.js';
import { renderWebviewHtml } from '../src/webview_html.js';

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as Record<string, unknown>;

describe('about page', () => {
  it('reports the packaged version, so it matches the installed VSIX', () => {
    expect(buildAbout(manifest).version).toBe(manifest.version);
  });

  it('normalizes git+https shorthand and template placeholders to real urls', () => {
    const about = buildAbout({
      version: '1.0.0',
      description: 'x',
      license: 'MIT',
      repository: { url: 'git+https://github.com/o/r.git#main' },
      bugs: { url: 'https://github.com/o/r/issues' },
      homepage: 'https://github.com/o/r#readme',
    });
    expect(about.repository).toBe('https://github.com/o/r');
    expect(about.documentation).toBe('https://github.com/o/r#readme');
    expect(about.issues).toBe('https://github.com/o/r/issues');
  });

  it('rejects metadata that would render an unusable or unsafe About page', () => {
    expect(() => buildAbout({ version: '1.0.0', description: 'x', license: 'MIT', homepage: 'javascript:alert(1)' })).toThrow();
    expect(() => buildAbout({ version: '', description: 'x', license: 'MIT', homepage: 'https://x' })).toThrow();
  });

  it('builds a valid About page from this extension manifest', () => {
    expect(buildAbout(manifest)).toMatchObject({ version: manifest.version, license: expect.any(String) });
  });
});

describe('webview markup', () => {
  const html = renderWebviewHtml({ cspSource: 'vscode-resource:', nonce: 'abc123', asset: (file) => `vscode-resource:/media/${file}` });

  it('locks the webview down to its own nonce and resources', () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    // No inline handler, remote script, or eval may appear. Anchored on a tag so
    // it cannot match the "ontent=" inside Content-Security-Policy.
    expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/https?:\/\/[^"']*\.js/);
    expect(html).not.toContain('eval(');
    expect(html).not.toMatch(/<script(?![^>]*nonce)/);
  });

  it('loads its script with the same nonce the policy requires', () => {
    expect(html).toContain('<script nonce="abc123" src="vscode-resource:/media/main.js">');
    expect(html).toContain('href="vscode-resource:/media/main.css"');
  });
});