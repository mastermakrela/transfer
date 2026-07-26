export type Visibility = "public" | "password" | "private";

export interface FileRecord {
	id: string;
	r2Key: string;
	filename: string;
	contentType: string;
	size: number;
	visibility: Visibility;
	owner: string;
	createdAt: number;
	expiresAt: number;
	/** Only set when visibility is "password" -- PBKDF2, see src/password.ts. Never sent to clients, see toPublicFileRecord. */
	passwordHash?: string;
	passwordSalt?: string;
	/** Set when this file is a member of a bundle. A bundled file defers all access
	 * gating (visibility/password) to its parent bundle -- see resolveGate in download.ts. */
	bundleId?: string;
}

/**
 * A shareable folder grouping several files under one link (/f/:id). The bundle owns
 * visibility/password/expiry; member files inherit it and are gated through the bundle.
 * Members keep their own FileRecord (own /d page, preview, R2 object) and carry bundleId.
 */
export interface BundleRecord {
	id: string;
	name: string;
	/** Member file ids, in display order. */
	fileIds: string[];
	visibility: Visibility;
	owner: string;
	createdAt: number;
	expiresAt: number;
	/** Same PBKDF2 scheme as FileRecord; only set when visibility is "password". */
	passwordHash?: string;
	passwordSalt?: string;
}

/** Structural gate shared by FileRecord and BundleRecord -- whichever one governs access. */
export interface Gated {
	id: string;
	visibility: Visibility;
	passwordHash?: string;
	passwordSalt?: string;
}

/** FileRecord shape safe to hand to any client -- see toPublicFileRecord in kv.ts. */
export type PublicFileRecord = Omit<FileRecord, "passwordHash" | "passwordSalt"> & { hasPassword: boolean };

/** BundleRecord shape safe to hand to any client, with its members resolved. */
export type PublicBundleRecord = Omit<BundleRecord, "passwordHash" | "passwordSalt" | "fileIds"> & {
	hasPassword: boolean;
	files: PublicFileRecord[];
};

export interface UsageCurrent {
	bytes: number;
	count: number;
}

export interface UsageMonth {
	bytesUploaded: number;
	uploadCount: number;
}
