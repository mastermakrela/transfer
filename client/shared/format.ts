/**
 * Small formatting helpers for the file manager UI. Deliberately not shared
 * with the Worker-side landing page (different runtime/bundler) -- see
 * task notes, not worth cross-wiring ~10 lines.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
	if (bytes === 0) return "0 B";
	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
	const value = bytes / 1024 ** exponent;
	const precision = exponent === 0 ? 0 : value < 10 ? 2 : value < 100 ? 1 : 0;
	return `${value.toFixed(precision)} ${BYTE_UNITS[exponent]}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
	["year", 1000 * 60 * 60 * 24 * 365],
	["month", 1000 * 60 * 60 * 24 * 30],
	["week", 1000 * 60 * 60 * 24 * 7],
	["day", 1000 * 60 * 60 * 24],
	["hour", 1000 * 60 * 60],
	["minute", 1000 * 60],
];

const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "in 2 hours", "in 3 days", or "expired" for timestamps in the past. */
export function formatRelativeTime(timestampMs: number, now = Date.now()): string {
	const diff = timestampMs - now;
	if (diff <= 0) return "expired";
	for (const [unit, unitMs] of RELATIVE_UNITS) {
		if (Math.abs(diff) >= unitMs) {
			return relativeFormatter.format(Math.round(diff / unitMs), unit);
		}
	}
	return relativeFormatter.format(Math.round(diff / (1000 * 60)), "minute");
}

export function formatAbsoluteTime(timestampMs: number): string {
	return new Date(timestampMs).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}
