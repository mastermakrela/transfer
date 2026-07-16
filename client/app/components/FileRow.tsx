import { Table } from "@cloudflare/kumo/components/table";
import { Select } from "@cloudflare/kumo/components/select";
import { Text } from "@cloudflare/kumo/components/text";
import { Button } from "@cloudflare/kumo/components/button";
import { CheckIcon, CopySimpleIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react";
import { useState, type CSSProperties } from "react";

import type { FileRecord, Visibility } from "../lib/api";
import { ExpiryInfo } from "../../shared/ExpiryInfo";
import { EXPIRY_OPTIONS } from "../../shared/expiry-options";
import { formatBytes, formatRelativeTime } from "../../shared/format";
import { SetPasswordDialog } from "../../shared/SetPasswordDialog";
import { useCopyFeedback } from "../../shared/useCopyFeedback";

interface FileRowProps {
	file: FileRecord;
	now: number;
	selected: boolean;
	/** Position in the list, used to stagger the enter animation (capped by the caller). */
	index: number;
	/** True while the row is playing its exit animation, just before being spliced out. */
	exiting: boolean;
	onToggle: () => void;
	onPatch: (patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) => Promise<void>;
	onDeleteRequest: () => void;
}

export function FileRow({ file, now, selected, index, exiting, onToggle, onPatch, onDeleteRequest }: FileRowProps) {
	const [savingField, setSavingField] = useState<"visibility" | "expiry" | null>(null);
	const [passwordDialogMode, setPasswordDialogMode] = useState<"set" | "rotate" | null>(null);
	const [passwordBusy, setPasswordBusy] = useState(false);
	const { copied: linkCopied, copy: copyLink } = useCopyFeedback();
	const downloadHref = `/d/${file.id}/${encodeURIComponent(file.filename)}`;
	const expired = file.expiresAt <= now;

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
		if (!v || v === file.visibility) return;
		if (v === "password") {
			setPasswordDialogMode("set");
			return;
		}
		void handlePatch("visibility", { visibility: v });
	}

	async function handlePasswordConfirm(password: string) {
		setPasswordBusy(true);
		try {
			if (passwordDialogMode === "set") {
				await onPatch({ visibility: "password", password });
			} else {
				await onPatch({ password });
			}
		} finally {
			setPasswordBusy(false);
			setPasswordDialogMode(null);
		}
	}

	return (
		<>
			<Table.Row
				variant={selected ? "selected" : "default"}
				className={`list-item-enter${exiting ? " list-item-exit" : ""}`}
				style={{ "--row-index": Math.min(index, 8) } as CSSProperties}
			>
				<Table.CheckCell checked={selected} onCheckedChange={onToggle} aria-label={`Select ${file.filename}`} />
				<Table.Cell>
					<div className="truncate-cell">
						<a href={downloadHref} className="link-hover">
							<Text truncate size="sm">
								{file.filename}
							</Text>
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
						aria-label={`Copy link to ${file.filename}`}
						onClick={() => copyLink(`${window.location.origin}${downloadHref}`)}
					/>
				</Table.Cell>
				<Table.Cell>
					<Text size="sm" variant="secondary">
						<span className="tabular">{formatBytes(file.size)}</span>
					</Text>
				</Table.Cell>
				<Table.Cell>
					<div className="truncate-cell-sm">
						<Text truncate size="sm" variant="secondary">
							{file.owner}
						</Text>
					</div>
				</Table.Cell>
				<Table.Cell>
					<div className="visibility-cell">
						<Select
							aria-label={`Visibility for ${file.filename}`}
							size="xs"
							className="select-w-visibility"
							value={file.visibility}
							disabled={savingField === "visibility"}
							onValueChange={handleVisibilityChange}
							items={{ private: "Private", password: "Password", public: "Public" }}
						/>
						{file.visibility === "password" && (
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								className="hit-target-square"
								icon={<KeyIcon />}
								aria-label={`Change password for ${file.filename}`}
								onClick={() => setPasswordDialogMode("rotate")}
							/>
						)}
					</div>
				</Table.Cell>
				<Table.Cell>
					<div className="expiry-cell">
						<Text size="sm" variant={expired ? "error" : "secondary"}>
							<span className="tabular">{formatRelativeTime(file.expiresAt, now)}</span>
						</Text>
						<ExpiryInfo expiresAt={file.expiresAt} now={now} />
					</div>
				</Table.Cell>
				<Table.Cell>
					<Select
						aria-label={`Extend expiry for ${file.filename}`}
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
						aria-label={`Delete ${file.filename}`}
						onClick={onDeleteRequest}
					/>
				</Table.Cell>
			</Table.Row>
			<SetPasswordDialog
				mode={passwordDialogMode}
				filename={file.filename}
				busy={passwordBusy}
				onCancel={() => setPasswordDialogMode(null)}
				onConfirm={handlePasswordConfirm}
			/>
		</>
	);
}
