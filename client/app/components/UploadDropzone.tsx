import { CloudArrowUpIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@cloudflare/kumo/components/button";
import { Meter } from "@cloudflare/kumo/components/meter";
import { Select } from "@cloudflare/kumo/components/select";
import { SensitiveInput } from "@cloudflare/kumo/components/sensitive-input";
import { Text } from "@cloudflare/kumo/components/text";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { useId, useRef, useState, type CSSProperties } from "react";

import { ApiError, AuthError, presignUpload, uploadToR2, type Visibility } from "../lib/api";
import { DEFAULT_EXPIRY_SECONDS, EXPIRY_OPTIONS } from "../../shared/expiry-options";
import { formatBytes } from "../../shared/format";

interface UploadItem {
	key: string;
	filename: string;
	size: number;
	progress: number;
	status: "uploading" | "error";
	error?: string;
}

// Keep in sync with the `list-item-exit` animation duration in app.css.
const ROW_EXIT_MS = 160;

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
	const [visibility, setVisibility] = useState<Visibility>("private");
	const [password, setPassword] = useState("");
	const [expiresIn, setExpiresIn] = useState(DEFAULT_EXPIRY_SECONDS);
	const [isDragging, setIsDragging] = useState(false);
	const [uploads, setUploads] = useState<UploadItem[]>([]);
	const [exitingKeys, setExitingKeys] = useState<Set<string>>(new Set());
	const inputRef = useRef<HTMLInputElement>(null);
	const dropzoneLabelId = useId();
	const toasts = useKumoToastManager();

	function updateUpload(key: string, patch: Partial<UploadItem>) {
		setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));
	}

	function removeUpload(key: string) {
		// Play the exit animation before splicing the row out, same as file deletion.
		setExitingKeys((prev) => new Set(prev).add(key));
		setTimeout(() => {
			setUploads((prev) => prev.filter((u) => u.key !== key));
			setExitingKeys((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		}, ROW_EXIT_MS);
	}

	async function uploadOne(file: File) {
		const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		setUploads((prev) => [...prev, { key, filename: file.name, size: file.size, progress: 0, status: "uploading" }]);
		try {
			const presigned = await presignUpload({
				filename: file.name,
				size: file.size,
				contentType: file.type || "application/octet-stream",
				visibility,
				expiresIn,
				password: visibility === "password" ? password : undefined,
			});
			await uploadToR2(presigned.uploadUrl, file, (fraction) => updateUpload(key, { progress: fraction }));
			removeUpload(key);
			toasts.add({ variant: "success", title: "Uploaded", description: file.name });
			onUploaded();
		} catch (err) {
			const message =
				err instanceof AuthError
					? "not signed in"
					: err instanceof ApiError
						? err.message
						: err instanceof Error
							? err.message
							: "upload failed";
			updateUpload(key, { status: "error", error: message });
			toasts.add({ variant: "error", title: "Upload failed", description: `${file.name}: ${message}` });
		}
	}

	function handleFiles(fileList: FileList | null) {
		if (!fileList || fileList.length === 0) return;
		if (visibility === "password" && !password) {
			toasts.add({ variant: "error", title: "Password required", description: "Set a password before uploading." });
			return;
		}
		for (const file of Array.from(fileList)) void uploadOne(file);
	}

	return (
		<div className="upload-card">
			<Text as="h2" bold size="sm">
				Upload
			</Text>
			<div className="flex flex-wrap items-end gap-3">
				<Select
					label="Visibility"
					className="w-40"
					size="sm"
					value={visibility}
					onValueChange={(v) => setVisibility(v ?? "private")}
					items={{ private: "Private", password: "Password protected", public: "Public" }}
				/>
				{visibility === "password" && (
					<SensitiveInput
						label="Password"
						size="sm"
						className="w-52"
						value={password}
						onValueChange={setPassword}
						placeholder="Set a password"
					/>
				)}
				<Select
					label="Expires in"
					className="w-40"
					size="sm"
					value={expiresIn}
					onValueChange={(v) => setExpiresIn(v ?? DEFAULT_EXPIRY_SECONDS)}
					items={EXPIRY_OPTIONS}
				/>
			</div>

			<div
				role="button"
				tabIndex={0}
				aria-labelledby={dropzoneLabelId}
				data-dragging={isDragging}
				onClick={() => inputRef.current?.click()}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						inputRef.current?.click();
					}
				}}
				onDragOver={(e) => {
					e.preventDefault();
					setIsDragging(true);
				}}
				onDragLeave={() => setIsDragging(false)}
				onDrop={(e) => {
					e.preventDefault();
					setIsDragging(false);
					handleFiles(e.dataTransfer.files);
				}}
				className="dropzone"
			>
				<CloudArrowUpIcon size={32} className="text-kumo-subtle" aria-hidden />
				<Text id={dropzoneLabelId} bold>
					Drag and drop files here
				</Text>
				<Text variant="secondary" size="sm">
					or
				</Text>
				<Button
					icon={<CloudArrowUpIcon />}
					onClick={(e) => {
						e.stopPropagation();
						inputRef.current?.click();
					}}
				>
					Choose files
				</Button>
				<input
					ref={inputRef}
					type="file"
					multiple
					className="hidden"
					onChange={(e) => {
						handleFiles(e.target.files);
						e.target.value = "";
					}}
				/>
			</div>

			{uploads.length > 0 && (
				<div className="flex flex-col gap-2">
					{uploads.map((u, index) => (
						<div
							key={u.key}
							className={`upload-row list-item-enter${exitingKeys.has(u.key) ? " list-item-exit" : ""}`}
							style={{ "--row-index": Math.min(index, 8) } as CSSProperties}
						>
							{u.status === "error" ? <WarningIcon size={18} className="text-kumo-danger shrink-0" /> : null}
							<div className="upload-row-body">
								<Text truncate size="sm">
									{u.filename}
								</Text>
								{u.status === "uploading" ? (
									<Meter
										label="Uploading"
										value={Math.round(u.progress * 100)}
										customValue={`${formatBytes(u.size * u.progress)} / ${formatBytes(u.size)}`}
									/>
								) : (
									<Text variant="error" size="xs">
										{u.error}
									</Text>
								)}
							</div>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								className="hit-target-square"
								icon={<XIcon />}
								aria-label="Dismiss"
								onClick={() => removeUpload(u.key)}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
