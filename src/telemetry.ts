/**
 * Access tracking for share links -- "who opened this".
 *
 * Named telemetry rather than "access" to keep it clearly distinct from src/access.ts,
 * which is about Cloudflare Access sessions.
 *
 * Scope is deliberately narrow (see AccessEvent in types.ts): every field comes from
 * request context Cloudflare already computes for the request anyway, and the two that
 * would identify a person -- the IP address and the raw User-Agent -- are never written,
 * only reduced to a country/city and a browser+OS family. Nothing is set on the visitor
 * (no cookie, no pixel, no id), so two visits are indistinguishable from two visitors.
 */
import type { AccessEvent, AccessKind, AccessSummary, AccessSummaryWithEvents } from "./types";

/** How many individual events are kept per link. Older ones fall off; counters keep counting. */
const RECENT_LIMIT = 50;

const EMPTY: AccessSummaryWithEvents = { views: 0, downloads: 0, lastAt: 0, recent: [] };

function hitsKey(id: string): string {
	return `hits:${id}`;
}

export async function getAccessStats(env: Env, id: string): Promise<AccessSummaryWithEvents> {
	const raw = await env.METADATA.get(hitsKey(id));
	return raw ? (JSON.parse(raw) as AccessSummaryWithEvents) : EMPTY;
}

/**
 * Counters for every tracked link, keyed by file/bundle id. Reads the summaries straight
 * off the KV list entries' metadata -- one list call for the whole table, instead of a
 * get per row (same trick putFile/putBundle use for expiresAt in kv.ts).
 */
export async function listAccessSummaries(env: Env): Promise<Record<string, AccessSummary>> {
	const summaries: Record<string, AccessSummary> = {};
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list<AccessSummary>({ prefix: "hits:", cursor });
		for (const key of page.keys) {
			if (key.metadata) summaries[key.name.slice("hits:".length)] = key.metadata;
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return summaries;
}

export async function deleteAccessStats(env: Env, id: string): Promise<void> {
	await env.METADATA.delete(hitsKey(id));
}

/**
 * Appends one access event. Call it through ctx.waitUntil -- it must never delay serving
 * the file.
 *
 * Read-modify-write on a single KV key, so two accesses landing in the same instant can
 * lose one of them. That is accepted on purpose: this is a "did anyone open my link"
 * signal, not billing, and the alternative (a Durable Object per file) is a lot of moving
 * parts for a counter nobody audits.
 */
export async function recordAccess(env: Env, id: string, kind: AccessKind, request: Request): Promise<void> {
	const event = describeEvent(request, kind);
	const stats = await getAccessStats(env, id);
	const next: AccessSummaryWithEvents = {
		views: stats.views + (kind === "view" ? 1 : 0),
		downloads: stats.downloads + (kind === "view" ? 0 : 1),
		lastAt: event.t,
		recent: [event, ...stats.recent].slice(0, RECENT_LIMIT),
	};
	const { recent: _recent, ...summary } = next;
	await env.METADATA.put(hitsKey(id), JSON.stringify(next), { metadata: summary });
}

function describeEvent(request: Request, kind: AccessKind): AccessEvent {
	const cf = request.cf;
	// "T1"/"XX" are Cloudflare's placeholders for Tor and "unknown", not real countries.
	const country = typeof cf?.country === "string" && cf.country !== "T1" && cf.country !== "XX" ? cf.country : undefined;
	const city = typeof cf?.city === "string" && cf.city ? cf.city : undefined;
	return {
		t: Date.now(),
		kind,
		country,
		city,
		referer: refererHost(request),
		client: clientFamily(request.headers.get("user-agent")),
	};
}

/**
 * Hostname of the Referer, dropped entirely when it is our own origin. A self-referral
 * just means the visitor pressed Download on the landing page we already served them;
 * the interesting case is the off-site one -- which inbox or chat the link travelled through.
 */
function refererHost(request: Request): string | undefined {
	const referer = request.headers.get("referer");
	if (!referer) return undefined;
	try {
		const host = new URL(referer).hostname;
		return host === new URL(request.url).hostname ? undefined : host;
	} catch {
		return undefined;
	}
}

// Bots first -- crawler UAs habitually claim to be Chrome/Safari too. Otherwise most
// specific first: Edge and Opera both carry "Chrome", and Chrome carries "Safari".
const BROWSERS: Array<[RegExp, string]> = [
	[/bot|crawler|spider|slurp|preview|facebookexternalhit/i, "Bot"],
	[/\bEdgi?A?\//, "Edge"],
	[/\bOPR\/|\bOpera\//, "Opera"],
	[/\bFirefox\/|\bFxiOS\//, "Firefox"],
	[/\bChrome\/|\bCriOS\//, "Chrome"],
	[/\bSafari\//, "Safari"],
	[/^curl\//i, "curl"],
	[/^Wget\//i, "Wget"],
];

// iOS before macOS: iPhone/iPad UAs also contain "Macintosh"-adjacent tokens.
const PLATFORMS: Array<[RegExp, string]> = [
	[/\bWindows NT\b/, "Windows"],
	[/\b(iPhone|iPad|iPod)\b/, "iOS"],
	[/\bAndroid\b/, "Android"],
	[/\bMac OS X\b|\bMacintosh\b/, "macOS"],
	[/\bCrOS\b/, "ChromeOS"],
	[/\bLinux\b/, "Linux"],
];

/**
 * Reduces a User-Agent to at most "Browser / OS". The full string is a well-known
 * fingerprinting surface (extensions, patch versions, device models); the family is
 * enough to answer "did they open it on their phone" and is shared by millions of people.
 */
function clientFamily(userAgent: string | null): string | undefined {
	if (!userAgent) return undefined;
	const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
	const platform = PLATFORMS.find(([re]) => re.test(userAgent))?.[1];
	if (browser && platform) return `${browser} / ${platform}`;
	return browser ?? platform;
}
