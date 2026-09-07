/**
 * Generates the two PNG icons Teams requires in an app manifest:
 *   color.png   192x192, full color
 *   outline.png  32x32, transparent bg, white silhouette only
 * Written by hand (raw PNG + zlib) so the POC has zero extra image deps.
 */
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// CMC-ish green, solid, full-bleed square with a simple check shape carved out lighter.
function colorPixel(x, y) {
  const w = 192,
    h = 192;
  // simple checkmark using distance-to-segment approximation
  const inCheck =
    isNearSegment(x, y, 50, 100, 85, 135, 8) || isNearSegment(x, y, 85, 135, 145, 60, 8);
  if (inCheck) return [255, 255, 255, 255];
  return [11, 106, 11, 255]; // #0b6a0b
}

function outlinePixel(x, y) {
  const cx = 16,
    cy = 16;
  const dx = x - cx,
    dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ring = dist > 10 && dist < 13;
  const check = isNearSegment(x, y, 9, 16, 14, 21, 1.4) || isNearSegment(x, y, 14, 21, 23, 10, 1.4);
  if (ring || check) return [255, 255, 255, 255];
  return [0, 0, 0, 0];
}

function isNearSegment(px, py, x1, y1, x2, y2, tol) {
  const dx = x2 - x1,
    dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx,
    cy = y1 + t * dy;
  const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return d <= tol;
}

const outDir = path.join(__dirname, "..", "teams-app");
fs.writeFileSync(path.join(outDir, "color.png"), encodePng(192, 192, colorPixel));
fs.writeFileSync(path.join(outDir, "outline.png"), encodePng(32, 32, outlinePixel));
console.log("Wrote teams-app/color.png and teams-app/outline.png");
