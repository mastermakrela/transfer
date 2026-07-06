/**
 * Password hashing (PBKDF2 via Web Crypto, available in Workers with no extra
 * dependency) plus a KV-backed "unlock" mechanism for password-protected
 * share links. Proportionate for a share-link password (a soft barrier, not
 * a high-value account credential) -- no rate limiting or lockout, matching
 * the scope actually asked for.
 */

const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer | Uint8Array): string {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function fromHex(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return bytes;
}

async function deriveBits(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
	const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
		"deriveBits",
	]);
	return crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const bits = await deriveBits(password, salt);
	return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
	const bits = await deriveBits(password, fromHex(salt));
	return toHex(bits) === hash;
}

// Generous TTL -- the real gate is the file's own expiresAt (checked separately
// on every request); this just avoids accumulating unlock tokens forever.
const UNLOCK_TTL_SECONDS = 60 * 60 * 24 * 30;

function unlockCookieName(fileId: string): string {
	return `transfer_unlock_${fileId}`;
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

export async function isUnlocked(request: Request, env: Env, fileId: string): Promise<boolean> {
	const token = getCookie(request, unlockCookieName(fileId));
	if (!token) return false;
	const stored = await env.METADATA.get(`unlock:${token}`);
	return stored === fileId;
}

/** Issues a fresh unlock token for this file and returns the Set-Cookie header value. */
export async function createUnlockCookie(env: Env, fileId: string): Promise<string> {
	const token = crypto.randomUUID();
	await env.METADATA.put(`unlock:${token}`, fileId, { expirationTtl: UNLOCK_TTL_SECONDS });
	// Scoped to this file's own routes (/d/<id> and /d/<id>/.../raw both match) so
	// unlocking one password-protected file never touches another's cookie.
	return `${unlockCookieName(fileId)}=${token}; Path=/d/${fileId}; HttpOnly; Secure; SameSite=Lax; Max-Age=${UNLOCK_TTL_SECONDS}`;
}
