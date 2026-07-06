/**
 * Renders an uploaded HTML file live, filling the preview pane. Sandboxed
 * without allow-same-origin: scripts in the uploaded page still run (needed
 * for genuinely interactive HTML exports), but it gets a unique opaque
 * origin with no access to this app's cookies, localStorage, or DOM --
 * a self-XSS guard against an arbitrary uploaded HTML file rather than a
 * trusted first-party page.
 */
export function HtmlPreview({ src, title }: { src: string; title: string }) {
	return <iframe className="preview-iframe" src={src} title={title} sandbox="allow-scripts allow-forms allow-popups" />;
}
