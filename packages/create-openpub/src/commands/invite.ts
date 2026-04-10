/**
 * `openpub invite` CLI — v0.3.0 Plan C scaffold.
 *
 * Subcommands:
 *   openpub invite create --pub <slug> [--max-uses N] [--expires 30d]
 *   openpub invite list --pub <slug>
 *   openpub invite revoke --pub <slug> --id <invite_id>
 *
 * Proxies to the hub endpoints using the operator's owner token
 * (read from ~/.openpub/credentials).
 */

export interface InviteCreateOpts {
  pub: string;
  maxUses?: number;
  expires?: string; // e.g. "30d", "2026-05-01"
}

export async function inviteCreate(_opts: InviteCreateOpts): Promise<void> {
  // TODO: resolve pub slug → pub_id via hub /pubs?slug=
  // TODO: POST /pubs/:pubId/invites
  // TODO: print the raw code ONCE with a big warning
  throw new Error('not_implemented');
}

export async function inviteList(_pub: string): Promise<void> {
  // TODO: GET /pubs/:pubId/invites — table output
  throw new Error('not_implemented');
}

export async function inviteRevoke(_pub: string, _inviteId: string): Promise<void> {
  // TODO: DELETE /pubs/:pubId/invites/:inviteId
  throw new Error('not_implemented');
}

/** Parse "30d", "12h", "2026-05-01" → ISO timestamp */
export function parseExpires(_spec: string): string {
  throw new Error('not_implemented');
}
