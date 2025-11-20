import http from "node:http";
import https from "node:https";

/**
 * Measure detailed timing of an HTTP request
 */
export const measureRequest = async (
	url: string | URL,
	options: http.RequestOptions,
) => {
	const startAt = Date.now();
	const result = await new Promise<{
		statusCode: number;
		durationMs: number;
	}>((resolve) => {
		let tlsHandshakeAt: number;
		const urlObj = typeof url === "string" ? new URL(url) : url;
		const client = urlObj.protocol === "https:" ? https : http;
		const req = client.request(url, options, (res) => {
			res.on("data", () => {
				// Consume the response data
			});
			res.on("end", () => {
				const totalMs = Date.now() - startAt;
				const tlsMs = tlsHandshakeAt ? tlsHandshakeAt - startAt : 0;
				resolve({
					statusCode: res.statusCode || 0,
					durationMs: totalMs - tlsMs,
				});
			});
		});
		req.on("socket", (socket) => {
			socket.on("secureConnect", () => {
				tlsHandshakeAt = Date.now();
			});
		});
		req.end();
	});

	return result;
};
