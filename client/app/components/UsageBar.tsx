import { Meter } from "@cloudflare/kumo/components/meter";
import { Text } from "@cloudflare/kumo/components/text";

import type { UsageSummary } from "../lib/api";
import { formatBytes } from "../../shared/format";

export function UsageBar({ usage }: { usage: UsageSummary }) {
	const monthPercent =
		usage.monthBudgetBytes > 0 ? Math.min(100, (usage.monthBytesUploaded / usage.monthBudgetBytes) * 100) : 0;

	return (
		<div className="usage-bar">
			<div className="usage-bar-stat">
				<Text variant="secondary" size="xs">
					Current storage
				</Text>
				<Text bold>
					<span className="tabular">{formatBytes(usage.currentBytes)}</span>
				</Text>
				<Text variant="secondary" size="xs">
					<span className="tabular">
						{usage.currentCount} {usage.currentCount === 1 ? "file" : "files"}
					</span>
				</Text>
			</div>
			<div className="usage-bar-meter">
				<Meter
					label="Monthly upload budget"
					value={monthPercent}
					customValue={`${formatBytes(usage.monthBytesUploaded)} / ${formatBytes(usage.monthBudgetBytes)}`}
				/>
				<Text variant="secondary" size="xs">
					<span className="tabular">
						{usage.monthUploadCount} {usage.monthUploadCount === 1 ? "upload" : "uploads"} this month
					</span>
				</Text>
			</div>
		</div>
	);
}
