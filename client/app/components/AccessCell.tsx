import { Button } from "@cloudflare/kumo/components/button";
import { Table } from "@cloudflare/kumo/components/table";
import { Text } from "@cloudflare/kumo/components/text";
import { DownloadSimpleIcon, EyeIcon } from "@phosphor-icons/react";

import type { AccessSummary } from "../lib/api";

interface AccessCellProps {
	/** Undefined until the counters load, or when the link has never been opened. */
	access: AccessSummary | undefined;
	/** File or folder name, for the button's accessible name. */
	name: string;
	onOpenLog: () => void;
}

/**
 * The views/downloads cell the file table grows in telemetry mode (see App.tsx).
 * Shared by FileRow and BundleRow -- both open the same AccessLogDialog.
 */
export function AccessCell({ access, name, onOpenLog }: AccessCellProps) {
	const views = access?.views ?? 0;
	const downloads = access?.downloads ?? 0;
	const untouched = views === 0 && downloads === 0;

	return (
		<Table.Cell>
			<Button
				variant="ghost"
				size="sm"
				className="hit-target-tall access-cell"
				aria-label={`Who opened ${name}`}
				onClick={onOpenLog}
			>
				<Text size="sm" variant={untouched ? "secondary" : "body"}>
					<span className="access-cell-stat">
						<EyeIcon size={14} aria-hidden />
						<span className="tabular">{views}</span>
					</span>
					<span className="access-cell-stat">
						<DownloadSimpleIcon size={14} aria-hidden />
						<span className="tabular">{downloads}</span>
					</span>
				</Text>
			</Button>
		</Table.Cell>
	);
}
