import { bundle } from "@scalar/json-magic/bundle";
import {
	fetchUrls,
	parseJson,
	parseYaml,
} from "@scalar/json-magic/bundle/plugins/browser";
import { readFiles } from "@scalar/json-magic/bundle/plugins/node";
import { dereference } from "@scalar/openapi-parser";
import pThrottle from "p-throttle";
import type { Alert } from "./alert.ts";
import { debug } from "./debug.ts";
import { Storage } from "./storage.ts";

type Options = {
	openapiSpecUrl: string;
	storagePath: string;
	concurrency?: number;
	baseUrl?: string;
	getExampleValue?: (paramName: string, path: string) => string | undefined;
	getStatus?: (
		statusCode: number,
		path: string,
		durationMs: number,
	) => "up" | "down" | "degraded";
	timeoutMs?: number;
	maxSpaceUsageBytes?: number;
	alerts: Alert[];
};

export const defineConfig = (options: Options) => {
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
		const start = Date.now();
		let status: "up" | "down" | "degraded" = "down";
		let durationMs: number | undefined;
		try {
			const abortSignal = AbortSignal.timeout(options.timeoutMs ?? 5000);

			const response = await fetch(url, {
				method: "GET",
				signal: abortSignal,
			});

			durationMs = Date.now() - start;

			if (options.getStatus) {
				status = options.getStatus(response.status, path, durationMs);
			} else {
				status = response.ok ? "up" : "down";
			}
		} catch (_error) {
			durationMs = Date.now() - start;
			status = "down";
		}

		return {
			status,
			durationMs,
			timestamp: start,
		};
	};

	const throttledMeasure = pThrottle({
		limit: options.concurrency ?? 5,
		interval: 1000,
	})(measure);

	await Promise.all(
		Array.from(fetchConfigurations.keys()).map(async (path) => {
			const measurement = await throttledMeasure(path);
			debug(`Measured ${path}:`, measurement);
			if (!measurement) return;
			await measurements.add(path, measurement);
		}),
	);

	await measurements.flush();

	for (const path of fetchConfigurations.keys()) {
		const state = await measurements.getState(path);
		if (
			!state.current ||
			(!state.previous && state.current[1] === "up") ||
			(state.previous && state.previous[1] === state.current[1])
		) {
			continue;
		}

		for (const alert of options.alerts) {
			if (state.current[1] === "up") {
				await alert.onUp(path);
			} else if (state.current[1] === "down") {
				await alert.onDown(path);
			} else if (state.current[1] === "degraded") {
				await alert.onDegraded(path);
			}
		}
	}
};

export * from "./alert.ts";
