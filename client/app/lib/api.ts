/**
 * /app-specific API client (file list, usage, presign, patch). Delete/auth-error
 * handling lives in ../../shared/api.ts, reused by the /d landing page too.
 */
import { apiFetch } from "../../shared/api";
import type { PublicFileRecord, Visibility } from "../../shared/api";

export { AuthError, ApiError, deleteFile, patchFile } from "../../shared/api";
export type { Visibility } from "../../shared/api";

export type FileRecord = PublicFileRecord;

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

export function fetchFiles(): Promise<{ files: FileRecord[] }> {
	return apiFetch("/app/api/files");
}

export function fetchUsage(): Promise<UsageSummary> {
	return apiFetch("/app/api/usage");
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
