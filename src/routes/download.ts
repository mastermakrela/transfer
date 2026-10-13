import { makeZip, predictLength } from "client-zip";
import { type Context, Hono } from "hono";
import QRCode from "qrcode";
import { type AccessSession, verifyAccessSession } from "../access";
import { getBundle, getBundleFiles, getFile, resolveGate } from "../kv";
import { createUnlockCookie, isUnlocked, verifyPassword } from "../password";
import { recordAccess } from "../telemetry";
import type { AccessKind, FileRecord, Gated } from "../types";
import type { PageData, PreviewKind } from "../../client/landing/types";

const download = new Hono<{ Bindings: Env }>();

/**
 * Records an access without holding up the response. Passing more than one id rolls the
 * event up to a parent bundle as well as the member that was actually hit, so a folder
 * row shows all the activity happening under its link, not just hits on the folder page.
 * Only ever called after the access gate has passed -- a 401 is not an access.
 */
function track(c: Context<{ Bindings: Env }>, ids: Array<string | undefined>, kind: AccessKind): void {
	for (const id of ids) {
		if (id) c.executionCtx.waitUntil(recordAccess(c.env, id, kind, c.req.raw));
	}
}

// Shared access gate for byte-serving routes (member /raw and bundle /all.zip). `gate` is
// whichever record governs access -- the file itself, or its parent bundle. Returns a 401
// Response when access is denied, or null when the caller may proceed.
async function denyRawAccess(c: Context<{ Bindings: Env }>, gate: Gated): Promise<Response | null> {
	if (gate.visibility === "private") {
		const session = await verifyAccessSession(c.req.raw, c.env);
		if (!session) return c.text("this is private — log in at /app first, then reopen this link\n", 401);
	}
	if (gate.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, gate))) {
		return c.text("this is password protected — open the landing page first to unlock it\n", 401);
	}
	return null;
}

// Shared access gate for HTML page routes (file and bundle landing pages). Same visibility
// checks as denyRawAccess, but renders the sign-in-required/password-required shell instead
// of a plain-text 401. `session` is passed in rather than looked up here so callers can fetch
// it alongside other independent work. `lockedRedirect` sends a locked visitor elsewhere
// instead of showing this page's own unlock form (a bundled member unlocks at its folder).
// Returns a Response when access is denied, or null when the caller may proceed.
async function denyPageAccess(
	c: Context<{ Bindings: Env }>,
	gate: Gated,
	session: AccessSession | null,
	shellOpts: { title: string; unlockAction: string; lockedRedirect?: string },
): Promise<Response | null> {
	if (gate.visibility === "private" && !session) {
		return c.html(renderShell({ title: "Sign in required", payload: { state: "sign-in-required" } }), 401);
	}
	if (gate.visibility === "password" && !(await isUnlocked(c.req.raw, c.env, gate))) {
		if (shellOpts.lockedRedirect) return c.redirect(shellOpts.lockedRedirect, 302);
		return c.html(
			renderShell({
				title: shellOpts.title,
				payload: { state: "password-required", title: shellOpts.title, unlockAction: shellOpts.unlockAction },
			}),
			401,
		);
	}
	return null;
}

