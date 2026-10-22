import { Hono } from "hono";
import { verifyAccessSession } from "../access";
import {
	type RecordPatch,
	deleteBundleRecord,
	deleteFileRecord,
	getUsageSummary,
	listBundles,
	listFiles,
	toTeamBundleRecord,
	toTeamFileRecord,
	updateBundleRecord,
	updateFileRecord,
} from "../kv";
import { getAccessStats, listAccessSummaries } from "../telemetry";
import { bundleUrl, downloadUrl, requestBundleUpload, requestUpload } from "../uploads";

const app = new Hono<{ Bindings: Env; Variables: { accessEmail: string } }>();

// GET /app itself (and any static assets under /app/*) is already gated at the Cloudflare
// edge by the Access application scoped to /app*, before this Worker even runs. We verify
// the JWT again here for the API routes as defense-in-depth, not because it's load-bearing.
app.use("/app/api/*", async (c, next) => {
	const session = await verifyAccessSession(c.req.raw, c.env);
	if (!session) return c.json({ error: "unauthorized" }, 401);
	c.set("accessEmail", session.email);
	await next();
});

// Browser upload: issue a presigned PUT URL; the page uploads directly to R2 with it.
app.post("/app/api/presign", async (c) => {
	const body = await c.req.json<{
		filename?: string;
		size?: number;
		contentType?: string;
		visibility?: string;
		expiresIn?: number;
		password?: string;
	}>();
	if (!body.filename || typeof body.size !== "number") {
		return c.json({ error: "filename and size are required" }, 400);
	}
	const result = await requestUpload(c.env, {
		filename: body.filename,
		size: body.size,
		contentType: body.contentType,
		visibility: body.visibility,
		expiresIn: body.expiresIn,
		owner: c.get("accessEmail"),
		password: body.password,
	});
	if (!result.ok) return c.json({ error: result.error }, 413);
	return c.json({
		id: result.record.id,
		uploadUrl: result.uploadUrl,
		downloadUrl: downloadUrl(new URL(c.req.url).origin, result.record),
		expiresAt: result.record.expiresAt,
		visibility: result.record.visibility,
	});
});

// Returns loose files (not in a bundle) plus bundles with their members resolved. Bundle
// members are excluded from `files` so they show once, grouped under their folder.
app.get("/app/api/files", async (c) => {
	const [files, bundles] = await Promise.all([listFiles(c.env), listBundles(c.env)]);
	const byId = new Map(files.map((f) => [f.id, f]));
	return c.json({
		files: files.filter((f) => !f.bundleId).map(toTeamFileRecord),
		bundles: bundles.map((b) =>
			toTeamBundleRecord(
				b,
				b.fileIds.map((fid) => byId.get(fid)).filter((f): f is NonNullable<typeof f> => f != null),
			),
		),
	});
});

// Create a bundle: one bundle record + one presigned PUT per file. The bundle owns
// visibility/password/expiry; the client PUTs each file to its own URL just like a single upload.
app.post("/app/api/bundles", async (c) => {
	const body = await c.req.json<{
		name?: string;
		visibility?: string;
		expiresIn?: number;
		password?: string;
		files?: Array<{ filename?: string; size?: number; contentType?: string }>;
	}>();
	if (!body.name || !Array.isArray(body.files) || body.files.length === 0) {
		return c.json({ error: "name and a non-empty files array are required" }, 400);
	}
	if (body.files.some((f) => !f.filename || typeof f.size !== "number")) {
		return c.json({ error: "every file needs a filename and size" }, 400);
	}
	const result = await requestBundleUpload(c.env, {
		name: body.name,
		visibility: body.visibility,
		expiresIn: body.expiresIn,
		password: body.password,
		owner: c.get("accessEmail"),
		files: body.files.map((f) => ({ filename: f.filename as string, size: f.size as number, contentType: f.contentType })),
	});
	if (!result.ok) return c.json({ error: result.error }, 413);
	return c.json({
		id: result.bundle.id,
		bundleUrl: bundleUrl(new URL(c.req.url).origin, result.bundle),
		visibility: result.bundle.visibility,
		expiresAt: result.bundle.expiresAt,
		uploads: result.uploads.map((u) => ({ id: u.record.id, filename: u.record.filename, uploadUrl: u.uploadUrl })),
	});
});

app.patch("/app/api/bundles/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<RecordPatch>();

	const result = await updateBundleRecord(c.env, id, {
		visibility: body.visibility,
		expiresInSeconds: body.expiresInSeconds,
		password: body.password,
	});
	if (!result.ok) {
		if (result.error === "password_required") {
			return c.json({ error: "password is required to set visibility to password" }, 400);
		}
		return c.json({ error: "not found" }, 404);
	}
	return c.json(toTeamBundleRecord(result.record, []));
});

app.delete("/app/api/bundles/:id", async (c) => {
	const deleted = await deleteBundleRecord(c.env, c.req.param("id"));
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

app.patch("/app/api/files/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<RecordPatch>();

	const result = await updateFileRecord(c.env, id, {
		visibility: body.visibility,
		expiresInSeconds: body.expiresInSeconds,
		password: body.password,
	});
	if (!result.ok) {
		if (result.error === "password_required") {
			return c.json({ error: "password is required to set visibility to password" }, 400);
		}
		if (result.error === "in_bundle") return c.json({ error: "this file is in a folder; change the folder instead" }, 409);
		return c.json({ error: "not found" }, 404);
	}
	return c.json(toTeamFileRecord(result.record));
});

app.delete("/app/api/files/:id", async (c) => {
	const deleted = await deleteFileRecord(c.env, c.req.param("id"));
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

app.get("/app/api/usage", async (c) => {
	return c.json(await getUsageSummary(c.env));
});

// Access tracking (see src/telemetry.ts). Both routes sit under /app/api/* and are
// therefore behind Cloudflare Access like everything else here -- who opened a link is
// only ever visible to a signed-in account member, never on the link's own public page.

// Counters for every tracked link at once, so the file table can label all its rows
// from a single request when telemetry mode is switched on.
app.get("/app/api/access", async (c) => {
	return c.json(await listAccessSummaries(c.env));
});

// The individual events behind one link's counters. Unknown ids return zeroed stats
// rather than 404 -- a file nobody has opened yet simply has no `hits:` key.
app.get("/app/api/access/:id", async (c) => {
	return c.json(await getAccessStats(c.env, c.req.param("id")));
});

export default app;
