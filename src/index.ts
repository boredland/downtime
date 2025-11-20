import { bundle } from "@scalar/json-magic/bundle";
import {
	fetchUrls,
	parseJson,
	parseYaml,
} from "@scalar/json-magic/bundle/plugins/browser";
import { readFiles } from "@scalar/json-magic/bundle/plugins/node";
import { dereference } from "@scalar/openapi-parser";
import dayjs from "dayjs";
import pThrottle from "p-throttle";
import type { Alert } from "./alert.ts";
import { debug } from "./debug.ts";
import { measureRequest } from "./request.ts";
import { Storage } from "./storage.ts";

export type DowwntimeOptions = {
	/** URL to OpenAPI spec */
	openapiSpecUrl: string;
	/** Path to store measurement data */
	storagePath: string;
	/** Number of concurrent requests */
	concurrency?: number;
	/** Number of samples to take per endpoint */
	samples?: number;
	/** Base URL to use for requests, overrides servers defined in OpenAPI spec */
	baseUrl?: string;
	/** Function to get example values for parameters */
	getExampleValue?: (paramName: string, path: string) => string | undefined;
	/** Function to determine status based on response */
	getStatus?: (
		statusCode: number,
		path: string,
		durationMs: number,
	) => "up" | "down" | "degraded";
	/** Request timeout in milliseconds */
	timeoutMs?: number;
	/** Maximum storage space usage in bytes */
	maxSpaceUsageBytes?: number;
	/** Alerts to trigger on status changes */
	alerts: Alert[];
};

export const defineConfig = (options: DowwntimeOptions) => {
	return options;
};

