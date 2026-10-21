import { checkQuota, clampTtlSeconds, createBundle, createUpload, createUploadBatch, generateId, sanitizeFilename } from "./kv";
import { presignUploadUrl } from "./presign";
import type { BundleRecord, FileRecord, Visibility } from "./types";

export interface UploadRequest {
	filename: string;
	size: number;
	contentType?: string;
	visibility?: string;
	expiresIn?: string | number;
	owner: string;
	password?: string;
}

function normalizeVisibility(requested: string | undefined): Visibility {
	if (requested === "public" || requested === "password") return requested;
	return "private";
}

export type UploadResult =
	| { ok: true; record: FileRecord; uploadUrl: string }
	| { ok: false; error: string };

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // R2 single-PUT limit

export async function requestUpload(env: Env, req: UploadRequest): Promise<UploadResult> {
	if (!Number.isInteger(req.size) || req.size <= 0) {
		return { ok: false, error: "size must be a positive integer (bytes)" };
	}
	if (req.size > MAX_UPLOAD_BYTES) {
		return { ok: false, error: "file exceeds the 5GB single-upload limit" };
	}

	const quota = await checkQuota(env, req.size);
	if (!quota.ok) {
		return {
			ok: false,
			error: `monthly upload budget exceeded (${quota.usedGB.toFixed(2)}GB / ${quota.budgetGB}GB used)`,
		};
	}

	const visibility = normalizeVisibility(req.visibility);
	if (visibility === "password" && !req.password) {
		return { ok: false, error: "password is required for password-protected files" };
	}

	const record = await createUpload(env, {
		filename: sanitizeFilename(req.filename),
		contentType: req.contentType || "application/octet-stream",
		size: req.size,
		visibility,
		ttlSeconds: clampTtlSeconds(req.expiresIn === undefined ? undefined : String(req.expiresIn), env),
		owner: req.owner,
		password: req.password,
	});

	const uploadUrl = await presignUploadUrl(env, record.r2Key, record.size);
	return { ok: true, record, uploadUrl };
}

export function downloadUrl(origin: string, record: FileRecord): string {
	return `${origin}/d/${record.id}/${record.filename}`;
}

export interface BundleFileRequest {
	filename: string;
	size: number;
	contentType?: string;
}

export interface BundleUploadRequest {
	name: string;
	visibility?: string;
	expiresIn?: string | number;
	owner: string;
	password?: string;
	files: BundleFileRequest[];
}

export type BundleUploadResult =
	| { ok: true; bundle: BundleRecord; uploads: Array<{ record: FileRecord; uploadUrl: string }> }
	| { ok: false; error: string };

/**
 * Creates a bundle plus one member FileRecord per file, and presigns a PUT for each.
 * The bundle owns visibility/password/expiry; members inherit it and carry bundleId, so
 * their own visibility field is cosmetic (access is resolved through the bundle). Byte
 * accounting stays per-member via createUpload, so nothing about usage/quota changes.
 */
export async function requestBundleUpload(env: Env, req: BundleUploadRequest): Promise<BundleUploadResult> {
	const name = req.name.trim();
	if (!name) return { ok: false, error: "bundle name is required" };
	if (!Array.isArray(req.files) || req.files.length === 0) {
		return { ok: false, error: "a bundle needs at least one file" };
	}
	for (const f of req.files) {
		if (!f.filename) return { ok: false, error: "every file needs a filename" };
		if (!Number.isInteger(f.size) || f.size <= 0) return { ok: false, error: `size for ${f.filename} must be a positive integer (bytes)` };
		if (f.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${f.filename} exceeds the 5GB single-upload limit` };
	}

	const totalSize = req.files.reduce((sum, f) => sum + f.size, 0);
	const quota = await checkQuota(env, totalSize);
	if (!quota.ok) {
		return {
			ok: false,
			error: `monthly upload budget exceeded (${quota.usedGB.toFixed(2)}GB / ${quota.budgetGB}GB used)`,
		};
	}

	const visibility = normalizeVisibility(req.visibility);
	if (visibility === "password" && !req.password) {
		return { ok: false, error: "password is required for password-protected folders" };
	}

	const bundleId = generateId();
	const ttlSeconds = clampTtlSeconds(req.expiresIn === undefined ? undefined : String(req.expiresIn), env);

	// Members mirror the bundle's visibility for display only -- resolveGate routes all
	// real access checks through the bundle. Passwords live on the bundle, not members.
	const records = await createUploadBatch(
		env,
		req.files.map((f) => ({
			filename: sanitizeFilename(f.filename),
			contentType: f.contentType || "application/octet-stream",
			size: f.size,
			visibility,
			ttlSeconds,
			owner: req.owner,
			bundleId,
		})),
	);
	const uploadUrls = await Promise.all(records.map((r) => presignUploadUrl(env, r.r2Key, r.size)));
	const uploads: Array<{ record: FileRecord; uploadUrl: string }> = records.map((record, i) => ({
		record,
		uploadUrl: uploadUrls[i],
	}));

	const now = Date.now();
	const bundle = await createBundle(env, {
		id: bundleId,
		name,
		fileIds: uploads.map((u) => u.record.id),
		visibility,
		owner: req.owner,
		createdAt: now,
		expiresAt: now + ttlSeconds * 1000,
		password: req.password,
	});

	return { ok: true, bundle, uploads };
}

export function bundleUrl(origin: string, bundle: BundleRecord): string {
	return `${origin}/f/${bundle.id}`;
}
