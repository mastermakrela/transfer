import { hashPassword } from "./password";
import { deleteAccessStats } from "./telemetry";
import type {
	BundleRecord,
	FileRecord,
	Gated,
	PublicBundleRecord,
	PublicFileRecord,
	TeamBundleRecord,
	TeamFileRecord,
	UpdateResult,
	UsageCurrent,
	UsageMonth,
	Visibility,
} from "./types";

/** Strips password fields before a record ever reaches a client (browser or MCP tool). */
export function toPublicFileRecord(record: FileRecord): PublicFileRecord {
	const { passwordHash, passwordSalt, password, ...rest } = record;
	return { ...rest, hasPassword: Boolean(passwordHash) };
}

/** Strips password fields and swaps fileIds for the resolved member records. */
export function toPublicBundleRecord(bundle: BundleRecord, files: FileRecord[]): PublicBundleRecord {
	const { passwordHash, passwordSalt, password, fileIds: _fileIds, ...rest } = bundle;
	return { ...rest, hasPassword: Boolean(passwordHash), files: files.map(toPublicFileRecord) };
}

/**
 * Same as toPublicFileRecord but keeps the plaintext password, for Access-gated team
 * members who are allowed to retrieve a forgotten password instead of rotating it.
 */
export function toTeamFileRecord(record: FileRecord): TeamFileRecord {
	const pub = toPublicFileRecord(record);
	return record.password ? { ...pub, password: record.password } : pub;
}

