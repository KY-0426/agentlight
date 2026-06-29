import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = path.join(root, "public", "assets");
const framesDir = path.join(assetsRoot, "pet-frames");

const frameCounts = {
  standby: 8,
  working: 5,
  completed: 6,
  attention: 6,
};

const stateColors = {
  standby: [59, 130, 246],
  working: [234, 179, 8],
  completed: [34, 197, 94],
  attention: [239, 68, 68],
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBuffer = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createSolidPng(width, height, [red, green, blue]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * 4;
      raw[pixelStart] = red;
      raw[pixelStart + 1] = green;
      raw[pixelStart + 2] = blue;
      raw[pixelStart + 3] = 255;
    }
  }

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writePng(filePath, color) {
  const png = createSolidPng(64, 64, color);
  await writeFile(filePath, png);
}

await mkdir(framesDir, { recursive: true });

for (const [state, count] of Object.entries(frameCounts)) {
  const color = stateColors[state];
  for (let index = 1; index <= count; index += 1) {
    const fileName = `${state}-${String(index).padStart(2, "0")}.png`;
    await writePng(path.join(framesDir, fileName), color);
  }
}

for (const state of Object.keys(stateColors)) {
  await writePng(path.join(assetsRoot, `hardware-cube-${state}.png`), stateColors[state]);
}

const manifest = createHash("sha256")
  .update(JSON.stringify({ frameCounts, stateColors }))
  .digest("hex")
  .slice(0, 12);

console.log(`Generated placeholder assets under public/assets (manifest ${manifest}).`);
