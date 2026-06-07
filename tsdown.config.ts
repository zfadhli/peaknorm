import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: "esm",
	platform: "node",
	clean: true,
	dts: true,
	minify: false,
	sourcemap: false,
});
