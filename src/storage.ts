import fs from "node:fs";
import { debug } from "./debug.ts";
import { deserialize, serialize } from "./serializer.ts";

type Measurement = [number, "up" | "down" | "degraded", number];
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
			} catch {
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
		},
	) {
		const data = await this.ensureLoaded();
		data.set(path, [
			...(data.get(path) || []),
			[measurement.timestamp, measurement.status, measurement.durationMs],
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
}
