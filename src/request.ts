import http from "node:http";

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
		dnsLookupMs: number;
		tcpConnectionMs: number;
		tlsHandshakeMs: number;
		timeToFirstByteMs: number;
	}>((resolve) => {
		let dnsLookupAt: number;
		let tcpConnectionAt: number;
		let tlsHandshakeAt: number;
		let statusCode: number;

		const req = http.request(url, options, (res) => {
			statusCode = res.statusCode || 0;
			res.once("readable", () => {
				resolve({
					statusCode,
					dnsLookupMs: dnsLookupAt - startAt,
					tcpConnectionMs: tcpConnectionAt - dnsLookupAt,
					tlsHandshakeMs: tlsHandshakeAt - tcpConnectionAt,
					timeToFirstByteMs: Date.now() - tlsHandshakeAt,
				});
			});
		});
		req.on("socket", (socket) => {
			socket.on("lookup", () => {
				dnsLookupAt = Date.now();
			});
			socket.on("connect", () => {
				tcpConnectionAt = Date.now();
			});
			socket.on("secureConnect", () => {
				tlsHandshakeAt = Date.now();
			});
		});
	});

	return result;
};
