/**
 * Revocation poller — v0.3.0 Plan C scaffold.
 *
 * Polls GET /pubs/:pubId/revoked?since=:ts every 60s and maintains a
 * rolling set of revoked jtis + agent_ids. On new revocations, calls
 * the kick callback so the relay can drop any active WS sessions.
 */

export interface RevocationEntry {
  agent_id: string;
  jti: string;
  revoked_at: string;
}

export type KickHandler = (agentId: string, jti: string) => void | Promise<void>;

export class RevocationPoller {
  private revokedJtis = new Set<string>();
  private since: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = 60_000;

  constructor(
    private readonly hubUrl: string,
    private readonly pubId: string,
    private readonly onKick: KickHandler
  ) {
    this.since = new Date(0).toISOString();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  isRevoked(jti: string): boolean {
    return this.revokedJtis.has(jti);
  }

  private async tick(): Promise<void> {
    // TODO: fetch `${hubUrl}/pubs/${pubId}/revoked?since=${since}` with operator auth
    // TODO: for each entry → revokedJtis.add(jti); await onKick(agent_id, jti)
    // TODO: advance this.since to max(revoked_at)
  }
}
