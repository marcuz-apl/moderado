import { deflateRawSync, inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/**
 * Build a zip from in-memory entries using the standard library only.
 *
 * A VSIX is an OPC package, which is a zip; pulling in a packaging dependency
 * for one container format would be bloat. Entries are stored in the order
 * given, with fixed timestamps so the output is reproducible.
 */
export function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const deflated = deflateRawSync(raw, { level: 9 });
    // Fall back to stored when compression does not actually help.
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0, 8);
    directory.writeUInt16LE(method, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(body.length, 20);
    directory.writeUInt32LE(raw.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);

    chunks.push(local, name, body);
    central.push(directory, name);
    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/**
 * Every entry name in the archive, in order and with duplicates intact.
 * `readZip` keys by name, so it cannot detect a duplicated path; this can.
 */
export function listZipEntries(buffer) {
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endIndex < 0) throw new Error('Not a zip archive: missing end-of-central-directory record.');
  const count = buffer.readUInt16LE(endIndex + 10);
  let cursor = buffer.readUInt32LE(endIndex + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    names.push(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Read a zip built by `buildZip`, so packaging can be asserted offline. */
export function readZip(buffer) {
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endIndex < 0) throw new Error('Not a zip archive: missing end-of-central-directory record.');
  const count = buffer.readUInt16LE(endIndex + 10);
  let cursor = buffer.readUInt32LE(endIndex + 16);
  const files = new Map();
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(body) : body);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}