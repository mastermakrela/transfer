import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Select } from "@cloudflare/kumo/components/select";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { DownloadSimpleIcon, FolderIcon, KeyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { ApiError, AuthError, patchBundle, type Visibility } from "../../shared/api";
import { EXPIRY_OPTIONS } from "../../shared/expiry-options";
import { ExpiryInfo } from "../../shared/ExpiryInfo";
import { formatBytes, formatRelativeTime } from "../../shared/format";
import { SetPasswordDialog } from "../../shared/SetPasswordDialog";
import type { BundleData, BundleFileEntry } from "../types";
import { LinkBox } from "./LinkBox";
import { QrBox } from "./QrBox";

const NOW_TICK_MS = 45_000;

export function BundleView({ data }: { data: BundleData }) {
	const [now, setNow] = useState(() => Date.now());
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
			const updated = await patchBundle(data.id, patch);
			setVisibility(updated.visibility);
			setExpiresAt(updated.expiresAt);
		} catch (err) {
			reportPatchError(err, "Couldn't update folder");
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
			const updated = await patchBundle(
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
					<div className="bundle-breadcrumb bundle-breadcrumb-static">
						<FolderIcon size={14} weight="fill" aria-hidden />
						<span>Folder</span>
					</div>
					<h1 className="sidebar-title">{data.name}</h1>
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
						<span className="badge">
							{data.files.length} {data.files.length === 1 ? "file" : "files"}
						</span>
					</div>
				</div>

				<div className="info-list">
					<div className="info-row">
						<span className="info-row-label">Total size</span>
						<span className="info-row-value tabular">{formatBytes(data.totalSize)}</span>
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
					<LinkButton href={data.zipUrl} variant="primary" icon={<DownloadSimpleIcon />} className="flex-1">
						Download all (.zip)
					</LinkButton>
				</div>

				<QrBox svg={data.qrSvg} />
			</aside>

			<main className="bundle-pane">
				{data.files.length === 0 ? (
					<p className="bundle-empty">This folder is empty — its files may still be uploading or have expired.</p>
				) : (
					<ul className="bundle-file-list">
						{data.files.map((file) => (
							<BundleFileRow key={file.id} file={file} />
						))}
					</ul>
				)}
			</main>

			<SetPasswordDialog
				mode={passwordDialogMode}
				filename={data.name}
				busy={passwordBusy}
				onCancel={() => setPasswordDialogMode(null)}
				onConfirm={handlePasswordConfirm}
			/>
		</div>
	);
}

function BundleFileRow({ file }: { file: BundleFileEntry }) {
	return (
		<li className="bundle-file-row">
			<a href={file.pageUrl} className="bundle-file-main">
				<span className="bundle-file-ext" aria-hidden>
					{file.extension}
				</span>
				<span className="bundle-file-name">{file.filename}</span>
			</a>
			<span className="bundle-file-size tabular">{formatBytes(file.size)}</span>
			<LinkButton
				href={file.downloadUrl}
				variant="secondary"
				size="sm"
				icon={<DownloadSimpleIcon />}
				aria-label={`Download ${file.filename}`}
			>
				Download
			</LinkButton>
		</li>
	);
}
