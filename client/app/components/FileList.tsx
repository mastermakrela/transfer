import { Empty } from "@cloudflare/kumo/components/empty";
import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import { Table } from "@cloudflare/kumo/components/table";
import { FileIcon } from "@phosphor-icons/react";

import type { FileRecord, Visibility } from "../lib/api";
import { FileRow } from "./FileRow";

interface FileListProps {
	files: FileRecord[] | null;
	now: number;
	selectedIds: Set<string>;
	exitingIds: Set<string>;
	onToggleOne: (id: string) => void;
	onToggleAll: () => void;
	onPatch: (id: string, patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) => Promise<void>;
	onDeleteRequest: (id: string) => void;
}

const HEADER_COLUMNS = ["File", "", "Size", "Owner", "Visibility", "Expires", "", ""];

function SkeletonRows() {
	return (
		<>
			{Array.from({ length: 5 }).map((_, i) => (
				<Table.Row key={i}>
					<Table.Cell colSpan={HEADER_COLUMNS.length + 1}>
						<div className="skeleton-bar animate-pulse" />
					</Table.Cell>
				</Table.Row>
			))}
		</>
	);
}

export function FileList({
	files,
	now,
	selectedIds,
	exitingIds,
	onToggleOne,
	onToggleAll,
	onPatch,
	onDeleteRequest,
}: FileListProps) {
	const isLoading = files === null;
	const isEmpty = files !== null && files.length === 0;
	const allSelected = files !== null && files.length > 0 && files.every((f) => selectedIds.has(f.id));
	const someSelected = files !== null && files.some((f) => selectedIds.has(f.id));

	return (
		<LayerCard className="p-0">
			<div className="overflow-x-auto">
				<Table>
					<Table.Header>
						<Table.Row>
							<Table.CheckHead
								checked={allSelected}
								indeterminate={someSelected && !allSelected}
								onCheckedChange={onToggleAll}
								disabled={isLoading || isEmpty}
								aria-label="Select all files"
							/>
							{HEADER_COLUMNS.map((label, i) => (
								<Table.Head key={i}>{label}</Table.Head>
							))}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{isLoading && <SkeletonRows />}
						{!isLoading &&
							!isEmpty &&
							(files as FileRecord[]).map((file, index) => (
								<FileRow
									key={file.id}
									file={file}
									now={now}
									index={index}
									exiting={exitingIds.has(file.id)}
									selected={selectedIds.has(file.id)}
									onToggle={() => onToggleOne(file.id)}
									onPatch={(patch) => onPatch(file.id, patch)}
									onDeleteRequest={() => onDeleteRequest(file.id)}
								/>
							))}
						{isEmpty && (
							<Table.Row>
								<Table.Cell colSpan={HEADER_COLUMNS.length + 1}>
									<Empty
										size="sm"
										icon={<FileIcon size={40} className="text-kumo-inactive" />}
										title="No files yet"
										description="Upload a file above to get started."
									/>
								</Table.Cell>
							</Table.Row>
						)}
					</Table.Body>
				</Table>
			</div>
		</LayerCard>
	);
}
