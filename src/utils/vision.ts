import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { BridgeError } from "./errors.js";
import { ViewportCropRect, ViewportScreenshotResult } from "../types/domain.js";

export interface SaveImageOptions {
  saveToFile?: string | undefined;
}

export interface CompareViewportOptions {
  referenceImagePath: string;
  saveDiffToFile?: string | undefined;
  mismatchTolerance?: number | undefined;
  pixelThreshold?: number | undefined;
}

export interface CompareViewportResult {
  matched: boolean;
  referenceImagePath: string;
  currentImagePath: string | null;
  diffImagePath: string | null;
  dimensions: {
    width: number;
    height: number;
  };
  metrics: {
    differingPixels: number;
    totalPixels: number;
    mismatchRatio: number;
    mismatchTolerance: number;
    pixelThreshold: number;
  };
  viewportCapture: Omit<ViewportScreenshotResult, "dataBase64">;
}

export async function saveViewportImage(
  result: ViewportScreenshotResult,
  options: SaveImageOptions
): Promise<ViewportScreenshotResult> {
  if (!options.saveToFile) {
    return result;
  }

  const absolutePath = resolveUserPath(options.saveToFile);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(result.dataBase64, "base64"));

  return {
    ...result,
    savedPath: absolutePath
  };
}

export async function compareViewportToReference(
  result: ViewportScreenshotResult,
  options: CompareViewportOptions
): Promise<CompareViewportResult> {
  const referenceImagePath = resolveUserPath(options.referenceImagePath);
  const currentBuffer = Buffer.from(result.dataBase64, "base64");
  const referenceBuffer = await readFile(referenceImagePath);
  const currentPng: PngBitmap = PNG.sync.read(currentBuffer);
  let referencePng: PngBitmap = PNG.sync.read(referenceBuffer);

  if (referencePng.width !== currentPng.width || referencePng.height !== currentPng.height) {
    referencePng = resizeNearest(referencePng, currentPng.width, currentPng.height);
  }

  const diffPng = new PNG({ width: currentPng.width, height: currentPng.height });
  const pixelThreshold = options.pixelThreshold ?? 0.1;
  const differingPixels = pixelmatch(
    currentPng.data,
    referencePng.data,
    diffPng.data,
    currentPng.width,
    currentPng.height,
    {
      threshold: pixelThreshold
    }
  );
  const totalPixels = currentPng.width * currentPng.height;
  const mismatchRatio = totalPixels > 0 ? differingPixels / totalPixels : 0;
  const mismatchTolerance = options.mismatchTolerance ?? 0;
  const diffImagePath = options.saveDiffToFile ? resolveUserPath(options.saveDiffToFile) : null;

  if (diffImagePath) {
    await mkdir(path.dirname(diffImagePath), { recursive: true });
    await writeFile(diffImagePath, PNG.sync.write(diffPng));
  }

  return {
    matched: mismatchRatio <= mismatchTolerance,
    referenceImagePath,
    currentImagePath: result.savedPath ?? null,
    diffImagePath,
    dimensions: {
      width: currentPng.width,
      height: currentPng.height
    },
    metrics: {
      differingPixels,
      totalPixels,
      mismatchRatio,
      mismatchTolerance,
      pixelThreshold
    },
    viewportCapture: omitImageData(result)
  };
}

export function resolveUserPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.length === 0) {
    throw new BridgeError("VALIDATION_ERROR", "Path arguments must not be empty.");
  }

  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(process.cwd(), trimmed);
}

export function validateCropRect(crop: ViewportCropRect): void {
  if (crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1) {
    throw new BridgeError("VALIDATION_ERROR", "crop must use non-negative x/y and positive width/height.");
  }
}

function omitImageData(result: ViewportScreenshotResult): Omit<ViewportScreenshotResult, "dataBase64"> {
  const { dataBase64: _ignored, ...rest } = result;
  return rest;
}

interface PngBitmap {
  width: number;
  height: number;
  data: Buffer;
}

function resizeNearest(input: PngBitmap, width: number, height: number): PngBitmap {
  const output = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(input.height - 1, Math.floor((y / height) * input.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(input.width - 1, Math.floor((x / width) * input.width));
      const sourceOffset = (sourceY * input.width + sourceX) * 4;
      const targetOffset = (y * width + x) * 4;

      output.data[targetOffset] = input.data[sourceOffset] ?? 0;
      output.data[targetOffset + 1] = input.data[sourceOffset + 1] ?? 0;
      output.data[targetOffset + 2] = input.data[sourceOffset + 2] ?? 0;
      output.data[targetOffset + 3] = input.data[sourceOffset + 3] ?? 0;
    }
  }

  return {
    width: output.width,
    height: output.height,
    data: output.data
  };
}
