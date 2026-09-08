import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const indexPath = join(distDir, "index.html");

function fail(message) {
  throw new Error(`theme static-route check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function localAssetPath(url, source) {
  const parsed = new URL(url, "https://komari.invalid/");
  assert(parsed.origin === "https://komari.invalid", `${source} must not reference an external asset: ${url}`);
  assert(
    parsed.pathname.startsWith("/assets/"),
    `${source} must use root /assets/* URLs so both Komari static fallbacks can find it: ${url}`,
  );
  assert(!parsed.pathname.includes(".."), `${source} contains an unsafe asset URL: ${url}`);

  // Both supported servers map a root asset request to the current theme's
  // dist directory (`path.Join("dist", requestPath)` in their Go handlers).
  // Normalize explicitly here rather than relying on Node's platform path
  // behavior, then ensure the emitted file exists in the package.
  const file = normalize(join(distDir, parsed.pathname.slice(1)));
  assert(file.startsWith(`${normalize(distDir)}/`), `${source} escapes dist: ${url}`);
  assert(existsSync(file), `${source} references a missing packaged asset: ${url}`);
  return parsed.pathname;
}

assert(existsSync(indexPath), "missing dist/index.html; run npm run build first");
const indexHtml = readFileSync(indexPath, "utf8");
const htmlAssetUrls = [
  ...indexHtml.matchAll(/\b(?:src|href)="([^"?#]+(?:\?[^"#]*)?(?:#[^"]*)?)"/g),
].map((match) => match[1]);

const resolvedAssets = new Set();
for (const url of htmlAssetUrls) {
  if (url === "/favicon.ico") continue; // Komari serves this via its dedicated favicon handler.
  resolvedAssets.add(localAssetPath(url, "dist/index.html"));
}
assert(resolvedAssets.size > 0, "dist/index.html did not emit any application assets");

// Vite can emit font/image URLs from CSS instead of the HTML entry. Inspect
// every emitted stylesheet that the HTML actually loads so those URLs remain
// portable as well.
const stylesheetUrls = htmlAssetUrls.filter((url) => /^\/assets\/.*\.css(?:[?#].*)?$/.test(url));
for (const stylesheetUrl of stylesheetUrls) {
  const cssPath = join(distDir, new URL(stylesheetUrl, "https://komari.invalid/").pathname.slice(1));
  const css = readFileSync(cssPath, "utf8");
  for (const match of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
    const url = match[2].trim();
    if (!url || url.startsWith("data:") || url.startsWith("#")) continue;
    resolvedAssets.add(localAssetPath(url, `stylesheet ${stylesheetUrl}`));
  }
}

console.log(JSON.stringify({
  checked: "Komari active-theme /assets fallback",
  assetCount: resolvedAssets.size,
  assets: [...resolvedAssets].sort(),
}, null, 2));
