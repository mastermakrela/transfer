import { deleteAccessStats } from "./telemetry";
import type {
	BundleRecord,
	FileRecord,
	Gated,
	PublicBundleRecord,
	PublicFileRecord,
	UsageCurrent,
	UsageMonth,
	Visibility,
} from "./types";

/** Strips password fields before a record ever reaches a client (browser or MCP tool). */
export function toPublicFileRecord(record: FileRecord): PublicFileRecord {
	const { passwordHash, passwordSalt, ...rest } = record;
	return { ...rest, hasPassword: Boolean(passwordHash) };
}

/** Strips password fields and swaps fileIds for the resolved member records. */
export function toPublicBundleRecord(bundle: BundleRecord, files: FileRecord[]): PublicBundleRecord {
	const { passwordHash, passwordSalt, fileIds: _fileIds, ...rest } = bundle;
	return { ...rest, hasPassword: Boolean(passwordHash), files: files.map(toPublicFileRecord) };
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const GB = 1024 * 1024 * 1024;

export function generateId(length = 10): string {
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function sanitizeFilename(rawName: string): string {
	const base = rawName.split(/[/\\]/).pop() ?? "";
	let cleaned = base.normalize("NFKC").replace(/[^A-Za-z0-9._-]/g, "_");
	cleaned = cleaned.replace(/^[.\s]+/, "").slice(0, 200);
	return cleaned || "file";
}

export function clampTtlSeconds(requested: string | undefined, env: Env): number {
	const parsed = requested ? Number(requested) : NaN;
	if (!Number.isFinite(parsed) || parsed <= 0) return env.DEFAULT_TTL_SECONDS;
	return Math.min(Math.max(parsed, env.MIN_TTL_SECONDS), env.MAX_TTL_SECONDS);
}

function fileKey(id: string): string {
	return `file:${id}`;
}

function bundleKey(id: string): string {
	return `bundle:${id}`;
}

// The third key namespace, `hits:<id>`, belongs to src/telemetry.ts. Every delete path
// below tears it down alongside the record so an id can't be reused onto stale history.

function currentMonthKey(now = Date.now()): string {
	const d = new Date(now);
	return `usage:month:${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getFile(env: Env, id: string): Promise<FileRecord | null> {
	const raw = await env.METADATA.get(fileKey(id));
	return raw ? (JSON.parse(raw) as FileRecord) : null;
}

async function putFile(env: Env, record: FileRecord): Promise<void> {
	await env.METADATA.put(fileKey(record.id), JSON.stringify(record), {
		metadata: { expiresAt: record.expiresAt, size: record.size },
	});
}

export async function listFiles(env: Env): Promise<FileRecord[]> {
	const records: FileRecord[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list({ prefix: "file:", cursor });
		const batch = await Promise.all(page.keys.map((k) => env.METADATA.get(k.name)));
		for (const raw of batch) if (raw) records.push(JSON.parse(raw) as FileRecord);
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateFileRecord(
	env: Env,
	id: string,
	patch: { visibility?: Visibility; expiresInSeconds?: number; passwordHash?: string; passwordSalt?: string },
): Promise<FileRecord | null> {
	const record = await getFile(env, id);
	if (!record) return null;
	if (patch.visibility === "public" || patch.visibility === "private" || patch.visibility === "password") {
		record.visibility = patch.visibility;
		if (patch.visibility !== "password") {
			record.passwordHash = undefined;
			record.passwordSalt = undefined;
		}
	}
	// Independent of whether visibility changed in this same patch -- lets a caller
	// rotate the password on an already password-protected file too.
	if (patch.passwordHash && patch.passwordSalt) {
		record.passwordHash = patch.passwordHash;
		record.passwordSalt = patch.passwordSalt;
	}
	if (typeof patch.expiresInSeconds === "number") {
		const ttl = Math.min(Math.max(patch.expiresInSeconds, env.MIN_TTL_SECONDS), env.MAX_TTL_SECONDS);
		record.expiresAt = Date.now() + ttl * 1000;
	}
	await putFile(env, record);
	return record;
}

export async function deleteFileRecord(env: Env, id: string): Promise<boolean> {
	const record = await getFile(env, id);
	if (!record) return false;
	await env.FILES.delete(record.r2Key);
	await env.METADATA.delete(fileKey(id));
	await deleteAccessStats(env, id);
	await adjustUsageCurrent(env, -record.size, -1);
	// Keep the parent bundle consistent when a member is deleted on its own (app row,
	// MCP delete_file). Deleting the last member removes the now-empty bundle too.
	if (record.bundleId) await detachFromBundle(env, record.bundleId, id);
	return true;
}

/** Removes a file id from its bundle's member list; deletes the bundle if it becomes empty. */
async function detachFromBundle(env: Env, bundleId: string, fileId: string): Promise<void> {
	const bundle = await getBundle(env, bundleId);
	if (!bundle) return;
	const fileIds = bundle.fileIds.filter((fid) => fid !== fileId);
	if (fileIds.length === 0) {
		await env.METADATA.delete(bundleKey(bundleId));
	} else {
		await putBundle(env, { ...bundle, fileIds });
	}
}

export async function deleteExpiredFile(env: Env, id: string): Promise<void> {
	const record = await getFile(env, id);
	if (record) {
		await env.FILES.delete(record.r2Key);
		await adjustUsageCurrent(env, -record.size, -1);
	}
	await env.METADATA.delete(fileKey(id));
	await deleteAccessStats(env, id);
}

export async function adjustUsageCurrent(env: Env, deltaBytes: number, deltaCount: number): Promise<void> {
	const raw = await env.METADATA.get("usage:current");
	const usage: UsageCurrent = raw ? JSON.parse(raw) : { bytes: 0, count: 0 };
	usage.bytes = Math.max(0, usage.bytes + deltaBytes);
	usage.count = Math.max(0, usage.count + deltaCount);
	await env.METADATA.put("usage:current", JSON.stringify(usage));
}

async function getMonthlyUsage(env: Env, monthKey: string): Promise<UsageMonth> {
	const raw = await env.METADATA.get(monthKey);
	return raw ? (JSON.parse(raw) as UsageMonth) : { bytesUploaded: 0, uploadCount: 0 };
}

async function addMonthlyUsage(env: Env, bytes: number): Promise<void> {
	const monthKey = currentMonthKey();
	const usage = await getMonthlyUsage(env, monthKey);
	usage.bytesUploaded += bytes;
	usage.uploadCount += 1;
	await env.METADATA.put(monthKey, JSON.stringify(usage));
}

export async function checkQuota(env: Env, size: number): Promise<{ ok: boolean; usedGB: number; budgetGB: number }> {
	const usage = await getMonthlyUsage(env, currentMonthKey());
	const budget = env.MONTHLY_BUDGET_BYTES;
	return {
		ok: usage.bytesUploaded + size <= budget,
		usedGB: usage.bytesUploaded / GB,
		budgetGB: budget / GB,
	};
}

export async function getUsageSummary(env: Env) {
	const [currentRaw, monthUsage] = await Promise.all([
		env.METADATA.get("usage:current"),
		getMonthlyUsage(env, currentMonthKey()),
	]);
	const current: UsageCurrent = currentRaw ? JSON.parse(currentRaw) : { bytes: 0, count: 0 };
	return {
		currentBytes: current.bytes,
		currentCount: current.count,
		monthBytesUploaded: monthUsage.bytesUploaded,
		monthUploadCount: monthUsage.uploadCount,
		monthBudgetBytes: env.MONTHLY_BUDGET_BYTES,
	};
}

export interface CreateUploadInput {
	filename: string;
	contentType: string;
	size: number;
	visibility: Visibility;
	ttlSeconds: number;
	owner: string;
	passwordHash?: string;
	passwordSalt?: string;
	/** Set when this upload is a member of a bundle (gating then defers to the bundle). */
	bundleId?: string;
}

// Records the upload optimistically at presign time — the client PUTs the bytes to R2
// directly afterwards. If it never does, downloads 404 (no R2 object) and the cron sweep
// removes the record and reclaims the counted usage once it expires.
export async function createUpload(env: Env, input: CreateUploadInput): Promise<FileRecord> {
	const id = generateId();
	const now = Date.now();
	const record: FileRecord = {
		id,
		r2Key: `${id}/${input.filename}`,
		filename: input.filename,
		contentType: input.contentType,
		size: input.size,
		visibility: input.visibility,
		owner: input.owner,
		createdAt: now,
		expiresAt: now + input.ttlSeconds * 1000,
		passwordHash: input.passwordHash,
		passwordSalt: input.passwordSalt,
		bundleId: input.bundleId,
	};

	await putFile(env, record);
	await adjustUsageCurrent(env, input.size, 1);
	await addMonthlyUsage(env, input.size);
	return record;
}

// ---- Bundles (shareable folders) ---------------------------------------------------------

export async function getBundle(env: Env, id: string): Promise<BundleRecord | null> {
	const raw = await env.METADATA.get(bundleKey(id));
	return raw ? (JSON.parse(raw) as BundleRecord) : null;
}

async function putBundle(env: Env, bundle: BundleRecord): Promise<void> {
	// Same size-less metadata trick as putFile -- the cron sweep reads expiresAt off the
	// list entry without deserializing every bundle. Byte accounting stays per-member.
	await env.METADATA.put(bundleKey(bundle.id), JSON.stringify(bundle), {
		metadata: { expiresAt: bundle.expiresAt },
	});
}

/** Persists a freshly-built bundle record. Members are created (and usage-counted) separately. */
export async function createBundle(env: Env, bundle: BundleRecord): Promise<BundleRecord> {
	await putBundle(env, bundle);
	return bundle;
}

export async function listBundles(env: Env): Promise<BundleRecord[]> {
	const records: BundleRecord[] = [];
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list({ prefix: "bundle:", cursor });
		const batch = await Promise.all(page.keys.map((k) => env.METADATA.get(k.name)));
		for (const raw of batch) if (raw) records.push(JSON.parse(raw) as BundleRecord);
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return records.sort((a, b) => b.createdAt - a.createdAt);
}

/** Resolves the member records of a bundle, dropping any that are missing or already expired. */
export async function getBundleFiles(env: Env, bundle: BundleRecord, now = Date.now()): Promise<FileRecord[]> {
	const files = await Promise.all(bundle.fileIds.map((fid) => getFile(env, fid)));
	return files.filter((f): f is FileRecord => f !== null && f.expiresAt > now);
}

export async function updateBundleRecord(
	env: Env,
	id: string,
	patch: { visibility?: Visibility; expiresInSeconds?: number; passwordHash?: string; passwordSalt?: string },
): Promise<BundleRecord | null> {
	const bundle = await getBundle(env, id);
	if (!bundle) return null;
	if (patch.visibility === "public" || patch.visibility === "private" || patch.visibility === "password") {
		bundle.visibility = patch.visibility;
		if (patch.visibility !== "password") {
			bundle.passwordHash = undefined;
			bundle.passwordSalt = undefined;
		}
	}
	if (patch.passwordHash && patch.passwordSalt) {
		bundle.passwordHash = patch.passwordHash;
		bundle.passwordSalt = patch.passwordSalt;
	}
	if (typeof patch.expiresInSeconds === "number") {
		const ttl = Math.min(Math.max(patch.expiresInSeconds, env.MIN_TTL_SECONDS), env.MAX_TTL_SECONDS);
		bundle.expiresAt = Date.now() + ttl * 1000;
		// Members share the bundle's lifetime, so the per-file cron sweep removes them in step.
		for (const fid of bundle.fileIds) {
			const file = await getFile(env, fid);
			if (file) await putFile(env, { ...file, expiresAt: bundle.expiresAt });
		}
	}
	await putBundle(env, bundle);
	return bundle;
}

export async function deleteBundleRecord(env: Env, id: string): Promise<boolean> {
	const bundle = await getBundle(env, id);
	if (!bundle) return false;
	// Delete the bundle key first so each deleteFileRecord's detachFromBundle is a no-op
	// (getBundle returns null) rather than rewriting a doomed record on every member.
	await env.METADATA.delete(bundleKey(id));
	await deleteAccessStats(env, id);
	for (const fid of bundle.fileIds) await deleteFileRecord(env, fid);
	return true;
}

export async function deleteExpiredBundle(env: Env, id: string): Promise<void> {
	const bundle = await getBundle(env, id);
	await env.METADATA.delete(bundleKey(id));
	await deleteAccessStats(env, id);
	// Members carry the same expiresAt and are swept by the file pass too; deleting here is
	// idempotent (deleteExpiredFile no-ops on an already-gone record, so usage isn't double-counted).
	if (bundle) for (const fid of bundle.fileIds) await deleteExpiredFile(env, fid);
}

/**
 * Returns whichever record governs access to a file: its parent bundle when the file is
 * bundled (bundle owns visibility/password), otherwise the file itself. Both structurally
 * satisfy Gated. If a bundleId dangles (bundle already gone), the file gates on itself.
 */
export async function resolveGate(env: Env, file: FileRecord): Promise<Gated> {
	if (file.bundleId) {
		const bundle = await getBundle(env, file.bundleId);
		if (bundle) return bundle;
	}
	return file;
}