/** Bundle counterpart of toTeamFileRecord, with members resolved to TeamFileRecord too. */
export function toTeamBundleRecord(bundle: BundleRecord, files: FileRecord[]): TeamBundleRecord {
	const pub = toPublicBundleRecord(bundle, files);
	const team: TeamBundleRecord = { ...pub, files: files.map(toTeamFileRecord) };
	return bundle.password ? { ...team, password: bundle.password } : team;
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

/**
 * Iterates every key page under a KV prefix, exhausting KV's cursor pagination. Yields
 * whole pages (rather than individual keys) so callers that need to fetch each key's
 * value can do so with one Promise.all per page, same as the hand-rolled loops this
 * replaced.
 */
export async function* listKeyPages<Metadata = unknown>(
	env: Env,
	prefix: string,
): AsyncGenerator<KVNamespaceListKey<Metadata>[]> {
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list<Metadata>({ prefix, cursor });
		yield page.keys;
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
}

/** Fetches and parses every record under a KV prefix (used by listFiles/listBundles). */
async function listByPrefix<T>(env: Env, prefix: string): Promise<T[]> {
	const records: T[] = [];
	for await (const keys of listKeyPages(env, prefix)) {
		const batch = await Promise.all(keys.map((k) => env.METADATA.get(k.name)));
		for (const raw of batch) if (raw) records.push(JSON.parse(raw) as T);
	}
	return records;
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
	const records = await listByPrefix<FileRecord>(env, "file:");
	return records.sort((a, b) => b.createdAt - a.createdAt);
}

interface GatePatch {
	visibility?: Visibility;
	/** Plaintext; hashed in applyGatePatch. */
	password?: string;
}

/** What the Access-gated PATCH routes and the MCP update_file tool accept. */
export type RecordPatch = GatePatch & { expiresInSeconds?: number };

/**
 * The one place a plaintext password gets hashed, for both the update paths
 * (applyGatePatch) and the create paths (buildFileRecord, createBundle). Only hashes
 * when visibility is "password" and a password was actually given -- a bundle member,
 * for instance, mirrors visibility: "password" with no password of its own. Always
 * returns all three keys explicitly (undefined when not hashing) so a caller spreading
 * this after an input object that happens to carry a stray `password` can't leak it
 * through unhashed.
 */
async function gateFields(
	visibility: Visibility | undefined,
	password: string | undefined,
): Promise<{ passwordHash?: string; passwordSalt?: string; password?: string }> {
	if (visibility !== "password" || !password) return { passwordHash: undefined, passwordSalt: undefined, password: undefined };
	const { hash, salt } = await hashPassword(password);
	return { passwordHash: hash, passwordSalt: salt, password };
}

/**
 * Shared visibility/password mutation used by updateFileRecord and updateBundleRecord.
 * Mutates `record` in place.
 *
 * Order is preserved from the original per-route logic: a visibility switch away from
 * "password" clears any existing hash first, and a freshly supplied password is applied
 * after that -- so patching visibility and password in the same call always ends with
 * the new password set, regardless of which visibility it lands on. Unlike gateFields,
 * a password patch is hashed even when the patch's own visibility isn't "password" (it
 * may be rotating the password on a record that's already password-protected).
 */
async function applyGatePatch(
	record: Gated & { visibility: Visibility; password?: string },
	patch: GatePatch,
): Promise<{ ok: true } | { ok: false; error: "password_required" }> {
	// Explicit list rather than a truthiness check: the PATCH bodies are type-asserted, not
	// validated, so this is what keeps an unknown visibility string out of the record.
	if (patch.visibility === "public" || patch.visibility === "private" || patch.visibility === "password") {
		// Switching to "password" without a new password is only valid if the record
		// already has one (a no-op visibility patch); otherwise there's nothing to gate with.
		if (patch.visibility === "password" && !patch.password && !record.passwordHash) {
			return { ok: false, error: "password_required" };
		}
		record.visibility = patch.visibility;
		if (patch.visibility !== "password") {
			record.passwordHash = undefined;
			record.passwordSalt = undefined;
			record.password = undefined;
		}
	}
	if (patch.password) {
		const { hash, salt } = await hashPassword(patch.password);
		record.passwordHash = hash;
		record.passwordSalt = salt;
		record.password = patch.password;
	}
	return { ok: true };
}

export async function updateFileRecord(
	env: Env,
	id: string,
	patch: RecordPatch,
): Promise<UpdateResult<FileRecord>> {
	const record = await getFile(env, id);
	if (!record) return { ok: false, error: "not_found" };
	const gated = await applyGatePatch(record, patch);
	if (!gated.ok) return gated;
	if (typeof patch.expiresInSeconds === "number") {
		const ttl = Math.min(Math.max(patch.expiresInSeconds, env.MIN_TTL_SECONDS), env.MAX_TTL_SECONDS);
		record.expiresAt = Date.now() + ttl * 1000;
	}
	await putFile(env, record);
	return { ok: true, record };
}

/**
 * Deletes a file record and everything that hangs off it. `detach` (default true)
 * controls whether the parent bundle's member list is rewritten to drop this id.
 *
 * The cron sweep (src/cleanup.ts) passes `detach: false`: it runs the bundle sweep
 * before the file sweep in the same pass, and members share their bundle's expiresAt,
 * so by the time the file sweep reaches an expired member its bundle has typically
 * already been swept away by deleteBundleRecord. detach would already be a no-op there
 * (detachFromBundle's own getBundle finds nothing); skipping it just avoids that wasted
 * round trip. A standalone delete (app row, MCP delete_file) leaves the bundle around
 * and must detach properly, hence the default.
 */
export async function deleteFileRecord(env: Env, id: string, opts: { detach?: boolean } = {}): Promise<boolean> {
	const detach = opts.detach ?? true;
	const record = await getFile(env, id);
	if (!record) {
		if (detach) return false;
		// Orphaned metadata entry (the list scan found the key but the value is already
		// gone) -- still tear down so it doesn't linger.
		await Promise.all([env.METADATA.delete(fileKey(id)), deleteAccessStats(env, id)]);
		return false;
	}
	await Promise.all([env.FILES.delete(record.r2Key), env.METADATA.delete(fileKey(id)), deleteAccessStats(env, id)]);
	await adjustUsageCurrent(env, -record.size, -1);
	if (detach && record.bundleId) await detachFromBundle(env, record.bundleId, id);
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

async function addMonthlyUsage(env: Env, bytes: number, count = 1): Promise<void> {
	const monthKey = currentMonthKey();
	const usage = await getMonthlyUsage(env, monthKey);
	usage.bytesUploaded += bytes;
	usage.uploadCount += count;
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
	/** Plaintext; hashed here (only when visibility is "password") rather than by the caller. */
	password?: string;
	/** Set when this upload is a member of a bundle (gating then defers to the bundle). */
	bundleId?: string;
}

async function buildFileRecord(input: CreateUploadInput): Promise<FileRecord> {
	const id = generateId();
	const now = Date.now();
	return {
		id,
		r2Key: `${id}/${input.filename}`,
		filename: input.filename,
		contentType: input.contentType,
		size: input.size,
		visibility: input.visibility,
		owner: input.owner,
		createdAt: now,
		expiresAt: now + input.ttlSeconds * 1000,
		...(await gateFields(input.visibility, input.password)),
		bundleId: input.bundleId,
	};
}

// Records the upload optimistically at presign time — the client PUTs the bytes to R2
// directly afterwards. If it never does, downloads 404 (no R2 object) and the cron sweep
// removes the record and reclaims the counted usage once it expires.
export async function createUpload(env: Env, input: CreateUploadInput): Promise<FileRecord> {
	const record = await buildFileRecord(input);
	await Promise.all([putFile(env, record), adjustUsageCurrent(env, input.size, 1), addMonthlyUsage(env, input.size)]);
	return record;
}

/**
 * Same as createUpload but for a whole bundle's worth of files at once: every record is
 * built and written concurrently, and the usage counters are hit exactly once for the
 * summed size/count instead of once per file (adjustUsageCurrent/addMonthlyUsage are each
 * a read-modify-write on one shared key, so running them per-file concurrently would race).
 */
export async function createUploadBatch(env: Env, inputs: CreateUploadInput[]): Promise<FileRecord[]> {
	const records = await Promise.all(inputs.map(buildFileRecord));
	const totalSize = records.reduce((sum, r) => sum + r.size, 0);
	await Promise.all([
		...records.map((r) => putFile(env, r)),
		adjustUsageCurrent(env, totalSize, records.length),
		addMonthlyUsage(env, totalSize, records.length),
	]);
	return records;
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

export type NewBundleInput = Omit<BundleRecord, "passwordHash" | "passwordSalt" | "password"> & {
	/** Plaintext; hashed here (only when visibility is "password") rather than by the caller. */
	password?: string;
};

/** Builds and persists a fresh bundle record. Members are created (and usage-counted) separately. */
export async function createBundle(env: Env, input: NewBundleInput): Promise<BundleRecord> {
	const bundle: BundleRecord = { ...input, ...(await gateFields(input.visibility, input.password)) };
	await putBundle(env, bundle);
	return bundle;
}

export async function listBundles(env: Env): Promise<BundleRecord[]> {
	const records = await listByPrefix<BundleRecord>(env, "bundle:");
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
	patch: RecordPatch,
): Promise<UpdateResult<BundleRecord>> {
	const bundle = await getBundle(env, id);
	if (!bundle) return { ok: false, error: "not_found" };
	const gated = await applyGatePatch(bundle, patch);
	if (!gated.ok) return gated;
	if (typeof patch.expiresInSeconds === "number") {
		const ttl = Math.min(Math.max(patch.expiresInSeconds, env.MIN_TTL_SECONDS), env.MAX_TTL_SECONDS);
		bundle.expiresAt = Date.now() + ttl * 1000;
		// Members share the bundle's lifetime, so the per-file cron sweep removes them in step.
		await Promise.all(
			bundle.fileIds.map(async (fid) => {
				const file = await getFile(env, fid);
				if (file) await putFile(env, { ...file, expiresAt: bundle.expiresAt });
			}),
		);
	}
	await putBundle(env, bundle);
	return { ok: true, record: bundle };
}

/**
 * Deletes every member file's R2 object, METADATA entry and access stats concurrently,
 * then adjusts the usage counter exactly once for the summed size/count -- deleteFileRecord
 * per member would each hit adjustUsageCurrent's read-modify-write concurrently and lose
 * updates. METADATA/access-stats teardown runs for every id, existing record or not (an
 * already-gone member shouldn't leave an orphaned `hits:` key), matching the old
 * deleteExpiredFile's unconditional cleanup; only the R2 delete and the usage delta need
 * an actual record.
 */
async function deleteMemberFiles(env: Env, fileIds: string[]): Promise<void> {
	const files = await Promise.all(fileIds.map((fid) => getFile(env, fid)));
	const existing = files.filter((f): f is FileRecord => f !== null);
	await Promise.all([
		...fileIds.map((fid) => env.METADATA.delete(fileKey(fid))),
		...fileIds.map((fid) => deleteAccessStats(env, fid)),
		...existing.map((f) => env.FILES.delete(f.r2Key)),
	]);
	if (existing.length > 0) {
		const totalSize = existing.reduce((sum, f) => sum + f.size, 0);
		await adjustUsageCurrent(env, -totalSize, -existing.length);
	}
}

/**
 * Deletes a bundle and every member file. Members never need detaching here (the bundle
 * itself is going away), so `detach` only decides what happens when the record is already
 * gone: the cron sweep (detach: false) still tears down the orphaned key and access stats,
 * like deleteFileRecord; a standalone delete (default) just reports not-found.
 */
export async function deleteBundleRecord(env: Env, id: string, opts: { detach?: boolean } = {}): Promise<boolean> {
	const detach = opts.detach ?? true;
	const bundle = await getBundle(env, id);
	if (!bundle) {
		if (detach) return false;
		await Promise.all([env.METADATA.delete(bundleKey(id)), deleteAccessStats(env, id)]);
		return false;
	}
	// Delete the bundle key first so a concurrent read of it (e.g. a member's own
	// detachFromBundle) never sees a bundle whose members are already gone.
	await Promise.all([env.METADATA.delete(bundleKey(id)), deleteAccessStats(env, id)]);
	await deleteMemberFiles(env, bundle.fileIds);
	return true;
}

/**
 * Returns whichever record governs access to a file: its parent bundle when the file is
 * bundled (bundle owns visibility/password), otherwise the file itself. Both structurally
 * satisfy Gated (and keep their full own shape -- e.g. mcp.ts's list_files still reads
 * .password off the result). If a bundleId dangles (bundle already gone), the file gates
 * on itself.
 */
export function gateFor<B extends Gated>(file: FileRecord, bundle: B | null | undefined): FileRecord | B {
	return bundle ?? file;
}

export async function resolveGate(env: Env, file: FileRecord): Promise<Gated> {
	return gateFor(file, file.bundleId ? await getBundle(env, file.bundleId) : null);
}
