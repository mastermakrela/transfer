import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds client/app/ (a plain React app) into public/app/, which Cloudflare
// Workers Assets then serves as static files -- see CLAUDE.md for why the
// Worker itself is never involved in serving /app's HTML/JS/CSS.
export default defineConfig({
	root: "client/app",
	base: "/app/",
	plugins: [react()],
	build: {
		outDir: "../../public/app",
		emptyOutDir: true,
	},
	server: {
		// `wrangler dev` (the real API) runs separately on :8787; `vite dev` only
		// serves the UI with HMR and proxies API calls through to it. Auth will
		// 401 locally without a real Access session -- expected, see README.
		proxy: {
			"/app/api": "http://localhost:8787",
		},
	},
});
