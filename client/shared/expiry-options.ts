/** Mirrors the backend's clampTtlSeconds bounds (MIN 300s / MAX 2592000s). */
export const EXPIRY_OPTIONS: Array<{ label: string; value: number }> = [
	{ label: "1 hour", value: 60 * 60 },
	{ label: "1 day", value: 60 * 60 * 24 },
	{ label: "3 days", value: 60 * 60 * 24 * 3 },
	{ label: "7 days", value: 60 * 60 * 24 * 7 },
	{ label: "30 days", value: 60 * 60 * 24 * 30 },
];

export const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24 * 7;
