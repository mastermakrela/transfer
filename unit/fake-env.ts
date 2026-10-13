// In-memory stand-ins for the KV and R2 bindings, so route tests never touch live storage.
import type { BundleRecord, FileRecord } from "../src/types";

export function fakeEnv(records: { files?: FileRecord[]; bundles?: BundleRecord[]; r2?: Record<string, string> } = {}) {
	const kv = new Map<string, string>();
	for (const f of records.files ?? []) kv.set(`file:${f.id}`, JSON.stringify(f));
	for (const b of records.bundles ?? []) kv.set(`bundle:${b.id}`, JSON.stringify(b));
	const r2 = records.r2 ?? {};
	const env = {
		METADATA: {
			get: async (key: string) => kv.get(key) ?? null,
			put: async (key: string, value: string) => void kv.set(key, value),
			delete: async (key: string) => void kv.delete(key),
		},
		FILES: {
			get: async (key: string) => {
				const text = r2[key];
				if (text === undefined) return null;
				const bytes = new TextEncoder().encode(text);
				return {
					body: new Blob([bytes]).stream(),
					size: bytes.length,
					httpEtag: '"etag"',
					text: async () => text,
					writeHttpMetadata: () => {},
				};
			},
		},
	};
	return { env: env as unknown as Env, kv };
}

export const fakeCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

export function fileRecord(over: Partial<FileRecord> = {}): FileRecord {
	return {
		id: "f1",
		r2Key: "f1/page.html",
		filename: "page.html",
		contentType: "text/html",
		size: 5,
		visibility: "public",
		owner: "a@b.c",
		createdAt: 1,
		expiresAt: Date.now() + 3_600_000,
		...over,
	};
}
