import { defineConfig } from "tsdown";

export default defineConfig([
	{
		exports: true,
		clean: true,
		format: ["esm"],
		treeshake: true,
		dts: {
			resolve: true,
		},
		removeNodeProtocol: true,
	},
	{
		entry: "src/cli.ts",
		clean: true,
		format: ["esm"],
		treeshake: true,
		dts: {
			resolve: true,
		},
		removeNodeProtocol: true,
	},
]);
