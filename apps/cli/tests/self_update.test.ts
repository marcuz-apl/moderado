import { describe, expect, it } from 'vitest';
import {
  fetchPublishedReleases,
  parseInstalledVersion,
  parseReleaseMetadata,
  selectUpdateRelease,
  SelfUpdateError,
} from '../src/self_update.js';

const release = (tag_name: string, extra: Record<string, unknown> = {}) => ({
  tag_name,
  html_url: `https://github.com/marcuz-apl/moderado/releases/tag/${tag_name}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe('release metadata', () => {
  it('parses a stable GitHub release into numeric semantic version parts', () => {
    expect(parseReleaseMetadata(release('v2.10.3'))).toEqual({
      tag_name: 'v2.10.3',
      html_url: 'https://github.com/marcuz-apl/moderado/releases/tag/v2.10.3',
      version: { major: 2, minor: 10, patch: 3 },
    });
  });

  it.each([null, [], {}, { tag_name: 'v1.2.3' }, release('v1.2.3', { draft: 'false' }), release('v1.2.3', { html_url: 'javascript:alert(1)' })])(
    'rejects malformed release shape %#', (value) => {
      expect(() => parseReleaseMetadata(value)).toThrow(SelfUpdateError);
    },
  );

  it.each(['v1.2', '1.2.3', 'v01.2.3', 'v1.2.3-rc.1', 'v1.2.3+build', 'v9007199254740992.0.0'])(
    'rejects invalid release tag %s', (tag) => {
      expect(() => parseReleaseMetadata(release(tag))).toThrow(SelfUpdateError);
    },
  );

  it('skips releases explicitly marked draft or prerelease', () => {
    expect(parseReleaseMetadata(release('v1.2.3', { draft: true }))).toBeNull();
    expect(parseReleaseMetadata(release('v1.2.3', { prerelease: true }))).toBeNull();
  });

  it('parses a connected installed version without comparing build metadata', () => {
    expect(parseInstalledVersion('v0.4.13+2610135')).toEqual({ major: 0, minor: 4, patch: 13 });
    expect(parseInstalledVersion('v0.4.13+261013a')).toEqual({ major: 0, minor: 4, patch: 13 });
    expect(() => parseInstalledVersion('v0.4.13+bad')).toThrow(SelfUpdateError);
  });
});

describe('release selection', () => {
  const releases = ['v2.0.0', 'v1.9.0', 'v1.10.0', 'v1.8.9'].map((tag) => parseReleaseMetadata(release(tag))!);

  it('chooses the highest newer release within the installed major for update', () => {
    expect(selectUpdateRelease(releases, 'v1.8.9+2610135', 'update').tag_name).toBe('v1.10.0');
  });

  it('chooses the highest newer release across majors for upgrade', () => {
    expect(selectUpdateRelease(releases, 'v1.8.9+2610135', 'upgrade').tag_name).toBe('v2.0.0');
  });

  it('reports already current when no newer release exists', () => {
    expect(() => selectUpdateRelease(releases, 'v2.0.0+2610135', 'upgrade')).toThrowError(SelfUpdateError);
    expect(() => selectUpdateRelease(releases, 'v2.0.0+2610135', 'upgrade')).toThrow(/already current/i);
  });

  it('reports no compatible release when only another major is available', () => {
    expect(() => selectUpdateRelease(releases, 'v3.0.0+2610135', 'update')).toThrow(/no compatible release/i);
  });
});

describe('fetchPublishedReleases', () => {
  it('fetches pages through an injected fetch and ignores marked drafts', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      urls.push(String(url));
      if (urls.length === 1) return new Response(JSON.stringify([release('v1.0.0'), release('v1.1.0', { draft: true })]), {
        headers: { Link: '<https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2>; rel="next"' },
      });
      return new Response(JSON.stringify([release('v2.0.0')]));
    };
    const result = await fetchPublishedReleases(fetchImpl as typeof fetch);
    expect(result.map((item) => item.tag_name)).toEqual(['v1.0.0', 'v2.0.0']);
    expect(urls).toEqual([
      'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100',
      'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2',
    ]);
  });

  it.each([{}, null, [release('v1.0.0'), release('v1.0.0')], [release('v1.0.0', { tag_name: 'bad' })]])(
    'rejects invalid or duplicate stable releases %#', async (payload) => {
      await expect(fetchPublishedReleases(async () => new Response(JSON.stringify(payload)))).rejects.toThrow(SelfUpdateError);
    },
  );

  it('rejects HTTP errors and unsafe pagination links', async () => {
    await expect(fetchPublishedReleases(async () => new Response('missing', { status: 404 }))).rejects.toThrow(/HTTP 404/);
    await expect(fetchPublishedReleases(async () => new Response('[]', {
      headers: { Link: '<https://evil.example/releases?page=2>; rel="next"' },
    }))).rejects.toThrow(/pagination/i);
  });

  it.each([
    'https://user:secret@api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=2',
    'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&per_page=1&page=2',
    'https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=3',
  ])('rejects a pagination link that could skip or redirect release results', async (next) => {
    let calls = 0;
    await expect(fetchPublishedReleases(async () => {
      calls++;
      return new Response('[]', calls === 1 ? { headers: { Link: `<${next}>; rel="next"` } } : undefined);
    })).rejects.toThrow(/pagination/i);
  });

  it('fails closed when a next page remains after ten pages', async () => {
    let pages = 0;
    const fetchImpl = async () => {
      pages++;
      return new Response('[]', { headers: { Link: `<https://api.github.com/repos/marcuz-apl/moderado/releases?per_page=100&page=${pages + 1}>; rel="next"` } });
    };
    await expect(fetchPublishedReleases(fetchImpl as typeof fetch)).rejects.toThrow(/10 pages/);
    expect(pages).toBe(10);
  });

  it('passes cancellation signal to fetch', async () => {
    const controller = new AbortController();
    const fetchImpl = async (_url: string | URL | Request, options?: RequestInit) => {
      expect(options?.signal).toBe(controller.signal);
      return new Response('[]');
    };
    await fetchPublishedReleases(fetchImpl as typeof fetch, controller.signal);
  });
});
