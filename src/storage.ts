import fs from "node:fs";
import { debug } from "./debug.ts";
import { deserialize, serialize } from "./serializer.ts";

type Measurement = [number, "up" | "down" | "degraded", number, string];
type StorageData = Map<string, Measurement[]>;

const read = async (path: string) => {
	const raw = await fs.promises.readFile(path, "utf-8");
	const data = deserialize(raw) as StorageData;
	return data;
};

const store = async (path: string, data: StorageData) => {
	const raw = serialize(data);
	debug(`Storage: Storing ${Buffer.byteLength(raw, "utf-8")} bytes to ${path}`);
	await fs.promises.writeFile(path, raw, "utf-8");
};

export class Storage {
	private data: StorageData | null = null;
	private storagePath: string;
	private maxSpaceUsageBytes: number;
	private updatedPaths = new Set<string>();

	/**
	 * @param storagePath where to store the data
	 * @param maxItems maximum number of items to store per path (default: keep last 4 weeks of 5-minute intervals)
	 */
	constructor(storagePath: string, maxSpaceUsageBytes: number) {
		this.storagePath = storagePath;
		this.maxSpaceUsageBytes = maxSpaceUsageBytes;
	}

	private async ensureLoaded() {
		if (this.data === null) {
			try {
				this.data = await read(this.storagePath);
			} catch (error) {
				// biome-ignore lint/suspicious/noConsole: Want to see what is going on here
				console.error(
					`Storage: No existing storage found at ${this.storagePath}, starting fresh.`,
					error,
				);
				this.data = new Map();
			}
		}
		return this.data;
	}

	public async add(
		path: string,
		measurement: {
			timestamp: Measurement[0];
			status: Measurement[1];
			durationMs: Measurement[2];
			url: Measurement[3];
		},
	) {
		const data = await this.ensureLoaded();
		data.set(path, [
			...(data.get(path) || []),
			[
				measurement.timestamp,
				measurement.status,
				measurement.durationMs,
				measurement.url,
			],
		]);
		this.updatedPaths.add(path);
	}

	public async flush() {
		const data = await this.ensureLoaded();
		// Cleanup paths that were were not updated
		for (const path of data.keys()) {
			if (!this.updatedPaths.has(path)) {
				// biome-ignore lint/style/noNonNullAssertion: checked above
				this.data!.delete(path);
			}
		}

		const paths = Array.from(data.keys());
		const bytesPerPath = Math.floor(this.maxSpaceUsageBytes / paths.length);

		for (const path of paths) {
			const measurements = data.get(path);
			if (!measurements) continue;
			const approxBytes = Buffer.byteLength(serialize(measurements), "utf-8");
			if (approxBytes > bytesPerPath) {
				// Need to trim
				const reductionFactor = approxBytes / bytesPerPath;
				const itemsToKeep = Math.floor(measurements.length / reductionFactor);
				const trimmed = measurements.slice(-itemsToKeep);
				data.set(path, trimmed);
				debug(
					`Storage: trimmed data for path ${path} from ${measurements.length} to ${trimmed.length} items`,
				);
			}
		}

		await store(this.storagePath, data);
	}

	public async getState(path: string) {
		const data = await this.ensureLoaded();
		const pathData = data.get(path);

		const current = pathData ? pathData[pathData.length - 1] : null;
		const previous =
			pathData && pathData.length > 1 ? pathData[pathData.length - 2] : null;

		return {
			current: current
				? {
						timestamp: current[0],
						status: current[1],
						durationMs: current[2],
						url: current[3],
					}
				: null,
			previous: previous
				? {
						timestamp: previous[0],
						status: previous[1],
						durationMs: previous[2],
						url: previous[3],
					}
				: null,
		};
	}

	public async getHistory(path: string) {
		const data = await this.ensureLoaded();
		return (data.get(path) ?? []).map(([timestamp, status, durationMs]) => ({
			timestamp,
			status,
			durationMs,
		}));
	}
}
