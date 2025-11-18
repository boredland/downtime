import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		lib: "src/index.ts",
		cli: "src/cli.ts",
	},
	exports: {
		all: true,
	},
	clean: true,
	format: ["esm"],
	treeshake: true,
	dts: {
		resolve: true,
	},
	removeNodeProtocol: true,
});
