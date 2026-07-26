import { Button } from "@cloudflare/kumo/components/button";
import { Select } from "@cloudflare/kumo/components/select";
import { Table } from "@cloudflare/kumo/components/table";
import { Text } from "@cloudflare/kumo/components/text";
import { CheckIcon, CopySimpleIcon, FolderIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react";
import { type CSSProperties, useState } from "react";

import { ExpiryInfo } from "../../shared/ExpiryInfo";
import { EXPIRY_OPTIONS } from "../../shared/expiry-options";
import { formatBytes, formatRelativeTime } from "../../shared/format";
import { SetPasswordDialog } from "../../shared/SetPasswordDialog";
import { useCopyFeedback } from "../../shared/useCopyFeedback";
import type { BundleRecord, Visibility } from "../lib/api";

interface BundleRowProps {
	bundle: BundleRecord;
	now: number;
	index: number;
	exiting: boolean;
	onPatch: (patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) => Promise<void>;
	onDeleteRequest: () => void;
}

export function BundleRow({ bundle, now, index, exiting, onPatch, onDeleteRequest }: BundleRowProps) {
	const [savingField, setSavingField] = useState<"visibility" | "expiry" | null>(null);
	const [passwordDialogMode, setPasswordDialogMode] = useState<"set" | "rotate" | null>(null);
	const [passwordBusy, setPasswordBusy] = useState(false);
	const { copied: linkCopied, copy: copyLink } = useCopyFeedback();
	const folderHref = `/f/${bundle.id}`;
	const totalSize = bundle.files.reduce((sum, f) => sum + f.size, 0);
	const expired = bundle.expiresAt <= now;

	async function handlePatch(
		field: "visibility" | "expiry",
		patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string },
	) {
		setSavingField(field);
		try {
			await onPatch(patch);
		} finally {
			setSavingField(null);
		}
	}

	function handleVisibilityChange(v: Visibility | null) {
		if (!v || v === bundle.visibility) return;
		if (v === "password") {
			setPasswordDialogMode("set");
			return;
		}
		void handlePatch("visibility", { visibility: v });
	}

	async function handlePasswordConfirm(password: string) {
		setPasswordBusy(true);
		try {
			await onPatch(passwordDialogMode === "set" ? { visibility: "password", password } : { password });
		} finally {
			setPasswordBusy(false);
			setPasswordDialogMode(null);
		}
	}

	return (
		<>
			<Table.Row
				className={`list-item-enter${exiting ? " list-item-exit" : ""}`}
				style={{ "--row-index": Math.min(index, 8) } as CSSProperties}
			>
				{/* No bulk-select for folders -- they delete as a unit via their own button. */}
				<Table.Cell />
				<Table.Cell>
					<div className="truncate-cell">
						<a href={folderHref} className="link-hover bundle-cell">
							<FolderIcon size={16} weight="fill" className="text-kumo-subtle shrink-0" aria-hidden />
							<Text truncate size="sm" bold>
								{bundle.name}
							</Text>
							<span className="bundle-file-count">
								<Text size="xs" variant="secondary">
									{bundle.files.length} {bundle.files.length === 1 ? "file" : "files"}
								</Text>
							</span>
						</a>
					</div>
				</Table.Cell>
				<Table.Cell>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						className="hit-target-square"
						icon={linkCopied ? <CheckIcon /> : <CopySimpleIcon />}
						aria-label={`Copy link to ${bundle.name}`}
						onClick={() => copyLink(`${window.location.origin}${folderHref}`)}
					/>
				</Table.Cell>
				<Table.Cell>
					<Text size="sm" variant="secondary">
						<span className="tabular">{formatBytes(totalSize)}</span>
					</Text>
				</Table.Cell>
				<Table.Cell>
					<div className="truncate-cell-sm">
						<Text truncate size="sm" variant="secondary">
							{bundle.owner}
						</Text>
					</div>
				</Table.Cell>
				<Table.Cell>
					<div className="visibility-cell">
						<Select
							aria-label={`Visibility for ${bundle.name}`}
							size="xs"
							className="select-w-visibility"
							value={bundle.visibility}
							disabled={savingField === "visibility"}
							onValueChange={handleVisibilityChange}
							items={{ private: "Private", password: "Password", public: "Public" }}
						/>
						{bundle.visibility === "password" && (
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								className="hit-target-square"
								icon={<KeyIcon />}
								aria-label={`Change password for ${bundle.name}`}
								onClick={() => setPasswordDialogMode("rotate")}
							/>
						)}
					</div>
				</Table.Cell>
				<Table.Cell>
					<div className="expiry-cell">
						<Text size="sm" variant={expired ? "error" : "secondary"}>
							<span className="tabular">{formatRelativeTime(bundle.expiresAt, now)}</span>
						</Text>
						<ExpiryInfo expiresAt={bundle.expiresAt} now={now} />
					</div>
				</Table.Cell>
				<Table.Cell>
					<Select
						aria-label={`Extend expiry for ${bundle.name}`}
						size="xs"
						className="select-w-expiry"
						placeholder="Extend"
						disabled={savingField === "expiry"}
						onValueChange={(v) => v != null && handlePatch("expiry", { expiresInSeconds: v })}
						items={EXPIRY_OPTIONS}
					/>
				</Table.Cell>
				<Table.Cell>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						className="hit-target-square"
						icon={<TrashIcon />}
						aria-label={`Delete ${bundle.name}`}
						onClick={onDeleteRequest}
					/>
				</Table.Cell>
			</Table.Row>
			<SetPasswordDialog
				mode={passwordDialogMode}
				filename={bundle.name}
				busy={passwordBusy}
				onCancel={() => setPasswordDialogMode(null)}
				onConfirm={handlePasswordConfirm}
			/>
		</>
	);
}
