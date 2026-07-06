import { AwsClient } from "aws4fetch";

const UPLOAD_URL_TTL_SECONDS = 3600;

// Presigns a PUT directly against R2's S3 endpoint so file bytes never pass through the
// Worker (and are not subject to its request-body size limit). Content-Length is part of
// the signature, so the client cannot upload more bytes than were declared (and checked
// against the quota) when the URL was issued.
export async function presignUploadUrl(env: Env, r2Key: string, size: number): Promise<string> {
	const client = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
	});

	// jurisdiction-scoped buckets (e.g. EU) live on their own S3 endpoint host
	const host = env.R2_JURISDICTION
		? `${env.ACCOUNT_ID}.${env.R2_JURISDICTION}.r2.cloudflarestorage.com`
		: `${env.ACCOUNT_ID}.r2.cloudflarestorage.com`;
	const url = new URL(`https://${host}/${env.R2_BUCKET_NAME}/${encodeURIComponent(r2Key).replace(/%2F/g, "/")}`);
	url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_SECONDS));

	// allHeaders forces content-length into the signature (aws4fetch skips it by default),
	// which is what makes the declared-size quota check tamper-proof.
	const signed = await client.sign(
		new Request(url, { method: "PUT", headers: { "content-length": String(size) } }),
		{ aws: { signQuery: true, service: "s3", allHeaders: true } },
	);
	return signed.url;
}
