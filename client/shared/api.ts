/**
 * Generic /app/api/* client shared between the /app file manager and the
 * /d/:id/:filename landing page (both need to call DELETE, both need the
 * same 401-vs-other-error handling).
 */

/** Thrown when the API responds 401 -- no Cloudflare Access session. */
export class AuthError extends Error {
	constructor() {
		super("Not signed in");
		this.name = "AuthError";
	}
}

/** Thrown for any other non-2xx response. */
export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
	// Safari in particular will happily serve a stale cached response for a plain GET
	// fetch() even without any caching headers from the server -- without this, a
	// refetch right after a mutation (e.g. right after a drag-and-drop upload) could
	// silently return the pre-upload list until a full page reload forced a real
	// network hit.
	const res = await fetch(input, { cache: "no-store", ...init });
	if (res.status === 401) throw new AuthError();
	if (!res.ok) {
		let message = `${res.status} ${res.statusText}`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body?.error) message = body.error;
		} catch {
			// response body wasn't JSON -- keep the status-line message
		}
		throw new ApiError(message, res.status);
	}
	return res.json() as Promise<T>;
}

export function deleteFile(id: string): Promise<{ ok: true }> {
	return apiFetch(`/app/api/files/${id}`, { method: "DELETE" });
}
