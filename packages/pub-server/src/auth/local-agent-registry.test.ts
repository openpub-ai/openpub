/**
 * LocalAgentRegistry tests.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as ed25519 from '@noble/ed25519';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalAgentRegistry } from './local-agent-registry.js';

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeKeypair() {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyB64: bytesToBase64Url(publicKey),
  };
}

async function signTimestamp(
  agentId: string,
  timestamp: string,
  privateKey: Uint8Array
): Promise<string> {
  const message = new TextEncoder().encode(`${agentId}:${timestamp}`);
  const sig = await ed25519.signAsync(message, privateKey);
  return bytesToBase64Url(sig);
}

describe('LocalAgentRegistry', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openpub-local-registry-'));
    path = join(dir, 'agents.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', () => {
    const reg = LocalAgentRegistry.load(path);
    expect(reg.list()).toEqual([]);
    expect(reg.lookup('whatever')).toBeNull();
  });

  it('registers an agent and persists atomically with mode 0600', async () => {
    const reg = LocalAgentRegistry.load(path);
    const { publicKeyB64 } = await makeKeypair();
    const record = {
      agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f',
      display_name: 'Carl',
      public_key: publicKeyB64,
      registered_at: new Date().toISOString(),
    };
    reg.register(record);

    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.schema_version).toBe(1);
    expect(onDisk.agents).toHaveLength(1);
    expect(onDisk.agents[0].display_name).toBe('Carl');

    const reloaded = LocalAgentRegistry.load(path);
    expect(reloaded.lookup(record.agent_id)?.display_name).toBe('Carl');
  });

  it('rejects duplicate agent_id', async () => {
    const reg = LocalAgentRegistry.load(path);
    const { publicKeyB64 } = await makeKeypair();
    const record = {
      agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f',
      display_name: 'Carl',
      public_key: publicKeyB64,
      registered_at: new Date().toISOString(),
    };
    reg.register(record);
    expect(() => reg.register(record)).toThrow(/already registered/);
  });

  it('rejects duplicate display name (case-insensitive)', async () => {
    const reg = LocalAgentRegistry.load(path);
    const a = await makeKeypair();
    const b = await makeKeypair();
    reg.register({
      agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f',
      display_name: 'Carl',
      public_key: a.publicKeyB64,
      registered_at: new Date().toISOString(),
    });
    expect(() =>
      reg.register({
        agent_id: '01919c4e-9a12-7000-8000-aaaaaaaaaaaa',
        display_name: 'CARL',
        public_key: b.publicKeyB64,
        registered_at: new Date().toISOString(),
      })
    ).toThrow(/already taken/);
  });

  it('verifies a valid signed timestamp', async () => {
    const reg = LocalAgentRegistry.load(path);
    const { privateKey, publicKeyB64 } = await makeKeypair();
    const agent_id = '01919c4e-9a12-7000-8000-1a2b3c4d5e6f';
    reg.register({
      agent_id,
      display_name: 'Carl',
      public_key: publicKeyB64,
      registered_at: new Date().toISOString(),
    });

    const timestamp = new Date().toISOString();
    const signature = await signTimestamp(agent_id, timestamp, privateKey);
    const verified = await reg.verifySignedTimestamp(agent_id, timestamp, signature);
    expect(verified.display_name).toBe('Carl');
  });

  it('rejects a signature for the wrong message', async () => {
    const reg = LocalAgentRegistry.load(path);
    const { privateKey, publicKeyB64 } = await makeKeypair();
    const agent_id = '01919c4e-9a12-7000-8000-1a2b3c4d5e6f';
    reg.register({
      agent_id,
      display_name: 'Carl',
      public_key: publicKeyB64,
      registered_at: new Date().toISOString(),
    });

    const timestamp = new Date().toISOString();
    const signature = await signTimestamp(agent_id, 'bogus', privateKey);
    await expect(reg.verifySignedTimestamp(agent_id, timestamp, signature)).rejects.toThrow(
      /signature/
    );
  });

  it('rejects a stale timestamp (>5 min skew)', async () => {
    const reg = LocalAgentRegistry.load(path);
    const { privateKey, publicKeyB64 } = await makeKeypair();
    const agent_id = '01919c4e-9a12-7000-8000-1a2b3c4d5e6f';
    reg.register({
      agent_id,
      display_name: 'Carl',
      public_key: publicKeyB64,
      registered_at: new Date().toISOString(),
    });

    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const signature = await signTimestamp(agent_id, stale, privateKey);
    await expect(reg.verifySignedTimestamp(agent_id, stale, signature)).rejects.toThrow(/window/);
  });

  it('rejects unknown agent_id', async () => {
    const reg = LocalAgentRegistry.load(path);
    await expect(reg.verifySignedTimestamp('nonexistent', new Date().toISOString(), 'x')).rejects.toThrow(
      /not registered/
    );
  });
});
