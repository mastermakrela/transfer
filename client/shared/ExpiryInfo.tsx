import { ClipboardText } from "@cloudflare/kumo/components/clipboard-text";
import { Popover } from "@cloudflare/kumo/components/popover";
import { InfoIcon } from "@phosphor-icons/react";

import { formatRelativeTime } from "./format";

const UTC_FORMATTER = new Intl.DateTimeFormat("en-GB", {
	timeZone: "UTC",
	day: "2-digit",
	month: "short",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

/** Rich expiry detail popover -- UTC / Relative / Timestamp(+copy), mirroring the Cloudflare dashboard's timestamp tooltip. */
export function ExpiryInfo({ expiresAt, now }: { expiresAt: number; now: number }) {
	const date = new Date(expiresAt);
	const iso = date.toISOString();

	return (
		<Popover>
			<Popover.Trigger
				render={
					<button type="button" className="expiry-info-trigger hit-target-square" aria-label="Expiry details">
						<InfoIcon size={13} weight="bold" />
					</button>
				}
			/>
			<Popover.Content align="end" className="expiry-popover">
				<div className="expiry-popover-row">
					<span className="expiry-popover-label">UTC</span>
					<span className="tabular">{UTC_FORMATTER.format(date)}</span>
				</div>
				<div className="expiry-popover-row">
					<span className="expiry-popover-label">Relative</span>
					<span className="tabular">{formatRelativeTime(expiresAt, now)}</span>
				</div>
				<div className="expiry-popover-row">
					<span className="expiry-popover-label">Timestamp</span>
					<ClipboardText text={iso} size="sm" tooltip={{ text: "Copy", copiedText: "Copied" }} />
				</div>
			</Popover.Content>
		</Popover>
	);
}
