import { makeZip, predictLength } from "client-zip";
import { type Context, Hono } from "hono";
import QRCode from "qrcode";
import { verifyAccessSession } from "../access";
import { getBundle, getBundleFiles, getFile, resolveGate } from "../kv";
import { createUnlockCookie, isUnlocked, verifyPassword } from "../password";
import type { FileRecord, Gated } from "../types";

const download = new Hono<{ Bindings: Env }>();

// Shared access gate for byte-serving routes (member /raw and bundle /all.zip). `gate` is
// whichever record governs access -- the file itself, or its parent bundle. Returns a 401
// Response when access is denied, or null when the caller may proceed.
async function denyRawAccess(c: Context<{ Bindings: Env }>, gate: Gated): Promise<Response | null> {
	if (gate.visibility === "private") {
		const session = await verifyAccessSession(c.req.raw, c.env);
		if (!session) return c.text("this is private — log in at /app first, then reopen this link\n", 401);
	}
	if (gate.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, gate.id))) {
		return c.text("this is password protected — open the landing page first to unlock it\n", 401);
	}
	return null;
}

// GET /d/:id/:filename/raw — byte streaming for <img>/<video>/<audio> src and the actual
// download link. ?download=1 swaps content-disposition to attachment. Bundled files gate
// through their parent bundle (resolveGate).
download.get("/d/:id/:filename/raw", async (c) => {
	const id = c.req.param("id");
	const record = await getFile(c.env, id);
	if (!record || record.expiresAt <= Date.now()) {
		return c.text("not found or expired\n", 404);
	}

	const denied = await denyRawAccess(c, await resolveGate(c.env, record));
	if (denied) return denied;

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

	// A bundled file defers gating to its parent bundle (bundle owns visibility/password).
	// Loading the bundle here also gives us its name for the "part of folder" breadcrumb.
	const bundle = record.bundleId ? await getBundle(c.env, record.bundleId) : null;
	const gate: Gated = bundle ?? record;

	// Checked for every file, not just private ones — a valid Access session (any account
	// member, matching this app's team-visible-not-owner-scoped model) is what gates the
	// Delete button on an otherwise publicly-viewable landing page.
	const session = await verifyAccessSession(c.req.raw, c.env);
	if (gate.visibility === "private" && !session) {
		return c.html(renderShell({ title: "Sign in required", payload: { state: "sign-in-required" } }), 401);
	}
	if (gate.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, gate.id))) {
		// A bundled member unlocks at its folder (one unlock covers the whole set); a
		// standalone file unlocks itself. Both set the same kind of unlock cookie.
		if (bundle) return c.redirect(`/f/${bundle.id}`, 302);
		return c.html(
			renderShell({
				title: record.filename,
				payload: {
					state: "password-required",
					title: record.filename,
					unlockAction: `/d/${record.id}/${encodeURIComponent(record.filename)}/unlock`,
				},
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
				visibility: gate.visibility,
				owner: record.owner,
				expiresAt: record.expiresAt,
				pageUrl,
				rawUrl: rawUrl(record),
				downloadUrl: rawUrl(record, { download: true }),
				qrSvg,
				// Bundled files inherit the bundle's access; per-file visibility/expiry can't be
				// changed independently, so the file page hides those controls and links back instead.
				canManage: session !== null && !bundle,
				bundle: bundle ? { name: bundle.name, url: `/f/${bundle.id}` } : null,
				previewKind,
				previewText,
				textTooLargeBytes,
			},
		}),
	);
});

