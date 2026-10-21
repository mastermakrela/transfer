import { useState } from "react";

import type { Visibility } from "./api";
import { useCopyFeedback } from "../../shared/useCopyFeedback";

export type Patch = { visibility?: Visibility; expiresInSeconds?: number; password?: string };

/**
 * State + handlers shared by every "gate" row (files, bundles): the visibility
 * select, its password-set/rotate dialog, the extend-expiry select, and the
 * copy-link/copy-password buttons. FileRow and BundleRow render identical
 * markup for all of this -- only the leading cell and the name cell differ,
 * so those two components delegate here instead of duplicating the logic.
 */
export function useGateControls(onPatch: (patch: Patch) => Promise<void>, visibility: Visibility) {
	const [savingField, setSavingField] = useState<"visibility" | "expiry" | null>(null);
	const [passwordDialogMode, setPasswordDialogMode] = useState<"set" | "rotate" | null>(null);
	const [passwordBusy, setPasswordBusy] = useState(false);
	const [passwordRevealed, setPasswordRevealed] = useState(false);
	const { copied: linkCopied, copy: copyLink } = useCopyFeedback();
	const { copied: passwordCopied, copy: copyPassword } = useCopyFeedback();

	async function handlePatch(field: "visibility" | "expiry", patch: Patch) {
		setSavingField(field);
		try {
			await onPatch(patch);
		} finally {
			setSavingField(null);
		}
	}

	function handleVisibilityChange(v: Visibility | null) {
		if (!v || v === visibility) return;
		if (v === "password") {
			setPasswordDialogMode("set");
			return;
		}
		void handlePatch("visibility", { visibility: v });
	}

	async function handlePasswordConfirm(password: string) {
		setPasswordBusy(true);
		try {
			await onPatch(passwordDialogMode === "set" ? { visibility: "password", password } : { password });
		} finally {
			setPasswordBusy(false);
			setPasswordDialogMode(null);
		}
	}

	return {
		savingField,
		passwordDialogMode,
		passwordBusy,
		passwordRevealed,
		linkCopied,
		copyLink,
		passwordCopied,
		copyPassword,
		setPasswordDialogMode,
		setPasswordRevealed,
		handlePatch,
		handleVisibilityChange,
		handlePasswordConfirm,
	};
}
