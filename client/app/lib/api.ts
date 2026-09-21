/**
 * /app-specific API client (file list, usage, presign, patch). Delete/auth-error
 * handling lives in ../../shared/api.ts, reused by the /d landing page too.
 */
import { apiFetch } from "../../shared/api";
import type { PublicBundleRecord, PublicFileRecord, Visibility } from "../../shared/api";

export { AuthError, ApiError, deleteFile, patchFile, deleteBundle, patchBundle } from "../../shared/api";
export type { Visibility } from "../../shared/api";

export type FileRecord = PublicFileRecord;
export type BundleRecord = PublicBundleRecord;

export interface UsageSummary {
	currentBytes: number;
	currentCount: number;
	monthBytesUploaded: number;
	monthUploadCount: number;
	monthBudgetBytes: number;
}

export interface PresignResponse {
	id: string;
	uploadUrl: string;
	downloadUrl: string;
	expiresAt: number;
	visibility: Visibility;
}

export function fetchFiles(): Promise<{ files: FileRecord[]; bundles: BundleRecord[] }> {
	return apiFetch("/app/api/files");
}

export interface BundleUploadTarget {
	id: string;
	filename: string;
	uploadUrl: string;
}

export interface CreateBundleResponse {
	id: string;
	bundleUrl: string;
	visibility: Visibility;
	expiresAt: number;
	uploads: BundleUploadTarget[];
}

export function createBundle(req: {
	name: string;
	visibility: Visibility;
	expiresIn: number;
	password?: string;
	files: Array<{ filename: string; size: number; contentType: string }>;
}): Promise<CreateBundleResponse> {
	return apiFetch("/app/api/bundles", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(req),
	});
}

export function fetchUsage(): Promise<UsageSummary> {
	return apiFetch("/app/api/usage");
}

/**
 * Access tracking -- mirrors AccessEvent/AccessSummary in src/types.ts. Only reachable
 * behind Cloudflare Access, and only surfaced by the hidden telemetry mode in App.tsx.
 */
export type AccessKind = "view" | "download" | "zip";

export interface AccessEvent {
	t: number;
	kind: AccessKind;
	country?: string;
	city?: string;
	referer?: string;
	client?: string;
}

export interface AccessSummary {
	views: number;
	downloads: number;
	lastAt: number;
}

export interface AccessStats extends AccessSummary {
	recent: AccessEvent[];
}

/** Counters for every tracked link, keyed by file/bundle id. */
export function fetchAccessSummaries(): Promise<Record<string, AccessSummary>> {
	return apiFetch("/app/api/access");
}

export function fetchAccessStats(id: string): Promise<AccessStats> {
	return apiFetch(`/app/api/access/${id}`);
}

export function presignUpload(req: {
	filename: string;
	size: number;
	contentType: string;
	visibility: Visibility;
	expiresIn: number;
	password?: string;
}): Promise<PresignResponse> {
	return apiFetch("/app/api/presign", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(req),
	});
}

/**
 * PUT raw file bytes to a presigned R2 URL with upload progress. Uses
 * XMLHttpRequest (not fetch) specifically because fetch has no cross-browser
 * upload-progress event -- XHR's `upload.onprogress` is the reliable path.
 */
export function uploadToR2(uploadUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", uploadUrl);
		xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total);
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress(1);
				resolve();
			} else {
				reject(new Error(`upload failed (${xhr.status})`));
			}
		};
		xhr.onerror = () => reject(new Error("network error during upload"));
		xhr.onabort = () => reject(new Error("upload aborted"));
		xhr.send(file);
	});
}
