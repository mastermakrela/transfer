import { expect, test } from "bun:test";
import { clampTtlSeconds, sanitizeFilename } from "../src/kv";
import { requestUpload } from "../src/uploads";
import { fakeEnv } from "./fake-env";

const vars = {
	DEFAULT_TTL_SECONDS: 604800,
	MIN_TTL_SECONDS: 300,
	MAX_TTL_SECONDS: 2592000,
	MONTHLY_BUDGET_BYTES: 1000,
	ACCOUNT_ID: "acc",
	R2_BUCKET_NAME: "bucket",
	R2_JURISDICTION: "eu",
	R2_ACCESS_KEY_ID: "key",
	R2_SECRET_ACCESS_KEY: "secret",
};
const upload = { filename: "a.txt", owner: "a@b.c" };

test("sanitizeFilename keeps only a safe basename", () => {
	expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
	expect(sanitizeFilename("C:\\x\\..\\.env")).toBe("env");
	expect(sanitizeFilename("..")).toBe("file");
	expect(sanitizeFilename("my report (v2).pdf")).toBe("my_report__v2_.pdf");
});

test("clampTtlSeconds falls back to the default and clamps to the bounds", () => {
	const env = vars as unknown as Env;
	expect(clampTtlSeconds(undefined, env)).toBe(604800);
	expect(clampTtlSeconds("-5", env)).toBe(604800);
	expect(clampTtlSeconds("10", env)).toBe(300);
	expect(clampTtlSeconds("99999999", env)).toBe(2592000);
});

test("requestUpload rejects bad sizes, a missing password and an exhausted budget", async () => {
	const env = { ...fakeEnv().env, ...vars } as unknown as Env;
	expect(await requestUpload(env, { ...upload, size: 0 })).toMatchObject({ ok: false });
	expect(await requestUpload(env, { ...upload, size: 6 * 1024 ** 3 })).toMatchObject({ ok: false });
	expect(await requestUpload(env, { ...upload, size: 10, visibility: "password" })).toMatchObject({ ok: false });
	expect(await requestUpload(env, { ...upload, size: 1001 })).toMatchObject({ ok: false, error: expect.stringContaining("budget") });
});

test("requestUpload presigns a PUT with the declared size signed, and counts it against the budget", async () => {
	const env = { ...fakeEnv().env, ...vars } as unknown as Env;
	const first = await requestUpload(env, { ...upload, size: 600 });
	if (!first.ok) throw new Error(first.error);
	const url = new URL(first.uploadUrl);
	expect(url.host).toBe("acc.eu.r2.cloudflarestorage.com");
	expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
	expect(await requestUpload(env, { ...upload, size: 600 })).toMatchObject({ ok: false });
});
