import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { defaults, type PushupSettings, validateSettings } from "./settings.ts";
import { type GateJob, type GateResult, startWorker } from "./worker.ts";

export interface GateDependencies {
	settingsPath: string;
	start: typeof startWorker;
}
export function installPushupGate(pi: ExtensionAPI, dependencies: GateDependencies): void {
	let settings = { ...defaults };
	let configurationError: string | undefined;
	let active: GateJob | undefined;
	try {
		if (existsSync(dependencies.settingsPath))
			settings = validateSettings(JSON.parse(readFileSync(dependencies.settingsPath, "utf8")));
	} catch (error) {
		configurationError = error instanceof Error ? error.message : String(error);
	}
	const status = (ctx: ExtensionContext) => ctx.ui.setStatus("pushups", `push-ups: ${settings.reps}`);
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") {
			status(ctx);
			if (configurationError)
				ctx.ui.notify(`Push-up settings invalid: ${configurationError}. Use /pushups reset.`, "error");
		}
	});
	pi.on("session_shutdown", () => active?.cancel());
	pi.registerCommand("pushups", {
		description:
			"Configure push-ups: /pushups [reps N | camera N | confidence N | upAngle N | downAngle N | holdMs N | reset]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (active) {
				ctx.ui.notify("Close the camera gate before changing settings.", "warning");
				return;
			}
			try {
				let input = args.trim();
				if (!input) {
					const choice = await ctx.ui.select("Push-up gate settings", [...Object.keys(defaults), "reset"]);
					if (!choice) return;
					if (choice === "reset") input = "reset";
					else {
						const value = await ctx.ui.input(
							`Set ${choice} (currently ${settings[choice as keyof PushupSettings]})`,
						);
						if (value === undefined) return;
						input = `${choice} ${value}`;
					}
				}
				let next: PushupSettings;
				if (input === "reset") next = { ...defaults };
				else {
					const parts = input.split(/\s+/);
					if (parts.length === 1 && /^\d+$/.test(parts[0])) parts.unshift("reps");
					const [key, value] = parts;
					if (parts.length !== 2 || !Object.hasOwn(defaults, key) || !value?.trim())
						throw new Error("Usage: /pushups reps 3 (or /pushups to open settings).");
					next = validateSettings({ ...settings, [key]: Number(value) });
				}
				await mkdir(dirname(dependencies.settingsPath), { recursive: true });
				const temporary = `${dependencies.settingsPath}.${process.pid}.tmp`;
				await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
				await rename(temporary, dependencies.settingsPath);
				settings = next;
				configurationError = undefined;
				status(ctx);
				ctx.ui.notify(`Push-up settings: ${JSON.stringify(settings)}`, "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
	pi.on("input", async (event, ctx): Promise<InputEventResult> => {
		if (event.source === "extension" || (!event.text.trim() && !event.images?.length)) return { action: "continue" };
		if (configurationError) {
			ctx.ui.notify("Invalid push-up settings. Use /pushups reset.", "error");
			if (ctx.mode === "tui") ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}
		if (settings.reps === 0) return { action: "continue" };
		if (ctx.mode !== "tui" || event.source !== "interactive") {
			ctx.ui.notify("Push-up gate requires Pi TUI. Configure zero reps in the TUI to disable it.", "error");
			return { action: "handled" };
		}
		if (active) {
			ctx.ui.notify("A camera gate is already active.", "warning");
			return { action: "handled" };
		}
		let outcome: GateResult = { status: "cancelled" };
		try {
			outcome = await ctx.ui.custom<GateResult>((tui, theme, keybindings, done) => {
				let count = 0,
					disposed = false;
				active = dependencies.start({ ...settings }, (value) => {
					count = value;
					tui.requestRender();
				});
				const job = active;
				void job.result.then((result) => {
					if (!disposed) done(result);
				});
				return {
					render: (width: number) => [
						truncateToWidth(
							theme.fg("accent", `Push-ups ${count}/${settings.reps} — your prompt is held`),
							width,
						),
						truncateToWidth("Use the native camera preview. Place your full body side-on.", width),
						truncateToWidth(
							`${keybindings.getKeys("app.interrupt").join("/")} cancels and restores your draft.`,
							width,
						),
					],
					handleInput: (data: string) => {
						if (keybindings.matches(data, "app.interrupt") || keybindings.matches(data, "app.clear"))
							job.cancel();
					},
					invalidate: () => {},
					dispose: () => {
						disposed = true;
						job.cancel();
					},
				};
			});
		} catch (error) {
			outcome = { status: "error", message: error instanceof Error ? error.message : String(error) };
		} finally {
			active = undefined;
			status(ctx);
		}
		if (outcome.status === "complete") return { action: "continue" };
		ctx.ui.setEditorText(event.text);
		ctx.ui.notify(
			outcome.status === "error"
				? `${outcome.message} Prompt restored.`
				: "Push-up gate cancelled. Prompt restored.",
			outcome.status === "error" ? "error" : "info",
		);
		if (event.images?.length) ctx.ui.notify("Reattach images before resubmitting the restored draft.", "warning");
		return { action: "handled" };
	});
}
export default function pushups(pi: ExtensionAPI): void {
	installPushupGate(pi, {
		settingsPath:
			process.env.PUSHUP_PI_SETTINGS ||
			fileURLToPath(new URL("../../../../../.pi/pushups.local.json", import.meta.url)),
		start: startWorker,
	});
}
