export interface Alert {
	name: string;
	onUp: (path: string) => Promise<void> | void;
	onDown: (path: string) => Promise<void> | void;
	onDegraded: (path: string) => Promise<void> | void;
}

export class ConsoleAlert implements Alert {
	name = "ConsoleAlert";

	async onUp(path: string): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.log(`[ALERT - UP] Path: ${path} is UP.`);
	}

	async onDown(path: string): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.log(`[ALERT - DOWN] Path: ${path} is DOWN.`);
	}

	async onDegraded(path: string): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.log(`[ALERT - DEGRADED] Path: ${path} is DEGRADED.`);
	}
}
