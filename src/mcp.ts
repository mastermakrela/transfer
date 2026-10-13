import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { deleteBundleRecord, deleteFileRecord, gateFor, getUsageSummary, listBundles, listFiles, updateFileRecord } from "./kv";
import { bundleUrl, downloadUrl, requestBundleUpload, requestUpload } from "./uploads";

export interface AuthProps extends Record<string, unknown> {
	email: string;
	origin: string;
}

const USAGE_GUIDE = `# transfer — internal file sharing

Share a local file (build artifact, log, export) with a human via a link.

## Uploading

1. Determine the file's exact size in bytes (e.g. \`stat -f%z file\` on macOS, \`stat -c%s file\` on Linux).
2. **Ask the user which visibility they want before uploading, unless they already said so** — don't decide this for them:
   - \`private\` (default) — only logged-in team members can download
   - \`password\` — anyone with the link *and* a password you set can download
   - \`public\` — anyone with the link can download, no auth at all
3. Call the \`upload_file\` tool with the filename, size, and the chosen \`visibility\` (plus \`password\` if \`"password"\`). It returns an \`upload_url\` (a presigned, single-use-style PUT URL valid for 1 hour) and the final \`download_url\`.
4. Upload the bytes: \`curl -T ./file "<upload_url>"\` — no auth headers needed, the URL itself is the credential. Do not modify the URL or add extra headers; the declared size is part of the signature.
5. Relay the \`download_url\` to the user — and the password too (as its own message), if you set one.

Files auto-delete after 7 days by default; pass \`expires_in_seconds\` (5 minutes to 30 days) to change retention.

## Sharing several files under one link (bundles)

When you have multiple files to hand over as a set (e.g. four Android builds for one client), use \`create_bundle\` instead of uploading each separately. It takes a folder \`name\` and a \`files\` array and returns ONE \`bundle_url\` (a /f/... folder page listing every file, with a "Download all" zip) plus one \`upload_url\` per file. Visibility/password/expiry are set once on the whole folder. Upload each file with its own \`curl -T <file> "<upload_url>"\`, then relay the single \`bundle_url\`.

## Managing files

\`list_files\`, \`update_file\` (visibility/password/expiry), \`delete_file\`, \`delete_bundle\`, and \`get_usage\` (storage + monthly budget) are available to every authenticated team member. The password of a password-protected file can be read back later via \`list_files\` by any team member -- if someone forgot it, look it up there instead of rotating it.

## If the curl PUT is blocked

Some agent runtimes flag that upload \`curl\` as a possible data-exfiltration pattern and refuse to run it, even though the URL points at this service's own bucket. Don't try to work around a block like that — tell the human exactly what was blocked and that they need to allow-list it in their permission config, then retry once they confirm it's granted.
`;

