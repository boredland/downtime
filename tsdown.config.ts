import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		main: "src/index.ts",
		cli: "src/cli.ts",
	},
	exports: true,
	clean: true,
	format: ["esm"],
	treeshake: true,
	dts: {
		resolve: true,
	},
	removeNodeProtocol: true,
});
