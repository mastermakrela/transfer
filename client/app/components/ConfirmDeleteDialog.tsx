import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { XIcon } from "@phosphor-icons/react";

interface ConfirmDeleteDialogProps {
	/** Filenames pending deletion; dialog is open whenever this is non-null. */
	pending: string[] | null;
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

export function ConfirmDeleteDialog({ pending, busy, onCancel, onConfirm }: ConfirmDeleteDialogProps) {
	const count = pending?.length ?? 0;

	return (
		<Dialog.Root open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
			<Dialog className="p-6" size="sm">
				<div className="dialog-header">
					<Dialog.Title className="text-lg font-semibold">
						Delete {count === 1 ? "file" : `${count} files`}?
					</Dialog.Title>
					<Dialog.Close
						render={(props) => (
							<Button
								{...props}
								aria-label="Close"
								variant="ghost"
								shape="square"
								size="sm"
								className="hit-target-square"
								icon={<XIcon />}
							/>
						)}
					/>
				</div>
				<Dialog.Description className="text-kumo-subtle">
					{count === 1 ? (
						<>
							This permanently deletes <strong>{pending?.[0]}</strong>. This can&rsquo;t be undone.
						</>
					) : (
						<>This permanently deletes {count} files. This can&rsquo;t be undone.</>
					)}
				</Dialog.Description>
				<div className="mt-6 flex justify-end gap-2">
					<Dialog.Close
						render={(props) => (
							<Button {...props} variant="secondary" disabled={busy}>
								Cancel
							</Button>
						)}
					/>
					<Button variant="destructive" loading={busy} onClick={onConfirm}>
						Delete
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