// Shared by both unlock POST routes (/d/:id/:filename/unlock and /f/:id/unlock): parses the
// submitted password, verifies it against `gate`, and either re-renders the password shell
// with an error or sets the unlock cookie and redirects. Identical for files and bundles --
// both are Gated records unlocked the same way.
async function handleUnlock(
	c: Context<{ Bindings: Env }>,
	gate: Gated,
	opts: { title: string; unlockAction: string; redirectTo: string },
): Promise<Response> {
	const form = await c.req.parseBody();
	const password = typeof form.password === "string" ? form.password : "";
	const valid =
		password && gate.passwordHash && gate.passwordSalt
			? await verifyPassword(password, gate.passwordHash, gate.passwordSalt)
			: false;
	if (!valid) {
		return c.html(
			renderShell({
				title: opts.title,
				payload: {
					state: "password-required",
					title: opts.title,
					unlockAction: opts.unlockAction,
					error: "Incorrect password.",
				},
			}),
			401,
		);
	}

	const cookie = await createUnlockCookie(c.env, gate);
	return new Response(null, { status: 303, headers: { Location: opts.redirectTo, "Set-Cookie": cookie } });
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
	// ?download=1 is the Download button. A bare /raw hit is either the landing page's own
	// <img>/<video> subresource -- already counted as the page view, and flagged by
	// Sec-Fetch-Site: same-origin, which every current browser sends -- or someone pulling
	// the bytes directly with curl or a hotlink, which is a download in all but name.
	if (wantsDownload || c.req.header("sec-fetch-site") !== "same-origin") {
		track(c, [record.id, record.bundleId], "download");
	}
	const safeFilename = record.filename.replace(/"/g, "");
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	// presigned direct-to-R2 uploads usually don't set R2 http metadata — use the declared type
	headers.set("content-type", record.contentType);
	headers.set("etag", object.httpEtag);
	headers.set("x-content-type-options", "nosniff");
	// Uploaded HTML/SVG/XML opened directly would run as a page on this origin, next to a
	// team member's Access session (it could call /app/api/* as them). Same flags as the
	// landing page's preview iframe. Not applied to everything: PDFs don't render under a CSP sandbox.
	if (/html|xml/i.test(record.contentType)) {
		headers.set("content-security-policy", "sandbox allow-scripts allow-forms allow-popups");
	}
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
	// Independent of the Access session lookup below (checked for every file, not just
	// private ones — a valid Access session, any account member, is what gates the Delete
	// button on an otherwise publicly-viewable landing page), so run them together.
	const [bundle, session] = await Promise.all([
		record.bundleId ? getBundle(c.env, record.bundleId) : Promise.resolve(null),
		verifyAccessSession(c.req.raw, c.env),
	]);
	const gate: Gated = bundle ?? record;

	// A bundled member unlocks at its folder (one unlock covers the whole set); a standalone
	// file unlocks itself. Both set the same kind of unlock cookie.
	const denied = await denyPageAccess(c, gate, session, {
		title: record.filename,
		unlockAction: `/d/${record.id}/${encodeURIComponent(record.filename)}/unlock`,
		lockedRedirect: bundle ? `/f/${bundle.id}` : undefined,
	});
	if (denied) return denied;

	track(c, [record.id, record.bundleId], "view");

	const pageUrl = c.req.url;
	const extension = fileExtension(record.filename);
	const previewKind = determinePreviewKind(record, extension);

	// Small text/markdown documents get their content embedded directly in the page
	// (no client fetch, no loading flash). Capped so a multi-hundred-MB log doesn't get
	// pulled into an HTML response -- Download still works regardless of size.
	const isTextLike = previewKind === "markdown" || previewKind === "text";
	const wantsTextPreview = isTextLike && record.size <= TEXT_PREVIEW_MAX_BYTES;
	const textTooLargeBytes = isTextLike && !wantsTextPreview ? TEXT_PREVIEW_MAX_BYTES : null;

	const [qrSvg, previewObject] = await Promise.all([
		QRCode.toString(pageUrl, { type: "svg", margin: 1 }),
		wantsTextPreview ? c.env.FILES.get(record.r2Key) : Promise.resolve(null),
	]);
	const previewText = previewObject ? await previewObject.text() : null;

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

	return handleUnlock(c, record, {
		title: record.filename,
		unlockAction: `/d/${record.id}/${encodeURIComponent(record.filename)}/unlock`,
		redirectTo: `/d/${record.id}/${record.filename}`,
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
	const denied = await denyPageAccess(c, bundle, session, {
		title: bundle.name,
		unlockAction: `/f/${bundle.id}/unlock`,
	});
	if (denied) return denied;

	track(c, [bundle.id], "view");

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

	return handleUnlock(c, bundle, {
		title: bundle.name,
		unlockAction: `/f/${bundle.id}/unlock`,
		redirectTo: `/f/${bundle.id}`,
	});
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
	const objects = await Promise.all(files.map((f) => c.env.FILES.get(f.r2Key)));
	const entries: Array<{ name: string; input: ReadableStream; size: number; lastModified: Date }> = [];
	const taken = new Set<string>();
	files.forEach((f, i) => {
		const object = objects[i];
		if (object) entries.push({ name: uniqueName(f.filename, taken), input: object.body, size: object.size, lastModified: new Date(f.createdAt) });
	});
	if (entries.length === 0) return c.text("this folder has no downloadable files\n", 404);

	track(c, [bundle.id], "zip");

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

// Filenames are reduced to their basename on upload, so two folder members can share one
// ("app-release.apk" from two build dirs); zip extractors would overwrite the first.
function uniqueName(name: string, taken: Set<string>): string {
	const dot = name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	let candidate = name;
	for (let n = 2; taken.has(candidate); n++) candidate = `${stem} (${n})${ext}`;
	taken.add(candidate);
	return candidate;
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
