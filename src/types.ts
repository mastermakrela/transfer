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
}

/** FileRecord shape safe to hand to any client -- see toPublicFileRecord in kv.ts. */
export type PublicFileRecord = Omit<FileRecord, "passwordHash" | "passwordSalt"> & { hasPassword: boolean };

export interface UsageCurrent {
	bytes: number;
	count: number;
}

export interface UsageMonth {
	bytesUploaded: number;
	uploadCount: number;
}
