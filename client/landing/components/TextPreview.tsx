import { languageFromExtension } from "../../shared/highlight";
import { ResizablePane } from "./ResizablePane";
import { ShikiBlock } from "./ShikiBlock";

/** Non-markdown text-like files (txt/log/csv/json/yaml) -- a single syntax-highlighted view, no preview/source split since there's no separate rendered form. */
export function TextPreview({ text, extension }: { text: string; extension: string }) {
	return (
		<ResizablePane className="text-pane">
			<ShikiBlock code={text} lang={languageFromExtension(extension)} />
		</ResizablePane>
	);
}
