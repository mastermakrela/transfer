import { type ReactNode, useRef, useState } from "react";

const STORAGE_KEY = "transfer:preview-pane-width";
const MIN_WIDTH = 320;

function readStoredWidth(): number | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const n = raw ? Number(raw) : NaN;
		return Number.isFinite(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

/**
 * Wraps the markdown/text preview card with a drag-to-resize right edge --
 * no visible handle, just an ew-resize cursor over a thin hit zone (native
 * CSS `resize` puts an ugly grabber in the bottom-right corner instead).
 * Width is remembered across files/reloads via localStorage; unset until the
 * user actually drags, so the card fills the available space by default.
 */
export function ResizablePane({ className, children }: { className: string; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(readStoredWidth);
	const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect) return;
		dragState.current = { startX: e.clientX, startWidth: rect.width };
		setIsDragging(true);
		e.currentTarget.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
		if (!dragState.current) return;
		setWidth(Math.max(MIN_WIDTH, dragState.current.startWidth + (e.clientX - dragState.current.startX)));
	}

	function handlePointerUp() {
		if (!dragState.current) return;
		dragState.current = null;
		setIsDragging(false);
		setWidth((current) => {
			if (current != null) {
				try {
					localStorage.setItem(STORAGE_KEY, String(Math.round(current)));
				} catch {
					// localStorage can throw in locked-down browser contexts -- the
					// resize still works within this page load, it just won't persist.
				}
			}
			return current;
		});
	}

	return (
		<div
			ref={ref}
			className={`${className} resizable-pane${isDragging ? " resizing" : ""}`}
			style={width != null ? { width, flex: "none" } : undefined}
		>
			{children}
			<div
				className="resize-edge"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			/>
		</div>
	);
}
