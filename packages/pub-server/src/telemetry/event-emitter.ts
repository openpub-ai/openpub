/**
 * Event emitter shim — v0.3.0 Plan D scaffold (runtime side).
 *
 * Pub-server instruments its lifecycle with emit() calls; this buffers and
 * ships batches to the hub's /events/ingest endpoint.
 *
 * Lossy on purpose: if the hub is unreachable, events drop after a bounded
 * retry. The pub itself keeps running. Observability is not on the hot path.
 */

type EventType =
  | 'agent_checkin'
  | 'agent_checkout'
  | 'message'
  | 'fragment_signed'
  | 'rate_limit_hit'
  | 'error'
  | 'heartbeat';

export interface EmitArgs {
  type: EventType;
  agent_id?: string;
  session_id?: string;
  payload?: Record<string, unknown>;
}

export interface EmitterConfig {
  hubUrl: string;
  pubIngestToken: string; // pub-scoped JWT
  flushMs?: number; // default 5000
  batchMax?: number; // default 100
  heartbeatMs?: number; // default 30_000
}

export class PubEventEmitter {
  private buf: Array<EmitArgs & { event_id: string; ts: string }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: EmitterConfig) {}

  start(): void {
    const flushMs = this.cfg.flushMs ?? 5000;
    const hbMs = this.cfg.heartbeatMs ?? 30_000;
    this.flushTimer = setInterval(() => void this.flush(), flushMs);
    this.heartbeatTimer = setInterval(() => this.emit({ type: 'heartbeat' }), hbMs);
  }

  stop(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    void this.flush();
  }

  emit(args: EmitArgs): void {
    this.buf.push({ ...args, event_id: ulid(), ts: new Date().toISOString() });
    if (this.buf.length >= (this.cfg.batchMax ?? 100)) void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buf.length === 0) return;
    const batch = this.buf.splice(0, this.cfg.batchMax ?? 100);
    try {
      await fetch(`${this.cfg.hubUrl}/events/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.pubIngestToken}`,
        },
        body: JSON.stringify({ events: batch }),
      });
    } catch {
      // TODO: single retry with backoff, then drop
    }
  }
}

function ulid(): string {
  // TODO: replace with real ulid impl
  return Math.random().toString(36).slice(2).padEnd(26, '0');
}
