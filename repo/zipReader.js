import { inflateRawSync } from "zlib";

// Minimal, defensive ZIP reader for UNTRUSTED archives (GitHub downloads and user uploads).
//
// Safety properties:
//  - Nothing is ever written to disk. Entries are read selectively into memory, so
//    path traversal ("zip slip"), symlink and permission tricks have nothing to act on.
//    Paths are still normalised, because they are used as labels in prompts.
//  - Decompressed output is hard-capped per entry (zlib maxOutputLength), whatever sizes
//    the archive declares, so a zip bomb cannot exhaust memory.
//  - Entry count is capped; every offset and length is bounds-checked against the buffer.
//  - Encrypted entries, symlinks, multi-disk and ZIP64 archives are refused or skipped.
//  - Only "stored" (0) and "deflate" (8) compression is supported (what GitHub produces).

export class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZipError";
    this.expose = true; // safe to show to the user
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export const ZIP_LIMITS = { maxEntries: 20000, maxEntryBytes: 1_000_000 };

// Normalise an entry name to a safe relative path, or null if it is unsafe.
export function sanitizeEntryPath(name) {
  if (typeof name !== "string" || name.includes("\0")) return null;
  const p = name.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return null; // absolute / drive path
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null;
    parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

function findEocd(buf) {
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

export function openZip(buf, { maxEntries = ZIP_LIMITS.maxEntries } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError("That is not a valid zip file.");
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ZipError("That is not a valid zip file (no central directory).");

  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) throw new ZipError("Multi-part zip files are not supported.");
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError("ZIP64 archives are not supported (the repository is too large).");
  }
  if (total > maxEntries) throw new ZipError(`The archive has too many files (${total}; the limit is ${maxEntries}).`);
  if (cdOffset + cdSize > buf.length) throw new ZipError("The zip file is corrupt (bad central directory).");

  const entries = [];
  const skipped = { unsafePath: 0, symlink: 0, encrypted: 0, unsupported: 0 };
  let pos = cdOffset;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CEN) throw new ZipError("The zip file is corrupt (bad directory entry).");
    const madeBy = buf.readUInt16LE(pos + 4);
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const extAttr = buf.readUInt32LE(pos + 38);
    const offset = buf.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLen + extraLen + commentLen;
    if (next > buf.length) throw new ZipError("The zip file is corrupt (truncated directory).");
    const rawName = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    pos = next;

    const isDir = rawName.endsWith("/") || rawName.endsWith("\\");
    const path = sanitizeEntryPath(rawName);
    if (!path) { if (!isDir || rawName.replace(/[\\/.]/g, "")) skipped.unsafePath++; continue; }
    if (isDir) continue;
    // Unix mode lives in the high 16 bits of the external attributes when madeBy host = 3.
    if (madeBy >> 8 === 3 && ((extAttr >>> 16) & 0xf000) === 0xa000) { skipped.symlink++; continue; }
    if (flags & 1) { skipped.encrypted++; continue; }
    if (method !== 0 && method !== 8) { skipped.unsupported++; continue; }
    entries.push({ path, size, compressedSize, method, offset });
  }

  // Read one entry fully into memory, never producing more than maxBytes.
  function read(entry, { maxBytes = ZIP_LIMITS.maxEntryBytes } = {}) {
    if (entry.size > maxBytes) throw new ZipError(`"${entry.path}" is larger than the ${maxBytes}-byte limit.`);
    const o = entry.offset;
    if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOC) throw new ZipError("The zip file is corrupt (bad file header).");
    const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
    const end = start + entry.compressedSize;
    if (end > buf.length || start > end) throw new ZipError("The zip file is corrupt (file data out of range).");
    const raw = buf.subarray(start, end);
    let out;
    if (entry.method === 0) {
      if (raw.length > maxBytes) throw new ZipError(`"${entry.path}" exceeds the size limit.`);
      out = Buffer.from(raw);
    } else {
      try {
        out = inflateRawSync(raw, { maxOutputLength: maxBytes });
      } catch (err) {
        if (err?.code === "ERR_BUFFER_TOO_LARGE") throw new ZipError(`"${entry.path}" expands beyond the size limit.`);
        throw new ZipError("The zip file is corrupt (bad compressed data).");
      }
    }
    // A declared size that disagrees with the real one means a lying or damaged archive.
    if (out.length !== entry.size) throw new ZipError(`"${entry.path}" does not match its declared size.`);
    return out;
  }

  return { entries, skipped, read };
}