// POST /d/:id/:filename/unlock — verifies a standalone password-protected file's password
// (bundled members unlock at /f/:id/unlock instead) and, on success, sets a cookie so the
// landing page and raw route both recognize it as unlocked without asking again.
download.post("/d/:id/:filename/unlock", async (c) => {
	const id = c.req.param("id");
	const record = await getFile(c.env, id);
	if (!record || record.expiresAt <= Date.now()) {
		return c.html(renderShell({ title: "Not found", payload: { state: "not-found" } }), 404);
	}
	if (record.visibility !== "password" || record.bundleId) {
		return c.redirect(record.bundleId ? `/f/${record.bundleId}` : `/d/${record.id}/${record.filename}`, 303);
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
					title: record.filename,
					unlockAction: `/d/${record.id}/${encodeURIComponent(record.filename)}/unlock`,
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

// GET /f/:id — bundle (shareable folder) landing page. Same shell/hydration path as the
// single-file page, with a "bundle" payload the landing app renders as a file listing.
download.get("/f/:id", async (c) => {
	const id = c.req.param("id");
	const bundle = await getBundle(c.env, id);
	if (!bundle || bundle.expiresAt <= Date.now()) {
		return c.html(renderShell({ title: "Not found", payload: { state: "not-found" } }), 404);
	}

	const session = await verifyAccessSession(c.req.raw, c.env);
	if (bundle.visibility === "private" && !session) {
		return c.html(renderShell({ title: "Sign in required", payload: { state: "sign-in-required" } }), 401);
	}
	if (bundle.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, bundle.id))) {
		return c.html(
			renderShell({
				title: bundle.name,
				payload: { state: "password-required", title: bundle.name, unlockAction: `/f/${bundle.id}/unlock` },
			}),
			401,
		);
	}

	const files = await getBundleFiles(c.env, bundle);
	const pageUrl = c.req.url;
	const qrSvg = await QRCode.toString(pageUrl, { type: "svg", margin: 1 });

	return c.html(
		renderShell({
			title: bundle.name,
			payload: {
				state: "bundle",
				id: bundle.id,
				name: bundle.name,
				owner: bundle.owner,
				visibility: bundle.visibility,
				expiresAt: bundle.expiresAt,
				pageUrl,
				zipUrl: `/f/${bundle.id}/all.zip`,
				qrSvg,
				canManage: session !== null,
				totalSize: files.reduce((sum, f) => sum + f.size, 0),
				files: files.map((f) => ({
					id: f.id,
					filename: f.filename,
					extension: fileExtension(f.filename),
					size: f.size,
					contentType: f.contentType,
					previewKind: determinePreviewKind(f, fileExtension(f.filename)),
					pageUrl: `/d/${f.id}/${encodeURIComponent(f.filename)}`,
					downloadUrl: rawUrl(f, { download: true }),
				})),
			},
		}),
	);
});

// POST /f/:id/unlock — bundle password unlock; sets the unlock cookie for the whole folder.
download.post("/f/:id/unlock", async (c) => {
	const id = c.req.param("id");
	const bundle = await getBundle(c.env, id);
	if (!bundle || bundle.expiresAt <= Date.now()) {
		return c.html(renderShell({ title: "Not found", payload: { state: "not-found" } }), 404);
	}
	if (bundle.visibility !== "password") {
		return c.redirect(`/f/${bundle.id}`, 303);
	}

	const form = await c.req.parseBody();
	const password = typeof form.password === "string" ? form.password : "";
	const valid =
		password && bundle.passwordHash && bundle.passwordSalt
			? await verifyPassword(password, bundle.passwordHash, bundle.passwordSalt)
			: false;
	if (!valid) {
		return c.html(
			renderShell({
				title: bundle.name,
				payload: {
					state: "password-required",
					title: bundle.name,
					unlockAction: `/f/${bundle.id}/unlock`,
					error: "Incorrect password.",
				},
			}),
			401,
		);
	}

	const cookie = await createUnlockCookie(c.env, bundle.id);
	return new Response(null, { status: 303, headers: { Location: `/f/${bundle.id}`, "Set-Cookie": cookie } });
});

// GET /f/:id/all.zip — streams every member into a single zip. STORE (no deflate): the
// members are already-compressed artifacts (apks, images, archives), so deflating would
// burn CPU for ~nothing, and store-mode lets client-zip stream straight from R2 with a
// known Content-Length (predictLength) so the browser shows real download progress.
download.get("/f/:id/all.zip", async (c) => {
	const id = c.req.param("id");
	const bundle = await getBundle(c.env, id);
	if (!bundle || bundle.expiresAt <= Date.now()) {
		return c.text("not found or expired\n", 404);
	}

	const denied = await denyRawAccess(c, bundle);
	if (denied) return denied;

	const files = await getBundleFiles(c.env, bundle);
	const entries: Array<{ name: string; input: ReadableStream; size: number; lastModified: Date }> = [];
	for (const f of files) {
		const object = await c.env.FILES.get(f.r2Key);
		if (object) entries.push({ name: f.filename, input: object.body, size: object.size, lastModified: new Date(f.createdAt) });
	}
	if (entries.length === 0) return c.text("this folder has no downloadable files\n", 404);

	const zipName = (bundle.name.replace(/[^A-Za-z0-9._ -]/g, "_").trim() || "bundle").slice(0, 100);
	const headers = new Headers({
		"content-type": "application/zip",
		"content-disposition": `attachment; filename="${zipName}.zip"`,
		"content-length": predictLength(entries.map((e) => ({ name: e.name, size: e.size }))).toString(),
	});
	return new Response(makeZip(entries), { headers });
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

type PreviewKind = "image" | "video" | "audio" | "html" | "markdown" | "text" | "generic";

function determinePreviewKind(record: FileRecord, extension: string): PreviewKind {
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

/** A single file as listed on a bundle page. */
interface BundleFileEntry {
	id: string;
	filename: string;
	extension: string;
	size: number;
	contentType: string;
	previewKind: PreviewKind;
	pageUrl: string;
	downloadUrl: string;
}

/** Matches client/landing/types.ts's `PageData` -- kept in sync manually, same as the pre-existing payload. */
type PageData =
	| { state: "not-found" }
	| { state: "sign-in-required" }
	| { state: "password-required"; title: string; unlockAction: string; error?: string }
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
			bundle: { name: string; url: string } | null;
			previewKind: PreviewKind;
			previewText: string | null;
			textTooLargeBytes: number | null;
	  }
	| {
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
