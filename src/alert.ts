import { IncomingWebhook } from "@slack/webhook";

type State = {
	timestamp: number;
	status: "up" | "down" | "degraded";
	durationMs: number;
	url: string;
};

export interface Alert {
	name: string;
	onUp: (path: string, state: State) => Promise<void> | void;
	onDown: (path: string, state: State) => Promise<void> | void;
	onDegraded: (path: string, state: State) => Promise<void> | void;
}

export class ConsoleAlert implements Alert {
	name = "ConsoleAlert";

	async onUp(path: string, state: State): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.log(`[ALERT - UP] Path: ${path} is UP (${state.durationMs}ms).`);
	}

	async onDown(path: string, state: State): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.error(
			`[ALERT - DOWN] Path: ${path} is DOWN (${state.durationMs}ms).`,
		);
	}

	async onDegraded(path: string, state: State): Promise<void> {
		// biome-ignore lint/suspicious/noConsole: literally a console alert
		console.warn(
			`[ALERT - DEGRADED] Path: ${path} is DEGRADED (${state.durationMs}ms).`,
		);
	}
}

export class SlackAlert implements Alert {
	name = "SlackAlert";

	private webhook: IncomingWebhook;

	constructor(webhookUrl: string) {
		this.webhook = new IncomingWebhook(webhookUrl);
	}

	private async sendSlackMessage(
		text: string,
		category: "good" | "warning" | "danger",
	): Promise<void> {
		await this.webhook.send({
			attachments: [
				{
					color: category,
					text,
					mrkdwn_in: ["text"],
				},
			],
		});
	}

	async onUp(path: string, state: State): Promise<void> {
		await this.sendSlackMessage(
			`🟢 [\`${path}\`](${state.url}) is UP (${state.durationMs}ms).`,
			"good",
		);
	}

	async onDown(path: string, state: State): Promise<void> {
		await this.sendSlackMessage(
			`🔴 [\`${path}\`](${state.url}) is DOWN (${state.durationMs}ms).`,
			"danger",
		);
	}

	async onDegraded(path: string, state: State): Promise<void> {
		await this.sendSlackMessage(
			`🟡 [\`${path}\`](${state.url}) is DEGRADED (${state.durationMs}ms).`,
			"warning",
		);
	}
}
