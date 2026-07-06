import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { useState } from "react";

import { deleteFile } from "../../shared/api";

/** Real Kumo Dialog now that this page is a React app -- replaces the earlier native <dialog> fallback used when this was a plain server-rendered page. */
export function DeleteButton({ id, filename }: { id: string; filename: string }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleConfirm() {
		setBusy(true);
		setError(null);
		try {
			await deleteFile(id);
			window.location.href = "/app";
		} catch {
			setBusy(false);
			setError("Couldn't delete this file. Your session may have expired -- try signing in again at /app.");
		}
	}

	return (
		<Dialog.Root>
			<Dialog.Trigger render={<Button variant="destructive" className="flex-1" />}>Delete</Dialog.Trigger>
			<Dialog className="p-6" size="sm">
				<Dialog.Title className="text-lg font-semibold">Delete &quot;{filename}&quot;?</Dialog.Title>
				<Dialog.Description className="text-kumo-subtle">
					This permanently deletes the file. This can&rsquo;t be undone.
				</Dialog.Description>
				{error && (
					<p className="mt-3 text-sm text-kumo-danger" role="alert">
						{error}
					</p>
				)}
				<div className="mt-6 flex justify-end gap-2">
					<Dialog.Close render={<Button variant="secondary" disabled={busy} />}>Cancel</Dialog.Close>
					<Button variant="destructive" loading={busy} onClick={handleConfirm}>
						Delete
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
