import { expect, test } from "bun:test";
import download from "../src/routes/download";
import { fakeCtx, fakeEnv, fileRecord } from "./fake-env";

async function rawHeaders(contentType: string) {
	const { env } = fakeEnv({ files: [fileRecord({ contentType })], r2: { "f1/page.html": "<h1>hi</h1>" } });
	const res = await download.fetch(new Request("https://t.example/d/f1/page.html/raw"), env, fakeCtx);
	expect(res.status).toBe(200);
	return res.headers;
}

test("raw HTML/SVG/XML is sandboxed so it can't run as a page on the app origin", async () => {
	for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml"]) {
		expect((await rawHeaders(type)).get("content-security-policy")).toStartWith("sandbox");
	}
});

test("other types are served unsandboxed (PDFs break under a CSP sandbox) but never sniffed", async () => {
	const headers = await rawHeaders("application/pdf");
	expect(headers.get("content-security-policy")).toBeNull();
	expect(headers.get("x-content-type-options")).toBe("nosniff");
});