export const run = async (options: ReturnType<typeof defineConfig>) => {
	// Load a file and all referenced files
	const data = await bundle(options.openapiSpecUrl, {
		plugins: [readFiles(), fetchUrls(), parseYaml(), parseJson()],
		treeShake: true,
	});

	const dereferenceResult = dereference(data);

	if (dereferenceResult.errors?.[0] || !dereferenceResult.schema) {
		throw new Error("Failed to dereference OpenAPI spec.", {
			cause: dereferenceResult.errors?.[0],
		});
	}

	const schema = dereferenceResult.schema;

	const baseUrl = options.baseUrl ?? schema.servers?.[0]?.url;

	if (!baseUrl) {
		throw new Error(
			"No base URL found in OpenAPI spec and no baseUrl option provided.",
		);
	}

	const fetchConfigurations = new Map<string, URL>();

	if (schema.paths) {
		for (const path of Object.keys(schema.paths)) {
			const pathItem = schema.paths[path];
			if (!pathItem) continue;
			if (!pathItem.get) continue;

			const url = new URL(path, baseUrl);
			let _path = path;

			if (
				"200" in (pathItem.get?.responses ?? {}) &&
				"text/event-stream" in (pathItem.get.responses?.["200"]?.content ?? {})
			) {
				continue; // Skip SSE endpoints
			}

			for (const param of pathItem.get.parameters || []) {
				let exampleValue =
					options.getExampleValue?.(param.name, path) ??
					param.example ??
					param.examples?.[0] ??
					param.schema?.example ??
					param.schema?.examples?.[0];

				if (!exampleValue && "enum" in param.schema) {
					// If the parameter has an enum, use the first value from the enum
					const enumValues = param.schema.enum;
					if (Array.isArray(enumValues) && enumValues.length > 0) {
						// Use the first enum value as the example value
						exampleValue = enumValues[0];
					}
				}

				if (!exampleValue && param.required) {
					debug(`No example value for parameter ${param.name} in ${path}`);
					continue;
				}

				if (param.in === "path") {
					// Replace path parameter with a placeholder value
					const placeholder = `{${param.name}}`;
					_path = _path.replace(placeholder, exampleValue);
					url.pathname = _path;
				}

				if (param.in === "query") {
					url.searchParams.set(param.name, exampleValue);
				}
			}

			fetchConfigurations.set(path, url);
		}
	}

	const measurements = new Storage(
		options.storagePath,
		options.maxSpaceUsageBytes ?? 262144 * 0.95,
	);

	const measure = async (path: string) => {
		const url = fetchConfigurations.get(path);
		if (!url) return;
		let status: "up" | "down" | "degraded" = "down";
		let durationMs: number | undefined;
		const start = Date.now();
		try {
			const metrics = await measureRequest(url, {
				method: "GET",
				timeout: options.timeoutMs ?? 5000,
			});
			durationMs = metrics.durationMs;

			if (options.getStatus) {
				status = options.getStatus(metrics.statusCode, path, durationMs);
			} else {
				status = metrics.statusCode >= 200 && durationMs < 300 ? "up" : "down";
			}
		} catch (_error) {
			durationMs = Date.now() - start;
			status = "down";
		}

		const measurement = {
			status,
			durationMs,
			timestamp: start,
			url: url.toString(),
		};

		debug(`Measured ${path}:`, measurement);

		return measurement;
	};

	const throttledMeasure = pThrottle({
		limit: options.concurrency ?? 5,
		interval: 1000,
	})(measure);

	await Promise.all(
		Array.from(fetchConfigurations.keys()).map(async (path) => {
			const mesaurements = await Promise.all(
				Array.from({ length: options.samples ?? 5 }).map(() =>
					throttledMeasure(path),
				),
			);
			const measurement = mesaurements.reduce(
				(acc, curr) => {
					if (!acc) return curr;
					if (!curr) return acc;

					acc.status = curr.status;
					// For duration, we take the average of measurements
					acc.durationMs = Math.round((acc.durationMs + curr.durationMs) / 2);

					return acc;
				},
				undefined satisfies Awaited<ReturnType<typeof measure>>,
			);

			debug(`Measured ${path} (avg):`, measurement);
			if (!measurement) return;
			await measurements.add(path, measurement);
		}),
	);

	await measurements.flush();

	for (const path of fetchConfigurations.keys()) {
		const { current, previous } = await measurements.getState(path);
		if (
			!current ||
			(!previous && current.status === "up") ||
			(previous && previous.status === current.status)
		) {
			continue;
		}

		for (const alert of options.alerts) {
			if (current.status === "up") {
				await alert.onUp(path, current);
			} else if (current.status === "down") {
				await alert.onDown(path, current);
			} else if (current.status === "degraded") {
				await alert.onDegraded(path, current);
			}
		}
	}

	const reports = await Promise.all(
		[...fetchConfigurations.keys()].map(async (path) => {
			const history = await measurements.getHistory(path);

			const startOfPast60m = dayjs()
				.subtract(60, "minute")
				.startOf("minute")
				.get("milliseconds");
			const startOfPast24h = dayjs()
				.subtract(24, "hours")
				.startOf("hour")
				.get("milliseconds");
			const startOfPast7d = dayjs()
				.subtract(7, "day")
				.startOf("day")
				.get("milliseconds");
			const startOfPast30d = dayjs()
				.subtract(30, "day")
				.startOf("day")
				.get("milliseconds");

			const getAvergageDuration = (since: number) => {
				const filtered = history.filter((item) => item.timestamp >= since);
				if (filtered.length === 0) return null;
				const total = filtered.reduce((acc, curr) => acc + curr.durationMs, 0);
				return Math.round(total / filtered.length);
			};

			const avgDuration60m = getAvergageDuration(startOfPast60m);
			const avgDuration24h = getAvergageDuration(startOfPast24h);
			const avgDuration7d = getAvergageDuration(startOfPast7d);
			const avgDuration30d = getAvergageDuration(startOfPast30d);

			const getRelativeDowntime = (since: number) => {
				const filtered = history.filter((item) => item.timestamp >= since);
				if (filtered.length === 0) return null;
				const downCount = filtered.filter(
					(item) => item.status === "down",
				).length;
				return downCount / filtered.length;
			};

			const relDowntime60m = getRelativeDowntime(startOfPast60m);
			const relDowntime24h = getRelativeDowntime(startOfPast24h);
			const relDowntime7d = getRelativeDowntime(startOfPast7d);
			const relDowntime30d = getRelativeDowntime(startOfPast30d);

			const getRelativeDegraded = (since: number) => {
				const filtered = history.filter((item) => item.timestamp >= since);
				if (filtered.length === 0) return null;
				const degradedCount = filtered.filter(
					(item) => item.status === "degraded",
				).length;
				return degradedCount / filtered.length;
			};

			const relDegraded60m = getRelativeDegraded(startOfPast60m);
			const relDegraded24h = getRelativeDegraded(startOfPast24h);
			const relDegraded7d = getRelativeDegraded(startOfPast7d);
			const relDegraded30d = getRelativeDegraded(startOfPast30d);

			return {
				path: `${path} - ${history[history.length - 1]?.status ?? "unknown"} - ${history[history.length - 1]?.durationMs ?? 0}ms`,
				down60m: relDowntime60m,
				degr60m: relDegraded60m,
				dur60m: avgDuration60m,
				down24h: relDowntime24h,
				degr24h: relDegraded24h,
				dur24h: avgDuration24h,
				down7d: relDowntime7d,
				degr7d: relDegraded7d,
				dur7d: avgDuration7d,
				down30d: relDowntime30d,
				degr30d: relDegraded30d,
				dur30d: avgDuration30d,
			};
		}),
	);

	// biome-ignore lint/suspicious/noConsole: fine here
	console.table(reports);
};

export * from "./alert.ts";
