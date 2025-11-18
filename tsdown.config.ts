import { defineConfig } from "tsdown";

export default defineConfig({
	exports: {
		all: true,
	},
	clean: true,
	format: ["esm"],
	entry: { node: "src/index.ts" },
	treeshake: true,
	dts: {
		resolve: true,
	},
	removeNodeProtocol: true,
});
