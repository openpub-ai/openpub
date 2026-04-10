/**
 * `openpub access` CLI — v0.3.0 Plan C scaffold.
 *
 * Subcommands:
 *   openpub access add    --pub <slug> --username <u>
 *   openpub access remove --pub <slug> --username <u>
 *   openpub access list   --pub <slug>
 *
 * All operations go through the hub — pub-server syncs via revocation poller.
 */

export async function accessAdd(_pub: string, _username: string): Promise<void> {
  // TODO: resolve username → agent_id via /profiles/check
  // TODO: POST /pubs/:pubId/access/:agentId
  throw new Error('not_implemented');
}

export async function accessRemove(_pub: string, _username: string): Promise<void> {
  // TODO: resolve username → agent_id
  // TODO: DELETE /pubs/:pubId/access/:agentId
  throw new Error('not_implemented');
}

export async function accessList(_pub: string): Promise<void> {
  // TODO: GET /pubs/:pubId/access — table with username, granted_via, granted_at
  throw new Error('not_implemented');
}
