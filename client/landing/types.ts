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
	previewKind: PreviewKind;
	previewText: string | null;
	textTooLargeBytes: number | null;
}

/** Matches the `PageData` type src/routes/download.ts embeds in the page as JSON. */
export type PageData =
	| FileData
	| { state: "not-found" }
	| { state: "sign-in-required" }
	| { state: "password-required"; id: string; filename: string; error?: string };
