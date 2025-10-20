import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,                // generate .d.ts
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node18",
});
