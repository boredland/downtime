import * as devalue from "devalue";

export const serialize = devalue.uneval;
export const deserialize = (input: string) => {
	const errors: Error[] = [];
	let result: unknown;
	try {
		// biome-ignore lint/security/noGlobalEval: only used for deserializing trusted input
		result = eval(`(${input})`);
	} catch (e) {
		errors.push(e as Error);
	}

	if (!result) {
		throw new Error(
			`Failed to deserialize input: ${input}. Errors: ${errors.map((e) => e.message).join(", ")}`,
		);
	}
	return result;
};
