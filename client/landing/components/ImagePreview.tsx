import { useRef, useState } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * Trackpad-friendly zoom/pan: pinch (wheel + ctrlKey, how browsers report trackpad
 * pinch gestures) to zoom, two-finger scroll to pan once zoomed, double-click to
 * toggle, click-drag also pans.
 *
 * A smaller-than-viewport image renders at its natural size at rest (that's fine),
 * but the first zoom-in tick jumps straight to "cover" -- filling the available
 * space with no padding -- rather than growing gradually and leaving visible
 * padding around the image for a while. Further zooming crops in beyond that.
 */
export function ImagePreview({ src, alt }: { src: string; alt: string }) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const [scale, setScale] = useState(1);
	const [origin, setOrigin] = useState({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const panStart = useRef({ x: 0, y: 0, originX: 0, originY: 0 });

	function reset() {
		setScale(1);
		setOrigin({ x: 0, y: 0 });
	}

	/** Scale (relative to the image's at-rest size) needed to fill the wrap with no padding. */
	function coverScale(): number {
		const wrap = wrapRef.current;
		const img = imgRef.current;
		if (!wrap || !img || img.offsetWidth === 0 || img.offsetHeight === 0) return 1;
		// offsetWidth/Height reflect the pre-transform layout size -- unaffected by
		// the CSS `transform: scale()` already applied, unlike getBoundingClientRect().
		return Math.max(wrap.clientWidth / img.offsetWidth, wrap.clientHeight / img.offsetHeight, 1);
	}

	function handleWheel(e: React.WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			const zoomingIn = e.deltaY < 0;
			setScale((prev) => {
				const cover = coverScale();
				const maxScale = Math.max(MAX_SCALE, cover * 3);
				let next: number;
				if (prev <= MIN_SCALE && zoomingIn && cover > MIN_SCALE) {
					// First tick: fill the viewport before any further zoom starts cropping.
					next = Math.max(cover, prev * (1 - e.deltaY * 0.01));
				} else {
					next = prev * (1 - e.deltaY * 0.01);
				}
				next = Math.min(maxScale, Math.max(MIN_SCALE, next));
				if (next === MIN_SCALE) setOrigin({ x: 0, y: 0 });
				return next;
			});
		} else if (scale > 1) {
			setOrigin((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
		}
	}

	function handlePointerDown(e: React.PointerEvent) {
		if (scale <= 1) return;
		setIsPanning(true);
		panStart.current = { x: e.clientX, y: e.clientY, originX: origin.x, originY: origin.y };
		wrapRef.current?.setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: React.PointerEvent) {
		if (!isPanning) return;
		setOrigin({
			x: panStart.current.originX + (e.clientX - panStart.current.x),
			y: panStart.current.originY + (e.clientY - panStart.current.y),
		});
	}

	return (
		<div
			ref={wrapRef}
			className={`preview-zoom-wrap${scale > 1 ? " zoomed" : ""}${isPanning ? " panning" : ""}`}
			onWheel={handleWheel}
			onDoubleClick={() => (scale > 1 ? reset() : setScale(Math.max(2, coverScale())))}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={() => setIsPanning(false)}
			onPointerCancel={() => setIsPanning(false)}
		>
			<img
				ref={imgRef}
				className="preview-media"
				src={src}
				alt={alt}
				style={{ transform: `translate(${origin.x}px, ${origin.y}px) scale(${scale})` }}
			/>
		</div>
	);
}
