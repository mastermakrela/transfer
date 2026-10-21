import { deleteBundleRecord, deleteFileRecord, listKeyPages } from "./kv";

export async function runCleanup(env: Env): Promise<void> {
	const now = Date.now();
	// Bundles first: removing a bundle also drops its members, so the file pass below then
	// only has to mop up loose files and any orphaned members (both idempotent).
	// detach:false -- see the comment on deleteFileRecord in kv.ts for why the cron path
	// must not rewrite a bundle's member list here.
	await sweep(env, "bundle:", now, (id) => deleteBundleRecord(env, id, { detach: false }));
	await sweep(env, "file:", now, (id) => deleteFileRecord(env, id, { detach: false }));
}

async function sweep(env: Env, prefix: string, now: number, remove: (id: string) => Promise<unknown>): Promise<void> {
	for await (const keys of listKeyPages<{ expiresAt?: number }>(env, prefix)) {
		for (const key of keys) {
			const meta = key.metadata;
			if (!meta?.expiresAt || meta.expiresAt > now) continue;
			await remove(key.name.slice(prefix.length));
		}
	}
}
