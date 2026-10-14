export interface PushupSettings {
	reps: number;
	camera: number;
	confidence: number;
	upAngle: number;
	downAngle: number;
	holdMs: number;
}
export const defaults: PushupSettings = {
	reps: 1,
	camera: 0,
	confidence: 0.65,
	upAngle: 155,
	downAngle: 100,
	holdMs: 180,
};
export function validateSettings(value: unknown): PushupSettings {
	if (typeof value !== "object" || value === null) throw new Error("Settings must be an object.");
	const input = value as Record<string, unknown>;
	const settings = { ...defaults };
	for (const key of Object.keys(defaults) as (keyof PushupSettings)[]) {
		if (input[key] !== undefined) {
			if (typeof input[key] !== "number" || !Number.isFinite(input[key])) throw new Error(`Invalid ${key}.`);
			settings[key] = input[key];
		}
	}
	if (!Number.isInteger(settings.reps) || settings.reps < 0 || settings.reps > 100)
		throw new Error("Reps must be an integer from 0 to 100.");
	if (!Number.isInteger(settings.camera) || settings.camera < 0 || settings.camera > 20)
		throw new Error("Camera must be an integer from 0 to 20.");
	if (settings.confidence < 0.1 || settings.confidence > 1) throw new Error("Confidence must be between 0.1 and 1.");
	if (settings.downAngle < 30 || settings.upAngle > 180 || settings.downAngle >= settings.upAngle)
		throw new Error("Angles must satisfy 30 <= downAngle < upAngle <= 180.");
	if (!Number.isInteger(settings.holdMs) || settings.holdMs < 50 || settings.holdMs > 2000)
		throw new Error("Hold time must be an integer from 50 to 2000 ms.");
	return settings;
}
