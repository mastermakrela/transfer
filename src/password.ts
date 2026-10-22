/**
 * Password hashing (PBKDF2 via Web Crypto, available in Workers with no extra
 * dependency) plus a KV-backed "unlock" mechanism for password-protected
 * share links. Proportionate for a share-link password (a soft barrier, not
 * a high-value account credential) -- no rate limiting or lockout, matching
 * the scope actually asked for.
 */
import { getCookie } from "./cookies";
import type { Gated } from "./types";

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

// A token is only good for the password it was issued under: the salt is regenerated every
// time the password is set or rotated, so changing the password locks out everyone who
// had unlocked with the old one.
function unlockValue(gate: Gated): string {
	return `${gate.id}:${gate.passwordSalt}`;
}

export async function isUnlocked(request: Request, env: Env, gate: Gated): Promise<boolean> {
	const token = getCookie(request, unlockCookieName(gate.id));
	if (!token) return false;
	const stored = await env.METADATA.get(`unlock:${token}`);
	return stored === unlockValue(gate);
}

/**
 * Issues a fresh unlock token for this gate (a file, or a bundle when unlocking a folder)
 * and returns the Set-Cookie header value.
 *
 * Path is "/" rather than the resource's own route: a bundle unlock has to be recognized
 * both on the bundle page (/f/<id>) and on every member's own page (/d/<memberId>), which
 * live under different paths. This is safe because the per-id cookie *name* keeps unlocks
 * from colliding, and the token itself -- not the path -- is the unguessable secret.
 */
export async function createUnlockCookie(env: Env, gate: Gated): Promise<string> {
	const token = crypto.randomUUID();
	await env.METADATA.put(`unlock:${token}`, unlockValue(gate), { expirationTtl: UNLOCK_TTL_SECONDS });
	return `${unlockCookieName(gate.id)}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${UNLOCK_TTL_SECONDS}`;
}
