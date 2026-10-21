import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { useEffect, useState } from "react";

import { describeError, patchRecord, type RecordKind, type Visibility } from "./api";

const NOW_TICK_MS = 45_000;

/**
 * Shared behavior behind the Access-authorized visibility/expiry/password controls on
 * both the file landing page (ReadyView) and the bundle landing page (BundleView):
 * a live "now" clock for the relative expiry display, the visibility/expiry/password
 * mutation flow against /app/api/{files,bundles}/:id, and its error reporting.
 */
export function usePatchableEntity(
	kind: RecordKind,
	id: string,
	initial: { visibility: Visibility; expiresAt: number },
	entityLabel: string,
) {
	const [now, setNow] = useState(() => Date.now());
	// Access-authorized visitors can change visibility/expiry right here, so these
	// track the server's current values instead of the page-load snapshot.
	const [visibility, setVisibility] = useState(initial.visibility);
	const [expiresAt, setExpiresAt] = useState(initial.expiresAt);
	const [savingField, setSavingField] = useState<"visibility" | "expiry" | null>(null);
	const [passwordDialogMode, setPasswordDialogMode] = useState<"set" | "rotate" | null>(null);
	const [passwordBusy, setPasswordBusy] = useState(false);
	const toasts = useKumoToastManager();

	useEffect(() => {
		const tickId = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
		return () => clearInterval(tickId);
	}, []);

	function reportPatchError(err: unknown, title: string) {
		toasts.add({ variant: "error", title, description: describeError(err, "update failed") });
	}

	async function handlePatch(
		field: "visibility" | "expiry",
		patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string },
	) {
		setSavingField(field);
		try {
			const updated = await patchRecord(kind, id, patch);
			setVisibility(updated.visibility);
			setExpiresAt(updated.expiresAt);
		} catch (err) {
			reportPatchError(err, `Couldn't update ${entityLabel}`);
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
			const updated = await patchRecord(
				kind,
				id,
				passwordDialogMode === "set" ? { visibility: "password", password } : { password },
			);
			setVisibility(updated.visibility);
			setExpiresAt(updated.expiresAt);
		} catch (err) {
			reportPatchError(err, "Couldn't update password");
		} finally {
			setPasswordBusy(false);
			setPasswordDialogMode(null);
		}
	}

	return {
		now,
		visibility,
		expiresAt,
		savingField,
		passwordDialogMode,
		setPasswordDialogMode,
		passwordBusy,
		handlePatch,
		handleVisibilityChange,
		handlePasswordConfirm,
	};
}
