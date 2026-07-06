import { Hono } from "hono";
import QRCode from "qrcode";
import { verifyAccessSession } from "../access";
import { getFile } from "../kv";
import { createUnlockCookie, isUnlocked, verifyPassword } from "../password";
import type { FileRecord } from "../types";

const download = new Hono<{ Bindings: Env }>();

// GET /d/:id/:filename/raw — byte streaming for <img>/<video>/<audio> src and the actual
// download link. ?download=1 swaps content-disposition to attachment.
download.get("/d/:id/:filename/raw", async (c) => {
	const id = c.req.param("id");
	const record = await getFile(c.env, id);
	if (!record || record.expiresAt <= Date.now()) {
		return c.text("not found or expired\n", 404);
	}

	if (record.visibility === "private") {
		const session = await verifyAccessSession(c.req.raw, c.env);
		if (!session) {
			return c.text("this file is private — log in at /app first, then reopen this link\n", 401);
		}
	}
	if (record.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, record.id))) {
		return c.text("this file is password protected — open the landing page first to unlock it\n", 401);
	}

	const object = await c.env.FILES.get(record.r2Key);
	if (!object) return c.text("file missing from storage\n", 404);

	const wantsDownload = c.req.query("download") === "1";
	const safeFilename = record.filename.replace(/"/g, "");
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	// presigned direct-to-R2 uploads usually don't set R2 http metadata — use the declared type
	headers.set("content-type", record.contentType);
	headers.set("etag", object.httpEtag);
	headers.set(
		"content-disposition",
		wantsDownload ? `attachment; filename="${safeFilename}"` : `inline; filename="${safeFilename}"`,
	);
	return new Response(object.body, { headers });
});

// GET /d/:id/:filename — renders a shell that hydrates client/landing/ (React + Kumo).
// All layout/interactivity (preview, zoom/pan, markdown+syntax highlighting, delete
// dialog) lives there; this route's job is auth gating + gathering the data it needs.
download.get("/d/:id/:filename", async (c) => {
	const id = c.req.param("id");
	const record = await getFile(c.env, id);
	if (!record || record.expiresAt <= Date.now()) {
		return c.html(renderShell({ title: "Not found", payload: { state: "not-found" } }), 404);
	}

	// Checked for every file, not just private ones — a valid Access session (any account
	// member, matching this app's team-visible-not-owner-scoped model) is what gates the
	// Delete button on an otherwise publicly-viewable landing page.
	const session = await verifyAccessSession(c.req.raw, c.env);
	if (record.visibility === "private" && !session) {
		return c.html(renderShell({ title: "Sign in required", payload: { state: "sign-in-required" } }), 401);
	}
	if (record.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, record.id))) {
		return c.html(
			renderShell({
				title: record.filename,
				payload: { state: "password-required", id: record.id, filename: record.filename },
			}),
			401,
		);
	}

	const pageUrl = c.req.url;
	const qrSvg = await QRCode.toString(pageUrl, { type: "svg", margin: 1 });
	const extension = fileExtension(record.filename);
	const previewKind = determinePreviewKind(record, extension);

	// Small text/markdown documents get their content embedded directly in the page
	// (no client fetch, no loading flash). Capped so a multi-hundred-MB log doesn't get
	// pulled into an HTML response -- Download still works regardless of size.
	let previewText: string | null = null;
	let textTooLargeBytes: number | null = null;
	if (previewKind === "markdown" || previewKind === "text") {
		if (record.size <= TEXT_PREVIEW_MAX_BYTES) {
			const object = await c.env.FILES.get(record.r2Key);
			if (object) previewText = await object.text();
		} else {
			textTooLargeBytes = TEXT_PREVIEW_MAX_BYTES;
		}
	}

	return c.html(
		renderShell({
			title: record.filename,
			payload: {
				state: "ready",
				id: record.id,
				filename: record.filename,
				extension,
				size: record.size,
				contentType: record.contentType,
				visibility: record.visibility,
				owner: record.owner,
				expiresAt: record.expiresAt,
				pageUrl,
				rawUrl: rawUrl(record),
				downloadUrl: rawUrl(record, { download: true }),
				qrSvg,
				canManage: session !== null,
				previewKind,
				previewText,
				textTooLargeBytes,
			},
		}),
	);
});

