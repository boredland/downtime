import { defineConfig } from "tsdown";

export default defineConfig({
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
