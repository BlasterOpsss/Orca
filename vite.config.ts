import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

// Orca's whirlpools-core ships WebAssembly (wasm plugin). The SDK also imports Node's
// `assert`, which browsers lack, so it is aliased to a tiny shim.
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: { assert: fileURLToPath(new URL("./src/assert-shim.ts", import.meta.url)) },
  },
  build: { target: "esnext" },
  optimizeDeps: { exclude: ["@orca-so/whirlpools-core"] },
});
