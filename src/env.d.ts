import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

// `wrangler types` generates Env from wrangler.jsonc bindings/vars but doesn't know about
// secrets (never in the config file) or the helpers OAuthProvider injects at runtime.
declare global {
	interface Env {
		// R2 S3-API credentials used only to presign upload URLs (create an R2 API token, see README.md)
		R2_ACCESS_KEY_ID: string;
		R2_SECRET_ACCESS_KEY: string;
		// injected by @cloudflare/workers-oauth-provider into the defaultHandler's env
		OAUTH_PROVIDER: OAuthHelpers;
	}
}

export {};
