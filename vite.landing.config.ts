import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Builds client/landing/ into public/landing/ with FIXED (non-hashed)
// filenames -- unlike /app, this bundle is loaded from an HTML shell that
// src/routes/download.ts renders per-request (dynamic, per-file data), so the
// Worker needs a predictable path to reference rather than a content hash
// looked up from a manifest.
export default defineConfig({
	base: "/landing/",
	// Vite's default publicDir ("public/", relative to the project root since this config
	// has no `root` override) is the SAME top-level public/ this build writes into --
	// without disabling it, every build copies the whole existing public/ tree (including
	// public/app/'s bundle and the root index.html) into public/landing/ as a side effect.
	publicDir: false,
	plugins: [react()],
	build: {
		outDir: "public/landing",
		emptyOutDir: true,
		rollupOptions: {
			input: "client/landing/main.tsx",
			output: {
				entryFileNames: "bundle.js",
				chunkFileNames: "chunk-[hash].js",
				assetFileNames: "bundle.[ext]",
			},
		},
	},
});
