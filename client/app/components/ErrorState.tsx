import { Empty } from "@cloudflare/kumo/components/empty";
import { Button } from "@cloudflare/kumo/components/button";
import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<Empty
			size="lg"
			icon={<WarningIcon size={48} className="text-kumo-danger" />}
			title="Couldn't load files"
			description={message}
			contents={
				<Button icon={<ArrowClockwiseIcon />} onClick={onRetry}>
					Retry
				</Button>
			}
		/>
	);
}
