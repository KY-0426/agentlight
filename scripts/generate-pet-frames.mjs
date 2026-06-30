import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = path.join(root, "public", "assets");
const stripsDir = path.join(assetsRoot, "pet-strips");
const framesDir = path.join(assetsRoot, "pet-frames");
const outputSize = 218;

const stripFrameCounts = {
  standby: 8,
  working: 6,
  completed: 6,
  attention: 6,
};

const frameCounts = {
  standby: 8,
  working: 5,
  completed: 6,
  attention: 6,
};

const stripCrop = {
  standby: { top: 119, height: 456 },
};

function buildFrameWidths(totalWidth, frameCount) {
  const base = Math.floor(totalWidth / frameCount);
  const remainder = totalWidth - base * frameCount;
  const widths = Array.from({ length: frameCount }, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
  const offsets = [];
  let cursor = 0;
  for (const width of widths) {
    offsets.push(cursor);
    cursor += width;
  }
  return { widths, offsets };
}

async function sliceStrip(state) {
  const frameCount = frameCounts[state];
  const stripFrameCount = stripFrameCounts[state];
  const stripPath = path.join(stripsDir, `${state}.png`);
  const metadata = await sharp(stripPath).metadata();
  const stripWidth = metadata.width ?? 0;
  const stripHeight = metadata.height ?? 0;
  const { widths, offsets } = buildFrameWidths(stripWidth, stripFrameCount);

  for (let index = 0; index < frameCount; index += 1) {
    const frameNumber = String(index + 1).padStart(2, "0");
    const outputPath = path.join(framesDir, `${state}-${frameNumber}.png`);
    await sharp(stripPath)
      .extract({
        left: offsets[index],
        top: stripCrop[state]?.top ?? 0,
        width: widths[index],
        height: stripCrop[state]?.height ?? stripHeight,
      })
      .resize(outputSize, outputSize, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(outputPath);
  }
}

await mkdir(framesDir, { recursive: true });

for (const state of Object.keys(frameCounts)) {
  await sliceStrip(state);
  console.log(
    `Sliced ${frameCounts[state]} ${state} frame(s) from ${stripFrameCounts[state]}-column strip.`,
  );
}

const hardwareCubeSource = path.join(assetsRoot, "hardware-cube.png");
for (const state of Object.keys(frameCounts)) {
  await copyFile(hardwareCubeSource, path.join(assetsRoot, `hardware-cube-${state}.png`));
}

console.log(`Generated pet frames under public/assets/pet-frames (${outputSize}x${outputSize}).`);
