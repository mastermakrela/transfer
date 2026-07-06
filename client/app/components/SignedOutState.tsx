import { Empty } from "@cloudflare/kumo/components/empty";
import { Button } from "@cloudflare/kumo/components/button";
import { LockIcon, ArrowClockwiseIcon } from "@phosphor-icons/react";

export function SignedOutState({ onRetry }: { onRetry: () => void }) {
	return (
		<Empty
			size="lg"
			icon={<LockIcon size={48} className="text-kumo-inactive" />}
			title="Sign in required"
			description="This page requires an active Cloudflare Access session. In local dev without one, the API returns 401 -- that's expected. Sign in via Cloudflare Access and reload, or retry once your session is active."
			contents={
				<Button icon={<ArrowClockwiseIcon />} onClick={onRetry}>
					Retry
				</Button>
			}
		/>
	);
}
