import { Empty } from "@cloudflare/kumo/components/empty";
import { LayerCard } from "@cloudflare/kumo/components/layer-card";
import { Table } from "@cloudflare/kumo/components/table";
import { FileIcon } from "@phosphor-icons/react";

import type { AccessSummary, BundleRecord, FileRecord, Visibility } from "../lib/api";
import { BundleRow } from "./BundleRow";
import { FileRow } from "./FileRow";

type Patch = { visibility?: Visibility; expiresInSeconds?: number; password?: string };

interface FileListProps {
	files: FileRecord[] | null;
	bundles: BundleRecord[] | null;
	now: number;
	selectedIds: Set<string>;
	exitingIds: Set<string>;
	/** Hidden telemetry mode (see App.tsx) -- adds the "Opens" column to every row. */
	telemetry: boolean;
	accessById: Record<string, AccessSummary>;
	onToggleOne: (id: string) => void;
	onToggleAll: () => void;
	onPatch: (id: string, patch: Patch) => Promise<void>;
	onDeleteRequest: (id: string) => void;
	onOpenLog: (target: { id: string; name: string }) => void;
	onBundlePatch: (id: string, patch: Patch) => Promise<void>;
	onBundleDeleteRequest: (id: string) => void;
}

const BASE_COLUMNS = ["File", "", "Size", "Owner", "Visibility", "Expires", "", ""];

/** Column labels for the current mode; "Opens" slots in after Owner when telemetry is on. */
function headerColumns(telemetry: boolean): string[] {
	if (!telemetry) return BASE_COLUMNS;
	const at = BASE_COLUMNS.indexOf("Visibility");
	return [...BASE_COLUMNS.slice(0, at), "Opens", ...BASE_COLUMNS.slice(at)];
}

function SkeletonRows({ columnCount }: { columnCount: number }) {
	return (
		<>
			{Array.from({ length: 5 }).map((_, i) => (
				<Table.Row key={i}>
					<Table.Cell colSpan={columnCount}>
						<div className="skeleton-bar animate-pulse" />
					</Table.Cell>
				</Table.Row>
			))}
		</>
	);
}

export function FileList({
	files,
	bundles,
	now,
	selectedIds,
	exitingIds,
	telemetry,
	accessById,
	onToggleOne,
	onToggleAll,
	onPatch,
	onDeleteRequest,
	onOpenLog,
	onBundlePatch,
	onBundleDeleteRequest,
}: FileListProps) {
	const isLoading = files === null;
	const bundleList = bundles ?? [];
	const isEmpty = files !== null && files.length === 0 && bundleList.length === 0;
	const allSelected = files !== null && files.length > 0 && files.every((f) => selectedIds.has(f.id));
	const someSelected = files !== null && files.some((f) => selectedIds.has(f.id));
	const columns = headerColumns(telemetry);
	// +1 for the leading checkbox column, which isn't part of `columns`.
	const columnCount = columns.length + 1;

	return (
		<LayerCard className={`p-0${telemetry ? " telemetry-card" : ""}`}>
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
							{columns.map((label, i) => (
								<Table.Head key={i}>{label}</Table.Head>
							))}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{isLoading && <SkeletonRows columnCount={columnCount} />}
						{!isLoading &&
							bundleList.map((bundle, index) => (
								<BundleRow
									key={bundle.id}
									bundle={bundle}
									now={now}
									index={index}
									exiting={false}
									telemetry={telemetry}
									access={accessById[bundle.id]}
									onPatch={(patch) => onBundlePatch(bundle.id, patch)}
									onDeleteRequest={() => onBundleDeleteRequest(bundle.id)}
									onOpenLog={() => onOpenLog({ id: bundle.id, name: bundle.name })}
								/>
							))}
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
									telemetry={telemetry}
									access={accessById[file.id]}
									onToggle={() => onToggleOne(file.id)}
									onPatch={(patch) => onPatch(file.id, patch)}
									onDeleteRequest={() => onDeleteRequest(file.id)}
									onOpenLog={() => onOpenLog({ id: file.id, name: file.filename })}
								/>
							))}
						{isEmpty && (
							<Table.Row>
								<Table.Cell colSpan={columnCount}>
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
