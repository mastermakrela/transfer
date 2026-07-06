import { Hono } from "hono";
import { verifyAccessSession } from "../access";
import { deleteFileRecord, getFile, getUsageSummary, listFiles, toPublicFileRecord, updateFileRecord } from "../kv";
import { hashPassword } from "../password";
import { downloadUrl, requestUpload } from "../uploads";

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

app.get("/app/api/files", async (c) => {
	const files = await listFiles(c.env);
	return c.json({ files: files.map(toPublicFileRecord) });
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
