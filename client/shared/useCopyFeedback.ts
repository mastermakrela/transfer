import { useEffect, useRef, useState } from "react";

const COPIED_RESET_MS = 1400;

/** Copies text to the clipboard and flips `copied` true for a moment, for the "copied!" icon/label swap. */
export function useCopyFeedback() {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(timerRef.current), []);

	function copy(text: string) {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
		});
	}

	return { copied, copy };
}
