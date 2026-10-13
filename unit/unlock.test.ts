import { expect, test } from "bun:test";
import { updateFileRecord } from "../src/kv";
import { hashPassword } from "../src/password";
import download from "../src/routes/download";
import { fakeCtx, fakeEnv, fileRecord } from "./fake-env";

const BASE = "https://t.example/d/f1/page.html";

test("rotating a file's password locks out visitors who unlocked with the old one", async () => {
	const old = await hashPassword("old-pass");
	const { env } = fakeEnv({
		files: [fileRecord({ visibility: "password", passwordHash: old.hash, passwordSalt: old.salt, password: "old-pass" })],
		r2: { "f1/page.html": "<h1>hi</h1>" },
	});

	const unlock = await download.fetch(
		new Request(`${BASE}/unlock`, { method: "POST", body: new URLSearchParams({ password: "old-pass" }) }),
		env,
		fakeCtx,
	);
	expect(unlock.status).toBe(303);
	const cookie = unlock.headers.get("set-cookie")?.split(";")[0] ?? "";
	const rawWithCookie = () => download.fetch(new Request(`${BASE}/raw`, { headers: { cookie } }), env, fakeCtx);

	expect((await rawWithCookie()).status).toBe(200);

	const next = await hashPassword("new-pass");
	await updateFileRecord(env, "f1", { passwordHash: next.hash, passwordSalt: next.salt, password: "new-pass" });
	expect((await rawWithCookie()).status).toBe(401);
});
