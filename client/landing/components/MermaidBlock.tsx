import { useEffect, useId, useState } from "react";

type MermaidState = { svg: string } | { error: string } | null;

/** Dynamically imported (code-split) so plain text/other-markdown previews never pay for mermaid's bundle size. */
export function MermaidBlock({ code }: { code: string }) {
	const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
	const id = `mermaid-${rawId}`;
	const [state, setState] = useState<MermaidState>(null);

	useEffect(() => {
		let cancelled = false;
		import("mermaid").then(async (mod) => {
			const mermaid = mod.default;
			mermaid.initialize({
				startOnLoad: false,
				theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
			});
			try {
				const { svg } = await mermaid.render(id, code);
				if (!cancelled) setState({ svg });
			} catch (err) {
				if (!cancelled) setState({ error: err instanceof Error ? err.message : "failed to render diagram" });
			}
		});
		return () => {
			cancelled = true;
		};
	}, [code, id]);

	if (state === null) {
		return <div className="mermaid-loading">Rendering diagram…</div>;
	}
	if ("error" in state) {
		return (
			<div className="mermaid-error">
				<p>Couldn&rsquo;t render this diagram.</p>
				<pre>
					<code>{code}</code>
				</pre>
			</div>
		);
	}
	// mermaid.render's SVG output, not user-controlled markup.
	return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
