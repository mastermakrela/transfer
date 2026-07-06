import { Tabs } from "@cloudflare/kumo/components/tabs";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MermaidBlock } from "./MermaidBlock";
import { ResizablePane } from "./ResizablePane";
import { ShikiBlock } from "./ShikiBlock";

type View = "preview" | "source";
const STORAGE_KEY = "transfer:markdown-view";

function readStoredView(): View {
	try {
		return localStorage.getItem(STORAGE_KEY) === "source" ? "source" : "preview";
	} catch {
		return "preview";
	}
}

/** .md/.markdown files get a Preview/Source toggle; the choice is remembered across files via localStorage. */
export function MarkdownPreview({ text }: { text: string }) {
	const [view, setView] = useState<View>(readStoredView);

	function handleChange(value: string) {
		const next: View = value === "source" ? "source" : "preview";
		setView(next);
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// localStorage can throw in locked-down browser contexts -- the tab
			// switcher still works within this page load, it just won't persist.
		}
	}

	return (
		<ResizablePane className="markdown-pane">
			<Tabs
				className="markdown-tabs"
				size="sm"
				tabs={[
					{ value: "preview", label: "Preview" },
					{ value: "source", label: "Source" },
				]}
				value={view}
				onValueChange={handleChange}
			/>
			<div className="markdown-pane-body">
				{view === "preview" ? (
					<div className="markdown-body">
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							components={{
								code(props) {
									const { children, className, node } = props;
									const isBlock = node?.position ? node.position.start.line !== node.position.end.line : false;
									if (!isBlock) return <code className={className}>{children}</code>;
									const match = /language-(\w+)/.exec(className ?? "");
									const lang = match?.[1];
									const code = String(children).replace(/\n$/, "");
									if (lang === "mermaid") return <MermaidBlock code={code} />;
									return <ShikiBlock code={code} lang={lang ?? "text"} />;
								},
								pre({ children }) {
									// The `code` override above already renders the final block markup
									// (Shiki's own <pre> or a mermaid <svg>) -- don't wrap it twice.
									return <>{children}</>;
								},
							}}
						>
							{text}
						</ReactMarkdown>
					</div>
				) : (
					<ShikiBlock code={text} lang="markdown" />
				)}
			</div>
		</ResizablePane>
	);
}
