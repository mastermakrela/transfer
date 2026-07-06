import { createRemoteJWKSet, jwtVerify } from "jose";

// Cached across requests within the same isolate so we don't refetch the JWKS every time.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks(teamDomain: string) {
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`));
	}
	return jwks;
}

function getCookie(request: Request, name: string): string | null {
	const header = request.headers.get("cookie");
	if (!header) return null;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
	}
	return null;
}

export interface AccessSession {
	email: string;
}

// /d/* is deliberately outside the Access application's protected path (/app*), so the
// only reason this still works for private-file gating is that Access's session cookie
// defaults to being scoped to the whole hostname (Path=/), not just the app's own path.
// That's an Access default, not a documented guarantee — if someone enables the app's
// "Cookie Path Attribute" setting in the dashboard, this stops receiving the cookie on
// /d/* and private downloads fail closed (401), they don't leak open.
export async function verifyAccessSession(request: Request, env: Env): Promise<AccessSession | null> {
	const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? getCookie(request, "CF_Authorization");
	if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;
	try {
		const { payload } = await jwtVerify(token, getJwks(env.CF_ACCESS_TEAM_DOMAIN), {
			audience: env.CF_ACCESS_AUD,
		});
		return typeof payload.email === "string" ? { email: payload.email } : null;
	} catch {
		return null;
	}
}
