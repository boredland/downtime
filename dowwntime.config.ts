import { ConsoleAlert, defineConfig } from "dowwntime";

export default defineConfig({
	openapiSpecUrl: "https://registry.scalar.com/@scalar/apis/galaxy?format=yaml",
	getExampleValue: (paramName: string) => {
		if (paramName === "planetId") {
			return "1";
		}
		return undefined;
	},
	getStatus: (statusCode: number, path: string, durationMs: number) => {
		if (statusCode >= 200 && statusCode < 300) {
			if (path === "/api/health" && durationMs > 50) {
				return "degraded";
			}
			return "up";
		}
		if (statusCode === 429) {
			return "degraded";
		}
		return "down";
	},
	concurrency: 2,
	timeoutMs: 5000,
	storagePath: "./storage.tmp",
	maxSpaceUsageBytes: 262144 * 0.1,
	alerts: [new ConsoleAlert()],
});
