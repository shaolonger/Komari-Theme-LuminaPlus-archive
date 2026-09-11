import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
// theme-preview.png (the branded UI preview under docs/) is the
// canonical preview. We copy it to the repo root as preview.png — the name the
// komari-theme.json manifest references and that package-zip.mjs bundles.
const sourcePath = resolve(root, "docs/images/theme-preview.png");
const outPath = resolve(root, "preview.png");

if (!existsSync(sourcePath)) {
  throw new Error(`Missing preview source: ${sourcePath}`);
}

copyFileSync(sourcePath, outPath);
console.log(`Wrote ${outPath}`);
