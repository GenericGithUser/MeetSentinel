import { defineConfig, loadEnv } from "vite";
import { resolve } from "node:path";

// Multi-entry build for a Manifest V3 extension:
//   popup.html / options.html  -> normal Vite HTML entries
//   src/background/index.js    -> service worker (ES module, may import shared chunks)
//   src/content/index.js       -> content script (MUST stay import-free: content scripts are classic scripts)
// public/manifest.json and public/icons are copied to dist as-is.
// Chrome only needs woff2. Fontsource also ships a legacy .woff copy of every weight; drop those and their CSS references.
function dropWoff() {
  return {
    name: "drop-woff",
    enforce: "post",
    generateBundle(_, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        if (name.endsWith(".woff")) delete bundle[name];
        else if (file.type === "asset" && name.endsWith(".css")) {
          file.source = String(file.source).replace(/,\s*url\([^)]*\.woff\)\s*format\(["']?woff["']?\)/g, "");
        }
      }
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  if (mode === "production" && env.VITE_TRACK_ALL_MEETINGS === "true") {
    throw new Error(
      "VITE_TRACK_ALL_MEETINGS=true is a dev-only switch. Unset it (or set it to false) before a production build."
    );
  }

  const fixedNames = new Set(["background", "content"]);

  return {
    plugins: [dropWoff()],
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "es2022",
      modulePreload: false,
      sourcemap: mode !== "production",
      minify: mode === "production",
      rollupOptions: {
        input: {
          popup: resolve("popup.html"),
          options: resolve("options.html"),
          background: resolve("src/background/index.js"),
          content: resolve("src/content/index.js")
        },
        output: {
          // manifest.json references background.js and content.js by name, so those two must not be hashed
          entryFileNames: (chunk) => (fixedNames.has(chunk.name) ? "[name].js" : "assets/[name]-[hash].js"),
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});
