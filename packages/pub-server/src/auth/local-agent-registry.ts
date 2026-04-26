/**
 * Local Agent Registry
 *
 * The on-disk roster of agents allowed to use this pub-server in
 * local-trust mode. Replaces the hub's agents table for the on-box
 * deployment. Provisioned by the supervisor (or by the bundled
 * `register-agent` CLI subcommand); read by the auth path on every
 * /agents/auth request.
 *
 * File shape:
 *   {
 *     "schema_version": 1,
 *     "agents": [
 *       {
 *         "agent_id": "<uuid-v7>",
 *         "display_name": "Carl",
 *         "public_key": "<ed25519-base64url>",
 *         "registered_at": "2026-04-26T..."
 *       }
 *     ]
 *   }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, watch } from 'fs';
import { dirname } from 'path';
import * as ed25519 from '@noble/ed25519';
import { z } from 'zod';

export const LocalAgentRecord = z.object({
  agent_id: z.string().uuid(),
  display_name: z.string().min(1).max(64),
  public_key: z.string().min(1),
  registered_at: z.string().datetime(),
});
export type LocalAgentRecord = z.infer<typeof LocalAgentRecord>;

const RegistryFile = z.object({
  schema_version: z.literal(1),
  agents: z.array(LocalAgentRecord),
});

const AUTH_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // ±5 minutes, matches hub

function base64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

export class LocalAgentRegistry {
  private agents = new Map<string, LocalAgentRecord>();

  private constructor(private readonly path: string) {}

  static load(path: string): LocalAgentRegistry {
    const reg = new LocalAgentRegistry(path);
    reg.reload();
    return reg;
  }

  /**
   * Re-read the file from disk. Cheap; called on demand and on
   * fs.watch events. Tolerates the file not existing yet (empty
   * registry until the first agent is registered).
   */
  reload(): void {
    if (!existsSync(this.path)) {
      this.agents = new Map();
      return;
    }
    const raw = readFileSync(this.path, 'utf-8');
    const parsed = RegistryFile.parse(JSON.parse(raw));
    const next = new Map<string, LocalAgentRecord>();
    for (const a of parsed.agents) {
      next.set(a.agent_id, a);
    }
    this.agents = next;
  }

  /**
   * Watch the registry file for changes and reload automatically.
   * Returns a closer that stops the watcher.
   */
  watch(): () => void {
    if (!existsSync(this.path)) {
      mkdirSync(dirname(this.path), { recursive: true });
    }
    const watcher = watch(dirname(this.path), (_event, filename) => {
      if (filename && this.path.endsWith(filename)) {
        try {
          this.reload();
        } catch {
          // ignore — keep the last-good registry in memory
        }
      }
    });
    return () => watcher.close();
  }

  lookup(agentId: string): LocalAgentRecord | null {
    return this.agents.get(agentId) ?? null;
  }

  list(): LocalAgentRecord[] {
    return Array.from(this.agents.values());
  }

  /**
   * Add a new agent record and persist. Atomic temp-and-rename so a
   * crash mid-write doesn't corrupt the registry.
   */
  register(record: LocalAgentRecord): void {
    if (this.agents.has(record.agent_id)) {
      throw new Error(`Agent ${record.agent_id} already registered`);
    }
    if (Array.from(this.agents.values()).some((a) => a.display_name.toLowerCase() === record.display_name.toLowerCase())) {
      throw new Error(`Display name ${record.display_name} already taken`);
    }
    this.agents.set(record.agent_id, record);
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload: z.infer<typeof RegistryFile> = {
      schema_version: 1,
      agents: this.list(),
    };
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  /**
   * Verify an Ed25519 signature over `${agent_id}:${timestamp}` against
   * the registered public key. ±5 minute clock skew, identical to hub
   * /agents/auth. Returns the matched record on success, throws on
   * failure.
   */
  async verifySignedTimestamp(
    agentId: string,
    timestamp: string,
    signature: string
  ): Promise<LocalAgentRecord> {
    const record = this.lookup(agentId);
    if (!record) {
      throw new Error('agent not registered');
    }

    const tsMs = Date.parse(timestamp);
    if (Number.isNaN(tsMs)) {
      throw new Error('invalid timestamp');
    }
    if (Math.abs(Date.now() - tsMs) > AUTH_TIMESTAMP_SKEW_MS) {
      throw new Error('timestamp outside ±5 minute window');
    }

    const message = new TextEncoder().encode(`${agentId}:${timestamp}`);
    const sigBytes = base64urlToBytes(signature);
    const pubBytes = base64urlToBytes(record.public_key);

    const valid = await ed25519.verifyAsync(sigBytes, message, pubBytes);
    if (!valid) {
      throw new Error('signature verification failed');
    }

    return record;
  }
}
