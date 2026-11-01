import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  base: "./",
  server: {
    // Electron main/report windows hardcode http://localhost:5173 — never fall
    // back to another port or the app loads a blank/hung UI.
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist-react",
  },
});
