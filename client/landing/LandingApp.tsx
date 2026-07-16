import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Select } from "@cloudflare/kumo/components/select";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { KeyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { ApiError, AuthError, patchFile, type Visibility } from "../shared/api";
import { EXPIRY_OPTIONS } from "../shared/expiry-options";
import { ExpiryInfo } from "../shared/ExpiryInfo";
import { formatBytes, formatRelativeTime } from "../shared/format";
import { SetPasswordDialog } from "../shared/SetPasswordDialog";
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
	return (
		<Toasty>
			<ReadyView data={data} />
		</Toasty>
	);
}

function ReadyView({ data }: { data: FileData }) {
	const [now, setNow] = useState(() => Date.now());
	// Access-authorized visitors (data.canManage) can change visibility/expiry right here,
	// so these track the server's current values instead of the page-load snapshot in `data`.
	const [visibility, setVisibility] = useState(data.visibility);
	const [expiresAt, setExpiresAt] = useState(data.expiresAt);
	const [savingField, setSavingField] = useState<"visibility" | "expiry" | null>(null);
	const [passwordDialogMode, setPasswordDialogMode] = useState<"set" | "rotate" | null>(null);
	const [passwordBusy, setPasswordBusy] = useState(false);
	const toasts = useKumoToastManager();

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
		return () => clearInterval(id);
	}, []);

	function reportPatchError(err: unknown, title: string) {
		const description =
			err instanceof AuthError
				? "Your session expired -- sign in again at /app."
				: err instanceof ApiError
					? err.message
					: "update failed";
		toasts.add({ variant: "error", title, description });
	}

	async function handlePatch(
		field: "visibility" | "expiry",
		patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string },
	) {
		setSavingField(field);
		try {
			const updated = await patchFile(data.id, patch);
			setVisibility(updated.visibility);
			setExpiresAt(updated.expiresAt);
		} catch (err) {
			reportPatchError(err, "Couldn't update file");
		} finally {
			setSavingField(null);
		}
	}

	function handleVisibilityChange(v: Visibility | null) {
		if (!v || v === visibility) return;
		if (v === "password") {
			setPasswordDialogMode("set");
			return;
		}
		void handlePatch("visibility", { visibility: v });
	}

	async function handlePasswordConfirm(password: string) {
		setPasswordBusy(true);
		try {
			const updated = await patchFile(
				data.id,
				passwordDialogMode === "set" ? { visibility: "password", password } : { password },
			);
			setVisibility(updated.visibility);
			setExpiresAt(updated.expiresAt);
		} catch (err) {
			reportPatchError(err, "Couldn't update password");
		} finally {
			setPasswordBusy(false);
			setPasswordDialogMode(null);
		}
	}

	return (
		<div className="page">
			<aside className="sidebar">
				<div>
					<h1 className="sidebar-title">{data.filename}</h1>
					<div className="meta-row">
						{data.canManage ? (
							<div className="visibility-cell">
								<Select
									aria-label="Visibility"
									size="xs"
									className="select-w-visibility"
									value={visibility}
									disabled={savingField === "visibility"}
									onValueChange={handleVisibilityChange}
									items={{ private: "Private", password: "Password", public: "Public" }}
								/>
								{visibility === "password" && (
									<Button
										variant="ghost"
										shape="square"
										size="sm"
										className="hit-target-square"
										icon={<KeyIcon />}
										aria-label="Change password"
										onClick={() => setPasswordDialogMode("rotate")}
									/>
								)}
							</div>
						) : (
							<span className="badge">
								{visibility === "private" ? "Private" : visibility === "password" ? "Password protected" : "Public"}
							</span>
						)}
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
							<span className="tabular">{formatRelativeTime(expiresAt, now)}</span>
							<ExpiryInfo expiresAt={expiresAt} now={now} />
						</span>
					</div>
					{data.canManage && (
						<div className="info-row">
							<span className="info-row-label">Extend</span>
							<Select
								aria-label="Extend expiry"
								size="xs"
								className="select-w-expiry"
								placeholder="Extend"
								disabled={savingField === "expiry"}
								onValueChange={(v) => v != null && handlePatch("expiry", { expiresInSeconds: v })}
								items={EXPIRY_OPTIONS}
							/>
						</div>
					)}
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

			<SetPasswordDialog
				mode={passwordDialogMode}
				filename={data.filename}
				busy={passwordBusy}
				onCancel={() => setPasswordDialogMode(null)}
				onConfirm={handlePasswordConfirm}
			/>
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
