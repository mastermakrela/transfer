import { codeToHtml } from "shiki";

/**
 * Same rendering engine VS Code and Monaco use for tokenization, without the
 * editor chrome -- the right size for a read-only preview instead of pulling
 * in a full editor bundle just to display highlighted text.
 *
 * Dual light/dark output via CSS variables (defaultColor: false) -- see the
 * `.shiki` rules in app.css for the corresponding `prefers-color-scheme`
 * switch. No JS theme toggle needed, consistent with the rest of the app.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
	try {
		return await codeToHtml(code, {
			lang,
			themes: { light: "github-light", dark: "github-dark" },
			defaultColor: false,
		});
	} catch {
		// Unrecognized language (arbitrary fenced-code-block languages in markdown
		// can be anything) -- fall back to plain, still-themed text rather than
		// breaking the preview.
		try {
			return await codeToHtml(code, {
				lang: "text",
				themes: { light: "github-light", dark: "github-dark" },
				defaultColor: false,
			});
		} catch {
			return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
		}
	}
}

function escapeHtml(input: string): string {
	return input
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Extension -> Shiki language id, for files without a reliable browser-reported contentType. */
export function languageFromExtension(extension: string): string {
	const map: Record<string, string> = {
		md: "markdown",
		markdown: "markdown",
		txt: "text",
		log: "text",
		csv: "text",
		json: "json",
		yml: "yaml",
		yaml: "yaml",
	};
	return map[extension.toLowerCase()] ?? "text";
}
