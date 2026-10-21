import { Table } from "@cloudflare/kumo/components/table";
import { Select } from "@cloudflare/kumo/components/select";
import { Text } from "@cloudflare/kumo/components/text";
import { Button } from "@cloudflare/kumo/components/button";
import { CheckIcon, CopySimpleIcon, EyeIcon, EyeSlashIcon, KeyIcon, TrashIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode } from "react";

import type { AccessSummary, Visibility } from "../lib/api";
import { AccessCell } from "./AccessCell";
import { ExpiryInfo } from "../../shared/ExpiryInfo";
import { EXPIRY_OPTIONS } from "../../shared/expiry-options";
import { formatBytes, formatRelativeTime } from "../../shared/format";
import { SetPasswordDialog } from "../../shared/SetPasswordDialog";
import { useGateControls, type Patch } from "../lib/useGateControls";

interface GateRowProps {
	/** File or folder name, used to build aria-labels and the password dialog title. */
	entityName: string;
	/** Download or folder link, used by the copy-link button. */
	href: string;
	/** Leading cell: the select checkbox for files, an empty cell for bundles. */
	leading: ReactNode;
	/** Contents of the name cell: a plain link for files, a folder icon + file count for bundles. */
	name: ReactNode;
	size: number;
	owner: string;
	visibility: Visibility;
	password?: string;
	expiresAt: number;
	now: number;
	/** Whether the row is currently selected (files only; bundles are never selectable). */
	selected?: boolean;
	/** Position in the list, used to stagger the enter animation (capped by the caller). */
	index: number;
	/** True while the row is playing its exit animation, just before being spliced out. */
	exiting: boolean;
	/** Whether the hidden telemetry mode is on -- adds the views/downloads cell. */
	telemetry: boolean;
	access: AccessSummary | undefined;
	onPatch: (patch: Patch) => Promise<void>;
	onDeleteRequest: () => void;
	onOpenLog: () => void;
}

export function GateRow({
	entityName,
	href,
	leading,
	name,
	size,
	owner,
	visibility,
	password,
	expiresAt,
	now,
	selected = false,
	index,
	exiting,
	telemetry,
	access,
	onPatch,
	onDeleteRequest,
	onOpenLog,
}: GateRowProps) {
	const {
		savingField,
		passwordDialogMode,
		passwordBusy,
		passwordRevealed,
		linkCopied,
		copyLink,
		passwordCopied,
		copyPassword,
		setPasswordDialogMode,
		setPasswordRevealed,
		handlePatch,
		handleVisibilityChange,
		handlePasswordConfirm,
	} = useGateControls(onPatch, visibility);

	const expired = expiresAt <= now;

	return (
		<>
			<Table.Row
				variant={selected ? "selected" : "default"}
				className={`list-item-enter${exiting ? " list-item-exit" : ""}`}
				style={{ "--row-index": Math.min(index, 8) } as CSSProperties}
			>
				{leading}
				<Table.Cell>
					<div className="truncate-cell">{name}</div>
				</Table.Cell>
				<Table.Cell>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						className="hit-target-square"
						icon={linkCopied ? <CheckIcon /> : <CopySimpleIcon />}
						aria-label={`Copy link to ${entityName}`}
						onClick={() => copyLink(`${window.location.origin}${href}`)}
					/>
				</Table.Cell>
				<Table.Cell>
					<Text size="sm" variant="secondary">
						<span className="tabular">{formatBytes(size)}</span>
					</Text>
				</Table.Cell>
				<Table.Cell>
					<div className="truncate-cell-sm">
						<Text truncate size="sm" variant="secondary">
							{owner}
						</Text>
					</div>
				</Table.Cell>
				{telemetry && <AccessCell access={access} name={entityName} onOpenLog={onOpenLog} />}
				<Table.Cell>
					<div className="visibility-cell">
						<Select
							aria-label={`Visibility for ${entityName}`}
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
								aria-label={`Change password for ${entityName}`}
								onClick={() => setPasswordDialogMode("rotate")}
							/>
						)}
						{visibility === "password" && password && (
							<>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									className="hit-target-square"
									icon={passwordCopied ? <CheckIcon /> : <CopySimpleIcon />}
									aria-label={`Copy password for ${entityName}`}
									onClick={() => copyPassword(password ?? "")}
								/>
								<Button
									variant="ghost"
									size="sm"
									className="password-reveal"
									icon={passwordRevealed ? <EyeSlashIcon /> : <EyeIcon />}
									aria-label={passwordRevealed ? "Hide password" : "Show password"}
									onClick={() => setPasswordRevealed((v) => !v)}
								>
									<span className="tabular">{passwordRevealed ? password : "••••••"}</span>
								</Button>
							</>
						)}
					</div>
				</Table.Cell>
				<Table.Cell>
					<div className="expiry-cell">
						<Text size="sm" variant={expired ? "error" : "secondary"}>
							<span className="tabular">{formatRelativeTime(expiresAt, now)}</span>
						</Text>
						<ExpiryInfo expiresAt={expiresAt} now={now} />
					</div>
				</Table.Cell>
				<Table.Cell>
					<Select
						aria-label={`Extend expiry for ${entityName}`}
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
						aria-label={`Delete ${entityName}`}
						onClick={onDeleteRequest}
					/>
				</Table.Cell>
			</Table.Row>
			<SetPasswordDialog
				mode={passwordDialogMode}
				filename={entityName}
				busy={passwordBusy}
				teamVisible
				onCancel={() => setPasswordDialogMode(null)}
				onConfirm={handlePasswordConfirm}
			/>
		</>
	);
}
