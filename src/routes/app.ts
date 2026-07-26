import { Hono } from "hono";
import { verifyAccessSession } from "../access";
import {
	deleteBundleRecord,
	deleteFileRecord,
	getBundle,
	getFile,
	getUsageSummary,
	listBundles,
	listFiles,
	toPublicBundleRecord,
	toPublicFileRecord,
	updateBundleRecord,
	updateFileRecord,
} from "../kv";
import { hashPassword } from "../password";
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
		files: files.filter((f) => !f.bundleId).map(toPublicFileRecord),
		bundles: bundles.map((b) =>
			toPublicBundleRecord(
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
	const body = await c.req.json<{
		visibility?: "public" | "password" | "private";
		expiresInSeconds?: number;
		password?: string;
	}>();

	let passwordHash: string | undefined;
	let passwordSalt: string | undefined;
	if (body.password) {
		({ hash: passwordHash, salt: passwordSalt } = await hashPassword(body.password));
	} else if (body.visibility === "password") {
		const existing = await getBundle(c.env, id);
		if (!existing?.passwordHash) {
			return c.json({ error: "password is required to set visibility to password" }, 400);
		}
	}

	const updated = await updateBundleRecord(c.env, id, {
		visibility: body.visibility,
		expiresInSeconds: body.expiresInSeconds,
		passwordHash,
		passwordSalt,
	});
	if (!updated) return c.json({ error: "not found" }, 404);
	return c.json(toPublicBundleRecord(updated, []));
});

app.delete("/app/api/bundles/:id", async (c) => {
	const deleted = await deleteBundleRecord(c.env, c.req.param("id"));
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

app.patch("/app/api/files/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{
		visibility?: "public" | "password" | "private";
		expiresInSeconds?: number;
		password?: string;
	}>();

	let passwordHash: string | undefined;
	let passwordSalt: string | undefined;
	if (body.password) {
		({ hash: passwordHash, salt: passwordSalt } = await hashPassword(body.password));
	} else if (body.visibility === "password") {
		// Switching an existing file to "password" without providing a new one is
		// only valid if it already has one (a no-op visibility patch); otherwise
		// there's nothing to gate downloads with.
		const existing = await getFile(c.env, id);
		if (!existing?.passwordHash) {
			return c.json({ error: "password is required to set visibility to password" }, 400);
		}
	}

	const updated = await updateFileRecord(c.env, id, {
		visibility: body.visibility,
		expiresInSeconds: body.expiresInSeconds,
		passwordHash,
		passwordSalt,
	});
	if (!updated) return c.json({ error: "not found" }, 404);
	return c.json(toPublicFileRecord(updated));
});

app.delete("/app/api/files/:id", async (c) => {
	const deleted = await deleteFileRecord(c.env, c.req.param("id"));
	if (!deleted) return c.json({ error: "not found" }, 404);
	return c.json({ ok: true });
});

app.get("/app/api/usage", async (c) => {
	return c.json(await getUsageSummary(c.env));
});

export default app;
