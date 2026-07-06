# transfer

A self-hosted transfer.sh replacement, running as a single Cloudflare Worker. This is a **whitelabel template** — fill in the placeholders in `wrangler.jsonc` and `r2-cors.json` (see [Setup](#setup) below) and deploy it under your own Cloudflare account and domain.

An OAuth-protected **MCP server** hands out presigned R2 upload URLs, so agents (and the browser app) upload straight to R2 — file bytes never pass through the Worker. KV tracks metadata/expiry/usage, an hourly cron sweeps expired files, and each file has one of three visibility tiers: public, password-protected, or private (team-only, gated by Cloudflare Access). Built with Hono + the official MCP TypeScript SDK, with three Kumo-based UI surfaces (the file manager, the per-file landing/preview page, and the plain static root page) sharing one consistent design system.

## Routes

- **`/mcp`** — MCP server (streamable HTTP) for AI agents. Tools: `upload_file` (returns a presigned PUT URL + download link), `list_files`, `update_file`, `delete_file`, `get_usage`; resource: `transfer://usage-guide`. Auth is OAuth: `@cloudflare/workers-oauth-provider` handles token issuance + dynamic client registration, and the `/authorize` endpoint sits behind Cloudflare Access ("Login with Cloudflare"), so only account members can connect. Connect with:

  ```
  claude mcp add --transport http transfer https://<YOUR_WORKER_DOMAIN>/mcp
  ```

- **`/app`** — the file manager (React + Kumo): upload via drag/drop, list/delete files, change visibility/password/expiry, copy a file's link, see usage vs. the monthly budget. Gated by the same Access application.
- **`/d/:id/:filename`** — a file's landing/preview page (React + Kumo): shows metadata, a QR code, and an inline preview (image/video/audio/HTML/markdown/text, or a generic badge otherwise). Public files need no auth; private files require an active Access session; password-protected files prompt for a password (`/d/:id/:filename/unlock`, sets a scoped unlock cookie). Not-found, sign-in-required, and password-required all render through the same page shell using real Kumo components, not separate hand-rolled markup.
- **`/d/:id/:filename/raw`** — the actual byte stream, used as the `<img>`/`<video>`/`<audio>` `src` and as the real download link (`?download=1` for `Content-Disposition: attachment`).
- **`/`** — a plain static page (no JS bundle) pointing people at `/app` and giving agents the MCP connect command.
- **`/authorize`, `/token`, `/register`, `/.well-known/oauth-*`** — OAuth plumbing (token/register/metadata served automatically by `workers-oauth-provider`).

See `.claude/skills/transfer-upload/SKILL.md` for the agent-facing upload instructions (the MCP server also serves the same content as the `transfer://usage-guide` resource).

## How uploads work

Uploads are presigned direct-to-R2 PUTs (1h URL validity, `Content-Length` signed, 5GB max), so the Workers request-body limit doesn't apply. The 10GB/month budget is enforced at presign time — upload requests are refused once exceeded, and presigned-but-never-uploaded files still count against the budget until their KV record expires. An hourly Cron Trigger deletes expired file records (including those never-uploaded ones) and their R2 objects.

## Access control

MCP tool access and the `/app` file manager are gated by a Cloudflare Access "Self-hosted" application named `transfer`, covering the `/app*` and `/authorize` paths, with a policy allowing any member of your Cloudflare account (your Zero Trust team domain). Files themselves are team-visible, not owner-scoped — any account member can see and manage any file; uploads are attributed to the uploader's email for display only. OAuth's `/authorize` step auto-approves without a consent screen, since only account members can reach it and there's a single first-party tool set.

R2 bucket jurisdiction is set via `R2_JURISDICTION` in `wrangler.jsonc` (defaults to `eu` — change or drop it to match wherever you create the bucket); presigned URLs are built from `ACCOUNT_ID` + `R2_BUCKET_NAME` + `R2_JURISDICTION`. If the bucket is EU-jurisdiction, `wrangler r2` commands against it need `--jurisdiction eu`. Bucket CORS (`r2-cors.json`) must allow `PUT` from your deployed Worker's origin for direct browser uploads.

## Setup

This repo ships with placeholders — a fresh deployment needs:

1. **Cloudflare account**: set `account_id` in `wrangler.jsonc` (or export `CLOUDFLARE_ACCOUNT_ID`) and `ACCOUNT_ID` under `vars`.
2. **R2 bucket**: `wrangler r2 bucket create transfer-files [--jurisdiction eu]`, matching the `r2_buckets` entry in `wrangler.jsonc`.
3. **KV namespaces**: `wrangler kv namespace create METADATA` and `wrangler kv namespace create OAUTH_KV`, then paste the returned ids into `kv_namespaces` in `wrangler.jsonc`.
4. **Cloudflare Access**: create a "Self-hosted" Access application (Zero Trust dashboard) covering `/app*` and `/authorize` on your Worker's domain, with a policy allowing your account's members. Set `CF_ACCESS_TEAM_DOMAIN` (your team domain) and `CF_ACCESS_AUD` (the application's Audience tag) under `vars`.
5. **CORS**: after your Worker has a domain, update the origin in `r2-cors.json` and apply it: `wrangler r2 bucket cors put transfer-files --config r2-cors.json [--jurisdiction eu]`.
6. Run `bun run cf-typegen` to regenerate `worker-configuration.d.ts` from the filled-in config.

## Local dev

```
bun install
cp .dev.vars.example .dev.vars
bun run dev
```

Local limits: Access-gated routes (`/app/api/*`, `/authorize`) fail closed with 401 (no real Access session), and presigned URLs are generated but point at real R2, so they only work with real credentials in `.dev.vars`. Public downloads and the OAuth metadata/register/token endpoints work fully locally.

## Deploying

```
bun run deploy
```

Builds `client/app` and `client/landing`, then `wrangler deploy`. After changing `wrangler.jsonc`, rerun `bun run cf-typegen` first to regenerate `worker-configuration.d.ts`.

## Notes / deliberate v1 cuts

- Usage counters are best-effort (KV has no atomic increments); the monthly budget check is approximate under concurrent uploads.
- No headless/CI auth path (OAuth needs a browser once per machine). If ever needed: an Access service-token policy on a dedicated endpoint.
- No malware scanning, no multipart/resumable uploads (5GB single-PUT ceiling), no per-user quotas.
