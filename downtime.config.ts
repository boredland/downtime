import { defineConfig } from "./src/index.ts";

export default defineConfig({
	openapiSpecUrl: "https://registry.scalar.com/@scalar/apis/galaxy?format=yaml",
	getExampleValue: (paramName: string) => {
		if (paramName === "chainId") {
			return "1";
		}
		return undefined;
	},
	concurrency: 10,
	timeoutMs: 5000,
	storagePath: "./storage.tmp",
});
