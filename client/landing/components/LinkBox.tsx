import { CheckIcon, CopySimpleIcon } from "@phosphor-icons/react";

import { useCopyFeedback } from "../../shared/useCopyFeedback";

/** Full link written out, click-anywhere-on-it to copy (per explicit design ask -- not a separate "copy" button). */
export function LinkBox({ url }: { url: string }) {
	const { copied, copy } = useCopyFeedback();

	return (
		<div
			className={`link-box${copied ? " copied" : ""}`}
			role="button"
			tabIndex={0}
			onClick={() => copy(url)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					copy(url);
				}
			}}
		>
			<span className="link-box-text">{url}</span>
			<span className="link-box-icon">{copied ? <CheckIcon size={14} /> : <CopySimpleIcon size={14} />}</span>
		</div>
	);
}
