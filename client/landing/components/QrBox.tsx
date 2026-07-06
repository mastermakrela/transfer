/** SVG string is generated server-side (qrcode package, pure JS, works fine in Workers) and passed through as-is -- no client-side QR dependency needed. */
export function QrBox({ svg }: { svg: string }) {
	return (
		<div className="qr-box">
			{/* biome-ignore lint: server-generated QR SVG, not user-controlled HTML */}
			<div className="qr-box-svg" dangerouslySetInnerHTML={{ __html: svg }} />
			<p>Scan to open this page on another device.</p>
		</div>
	);
}
