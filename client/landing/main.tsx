import "@cloudflare/kumo/styles/standalone";
import "./app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { syncKumoColorScheme } from "../shared/syncKumoMode";
import { LandingApp } from "./LandingApp";
import type { PageData } from "./types";

syncKumoColorScheme();

const dataEl = document.getElementById("transfer-data");
const rootEl = document.getElementById("root");
if (!dataEl || !rootEl) throw new Error("missing #transfer-data or #root element");

const data = JSON.parse(dataEl.textContent ?? "null") as PageData;

createRoot(rootEl).render(
	<StrictMode>
		<LandingApp data={data} />
	</StrictMode>,
);
