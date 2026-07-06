import { checkQuota, clampTtlSeconds, createUpload, sanitizeFilename } from "./kv";
import { hashPassword } from "./password";
import { presignUploadUrl } from "./presign";
import type { FileRecord, Visibility } from "./types";

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
	const hashed = visibility === "password" && req.password ? await hashPassword(req.password) : undefined;

	const record = await createUpload(env, {
		filename: sanitizeFilename(req.filename),
		contentType: req.contentType || "application/octet-stream",
		size: req.size,
		visibility,
		ttlSeconds: clampTtlSeconds(req.expiresIn === undefined ? undefined : String(req.expiresIn), env),
		owner: req.owner,
		passwordHash: hashed?.hash,
		passwordSalt: hashed?.salt,
	});

	const uploadUrl = await presignUploadUrl(env, record.r2Key, record.size);
	return { ok: true, record, uploadUrl };
}

export function downloadUrl(origin: string, record: FileRecord): string {
	return `${origin}/d/${record.id}/${record.filename}`;
}
