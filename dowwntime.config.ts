import { ConsoleAlert, defineConfig } from "dowwntime";

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
	maxSpaceUsageBytes: 262144 * 0.1,
	alerts: [new ConsoleAlert()],
});
