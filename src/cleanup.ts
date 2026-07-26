import { deleteExpiredBundle, deleteExpiredFile } from "./kv";

export async function runCleanup(env: Env): Promise<void> {
	const now = Date.now();
	// Bundles first: removing a bundle also drops its members, so the file pass below then
	// only has to mop up loose files and any orphaned members (both idempotent).
	await sweep(env, "bundle:", now, (id) => deleteExpiredBundle(env, id));
	await sweep(env, "file:", now, (id) => deleteExpiredFile(env, id));
}

async function sweep(env: Env, prefix: string, now: number, remove: (id: string) => Promise<void>): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list({ prefix, cursor });
		for (const key of page.keys) {
			const meta = key.metadata as { expiresAt?: number } | undefined;
			if (!meta?.expiresAt || meta.expiresAt > now) continue;
			await remove(key.name.slice(prefix.length));
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
}
