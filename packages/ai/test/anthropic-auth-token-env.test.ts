import { describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.ts";
import { streamAnthropic } from "../src/providers/anthropic.ts";
import type { Context } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	constructorOpts: undefined as Record<string, unknown> | undefined,
	createParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
	function createSseResponse(): Response {
		const body = [
			`event: message_start\ndata: ${JSON.stringify({
				type: "message_start",
				message: { id: "msg_test", usage: { input_tokens: 10, output_tokens: 0 } },
			})}\n`,
			`event: message_delta\ndata: ${JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			})}\n`,
			`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n`,
		].join("\n");
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	}

	class FakeAnthropic {
		constructor(opts: Record<string, unknown>) {
			mockState.constructorOpts = opts;
		}
		messages = {
			create: (params: Record<string, unknown>) => {
				mockState.createParams = params;
				return { asResponse: async () => createSseResponse() };
			},
		};
	}

	return { default: FakeAnthropic };
});

describe("Anthropic provider-scoped auth token env", () => {
	const context: Context = {
		systemPrompt: "You are a helpful assistant.",
		messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
	};

	it("uses scoped ANTHROPIC_AUTH_TOKEN as Anthropic SDK authToken", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-6");
		const stream = streamAnthropic(model, context, {
			apiKey: "opaque-proxy-token",
			env: { ANTHROPIC_AUTH_TOKEN: "opaque-proxy-token" },
		});
		await stream.result();

		const opts = mockState.constructorOpts!;
		expect(opts.apiKey).toBeNull();
		expect(opts.authToken).toBe("opaque-proxy-token");

		const headers = opts.defaultHeaders as Record<string, string>;
		expect(headers["anthropic-beta"]).toContain("oauth-2025-04-20");

		const params = mockState.createParams!;
		expect(params.system).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ text: "You are Claude Code, Anthropic's official CLI for Claude." }),
			]),
		);
	});

	it("uses API key auth without scoped ANTHROPIC_AUTH_TOKEN", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-6");
		const stream = streamAnthropic(model, context, { apiKey: "opaque-proxy-token" });
		await stream.result();

		const opts = mockState.constructorOpts!;
		expect(opts.apiKey).toBe("opaque-proxy-token");
		expect(opts.authToken).toBeNull();
	});
});
