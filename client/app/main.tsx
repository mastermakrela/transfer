import "@cloudflare/kumo/styles/standalone";
import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { syncKumoColorScheme } from "../shared/syncKumoMode";
import { App } from "./App";

syncKumoColorScheme();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
