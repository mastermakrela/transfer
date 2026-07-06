import { deleteExpiredFile } from "./kv";

export async function runCleanup(env: Env): Promise<void> {
	const now = Date.now();
	let cursor: string | undefined;
	do {
		const page = await env.METADATA.list({ prefix: "file:", cursor });
		for (const key of page.keys) {
			const meta = key.metadata as { expiresAt?: number } | undefined;
			if (!meta?.expiresAt || meta.expiresAt > now) continue;
			await deleteExpiredFile(env, key.name.slice("file:".length));
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
}
