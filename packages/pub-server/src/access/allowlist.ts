/**
 * Allowlist loader — v0.3.0 Plan C scaffold.
 *
 * Reads the PUB.md `access.allowlist` block and resolves username entries
 * against the hub once at boot. Stored in an in-memory map indexed by agent_id.
 */

import type { PubMd, PubMdAllowlistEntry } from '@openpub-ai/types';

export interface AllowlistEntry {
  agent_id: string;
  username?: string;
  source: 'pub-md' | 'cli' | 'grant';
}

export class Allowlist {
  private map = new Map<string, AllowlistEntry>();

  async load(_pubMd: PubMd): Promise<void> {
    // TODO: iterate pubMd.access?.allowlist
    // TODO: for each entry with username only, call hub /profiles/check to resolve agent_id
    // TODO: populate this.map
  }

  has(agentId: string): boolean {
    return this.map.has(agentId);
  }

  add(entry: AllowlistEntry): void {
    this.map.set(entry.agent_id, entry);
  }

  remove(agentId: string): void {
    this.map.delete(agentId);
  }

  list(): AllowlistEntry[] {
    return Array.from(this.map.values());
  }

  private static resolveUsername(
    _hubUrl: string,
    _entry: PubMdAllowlistEntry
  ): Promise<string | null> {
    // TODO
    return Promise.resolve(null);
  }
}
