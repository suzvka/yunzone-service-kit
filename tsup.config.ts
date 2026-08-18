import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/registry/index.ts", "src/config/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
});
