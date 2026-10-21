import { Table } from "@cloudflare/kumo/components/table";
import { Text } from "@cloudflare/kumo/components/text";

import type { AccessSummary, FileRecord, Visibility } from "../lib/api";
import { GateRow } from "./GateRow";

interface FileRowProps {
	file: FileRecord;
	now: number;
	selected: boolean;
	/** Position in the list, used to stagger the enter animation (capped by the caller). */
	index: number;
	/** True while the row is playing its exit animation, just before being spliced out. */
	exiting: boolean;
	/** Whether the hidden telemetry mode is on -- adds the views/downloads cell. */
	telemetry: boolean;
	access: AccessSummary | undefined;
	onToggle: () => void;
	onPatch: (patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) => Promise<void>;
	onDeleteRequest: () => void;
	onOpenLog: () => void;
}

export function FileRow({
	file,
	now,
	selected,
	index,
	exiting,
	telemetry,
	access,
	onToggle,
	onPatch,
	onDeleteRequest,
	onOpenLog,
}: FileRowProps) {
	const downloadHref = `/d/${file.id}/${encodeURIComponent(file.filename)}`;

	return (
		<GateRow
			entityName={file.filename}
			href={downloadHref}
			leading={
				<Table.CheckCell checked={selected} onCheckedChange={onToggle} aria-label={`Select ${file.filename}`} />
			}
			name={
				<a href={downloadHref} className="link-hover">
					<Text truncate size="sm">
						{file.filename}
					</Text>
				</a>
			}
			size={file.size}
			owner={file.owner}
			visibility={file.visibility}
			password={file.password}
			expiresAt={file.expiresAt}
			now={now}
			selected={selected}
			index={index}
			exiting={exiting}
			telemetry={telemetry}
			access={access}
			onPatch={onPatch}
			onDeleteRequest={onDeleteRequest}
			onOpenLog={onOpenLog}
		/>
	);
}
