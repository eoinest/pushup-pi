import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPushupGate } from "../examples/extensions/pushups/index.ts";
import { defaults, validateSettings } from "../examples/extensions/pushups/settings.ts";
import { type GateResult, startWorker } from "../examples/extensions/pushups/worker.ts";
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from "../src/core/extensions/types.ts";
import type { KeybindingsManager } from "../src/core/keybindings.ts";
import type { Theme } from "../src/modes/interactive/theme/theme.ts";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function harness(outcome: GateResult, reps = 1) {
	const directory = await mkdtemp(join(tmpdir(), "pushups-test-"));
	directories.push(directory);
	const path = join(directory, "settings.json");
	await writeFile(path, JSON.stringify({ ...defaults, reps }));
	let input: ((event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult>) | undefined;
	const api = {
		on: (name: string, handler: typeof input) => {
			if (name === "input") input = handler;
		},
		registerCommand: vi.fn(),
	} as unknown as ExtensionAPI;
	const cancel = vi.fn();
	const start = vi.fn(() => ({ result: Promise.resolve(outcome), cancel }));
	installPushupGate(api, { settingsPath: path, start });
	const ui = {
		notify: vi.fn(),
		setStatus: vi.fn(),
		setEditorText: vi.fn(),
		custom: vi.fn(
			async (
				factory: (
					tui: TUI,
					theme: Theme,
					kb: KeybindingsManager,
					done: (result: GateResult) => void,
				) => Component & { dispose?: () => void },
			) => {
				let finish: (result: GateResult) => void = () => {};
				const result = new Promise<GateResult>((resolve) => {
					finish = resolve;
				});
				const component = factory(
					{ requestRender: vi.fn() } as unknown as TUI,
					{ fg: (_color: string, text: string) => text } as unknown as Theme,
					{ getKeys: () => ["escape"], matches: () => false } as unknown as KeybindingsManager,
					finish,
				);
				expect(component.render(80).join(" ")).toContain("your prompt is held");
				const value = await result;
				component.dispose?.();
				return value;
			},
		),
	};
	const ctx = { mode: "tui", ui } as unknown as ExtensionContext;
	if (!input) throw new Error("input hook was not registered");
	return { input, ctx, ui, start, api };
}
describe("Pi push-up input gate", () => {
	it("zero bypasses custom UI and camera", async () => {
		const h = await harness({ status: "complete" }, 0);
		expect(await h.input({ type: "input", text: "draft", source: "interactive" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).not.toHaveBeenCalled();
		expect(h.start).not.toHaveBeenCalled();
	});
	it("completion continues the same input through Pi without injecting a duplicate", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "original", source: "interactive" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).toHaveBeenCalledOnce();
		expect(h.start).toHaveBeenCalledOnce();
		expect(h.ui.setEditorText).not.toHaveBeenCalled();
	});
	it.each(["cancelled", "error"] as const)("%s blocks submission and restores exact text", async (status) => {
		const h = await harness({ status, message: "camera unavailable" });
		expect(await h.input({ type: "input", text: "draft\nline two", source: "interactive" }, h.ctx)).toEqual({
			action: "handled",
		});
		expect(h.ui.setEditorText).toHaveBeenCalledWith("draft\nline two");
	});
	it("positive count cannot be bypassed by RPC", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "draft", source: "rpc" }, h.ctx)).toEqual({ action: "handled" });
		expect(h.ui.custom).not.toHaveBeenCalled();
	});
	it("programmatic extension messages do not start the gate", async () => {
		const h = await harness({ status: "complete" });
		expect(await h.input({ type: "input", text: "internal", source: "extension" }, h.ctx)).toEqual({
			action: "continue",
		});
		expect(h.ui.custom).not.toHaveBeenCalled();
	});
	it("settings reject invalid counts, cameras, confidence and inverted thresholds", () => {
		for (const value of [
			{ reps: -1 },
			{ reps: 1.5 },
			{ camera: -1 },
			{ confidence: 0 },
			{ downAngle: 170 },
			{ holdMs: 0 },
		])
			expect(() => validateSettings({ ...defaults, ...value })).toThrow();
		expect(validateSettings({ ...defaults, reps: 0 }).reps).toBe(0);
	});
});

describe("native worker protocol", () => {
	async function executable(source: string) {
		const directory = await mkdtemp(join(tmpdir(), "pushups-worker-"));
		directories.push(directory);
		const path = join(directory, "helper");
		await writeFile(path, `#!${process.execPath}\n${source}\n`);
		await chmod(path, 0o755);
		return path;
	}
	it("waits for helper exit and required reps before accepting completion", async () => {
		const binary = await executable(
			`process.stdout.write('{"type":"progress","count":1}\\n{"type":"complete"}\\n');`,
		);
		vi.stubEnv("PUSHUP_PI_PYTHON", binary);
		try {
			const progress = vi.fn();
			const worker = startWorker({ ...defaults }, progress);
			expect(await worker.result).toEqual({ status: "complete" });
			expect(progress).toHaveBeenCalledWith(1);
			worker.cancel();
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("rejects a premature completion record", async () => {
		const binary = await executable(`process.stdout.write('{"type":"complete"}\\n');`);
		vi.stubEnv("PUSHUP_PI_PYTHON", binary);
		try {
			expect((await startWorker({ ...defaults }, () => {}).result).status).toBe("error");
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("cancellation terminates a live helper and blocks late success", async () => {
		const binary = await executable("setInterval(()=>{},1000);");
		vi.stubEnv("PUSHUP_PI_PYTHON", binary);
		try {
			const worker = startWorker({ ...defaults }, () => {});
			worker.cancel();
			worker.cancel();
			expect(await worker.result).toEqual({ status: "cancelled" });
		} finally {
			vi.unstubAllEnvs();
		}
	});
	it("a missing interpreter fails closed", async () => {
		vi.stubEnv("PUSHUP_PI_PYTHON", "/nonexistent/pushups/python");
		try {
			expect((await startWorker({ ...defaults }, () => {}).result).status).toBe("error");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
