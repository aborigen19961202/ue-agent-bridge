import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { compareViewportToReference, saveViewportImage } from "../src/utils/vision.js";
import { ViewportScreenshotResult } from "../src/types/domain.js";

describe("vision utils", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("saves a viewport screenshot to disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ue-agent-bridge-vision-"));
    tempDirs.push(tempDir);
    const screenshot = createScreenshotResult(createSolidPngBase64(2, 2, [255, 0, 0, 255]), 2, 2);
    const savePath = path.join(tempDir, "capture.png");

    const saved = await saveViewportImage(screenshot, {
      saveToFile: savePath
    });

    expect(saved.savedPath).toBe(savePath);
    const fileBytes = await readFile(savePath);
    expect(fileBytes.length).toBeGreaterThan(10);
  });

  it("compares screenshots and writes a diff artifact", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "ue-agent-bridge-vision-"));
    tempDirs.push(tempDir);
    const referencePath = path.join(tempDir, "reference.png");
    const diffPath = path.join(tempDir, "diff.png");
    const currentPath = path.join(tempDir, "current.png");

    const referenceBuffer = Buffer.from(createSolidPngBase64(4, 4, [255, 255, 255, 255]), "base64");
    await writeFile(referencePath, referenceBuffer);

    const screenshot = await saveViewportImage(
      createScreenshotResult(createSolidPngBase64(4, 4, [0, 0, 0, 255]), 4, 4),
      { saveToFile: currentPath }
    );

    const result = await compareViewportToReference(screenshot, {
      referenceImagePath: referencePath,
      saveDiffToFile: diffPath,
      mismatchTolerance: 0,
      pixelThreshold: 0.1
    });

    expect(result.matched).toBe(false);
    expect(result.metrics.differingPixels).toBeGreaterThan(0);
    expect(result.diffImagePath).toBe(diffPath);
    const diffBytes = await readFile(diffPath);
    expect(diffBytes.length).toBeGreaterThan(10);
  });
});

function createScreenshotResult(dataBase64: string, width: number, height: number): ViewportScreenshotResult {
  return {
    mimeType: "image/png",
    dataBase64,
    width,
    height,
    capturedAt: "2026-03-12T00:00:00Z",
    source: "active_viewport",
    projectName: "MockProject",
    currentMap: "/Game/Maps/TestMap",
    pieActive: false,
    viewport: {
      type: "perspective",
      viewMode: "lit",
      realtime: true,
      width,
      height
    },
    camera: {
      location: { x: 0, y: 0, z: 0 },
      rotation: { pitch: 0, yaw: 0, roll: 0 }
    }
  };
}

function createSolidPngBase64(width: number, height: number, rgba: [number, number, number, number]): string {
  const png = new PNG({ width, height });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = rgba[0];
    png.data[offset + 1] = rgba[1];
    png.data[offset + 2] = rgba[2];
    png.data[offset + 3] = rgba[3];
  }

  return PNG.sync.write(png).toString("base64");
}
