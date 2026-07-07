---
name: transfer-upload
description: Share a local file (build artifact, log, export) with a human via a download link, using the "transfer" MCP server. Use whenever the user asks to "share", "send", or "upload" a file, or after finishing a build/export they'll want to grab.
---

# transfer-upload

File sharing goes through the **transfer MCP server**. If its tools (`upload_file`, `list_files`, …) are available in this session, use them — the flow is:

1. Get the file's exact size in bytes: `stat -f%z <file>` (macOS) / `stat -c%s <file>` (Linux).
2. **Ask the user which visibility they want, unless they already said so**: `private` (default — only logged-in team members can download), `password` (anyone with the link and a password you set), or `public` (anyone with the link, no auth). Don't just pick one.
3. Call the `upload_file` tool with `filename`, `size_bytes`, and `visibility` (plus `password` if `"password"`). Retention defaults to 7 days; pass `expires_in_seconds` to change it.
4. PUT the bytes to the returned presigned URL: `curl -T <file> "<upload_url>"` — no auth headers; the URL is the credential and expires in 1 hour. The byte count must match `size_bytes` exactly or the signature check fails.
5. Relay the returned `download_url` to the user — and the password too (as its own message), if you set one.

The MCP server also exposes `list_files`, `update_file` (visibility/password/expiry), `delete_file`, and `get_usage`, plus a `transfer://usage-guide` resource with the same instructions.

## If the MCP server is not connected

Stop and ask the human to connect it once:

```
claude mcp add --transport http --scope global transfer https://<YOUR_WORKER_DOMAIN>/mcp
```

(First use opens a browser window for Cloudflare login; only members of your Cloudflare account get access.) There is no bearer-token or raw-endpoint fallback; don't invent one.
