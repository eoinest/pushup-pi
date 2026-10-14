import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PushupSettings } from "./settings.ts";

export type GateResult = { status: "complete" | "cancelled" | "error"; message?: string };
export interface GateJob {
	result: Promise<GateResult>;
	cancel: () => void;
}
export function startWorker(settings: PushupSettings, onProgress: (count: number) => void): GateJob {
	const directory = fileURLToPath(new URL("./", import.meta.url));
	const python = process.env.PUSHUP_PI_PYTHON || fileURLToPath(new URL("./native/.venv/bin/python", import.meta.url));
	const child = spawn(python, [`${directory}native/camera.py`, "--settings", JSON.stringify(settings)], {
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, PYTHONUNBUFFERED: "1" },
	});
	let cancelled = false,
		count = 0,
		finished = false,
		buffer = "",
		errorMessage: string | undefined;
	let terminal: GateResult | undefined;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let settle: (result: GateResult) => void = () => {};
	const result = new Promise<GateResult>((resolve) => {
		settle = resolve;
	});
	const finish = (value: GateResult) => {
		if (finished) return;
		finished = true;
		clearTimeout(deadline);
		clearTimeout(killTimer);
		settle(value);
	};
	const cancel = () => {
		if (finished || cancelled) return;
		cancelled = true;
		child.kill("SIGTERM");
		killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
	};
	const deadline = setTimeout(
		() => {
			errorMessage = "Camera gate timed out.";
			cancel();
		},
		10 * 60 * 1000,
	);
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		buffer += chunk;
		if (buffer.length > 65536) {
			errorMessage = "Invalid camera output.";
			cancel();
			return;
		}
		let newline = buffer.indexOf("\n");
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			try {
				const event = JSON.parse(line) as { type?: string; count?: number; message?: string };
				if (
					event.type === "progress" &&
					Number.isInteger(event.count) &&
					event.count !== undefined &&
					event.count >= count &&
					event.count <= settings.reps
				) {
					count = event.count;
					onProgress(count);
				}
				if (event.type === "complete" && count === settings.reps) terminal = { status: "complete" };
				if (event.type === "cancelled") terminal = { status: "cancelled" };
				if (event.type === "error") terminal = { status: "error", message: event.message || "Camera failed." };
			} catch {
				errorMessage = "Invalid camera output.";
				cancel();
			}
			newline = buffer.indexOf("\n");
		}
	});
	child.stderr.on("data", () => {});
	child.on("error", () =>
		finish({
			status: "error",
			message: "Camera helper could not start. Run native/setup.py or configure PUSHUP_PI_PYTHON.",
		}),
	);
	child.on("close", (code) => {
		if (errorMessage) finish({ status: "error", message: errorMessage });
		else if (cancelled) finish({ status: "cancelled" });
		else if (code === 0 && terminal) finish(terminal);
		else finish({ status: "error", message: terminal?.message || "Camera helper exited before completion." });
	});
	return { result, cancel };
}