function json(data: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function error(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

export class TransferMCP extends McpAgent<Env, unknown, AuthProps> {
	server = new McpServer({ name: "transfer", version: "1.0.0" });

	// props is optional on McpAgent, but this agent is only reachable through OAuthProvider,
	// which always sets it from the grant.
	private get auth(): AuthProps {
		if (!this.props) throw new Error("missing OAuth props");
		return this.props;
	}

	async init() {
		this.server.registerResource(
			"usage-guide",
			"transfer://usage-guide",
			{
				title: "How to share files with transfer",
				description: "Instructions for uploading and sharing files through this MCP server.",
				mimeType: "text/markdown",
			},
			async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: USAGE_GUIDE }] }),
		);

		this.server.registerTool(
			"upload_file",
			{
				title: "Request a file upload",
				description:
					"Get a presigned URL to share a local file via a download link. Returns upload_url — PUT the file bytes to it with `curl -T <file> \"<upload_url>\"` (valid 1 hour, exact declared size required) — and download_url, which is the shareable link to relay to the user once the PUT succeeds. If that curl is blocked by your permission settings, don't work around it — tell the user it needs to be allow-listed.",
				inputSchema: {
					filename: z.string().min(1).describe("The file's name, used in the download link"),
					size_bytes: z.number().int().positive().describe("Exact file size in bytes (e.g. from `stat -f%z`)"),
					content_type: z.string().optional().describe("MIME type, defaults to application/octet-stream"),
					visibility: z
						.enum(["public", "password", "private"])
						.optional()
						.describe(
							"private (default) = only logged-in team members; password = anyone with the password; public = anyone with the link",
						),
					password: z.string().min(1).optional().describe('Required when visibility is "password"'),
					expires_in_seconds: z
						.number()
						.int()
						.optional()
						.describe("Auto-delete after this many seconds (300–2592000); default 604800 (7 days)"),
				},
			},
			async ({ filename, size_bytes, content_type, visibility, password, expires_in_seconds }) => {
				const result = await requestUpload(this.env, {
					filename,
					size: size_bytes,
					contentType: content_type,
					visibility,
					password,
					expiresIn: expires_in_seconds,
					owner: this.auth.email,
				});
				if (!result.ok) return error(result.error);
				return json({
					upload_url: result.uploadUrl,
					download_url: downloadUrl(this.auth.origin, result.record),
					id: result.record.id,
					visibility: result.record.visibility,
					expires_at: new Date(result.record.expiresAt).toISOString(),
					next_step: `curl -T <file> "${result.uploadUrl}"`,
				});
			},
		);

		this.server.registerTool(
			"list_files",
			{
				title: "List uploaded files",
				description:
					"List all currently stored files with size, owner, visibility, and expiry. Password-protected files include their plaintext password, so a team member who forgot it can retrieve it here instead of rotating it.",
				inputSchema: {},
			},
			async () => {
				const [files, bundles] = await Promise.all([listFiles(this.env), listBundles(this.env)]);
				const bundleById = new Map(bundles.map((b) => [b.id, b]));
				return json(
					files.map((f) => {
						// A bundled file is gated by its bundle, so that's where its visibility and password live.
						const gate = gateFor(f, f.bundleId ? bundleById.get(f.bundleId) : null);
						return {
							id: f.id,
							filename: f.filename,
							size: f.size,
							owner: f.owner,
							visibility: gate.visibility,
							has_password: Boolean(gate.passwordHash),
							...(gate.password ? { password: gate.password } : {}),
							created_at: new Date(f.createdAt).toISOString(),
							expires_at: new Date(f.expiresAt).toISOString(),
							download_url: downloadUrl(this.auth.origin, f),
							bundle_id: f.bundleId ?? null,
						};
					}),
				);
			},
		);

		this.server.registerTool(
			"create_bundle",
			{
				title: "Share several files under one link",
				description:
					"Group multiple files into one shareable folder (a bundle) with a single link. Returns bundle_url (the /f/... folder page, list to the user) and one upload_url per file — PUT each file's bytes with `curl -T <file> \"<upload_url>\"` (valid 1 hour, exact declared size). Visibility/password/expiry apply to the whole folder. Prefer this over multiple upload_file calls when handing over a set of related files.",
				inputSchema: {
					name: z.string().min(1).describe("Folder name shown on the bundle page, e.g. \"Acme Android builds\""),
					files: z
						.array(
							z.object({
								filename: z.string().min(1),
								size_bytes: z.number().int().positive().describe("Exact size in bytes (e.g. from `stat -f%z`)"),
								content_type: z.string().optional(),
							}),
						)
						.min(1)
						.describe("The files to include; each gets its own upload_url in the response"),
					visibility: z
						.enum(["public", "password", "private"])
						.optional()
						.describe("private (default) = team members only; password = anyone with the password; public = anyone with the link"),
					password: z.string().min(1).optional().describe('Required when visibility is "password"'),
					expires_in_seconds: z
						.number()
						.int()
						.optional()
						.describe("Auto-delete the whole folder after this many seconds (300–2592000); default 604800 (7 days)"),
				},
			},
			async ({ name, files, visibility, password, expires_in_seconds }) => {
				const result = await requestBundleUpload(this.env, {
					name,
					visibility,
					password,
					expiresIn: expires_in_seconds,
					owner: this.auth.email,
					files: files.map((f) => ({ filename: f.filename, size: f.size_bytes, contentType: f.content_type })),
				});
				if (!result.ok) return error(result.error);
				return json({
					bundle_url: bundleUrl(this.auth.origin, result.bundle),
					id: result.bundle.id,
					visibility: result.bundle.visibility,
					expires_at: new Date(result.bundle.expiresAt).toISOString(),
					uploads: result.uploads.map((u) => ({
						filename: u.record.filename,
						upload_url: u.uploadUrl,
						next_step: `curl -T "${u.record.filename}" "${u.uploadUrl}"`,
					})),
				});
			},
		);

		this.server.registerTool(
			"update_file",
			{
				title: "Change a file's visibility, password, or expiry",
				description: "Update visibility (public/password/private), rotate its password, and/or reset the expiry countdown of an uploaded file.",
				inputSchema: {
					id: z.string().describe("File id (from upload_file or list_files)"),
					visibility: z.enum(["public", "password", "private"]).optional(),
					password: z
						.string()
						.min(1)
						.optional()
						.describe('New password. Required when setting visibility to "password" for the first time; optional otherwise to rotate an existing password.'),
					expires_in_seconds: z.number().int().optional().describe("New TTL from now (300–2592000 seconds)"),
				},
			},
			async ({ id, visibility, password, expires_in_seconds }) => {
				const result = await updateFileRecord(this.env, id, {
					visibility,
					expiresInSeconds: expires_in_seconds,
					password,
				});
				if (!result.ok) {
					if (result.error === "password_required") return error('password is required to set visibility to "password"');
					return error(`no file with id ${id}`);
				}
				const updated = result.record;
				return json({
					id: updated.id,
					visibility: updated.visibility,
					has_password: Boolean(updated.passwordHash),
					...(updated.password ? { password: updated.password } : {}),
					expires_at: new Date(updated.expiresAt).toISOString(),
				});
			},
		);

		this.server.registerTool(
			"delete_file",
			{
				title: "Delete a file",
				description: "Immediately delete an uploaded file and its link.",
				inputSchema: { id: z.string().describe("File id (from upload_file or list_files)") },
			},
			async ({ id }) => {
				const deleted = await deleteFileRecord(this.env, id);
				if (!deleted) return error(`no file with id ${id}`);
				return json({ deleted: id });
			},
		);

		this.server.registerTool(
			"delete_bundle",
			{
				title: "Delete a bundle",
				description: "Immediately delete a shared folder, its link, and every file inside it.",
				inputSchema: { id: z.string().describe("Bundle id (from create_bundle, or a file's bundle_id in list_files)") },
			},
			async ({ id }) => {
				const deleted = await deleteBundleRecord(this.env, id);
				if (!deleted) return error(`no bundle with id ${id}`);
				return json({ deleted: id });
			},
		);

		this.server.registerTool(
			"get_usage",
			{
				title: "Show storage usage and budget",
				description: "Current stored bytes/files and this month's upload volume against the team budget.",
				inputSchema: {},
			},
			async () => json(await getUsageSummary(this.env)),
		);
	}
}
