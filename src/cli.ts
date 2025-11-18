import { program } from "commander";

program.option(
	"-c, --config [string]",
	"Path to config file",
	"dowwntime.config.ts",
);

program.parse();

const options = program.opts<{
	config: string;
}>();

const configPath = options.config;

// Dynamically import the config file
const _path = path.resolve(process.cwd(), configPath);
const configModule = await import(_path);
const config = configModule.default || configModule;

import path from "node:path";
// Run the main function with the loaded config
// Assuming the main function is named 'run' and is exported from index.ts
import { run } from "./index.ts";

await run(config);
