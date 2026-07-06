import { Button } from "@cloudflare/kumo/components/button";
import { Text } from "@cloudflare/kumo/components/text";
import { TrashIcon, XIcon } from "@phosphor-icons/react";

interface BulkActionsBarProps {
	count: number;
	onClear: () => void;
	onDeleteRequest: () => void;
}

export function BulkActionsBar({ count, onClear, onDeleteRequest }: BulkActionsBarProps) {
	if (count === 0) return null;

	return (
		<div className="bulk-actions-bar">
			<Text size="sm">
				<span className="tabular">
					{count} {count === 1 ? "file" : "files"} selected
				</span>
			</Text>
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" className="hit-target-tall" icon={<XIcon />} onClick={onClear}>
					Clear
				</Button>
				<Button
					variant="destructive"
					size="sm"
					className="hit-target-tall"
					icon={<TrashIcon />}
					onClick={onDeleteRequest}
				>
					Delete selected
				</Button>
			</div>
		</div>
	);
}
