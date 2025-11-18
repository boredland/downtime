import fs from "node:fs";
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
	await fs.promises.writeFile(path, raw, "utf-8");
};

export class Storage {
	private data: StorageData | null = null;
	private storagePath: string;
	private maxItems: number;
	private updatedPaths = new Set<string>();

	/**
	 * @param storagePath where to store the data
	 * @param maxItems maximum number of items to store per path (default: keep last 4 weeks of 5-minute intervals)
	 */
	constructor(storagePath: string, maxItems = (60 / 5) * 24 * 7 * 4) {
		this.storagePath = storagePath;
		this.maxItems = maxItems;
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
		const before = (data.get(path) || []).slice(-this.maxItems + 1);
		data.set(path, [
			...before,
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
		await store(this.storagePath, data);
	}
}
