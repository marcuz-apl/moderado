import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vscodeRoot = path.resolve(__dirname, '..');

export const ICON_PATH = path.join(vscodeRoot, 'media', 'icon.png');
export const ICON_SIZE = 128;

const SUPERSAMPLE = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_RGBA = 6;
const BYTES_PER_PIXEL = 4;

// Moderado brand palette (indigo -> violet). Deliberately not VS Code blue (#007ACC).
const BADGE_TOP = [0x3b, 0x2a, 0xc9];
const BADGE_BOTTOM = [0x8b, 0x5c, 0xf6];
const BADGE_CORNER_RADIUS = 26;
const GLYPH_COLOR = [0xff, 0xff, 0xff];

// Shield and code glyph geometry, expressed in the 24x24 viewBox shared with media/icon.svg.
const SHIELD_CENTER_X = 12;
const SHIELD_HALF_WIDTH = 8;
const SHIELD_TOP_Y = 2.5;
const SHIELD_SHOULDER_Y = 6;
const SHIELD_WAIST_Y = 11.5;
const SHIELD_TIP_Y = 22.5;
const STROKE_HALF_WIDTH = 0.9;
const CODE_STROKES = [
  [
    [9.5, 9.5],
    [7, 12],
    [9.5, 14.5],
  ],
  [
    [14.5, 9.5],
    [17, 12],
    [14.5, 14.5],
  ],
  [
    [13, 9],
    [11, 15],
  ],
];
// The mark is authored in viewBox space; the offsets map its bounding box onto the centered badge area.
const SHIELD_MIN_X = SHIELD_CENTER_X - SHIELD_HALF_WIDTH;
const SHIELD_MIN_Y = SHIELD_TOP_Y;
const SHIELD_WIDTH = SHIELD_HALF_WIDTH * 2;
const SHIELD_HEIGHT = SHIELD_TIP_Y - SHIELD_TOP_Y;
const SHIELD_SCALE = 4.4;
const SHIELD_OFFSET_X = (ICON_SIZE - SHIELD_WIDTH * SHIELD_SCALE) / 2 - SHIELD_MIN_X * SHIELD_SCALE;
const SHIELD_OFFSET_Y = (ICON_SIZE - SHIELD_HEIGHT * SHIELD_SCALE) / 2 - SHIELD_MIN_Y * SHIELD_SCALE;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, pixels) {
  const stride = width * BYTES_PER_PIXEL;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = COLOR_TYPE_RGBA;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePngScanlines(file) {
  expectSignature(file);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    const data = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += length + 12;
  }
  if (colorType !== COLOR_TYPE_RGBA) {
    throw new Error(`expected an RGBA PNG (color type ${COLOR_TYPE_RGBA}), found type ${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * BYTES_PER_PIXEL;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const start = row * (stride + 1);
    if (raw[start] !== 0) {
      throw new Error(`unsupported PNG row filter ${raw[start]} on row ${row}`);
    }
    raw.copy(pixels, row * stride, start + 1, start + 1 + stride);
  }
  return { width, height, pixels };
}

function expectSignature(file) {
  if (file.length < PNG_SIGNATURE.length || !file.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('file is not a valid PNG');
  }
}

function insideRoundedBadge(x, y) {
  const clampedX = Math.min(Math.max(x, BADGE_CORNER_RADIUS), ICON_SIZE - BADGE_CORNER_RADIUS);
  const clampedY = Math.min(Math.max(y, BADGE_CORNER_RADIUS), ICON_SIZE - BADGE_CORNER_RADIUS);
  const dx = x - clampedX;
  const dy = y - clampedY;
  return dx * dx + dy * dy <= BADGE_CORNER_RADIUS * BADGE_CORNER_RADIUS;
}

function insideShield(x, y) {
  if (y < SHIELD_TOP_Y || y > SHIELD_TIP_Y) {
    return false;
  }
  const offsetFromCenter = Math.abs(x - SHIELD_CENTER_X);
  if (y <= SHIELD_SHOULDER_Y) {
    const halfWidth = (SHIELD_HALF_WIDTH * (y - SHIELD_TOP_Y)) / (SHIELD_SHOULDER_Y - SHIELD_TOP_Y);
    return offsetFromCenter <= halfWidth;
  }
  if (y <= SHIELD_WAIST_Y) {
    return offsetFromCenter <= SHIELD_HALF_WIDTH;
  }
  const dx = (x - SHIELD_CENTER_X) / SHIELD_HALF_WIDTH;
  const dy = (y - SHIELD_WAIST_Y) / (SHIELD_TIP_Y - SHIELD_WAIST_Y);
  return dx * dx + dy * dy <= 1;
}

function distanceToSegment(x, y, [startX, startY], [endX, endY]) {
  const dx = endX - startX;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(Math.max(((x - startX) * dx + (y - startY) * dy) / lengthSquared, 0), 1);
  return Math.hypot(x - (startX + t * dx), y - (startY + t * dy));
}

function insideCodeGlyph(x, y) {
  return CODE_STROKES.some((stroke) =>
    stroke.some((point, index) => index > 0 && distanceToSegment(x, y, stroke[index - 1], point) <= STROKE_HALF_WIDTH),
  );
}

function badgeColorAt(y) {
  const t = Math.min(Math.max(y / ICON_SIZE, 0), 1);
  return BADGE_TOP.map((channel, index) => channel + (BADGE_BOTTOM[index] - channel) * t);
}

function samplePixel(x, y) {
  if (!insideRoundedBadge(x, y)) {
    return undefined;
  }
  const glyphX = (x - SHIELD_OFFSET_X) / SHIELD_SCALE;
  const glyphY = (y - SHIELD_OFFSET_Y) / SHIELD_SCALE;
  if (insideShield(glyphX, glyphY) && !insideCodeGlyph(glyphX, glyphY)) {
    return GLYPH_COLOR;
  }
  return badgeColorAt(y);
}

export function generateIconPng() {
  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * BYTES_PER_PIXEL);
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;
  for (let pixelY = 0; pixelY < ICON_SIZE; pixelY++) {
    for (let pixelX = 0; pixelX < ICON_SIZE; pixelX++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;
      for (let subY = 0; subY < SUPERSAMPLE; subY++) {
        for (let subX = 0; subX < SUPERSAMPLE; subX++) {
          const sample = samplePixel(pixelX + (subX + 0.5) / SUPERSAMPLE, pixelY + (subY + 0.5) / SUPERSAMPLE);
          if (!sample) {
            continue;
          }
          red += sample[0];
          green += sample[1];
          blue += sample[2];
          covered++;
        }
      }
      const offset = (pixelY * ICON_SIZE + pixelX) * BYTES_PER_PIXEL;
      if (covered > 0) {
        pixels[offset] = Math.round(red / covered);
        pixels[offset + 1] = Math.round(green / covered);
        pixels[offset + 2] = Math.round(blue / covered);
      }
      pixels[offset + 3] = Math.round((covered / samplesPerPixel) * 255);
    }
  }
  return encodePng(ICON_SIZE, ICON_SIZE, pixels);
}

function preview(pixels) {
  const cells = 32;
  const cell = ICON_SIZE / cells;
  const rows = [];
  for (let row = 0; row < cells; row++) {
    let line = '';
    for (let column = 0; column < cells; column++) {
      let alpha = 0;
      let brightness = 0;
      let count = 0;
      for (let y = Math.floor(row * cell); y < Math.floor((row + 1) * cell); y++) {
        for (let x = Math.floor(column * cell); x < Math.floor((column + 1) * cell); x++) {
          const offset = (y * ICON_SIZE + x) * BYTES_PER_PIXEL;
          alpha += pixels[offset + 3];
          brightness += (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
          count++;
        }
      }
      const averageAlpha = alpha / count;
      const averageBrightness = brightness / count;
      line += averageAlpha < 128 ? ' ' : averageBrightness > 200 ? '#' : averageBrightness > 90 ? '+' : '.';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

function summarize(scanlines) {
  const opaque = [];
  for (let index = 3; index < scanlines.length; index += BYTES_PER_PIXEL) {
    if (scanlines[index] > 200) {
      opaque.push(index);
    }
  }
  const colored = opaque.filter((index) => {
    const channels = [scanlines[index - 3], scanlines[index - 2], scanlines[index - 1]];
    return Math.max(...channels) - Math.min(...channels) > 40;
  }).length;
  const glyph = opaque.filter(
    (index) => scanlines[index - 3] > 240 && scanlines[index - 2] > 240 && scanlines[index - 1] > 240,
  ).length;
  const share = opaque.length === 0 ? 0 : Math.round((colored / opaque.length) * 100);
  return `${ICON_SIZE}x${ICON_SIZE}, ${opaque.length} opaque pixels, ${share}% brand colored, ${glyph} glyph pixels`;
}

function main(argv) {
  const generated = generateIconPng();
  const scanlines = decodePngScanlines(generated).pixels;

  if (argv.includes('--check')) {
    if (!existsSync(ICON_PATH)) {
      throw new Error("media/icon.png is missing; run 'node scripts/generate_icon.mjs' to create it");
    }
    const committed = decodePngScanlines(readFileSync(ICON_PATH));
    if (committed.width !== ICON_SIZE || committed.height !== ICON_SIZE || !committed.pixels.equals(scanlines)) {
      throw new Error('media/icon.png is out of date with scripts/generate_icon.mjs; regenerate it');
    }
    console.log(`verified ${ICON_PATH} (${summarize(committed.pixels)})`);
    return;
  }

  writeFileSync(ICON_PATH, generated);
  console.log(`wrote ${ICON_PATH} (${summarize(scanlines)})`);
  if (argv.includes('--preview')) {
    console.log(preview(scanlines));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
