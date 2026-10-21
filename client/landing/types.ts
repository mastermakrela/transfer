export type PreviewKind = "image" | "video" | "audio" | "html" | "markdown" | "text" | "generic";

export interface FileData {
	state: "ready";
	id: string;
	filename: string;
	extension: string;
	size: number;
	contentType: string;
	visibility: "public" | "password" | "private";
	owner: string;
	expiresAt: number;
	pageUrl: string;
	rawUrl: string;
	downloadUrl: string;
	qrSvg: string;
	canManage: boolean;
	/** Set when this file belongs to a bundle -- the page links back to the folder and hides
	 * the per-file visibility/expiry controls (access is governed by the bundle). */
	bundle: { name: string; url: string } | null;
	previewKind: PreviewKind;
	previewText: string | null;
	textTooLargeBytes: number | null;
}

/** A single file as listed on a bundle page. */
export interface BundleFileEntry {
	id: string;
	filename: string;
	extension: string;
	size: number;
	contentType: string;
	previewKind: PreviewKind;
	pageUrl: string;
	downloadUrl: string;
}

export interface BundleData {
	state: "bundle";
	id: string;
	name: string;
	owner: string;
	visibility: "public" | "password" | "private";
	expiresAt: number;
	pageUrl: string;
	zipUrl: string;
	qrSvg: string;
	canManage: boolean;
	totalSize: number;
	files: BundleFileEntry[];
}

/** The payload shape src/routes/download.ts embeds in the page as JSON -- imported there
 * via `import type`, so there is nothing to keep in sync. */
export type PageData =
	| FileData
	| BundleData
	| { state: "not-found" }
	| { state: "sign-in-required" }
	| { state: "password-required"; title: string; unlockAction: string; error?: string };
