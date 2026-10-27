import { defineConfig } from "vite";

// Static single-page app deployed to Firebase Hosting (firebase.json serves web/dist). Hash routing, so no rewrites needed.
export default defineConfig({
  base: "./",
  // Brand art lives in public/assets (served at /assets). Keep Vite's hashed bundles out of that folder.
  build: { outDir: "dist", emptyOutDir: true, target: "es2022", assetsDir: "static" }
});
