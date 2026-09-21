export type Visibility = "public" | "password" | "private";

export interface FileRecord {
	id: string;
	r2Key: string;
	filename: string;
	contentType: string;
	size: number;
	visibility: Visibility;
	owner: string;
	createdAt: number;
	expiresAt: number;
	/** Only set when visibility is "password" -- PBKDF2, see src/password.ts. Never sent to clients, see toPublicFileRecord. */
	passwordHash?: string;
	passwordSalt?: string;
	/**
	 * Plaintext, kept alongside passwordHash so team members who forgot it can retrieve it
	 * instead of having to rotate it. Only ever set together with passwordHash/passwordSalt,
	 * and cleared whenever they are. Never exposed via PublicFileRecord -- see toTeamFileRecord
	 * in kv.ts for the one shape allowed to carry it (Access-gated team members only, who can
	 * already reset the password or make the file public, so this reveals no new capability).
	 */
	password?: string;
	/** Set when this file is a member of a bundle. A bundled file defers all access
	 * gating (visibility/password) to its parent bundle -- see resolveGate in download.ts. */
	bundleId?: string;
}

/**
 * A shareable folder grouping several files under one link (/f/:id). The bundle owns
 * visibility/password/expiry; member files inherit it and are gated through the bundle.
 * Members keep their own FileRecord (own /d page, preview, R2 object) and carry bundleId.
 */
export interface BundleRecord {
	id: string;
	name: string;
	/** Member file ids, in display order. */
	fileIds: string[];
	visibility: Visibility;
	owner: string;
	createdAt: number;
	expiresAt: number;
	/** Same PBKDF2 scheme as FileRecord; only set when visibility is "password". */
	passwordHash?: string;
	passwordSalt?: string;
	/** Plaintext counterpart of passwordHash -- see the doc comment on FileRecord.password. */
	password?: string;
}

/** Structural gate shared by FileRecord and BundleRecord -- whichever one governs access. */
export interface Gated {
	id: string;
	visibility: Visibility;
	passwordHash?: string;
	passwordSalt?: string;
}

/** FileRecord shape safe to hand to any client -- see toPublicFileRecord in kv.ts. */
export type PublicFileRecord = Omit<FileRecord, "passwordHash" | "passwordSalt" | "password"> & { hasPassword: boolean };

/** BundleRecord shape safe to hand to any client, with its members resolved. */
export type PublicBundleRecord = Omit<BundleRecord, "passwordHash" | "passwordSalt" | "password" | "fileIds"> & {
	hasPassword: boolean;
	files: PublicFileRecord[];
};

/**
 * FileRecord shape for Access-gated team members (the /app API, MCP tools): the public
 * shape plus the plaintext password when one is set. Never reaches an unauthenticated
 * client -- see toTeamFileRecord in kv.ts.
 */
export type TeamFileRecord = PublicFileRecord & { password?: string };

/** BundleRecord counterpart of TeamFileRecord, with members resolved to TeamFileRecord too. */
export type TeamBundleRecord = Omit<PublicBundleRecord, "files"> & { password?: string; files: TeamFileRecord[] };

/** What a visitor did with a link. "zip" is a whole-bundle download via /f/:id/all.zip. */
export type AccessKind = "view" | "download" | "zip";

/**
 * One recorded access to a link.
 *
 * Deliberately limited to request context Cloudflare already derives for every request
 * and hands the Worker for free (request.cf.country/city, Referer, User-Agent), and
 * reduced further before it is written: no IP address, no raw User-Agent string, no
 * cookie, no session id, nothing else that would single out a returning visitor. The
 * Referer keeps only its hostname -- paths routinely carry tokens and search terms.
 */
export interface AccessEvent {
	/** Unix ms. */
	t: number;
	kind: AccessKind;
	/** ISO-3166-1 alpha-2 from request.cf.country; omitted when Cloudflare can't tell. */
	country?: string;
	city?: string;
	/** Hostname of the Referer, and only for off-site referrers (see src/telemetry.ts). */
	referer?: string;
	/** Coarse browser+OS family parsed from the UA, e.g. "Firefox / macOS". */
	client?: string;
}

/** The counters half of AccessStats -- also mirrored into the KV entry's metadata. */
export interface AccessSummary {
	views: number;
	downloads: number;
	/** Unix ms of the most recent access of any kind; 0 when there has been none. */
	lastAt: number;
}

/** Access history for one file or bundle, stored under `hits:<id>` in METADATA. */
export interface AccessSummaryWithEvents extends AccessSummary {
	/** Most recent events, newest first, capped at RECENT_LIMIT in src/telemetry.ts. */
	recent: AccessEvent[];
}

export interface UsageCurrent {
	bytes: number;
	count: number;
}

export interface UsageMonth {
	bytesUploaded: number;
	uploadCount: number;
}
