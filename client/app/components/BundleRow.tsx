import { Table } from "@cloudflare/kumo/components/table";
import { Text } from "@cloudflare/kumo/components/text";
import { FolderIcon } from "@phosphor-icons/react";

import type { AccessSummary, BundleRecord, Visibility } from "../lib/api";
import { GateRow } from "./GateRow";

interface BundleRowProps {
	bundle: BundleRecord;
	now: number;
	/** Position in the list, used to stagger the enter animation (capped by the caller). */
	index: number;
	/** Whether the hidden telemetry mode is on -- adds the views/downloads cell. */
	telemetry: boolean;
	access: AccessSummary | undefined;
	onPatch: (patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) => Promise<void>;
	onDeleteRequest: () => void;
	onOpenLog: () => void;
}

export function BundleRow({ bundle, now, index, telemetry, access, onPatch, onDeleteRequest, onOpenLog }: BundleRowProps) {
	const folderHref = `/f/${bundle.id}`;
	const totalSize = bundle.files.reduce((sum, f) => sum + f.size, 0);

	return (
		<GateRow
			entityName={bundle.name}
			href={folderHref}
			// No bulk-select for folders -- they delete as a unit via their own button.
			leading={<Table.Cell />}
			name={
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
			}
			size={totalSize}
			owner={bundle.owner}
			visibility={bundle.visibility}
			password={bundle.password}
			expiresAt={bundle.expiresAt}
			now={now}
			index={index}
			// Folders never play the exit animation -- they're removed via their own confirm dialog, not the bulk-delete flow.
			exiting={false}
			telemetry={telemetry}
			access={access}
			onPatch={onPatch}
			onDeleteRequest={onDeleteRequest}
			onOpenLog={onOpenLog}
		/>
	);
}
