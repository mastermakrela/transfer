import { useEffect, useState } from "react";

import { highlightCode } from "../../shared/highlight";

export function ShikiBlock({ code, lang }: { code: string; lang: string }) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		highlightCode(code, lang).then((h) => {
			if (!cancelled) setHtml(h);
		});
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	if (html === null) {
		return (
			<pre className="shiki-loading">
				<code>{code}</code>
			</pre>
		);
	}
	// Shiki's output is HTML it generated itself (escaped/tokenized), not user-controlled markup.
	return <div className="shiki-wrap" dangerouslySetInnerHTML={{ __html: html }} />;
}
