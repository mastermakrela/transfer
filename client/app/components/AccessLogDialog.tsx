import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Text } from "@cloudflare/kumo/components/text";
import { ArrowSquareOutIcon, BinocularsIcon, DownloadSimpleIcon, EyeIcon, FileZipIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { formatAbsoluteTime, formatTimeAgo } from "../../shared/format";
import { AuthError, fetchAccessStats, type AccessEvent, type AccessStats } from "../lib/api";

interface AccessLogDialogProps {
	/** The link to show history for; the dialog is open whenever this is non-null. */
	target: { id: string; name: string } | null;
	onClose: () => void;
	onAuthError: () => void;
}

export function AccessLogDialog({ target, onClose, onAuthError }: AccessLogDialogProps) {
	const [stats, setStats] = useState<AccessStats | null>(null);
	const [error, setError] = useState<string | null>(null);

	const targetId = target?.id ?? null;
	useEffect(() => {
		if (!targetId) return;
		let cancelled = false;
		setStats(null);
		setError(null);
		fetchAccessStats(targetId)
			.then((result) => {
				if (!cancelled) setStats(result);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				if (err instanceof AuthError) onAuthError();
				else setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [targetId, onAuthError]);

	return (
		<Dialog.Root open={target !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog className="p-6" size="lg">
				<div className="dialog-header">
					<div className="access-log-heading">
						<Dialog.Title className="text-lg font-semibold">Who opened this</Dialog.Title>
						<Text truncate size="sm" variant="secondary">
							{target?.name}
						</Text>
					</div>
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

				{error ? (
					<Text variant="error" size="sm">
						{error}
					</Text>
				) : !stats ? (
					<div className="access-log-list">
						{Array.from({ length: 3 }).map((_, i) => (
							<div key={i} className="skeleton-bar animate-pulse" />
						))}
					</div>
				) : stats.recent.length === 0 ? (
					<Empty
						size="sm"
						icon={<BinocularsIcon size={40} className="text-kumo-inactive" />}
						title="Not opened yet"
						description="Nobody has followed this link so far."
					/>
				) : (
					<>
						<div className="access-log-totals">
							<Total icon={<EyeIcon size={16} />} value={stats.views} label={stats.views === 1 ? "view" : "views"} />
							<Total
								icon={<DownloadSimpleIcon size={16} />}
								value={stats.downloads}
								label={stats.downloads === 1 ? "download" : "downloads"}
							/>
						</div>
						<div className="access-log-list">
							{stats.recent.map((event, i) => (
								// Events carry no id and repeat by design (same country + client, minutes
								// apart); the index is the only stable key, and the list never reorders.
								<EventRow key={i} event={event} />
							))}
						</div>
					</>
				)}

				<div className="access-log-footnote">
					<Text size="xs" variant="secondary">
						Recorded from what Cloudflare already sees on each request: approximate location, a browser and OS family, and
						where the link was clicked from. No IP addresses, no cookies, nothing that identifies a person. The last 50
						events are kept, and everything is deleted with the file.
					</Text>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function Total({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
	return (
		<div className="access-log-total">
			<span className="text-kumo-subtle" aria-hidden>
				{icon}
			</span>
			<Text size="sm">
				<span className="tabular">{value}</span> {label}
			</Text>
		</div>
	);
}

const KIND_ICONS = {
	view: EyeIcon,
	download: DownloadSimpleIcon,
	zip: FileZipIcon,
} as const;

const KIND_LABELS = {
	view: "Opened the page",
	download: "Downloaded the file",
	zip: "Downloaded the whole folder",
} as const;

function EventRow({ event }: { event: AccessEvent }) {
	const KindIcon = KIND_ICONS[event.kind];
	const place = [event.city, countryName(event.country)].filter(Boolean).join(", ");

	return (
		<div className="access-log-row">
			<span className="access-log-kind" title={KIND_LABELS[event.kind]}>
				<KindIcon size={16} aria-label={KIND_LABELS[event.kind]} />
			</span>
			<div className="access-log-where">
				<Text size="sm" truncate>
					{flagEmoji(event.country)}
					{place || "Unknown location"}
				</Text>
				<Text size="xs" variant="secondary" truncate>
					{event.client ?? "Unknown client"}
					{event.referer && (
						<>
							{" · "}
							<ArrowSquareOutIcon size={11} className="access-log-referer-icon" aria-hidden />
							{event.referer}
						</>
					)}
				</Text>
			</div>
			<span className="access-log-when">
				<Text size="xs" variant="secondary">
					<time dateTime={new Date(event.t).toISOString()} title={formatAbsoluteTime(event.t)}>
						{formatTimeAgo(event.t)}
					</time>
				</Text>
			</span>
		</div>
	);
}

const REGION_NAMES = new Intl.DisplayNames(undefined, { type: "region" });

function countryName(code: string | undefined): string | undefined {
	if (!code) return undefined;
	try {
		return REGION_NAMES.of(code) ?? code;
	} catch {
		// Cloudflare occasionally reports non-ISO pseudo-codes that DisplayNames rejects.
		return code;
	}
}

/** Turns "DE" into 🇩🇪 by mapping A-Z onto the regional-indicator block. */
function flagEmoji(code: string | undefined): string {
	if (!code || !/^[A-Z]{2}$/.test(code)) return "";
	const flag = String.fromCodePoint(...[...code].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
	return `${flag} `;
}
