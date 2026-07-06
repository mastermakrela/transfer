import { LinkButton } from "@cloudflare/kumo/components/button";
import { useEffect, useState } from "react";

import { ExpiryInfo } from "../shared/ExpiryInfo";
import { formatBytes, formatRelativeTime } from "../shared/format";
import { DeleteButton } from "./components/DeleteButton";
import { HtmlPreview } from "./components/HtmlPreview";
import { ImagePreview } from "./components/ImagePreview";
import { LinkBox } from "./components/LinkBox";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { QrBox } from "./components/QrBox";
import { StatusPage } from "./components/StatusPage";
import { TextPreview } from "./components/TextPreview";
import type { FileData, PageData } from "./types";

const NOW_TICK_MS = 45_000;

export function LandingApp({ data }: { data: PageData }) {
	if (data.state !== "ready") return <StatusPage data={data} />;
	return <ReadyView data={data} />;
}

function ReadyView({ data }: { data: FileData }) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
		return () => clearInterval(id);
	}, []);

	return (
		<div className="page">
			<aside className="sidebar">
				<div>
					<h1 className="sidebar-title">{data.filename}</h1>
					<div className="meta-row">
						<span className="badge">
							{data.visibility === "private" ? "Private" : data.visibility === "password" ? "Password protected" : "Public"}
						</span>
						<span className="badge">{data.contentType || "unknown type"}</span>
					</div>
				</div>

				<div className="info-list">
					<div className="info-row">
						<span className="info-row-label">Size</span>
						<span className="info-row-value tabular">{formatBytes(data.size)}</span>
					</div>
					<div className="info-row">
						<span className="info-row-label">Owner</span>
						<span className="info-row-value">{data.owner}</span>
					</div>
					<div className="info-row">
						<span className="info-row-label">Expires</span>
						<span className="info-row-value expiry-cell">
							<span className="tabular">{formatRelativeTime(data.expiresAt, now)}</span>
							<ExpiryInfo expiresAt={data.expiresAt} now={now} />
						</span>
					</div>
				</div>

				<LinkBox url={data.pageUrl} />

				<div className="actions">
					<LinkButton href={data.downloadUrl} variant="primary" className="flex-1">
						Download
					</LinkButton>
					{data.canManage && <DeleteButton id={data.id} filename={data.filename} />}
				</div>

				<QrBox svg={data.qrSvg} />
			</aside>

			<main className="preview-pane">
				<Preview data={data} />
			</main>
		</div>
	);
}

function Preview({ data }: { data: FileData }) {
	switch (data.previewKind) {
		case "image":
			return <ImagePreview src={data.rawUrl} alt={data.filename} />;
		case "video":
			// biome-ignore lint: needs controls, no captions available for arbitrary uploads
			return <video className="preview-media" src={data.rawUrl} controls />;
		case "audio":
			return (
				<div className="preview-fallback">
					<ExtensionBadge extension={data.extension} />
					{/* biome-ignore lint: needs controls, no captions available for arbitrary uploads */}
					<audio className="preview-audio" src={data.rawUrl} controls />
				</div>
			);
		case "html":
			return <HtmlPreview src={data.rawUrl} title={data.filename} />;
		case "markdown":
			return data.previewText !== null ? <MarkdownPreview text={data.previewText} /> : <TooLarge data={data} />;
		case "text":
			return data.previewText !== null ? (
				<TextPreview text={data.previewText} extension={data.extension} />
			) : (
				<TooLarge data={data} />
			);
		default:
			return <ExtensionBadge extension={data.extension} />;
	}
}

function TooLarge({ data }: { data: FileData }) {
	return (
		<div className="preview-fallback">
			<ExtensionBadge extension={data.extension} />
			<p className="preview-fallback-note">
				Too large to preview inline
				{data.textTooLargeBytes ? ` (over ${formatBytes(data.textTooLargeBytes)})` : ""} -- use Download.
			</p>
		</div>
	);
}

function ExtensionBadge({ extension }: { extension: string }) {
	return (
		<div className="preview-badge" aria-hidden="true">
			{extension}
		</div>
	);
}
