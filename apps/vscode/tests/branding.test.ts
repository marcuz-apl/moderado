import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { buildContentTypes, buildManifest, collectMediaFiles } from '../scripts/package_vsix.mjs';

const vscodeRoot = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(vscodeRoot, 'package.json'), 'utf8'));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_PER_PIXEL = 4;

interface PngImage {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  pixels: Buffer;
}

function readPng(relativePath: string): PngImage {
  const file = readFileSync(path.join(vscodeRoot, relativePath));
  expect(file.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * BYTES_PER_PIXEL;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1);
    expect(raw[start]).toBe(0);
    raw.copy(pixels, row * stride, start + 1, start + 1 + stride);
  }
  return { width, height, bitDepth, colorType, pixels };
}

function countPixels(
  pixels: Buffer,
  predicate: (red: number, green: number, blue: number, alpha: number) => boolean,
): number {
  let count = 0;
  for (let index = 0; index < pixels.length; index += BYTES_PER_PIXEL) {
    if (predicate(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) {
      count++;
    }
  }
  return count;
}

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pixelBounds(
  pixels: Buffer,
  width: number,
  predicate: (red: number, green: number, blue: number, alpha: number) => boolean,
): PixelBounds {
  const bounds: PixelBounds = { minX: Infinity, minY: Infinity, maxX: -1, maxY: -1 };
  for (let index = 0; index < pixels.length; index += BYTES_PER_PIXEL) {
    if (!predicate(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) {
      continue;
    }
    const position = index / BYTES_PER_PIXEL;
    const x = position % width;
    const y = Math.floor(position / width);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

describe('Moderado extension icon branding', () => {
  it('uses a dedicated colored PNG icon instead of the monochrome activity bar glyph', () => {
    const activityBarIcon = packageJson.contributes.viewsContainers.activitybar[0].icon;
    expect(activityBarIcon).toBe('media/icon.svg');
    expect(packageJson.icon).toBe('media/icon.png');
    expect(packageJson.icon).not.toBe(activityBarIcon);
  });

  it('ships a 128x128 RGBA PNG icon', () => {
    const icon = readPng(packageJson.icon);
    expect(icon.width).toBe(128);
    expect(icon.height).toBe(128);
    expect(icon.bitDepth).toBe(8);
    expect(icon.colorType).toBe(6);
  });

  it('renders a brand colored badge with a white shield glyph', () => {
    const icon = readPng(packageJson.icon);
    const opaque = countPixels(icon.pixels, (_, __, ___, alpha) => alpha > 200);
    const colored = countPixels(
      icon.pixels,
      (red, green, blue, alpha) => alpha > 200 && Math.max(red, green, blue) - Math.min(red, green, blue) > 40,
    );
    const glyph = countPixels(
      icon.pixels,
      (red, green, blue, alpha) => alpha > 250 && red > 240 && green > 240 && blue > 240,
    );
    expect(colored).toBeGreaterThan(opaque * 0.5);
    expect(glyph).toBeGreaterThan(1000);
  });

  it('centers the shield mark in the badge and fills the icon area', () => {
    const icon = readPng(packageJson.icon);
    const isMark = (red: number, green: number, blue: number, alpha: number) =>
      alpha > 250 && red > 240 && green > 240 && blue > 240;
    const mark = pixelBounds(icon.pixels, icon.width, isMark);
    const center = icon.width / 2;
    expect(Math.abs((mark.minX + mark.maxX) / 2 - center)).toBeLessThanOrEqual(2);
    expect(Math.abs((mark.minY + mark.maxY) / 2 - center)).toBeLessThanOrEqual(2);
    expect(mark.maxX - mark.minX + 1).toBeGreaterThanOrEqual(68);
    expect(mark.maxY - mark.minY + 1).toBeGreaterThanOrEqual(86);

    const badge = pixelBounds(icon.pixels, icon.width, (_, __, ___, alpha) => alpha > 200);
    expect(badge).toEqual({ minX: 0, minY: 0, maxX: icon.width - 1, maxY: icon.height - 1 });
  });

  it('keeps the committed icon in sync with scripts/generate_icon.mjs', () => {
    expect(() =>
      execFileSync(process.execPath, [path.join(vscodeRoot, 'scripts', 'generate_icon.mjs'), '--check'], {
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('keeps the activity bar glyph monochrome and theme aware', () => {
    const svg = readFileSync(path.join(vscodeRoot, 'media', 'icon.svg'), 'utf8');
    expect(svg).toContain('currentColor');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    expect(svg).not.toContain('url(');
  });
});

describe('VSIX packaging ships the branded icon', () => {
  it('declares the icon asset and a PNG content type', () => {
    const vsixManifest = buildManifest(packageJson);
    expect(vsixManifest).toContain('Microsoft.VisualStudio.Services.Icons.Default');
    expect(vsixManifest).toContain(`Path="extension/${packageJson.icon}"`);
    expect(buildContentTypes()).toContain('Extension="png" ContentType="image/png"');
  });

  it('stages the icon alongside the webview assets', () => {
    const mediaFiles = collectMediaFiles(packageJson, vscodeRoot);
    expect(mediaFiles).toContain('icon.png');
    expect(mediaFiles).toContain('icon.svg');
  });

  it('rejects a non-PNG extension icon', () => {
    expect(() => collectMediaFiles({ icon: 'media/icon.svg' }, vscodeRoot)).toThrow(/PNG/);
  });
});
