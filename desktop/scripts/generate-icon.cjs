// Regenerates the desktop app icon from desktop/build/icon.svg:
//   - desktop/build/icon.png  (512x512 PNG source)
//   - desktop/build/icon.ico  (PNG-compressed ICO with 16..256px entries)
//
// Rasterizing SVG needs Chromium, so this script re-launches itself through the
// Electron binary when invoked with plain Node (`npm run icon`).
const fs = require("node:fs");
const path = require("node:path");

if (!process.versions.electron) {
    const { spawnSync } = require("node:child_process");
    const electronPath = require("electron");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electronPath, [__filename], { env, stdio: "inherit" });
    process.exit(result.status ?? 1);
}

const { app, BrowserWindow, nativeImage } = require("electron");

const BUILD_DIR = path.join(__dirname, "..", "build");
const SVG_PATH = path.join(BUILD_DIR, "icon.svg");
const PNG_PATH = path.join(BUILD_DIR, "icon.png");
const ICO_PATH = path.join(BUILD_DIR, "icon.ico");
const SOURCE_SIZE = 512;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// Packs PNG buffers into an ICO container (Vista+ PNG-compressed entries).
function buildIco(pngBuffers) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(pngBuffers.length, 4);

    let offset = 6 + 16 * pngBuffers.length;
    const entries = [];
    const data = [];
    for (const { size, buffer } of pngBuffers) {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
        entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
        entry.writeUInt8(0, 2); // color count
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(buffer.length, 8); // image bytes
        entry.writeUInt32LE(offset, 12); // image data offset
        offset += buffer.length;
        entries.push(entry);
        data.push(buffer);
    }
    return Buffer.concat([header, ...entries, ...data]);
}

async function renderPng(svgDataUrl) {
    const win = new BrowserWindow({
        width: SOURCE_SIZE,
        height: SOURCE_SIZE,
        show: false,
    });
    try {
        await win.loadURL("about:blank");
        const pngDataUrl = await win.webContents.executeJavaScript(`
            new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = ${SOURCE_SIZE};
                    canvas.height = ${SOURCE_SIZE};
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("2D canvas context is unavailable"));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, ${SOURCE_SIZE}, ${SOURCE_SIZE});
                    resolve(canvas.toDataURL("image/png"));
                };
                img.onerror = () => reject(new Error("Failed to decode icon.svg"));
                img.src = ${JSON.stringify(svgDataUrl)};
            })
        `);
        return nativeImage.createFromDataURL(pngDataUrl).toPNG();
    } finally {
        win.destroy();
    }
}

(async () => {
    await app.whenReady();
    const svg = fs.readFileSync(SVG_PATH, "utf8");
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const sourcePng = await renderPng(svgDataUrl);
    const sourceImage = nativeImage.createFromBuffer(sourcePng);
    if (sourceImage.isEmpty()) {
        throw new Error("Failed to rasterize icon.svg");
    }

    fs.writeFileSync(PNG_PATH, sourceImage.toPNG());

    const entries = ICO_SIZES.map((size) => ({
        size,
        buffer: sourceImage.resize({ width: size, height: size, quality: "best" }).toPNG(),
    }));
    fs.writeFileSync(ICO_PATH, buildIco(entries));
    console.log(`Generated ${PNG_PATH} and ${ICO_PATH}`);
    app.quit();
})().catch((err) => {
    console.error(err);
    app.exit(1);
});