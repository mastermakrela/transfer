/**
 * Kumo's dark-mode tokens are gated behind a `[data-mode="dark"]` attribute --
 * its `light-dark()` CSS fallback is overridden by later plain-value
 * declarations for several tokens (recessed/base surfaces among them), so it
 * does not actually auto-follow `prefers-color-scheme` on its own. This keeps
 * the attribute in sync with the OS preference so Kumo behaves like the
 * automatic (no manual toggle) light/dark app this project wants.
 */
export function syncKumoColorScheme(): void {
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const apply = () => {
		document.documentElement.dataset.mode = media.matches ? "dark" : "light";
	};
	apply();
	media.addEventListener("change", apply);
}
