import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/core/index.ts",
    "src/db/index.ts",
    "src/db/offline/index.ts",
    "src/storage/index.ts",
    "src/registry/index.ts",
    "src/config/index.ts",
    "src/ops/index.ts",
    "src/ops/next.ts",
    "src/auth/index.ts",
    "src/app/index.ts",
    "src/app/next.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
});
