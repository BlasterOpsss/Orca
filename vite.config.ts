import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Orca's whirlpools-core ships WebAssembly, so the browser build needs these two plugins.
export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  build: { target: "esnext" },
  optimizeDeps: { exclude: ["@orca-so/whirlpools-core"] },
});
