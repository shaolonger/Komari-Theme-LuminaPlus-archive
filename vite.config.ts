import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Both the legacy fork and upstream Komari serve the active theme's
  // `dist/assets/*` through their public SPA fallback at `/assets/*`.
  // Keep this root-relative on purpose: binding assets to `/themes/<short>/`
  // would break installations that rename or repackage the theme, while a
  // relative base would fail from nested SPA routes.
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    manifest: true,
    target: ["es2020", "safari15.4", "chrome87"],
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into stable chunks so the main app
        // bundle stays small and these can be cached across deploys.
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) return;

          if (
            /\/node_modules\/(?:react|react-dom|react-router|react-router-dom)\//.test(
              normalized,
            )
          ) {
            return "react";
          }
          if (normalized.includes("/node_modules/@tanstack/react-query/")) {
            return "query";
          }
          if (normalized.includes("/node_modules/zod/")) {
            return "validation";
          }
        },
      },
    },
  },
});
