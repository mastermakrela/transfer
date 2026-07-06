import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { verifyAccessSession } from "./access";
import { runCleanup } from "./cleanup";
import { TransferMCP } from "./mcp";
import appRoutes from "./routes/app";
import downloadRoutes from "./routes/download";

const app = new Hono<{ Bindings: Env }>();

// OAuth authorization endpoint for MCP clients. The Cloudflare Access application MUST
// cover this path (alongside /app*) — the edge forces the "Login with Cloudflare" flow
// before the request arrives, and we turn the resulting Access identity into an OAuth
// grant. Auto-approved without a consent screen: only account members can reach this,
// and the server exposes a single first-party tool set.
app.get("/authorize", async (c) => {
	const session = await verifyAccessSession(c.req.raw, c.env);
	if (!session) {
		return c.text("unauthorized: this endpoint must sit behind the Cloudflare Access application\n", 401);
	}
	const authRequest = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: authRequest,
		userId: session.email,
		metadata: {},
		scope: authRequest.scope,
		props: { email: session.email, origin: new URL(c.req.url).origin },
	});
	return c.redirect(redirectTo);
});

app.route("/", downloadRoutes);
app.route("/", appRoutes);
app.notFound((c) => c.text("not found\n", 404));

const provider = new OAuthProvider<Env>({
	apiHandlers: {
		// Hono's fetch and McpAgent.serve's fetch accept (request, env, ctx) but are typed
		// more loosely than ExportedHandlerWithFetch, hence the casts.
		"/mcp": TransferMCP.serve("/mcp") as ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> },
	},
	defaultHandler: { fetch: app.fetch } as ExportedHandler<Env>,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
});

export { TransferMCP };

export default {
	fetch: (request, env, ctx) => provider.fetch(request, env, ctx),
	async scheduled(_event, env, ctx) {
		ctx.waitUntil(runCleanup(env));
	},
} satisfies ExportedHandler<Env>;
