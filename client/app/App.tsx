import { Text } from "@cloudflare/kumo/components/text";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { AccessLogDialog } from "./components/AccessLogDialog";
import { BulkActionsBar } from "./components/BulkActionsBar";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
import { ErrorState } from "./components/ErrorState";
import { FileList } from "./components/FileList";
import { SignedOutState } from "./components/SignedOutState";
import { UploadDropzone } from "./components/UploadDropzone";
import { UsageBar } from "./components/UsageBar";
import {
	ApiError,
	AuthError,
	deleteBundle,
	deleteFile,
	fetchAccessSummaries,
	fetchFiles,
	fetchUsage,
	patchBundle,
	patchFile,
	type AccessSummary,
	type BundleRecord,
	type FileRecord,
	type UsageSummary,
	type Visibility,
} from "./lib/api";
import { useKonamiCode } from "./lib/useKonamiCode";

const NOW_TICK_MS = 45_000;
// How long a deleted row plays its exit animation before actually being
// spliced out of `files` -- keep in sync with the `list-item-exit` duration.
const ROW_EXIT_MS = 160;

export function App() {
	return (
		<Toasty>
			<AppShell />
		</Toasty>
	);
}

function AppShell() {
	const [files, setFiles] = useState<FileRecord[] | null>(null);
	const [bundles, setBundles] = useState<BundleRecord[] | null>(null);
	const [usage, setUsage] = useState<UsageSummary | null>(null);
	const [authError, setAuthError] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
	const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [pendingDeleteBundleId, setPendingDeleteBundleId] = useState<string | null>(null);
	const [bundleDeleteBusy, setBundleDeleteBusy] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	// Hidden "telemetry mode" -- off on every load, never persisted. See useKonamiCode below.
	const [telemetry, setTelemetry] = useState(false);
	const [accessById, setAccessById] = useState<Record<string, AccessSummary>>({});
	const [logTarget, setLogTarget] = useState<{ id: string; name: string } | null>(null);
	const toasts = useKumoToastManager();

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
		return () => clearInterval(id);
	}, []);

	const loadAll = useCallback(async () => {
		setLoadError(null);
		try {
			const [filesRes, usageRes] = await Promise.all([fetchFiles(), fetchUsage()]);
			setAuthError(false);
			setFiles(filesRes.files);
			setBundles(filesRes.bundles);
			setUsage(usageRes);
		} catch (err) {
			if (err instanceof AuthError) {
				setAuthError(true);
			} else {
				setLoadError(err instanceof Error ? err.message : String(err));
			}
		}
	}, []);

	useEffect(() => {
		void loadAll();
	}, [loadAll]);

	// Refetch helpers -- called after every mutation so the list/usage stay in
	// sync without a manual page reload. This is the fix for the "list didn't
	// reactively update" bug: every success path below ends by updating state
	// directly (optimistic splice) and/or calling one of these.
	const refetchUsage = useCallback(async () => {
		try {
			setUsage(await fetchUsage());
		} catch (err) {
			if (err instanceof AuthError) setAuthError(true);
			// non-fatal otherwise -- usage bar just stays stale until next success
		}
	}, []);

	const refetchFiles = useCallback(async () => {
		try {
			const { files: next, bundles: nextBundles } = await fetchFiles();
			setFiles(next);
			setBundles(nextBundles);
		} catch (err) {
			if (err instanceof AuthError) setAuthError(true);
		}
	}, []);

	// ↑↑↓↓←→←→BA. Access tracking runs server-side regardless of this switch -- all it
	// decides is whether the numbers are on screen. Keeping them off by default is the
	// whole point: the everyday view of /app should be about files, not about analytics,
	// and "has anyone opened this yet" is a question you ask a handful of times a year.
	const toggleTelemetry = useCallback(() => {
		const next = !telemetry;
		setTelemetry(next);
		if (!next) setLogTarget(null);
		toasts.add(
			next
				? {
						title: "Telemetry mode",
						description: "Every row now shows how often its link was opened. Same code again to hide it.",
					}
				: { title: "Telemetry mode off" },
		);
	}, [telemetry, toasts]);
	useKonamiCode(toggleTelemetry);

	// Counters for the whole table in one request, fetched only once the mode is on so
	// an ordinary page load never asks for them.
	useEffect(() => {
		if (!telemetry) return;
		let cancelled = false;
		fetchAccessSummaries()
			.then((summaries) => {
				if (!cancelled) setAccessById(summaries);
			})
			.catch((err: unknown) => {
				if (!cancelled && err instanceof AuthError) setAuthError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [telemetry]);

	const handleUploaded = useCallback(() => {
		void refetchFiles();
		void refetchUsage();
	}, [refetchFiles, refetchUsage]);

	// Shared by the file and folder patch handlers below: apply `apply`'s update to state on
	// success, or surface `errorTitle` as a toast (unless it's an auth error, which the caller
	// already redirects on).
	const runPatch = useCallback(
		async (apply: () => Promise<void>, errorTitle: string) => {
			try {
				await apply();
			} catch (err) {
				if (err instanceof AuthError) {
					setAuthError(true);
				} else {
					const message = err instanceof ApiError ? err.message : "update failed";
					toasts.add({ variant: "error", title: errorTitle, description: message });
				}
			}
		},
		[toasts],
	);

	const handlePatch = useCallback(
		(id: string, patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) =>
			runPatch(async () => {
				const updated = await patchFile(id, patch);
				setFiles((prev) => prev?.map((f) => (f.id === id ? updated : f)) ?? prev);
			}, "Couldn't update file"),
		[runPatch],
	);

	const handleBundlePatch = useCallback(
		(id: string, patch: { visibility?: Visibility; expiresInSeconds?: number; password?: string }) =>
			runPatch(async () => {
				const updated = await patchBundle(id, patch);
				// PATCH returns the bundle without its members resolved; keep the existing files array.
				setBundles((prev) => prev?.map((b) => (b.id === id ? { ...updated, files: b.files } : b)) ?? prev);
			}, "Couldn't update folder"),
		[runPatch],
	);

	const handleConfirmDeleteBundle = useCallback(async () => {
		if (!pendingDeleteBundleId) return;
		setBundleDeleteBusy(true);
		try {
			await deleteBundle(pendingDeleteBundleId);
			setBundles((prev) => prev?.filter((b) => b.id !== pendingDeleteBundleId) ?? prev);
			void refetchUsage();
			toasts.add({ variant: "success", title: "Folder deleted" });
		} catch (err) {
			if (err instanceof AuthError) {
				setAuthError(true);
			} else {
				const message = err instanceof ApiError ? err.message : "delete failed";
				toasts.add({ variant: "error", title: "Couldn't delete folder", description: message });
			}
		} finally {
			setBundleDeleteBusy(false);
			setPendingDeleteBundleId(null);
		}
	}, [pendingDeleteBundleId, refetchUsage, toasts]);

	const handleToggleOne = useCallback((id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const handleToggleAll = useCallback(() => {
		setSelectedIds((prev) => {
			if (!files || files.length === 0) return prev;
			const allSelected = files.every((f) => prev.has(f.id));
			return allSelected ? new Set() : new Set(files.map((f) => f.id));
		});
	}, [files]);

	const pendingDeleteFilenames = useMemo(() => {
		if (!pendingDeleteIds || !files) return pendingDeleteIds ?? null;
		const byId = new Map(files.map((f) => [f.id, f.filename]));
		return pendingDeleteIds.map((id) => byId.get(id) ?? id);
	}, [pendingDeleteIds, files]);

	const handleConfirmDelete = useCallback(async () => {
		if (!pendingDeleteIds) return;
		setDeleteBusy(true);
		const results = await Promise.allSettled(pendingDeleteIds.map((id) => deleteFile(id)));
		const succeeded = new Set<string>();
		let sawAuthError = false;
		let failureCount = 0;
		results.forEach((result, i) => {
			const id = pendingDeleteIds[i];
			if (result.status === "fulfilled") {
				succeeded.add(id);
			} else if (result.reason instanceof AuthError) {
				sawAuthError = true;
			} else {
				failureCount += 1;
			}
		});

		if (succeeded.size > 0) {
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of succeeded) next.delete(id);
				return next;
			});
			// Play the exit animation before actually removing the rows -- an
			// instant array filter would make them vanish with no feedback.
			setExitingIds((prev) => new Set([...prev, ...succeeded]));
			setTimeout(() => {
				setFiles((prev) => prev?.filter((f) => !succeeded.has(f.id)) ?? prev);
				setExitingIds((prev) => {
					const next = new Set(prev);
					for (const id of succeeded) next.delete(id);
					return next;
				});
			}, ROW_EXIT_MS);
			void refetchUsage();
			toasts.add({
				variant: "success",
				title: succeeded.size === 1 ? "File deleted" : `${succeeded.size} files deleted`,
			});
		}
		if (sawAuthError) setAuthError(true);
		if (failureCount > 0) {
			toasts.add({
				variant: "error",
				title: "Some deletions failed",
				description: `${failureCount} of ${pendingDeleteIds.length} file(s) could not be deleted.`,
			});
		}

		setDeleteBusy(false);
		setPendingDeleteIds(null);
	}, [pendingDeleteIds, refetchUsage, toasts]);

	const selectedCount = selectedIds.size;
	const pendingDeleteBundleName = useMemo(() => {
		if (!pendingDeleteBundleId) return null;
		return [bundles?.find((b) => b.id === pendingDeleteBundleId)?.name ?? pendingDeleteBundleId];
	}, [pendingDeleteBundleId, bundles]);

	return (
		<main className="app-shell">
			<header className="flex flex-col gap-1">
				<Text as="h1" variant="heading1" DANGEROUS_style={{ textWrap: "balance" } as CSSProperties}>
					Files
				</Text>
				<Text variant="secondary">Upload, share, and manage files stored in transfer.</Text>
			</header>

			{authError ? (
				<SignedOutState onRetry={loadAll} />
			) : loadError ? (
				<ErrorState message={loadError} onRetry={loadAll} />
			) : (
				<>
					{usage && <UsageBar usage={usage} />}
					<UploadDropzone onUploaded={handleUploaded} />
					<BulkActionsBar
						count={selectedCount}
						onClear={() => setSelectedIds(new Set())}
						onDeleteRequest={() => setPendingDeleteIds(Array.from(selectedIds))}
					/>
					<FileList
						files={files}
						bundles={bundles}
						now={now}
						selectedIds={selectedIds}
						exitingIds={exitingIds}
						telemetry={telemetry}
						accessById={accessById}
						onToggleOne={handleToggleOne}
						onToggleAll={handleToggleAll}
						onPatch={handlePatch}
						onDeleteRequest={(id) => setPendingDeleteIds([id])}
						onOpenLog={setLogTarget}
						onBundlePatch={handleBundlePatch}
						onBundleDeleteRequest={(id) => setPendingDeleteBundleId(id)}
					/>
				</>
			)}

			<ConfirmDeleteDialog
				pending={pendingDeleteFilenames}
				busy={deleteBusy}
				onCancel={() => setPendingDeleteIds(null)}
				onConfirm={handleConfirmDelete}
			/>
			<ConfirmDeleteDialog
				pending={pendingDeleteBundleName}
				busy={bundleDeleteBusy}
				noun="folder"
				onCancel={() => setPendingDeleteBundleId(null)}
				onConfirm={handleConfirmDeleteBundle}
			/>
			<AccessLogDialog
				target={logTarget}
				onClose={() => setLogTarget(null)}
				onAuthError={() => setAuthError(true)}
			/>
		</main>
	);
}
