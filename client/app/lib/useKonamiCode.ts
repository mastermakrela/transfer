import { useEffect, useRef } from "react";

const SEQUENCE = [
	"ArrowUp",
	"ArrowUp",
	"ArrowDown",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowLeft",
	"ArrowRight",
	"b",
	"a",
];

/**
 * Fires when ↑↑↓↓←→←→BA is typed on the page -- the entry point to telemetry mode
 * (see App.tsx). Keeping the access log behind a key sequence rather than a button is
 * the point: the numbers exist for the rare "did they ever open it" question, and a
 * permanent column would turn every file list into a dashboard.
 */
export function useKonamiCode(onUnlock: () => void): void {
	// Held in a ref so the listener is attached exactly once and never sees a stale
	// closure, even though the callback below it re-creates on every render.
	const handler = useRef(onUnlock);
	handler.current = onUnlock;

	useEffect(() => {
		let progress = 0;

		function onKeyDown(event: KeyboardEvent) {
			// Never eat keystrokes meant for a field -- typing "banana" into the password
			// dialog shouldn't be advancing a secret sequence behind it.
			const target = event.target as HTMLElement | null;
			if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) {
				progress = 0;
				return;
			}

			const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
			if (key === SEQUENCE[progress]) {
				progress += 1;
			} else {
				// Restart rather than reset, so a stutter (↑↑↑↓↓…) still lands on the
				// tenth key instead of silently dead-ending.
				progress = key === SEQUENCE[0] ? 1 : 0;
			}

			if (progress === SEQUENCE.length) {
				progress = 0;
				handler.current();
			}
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
