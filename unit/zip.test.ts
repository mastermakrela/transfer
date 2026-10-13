import { expect, test } from "bun:test";
import download from "../src/routes/download";
import type { BundleRecord } from "../src/types";
import { fakeCtx, fakeEnv, fileRecord } from "./fake-env";

test("two folder files with the same name get distinct names in the zip", async () => {
	const members = ["a", "b", "c"].map((id) =>
		fileRecord({ id, r2Key: `${id}/app.apk`, filename: "app.apk", contentType: "application/vnd.android.package-archive", bundleId: "b1" }),
	);
	const bundle: BundleRecord = {
		id: "b1",
		name: "Builds",
		fileIds: ["a", "b", "c"],
		visibility: "public",
		owner: "a@b.c",
		createdAt: 1,
		expiresAt: Date.now() + 3_600_000,
	};
	const { env } = fakeEnv({ files: members, bundles: [bundle], r2: { "a/app.apk": "1", "b/app.apk": "2", "c/app.apk": "3" } });

	const res = await download.fetch(new Request("https://t.example/f/b1/all.zip"), env, fakeCtx);
	expect(res.status).toBe(200);
	const zip = new TextDecoder("latin1").decode(await res.arrayBuffer());
	for (const name of ["app.apk", "app (2).apk", "app (3).apk"]) expect(zip).toContain(name);
});
