import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { SensitiveInput } from "@cloudflare/kumo/components/sensitive-input";
import { useState } from "react";

interface SetPasswordDialogProps {
	/** null = closed; "set" = switching visibility to password; "rotate" = already password-protected, just changing it. */
	mode: "set" | "rotate" | null;
	filename: string | null;
	busy: boolean;
	/**
	 * Shows the "team members can see this later" note. Only /app (behind Cloudflare
	 * Access) passes this -- the landing page also renders this dialog for
	 * Access-authorized visitors changing a file's password, but that surface doubles
	 * as the public download page and must not imply team visibility.
	 */
	teamVisible?: boolean;
	onCancel: () => void;
	onConfirm: (password: string) => void;
}

export function SetPasswordDialog({ mode, filename, busy, teamVisible, onCancel, onConfirm }: SetPasswordDialogProps) {
	const [password, setPassword] = useState("");

	function handleOpenChange(open: boolean) {
		if (!open) {
			setPassword("");
			onCancel();
		}
	}

	return (
		<Dialog.Root open={mode !== null} onOpenChange={handleOpenChange}>
			<Dialog className="p-6" size="sm">
				<Dialog.Title className="text-lg font-semibold">
					{mode === "rotate" ? "Change password" : "Set a password"}
				</Dialog.Title>
				<Dialog.Description className="text-kumo-subtle">
					Anyone with the link and this password can download &quot;{filename}&quot;.
				</Dialog.Description>
				<div className="mt-4">
					<SensitiveInput
						label="Password"
						value={password}
						onValueChange={setPassword}
						placeholder="Enter a password"
					/>
					{teamVisible && (
						<p className="mt-2 text-kumo-subtle text-sm">
							Team members can see this password later in the file manager — don&apos;t reuse a personal one.
						</p>
					)}
				</div>
				<div className="mt-6 flex justify-end gap-2">
					<Button variant="secondary" disabled={busy} onClick={() => handleOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="primary" loading={busy} disabled={!password} onClick={() => onConfirm(password)}>
						Save
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
