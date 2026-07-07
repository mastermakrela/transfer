import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { deleteFileRecord, getFile, getUsageSummary, listFiles, updateFileRecord } from "./kv";
import { hashPassword } from "./password";
import { downloadUrl, requestUpload } from "./uploads";

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

## Managing files

\`list_files\`, \`update_file\` (visibility/password/expiry), \`delete_file\`, and \`get_usage\` (storage + monthly budget) are available to every authenticated team member.

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
				description: "List all currently stored files with size, owner, visibility, and expiry.",
				inputSchema: {},
			},
			async () => {
				const files = await listFiles(this.env);
				return json(
					files.map((f) => ({
						id: f.id,
						filename: f.filename,
						size: f.size,
						owner: f.owner,
						visibility: f.visibility,
						has_password: Boolean(f.passwordHash),
						created_at: new Date(f.createdAt).toISOString(),
						expires_at: new Date(f.expiresAt).toISOString(),
						download_url: downloadUrl(this.auth.origin, f),
					})),
				);
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
				let passwordHash: string | undefined;
				let passwordSalt: string | undefined;
				if (password) {
					({ hash: passwordHash, salt: passwordSalt } = await hashPassword(password));
				} else if (visibility === "password") {
					const existing = await getFile(this.env, id);
					if (!existing?.passwordHash) return error('password is required to set visibility to "password"');
				}
				const updated = await updateFileRecord(this.env, id, {
					visibility,
					expiresInSeconds: expires_in_seconds,
					passwordHash,
					passwordSalt,
				});
				if (!updated) return error(`no file with id ${id}`);
				return json({
					id: updated.id,
					visibility: updated.visibility,
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
