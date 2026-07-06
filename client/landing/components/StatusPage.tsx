import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { FileXIcon, KeyIcon, LockIcon } from "@phosphor-icons/react";

import type { PageData } from "../types";

type StatusData = Exclude<PageData, { state: "ready" }>;

/** Renders the 404 / private / password-gated states download.ts falls back to, using the
 * same Kumo components as the rest of the app instead of hand-rolled markup. */
export function StatusPage({ data }: { data: StatusData }) {
	switch (data.state) {
		case "not-found":
			return (
				<div className="status-page">
					<Empty
						icon={<FileXIcon size={40} className="text-kumo-inactive" />}
						title="Not found"
						description="This file doesn't exist or has expired."
					/>
				</div>
			);
		case "sign-in-required":
			return (
				<div className="status-page">
					<Empty
						icon={<LockIcon size={40} className="text-kumo-inactive" />}
						title="Sign in required"
						description="This file is private. Log in, then reopen this link."
						contents={
							<LinkButton href="/app" variant="primary" className="w-full">
								Log in
							</LinkButton>
						}
					/>
				</div>
			);
		case "password-required":
			return (
				<div className="status-page">
					<Empty
						icon={<KeyIcon size={40} className="text-kumo-inactive" />}
						title="Password required"
						description={`“${data.filename}” is protected by a password.`}
						contents={
							<form
								method="POST"
								action={`/d/${data.id}/${encodeURIComponent(data.filename)}/unlock`}
								className="flex w-full flex-col gap-3"
							>
								<Input
									type="password"
									name="password"
									size="lg"
									placeholder="Password"
									aria-label="Password"
									autoFocus
									required
									autoComplete="current-password"
									error={data.error}
								/>
								<Button type="submit" variant="primary" className="w-full">
									Unlock
								</Button>
							</form>
						}
					/>
				</div>
			);
	}
}