// POST /d/:id/:filename/unlock — verifies a password-protected file's password and,
// on success, sets a cookie scoped to this file's own routes so the landing page and
// raw route both recognize it as unlocked without asking again.
download.post("/d/:id/:filename/unlock", async (c) => {
	const id = c.req.param("id");
	const record = await getFile(c.env, id);
	if (!record || record.expiresAt <= Date.now()) {
		return c.html(renderShell({ title: "Not found", payload: { state: "not-found" } }), 404);
	}
	if (record.visibility !== "password") {
		return c.redirect(`/d/${record.id}/${record.filename}`, 303);
	}

	const form = await c.req.parseBody();
	const password = typeof form.password === "string" ? form.password : "";
	const valid =
		password && record.passwordHash && record.passwordSalt
			? await verifyPassword(password, record.passwordHash, record.passwordSalt)
			: false;
	if (!valid) {
		return c.html(
			renderShell({
				title: record.filename,
				payload: {
					state: "password-required",
					id: record.id,
					filename: record.filename,
					error: "Incorrect password.",
				},
			}),
			401,
		);
	}

	const cookie = await createUnlockCookie(c.env, record.id);
	return new Response(null, {
		status: 303,
		headers: { Location: `/d/${record.id}/${record.filename}`, "Set-Cookie": cookie },
	});
});

export default download;

function rawUrl(record: FileRecord, opts: { download?: boolean } = {}): string {
	const base = `/d/${record.id}/${record.filename}/raw`;
	return opts.download ? `${base}?download=1` : base;
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function fileExtension(filename: string): string {
	const dot = filename.lastIndexOf(".");
	return dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toUpperCase() : "FILE";
}

const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;
const TEXT_PREVIEWABLE_EXTENSIONS = new Set(["txt", "log", "csv", "json", "yml", "yaml"]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);

function determinePreviewKind(
	record: FileRecord,
	extension: string,
): "image" | "video" | "audio" | "html" | "markdown" | "text" | "generic" {
	if (record.contentType.startsWith("image/")) return "image";
	if (record.contentType.startsWith("video/")) return "video";
	if (record.contentType.startsWith("audio/")) return "audio";
	const ext = extension.toLowerCase();
	// Browsers frequently report an empty/octet-stream content-type for these on
	// upload (.md especially), so the extension is the more reliable signal.
	if (record.contentType === "text/html" || HTML_EXTENSIONS.has(ext)) return "html";
	if (MARKDOWN_EXTENSIONS.has(ext)) return "markdown";
	if (record.contentType.startsWith("text/") || TEXT_PREVIEWABLE_EXTENSIONS.has(ext)) return "text";
	return "generic";
}

/** Matches client/landing/types.ts's `PageData` -- kept in sync manually, same as the pre-existing payload. */
type PageData =
	| { state: "not-found" }
	| { state: "sign-in-required" }
	| { state: "password-required"; id: string; filename: string; error?: string }
	| {
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
			previewKind: "image" | "video" | "audio" | "html" | "markdown" | "text" | "generic";
			previewText: string | null;
			textTooLargeBytes: number | null;
	  };

// Renders a shell that hydrates client/landing/ (React + Kumo) for every state -- found,
// not-found, sign-in-required, and password-required all reuse the same Kumo components
// (Empty, Button, Input) instead of hand-rolled markup, so they stay visually in sync with
// the rest of the app for free.
function renderShell(opts: { title: string; payload: PageData }): string {
	// Escape "<" so previewText (arbitrary uploaded file content) can never prematurely
	// close this script tag -- < is valid inside a JSON string and JSON.parse
	// resolves it back to "<" on the client.
	const payloadJson = JSON.stringify(opts.payload).replace(/</g, "\\u003c");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="stylesheet" href="/landing/bundle.css" />
</head>
<body>
<div id="root"></div>
<script id="transfer-data" type="application/json">${payloadJson}</script>
<script type="module" src="/landing/bundle.js"></script>
</body>
</html>`;
}
