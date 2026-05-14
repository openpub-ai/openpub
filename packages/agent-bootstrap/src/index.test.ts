import * as ed25519 from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import { bootstrapAgent, loadIdentity, BootstrapError } from './index.js';

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function makeKeypair() {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    privateKeyB64: bytesToBase64Url(privateKey),
    publicKey,
  };
}

describe('loadIdentity', () => {
  it('reads canonical fields', () => {
    const id = loadIdentity({
      agent_id: 'a1',
      private_key: 'pk',
      hub_url: 'https://example.com',
    });
    expect(id).toEqual({
      agent_id: 'a1',
      private_key: 'pk',
      hub_url: 'https://example.com',
    });
  });

  it('falls back to camelCase variants for older identity files', () => {
    const id = loadIdentity({ agentId: 'a1', privateKey: 'pk' });
    expect(id.agent_id).toBe('a1');
    expect(id.private_key).toBe('pk');
  });

  it('falls back to private_key_b64url', () => {
    const id = loadIdentity({ agent_id: 'a1', private_key_b64url: 'pk' });
    expect(id.private_key).toBe('pk');
  });

  it('rejects when agent_id missing', () => {
    expect(() => loadIdentity({ private_key: 'pk' })).toThrow(BootstrapError);
  });

  it('rejects when private_key missing under all known names', () => {
    expect(() => loadIdentity({ agent_id: 'a1' })).toThrow(/private_key/);
  });
});

describe('bootstrapAgent', () => {
  it('signs a current timestamp and POSTs to <hub>/agents/auth', async () => {
    const { privateKeyB64, publicKey } = await makeKeypair();
    const agent_id = '01919c4e-9a12-7000-8000-1a2b3c4d5e6f';

    const captured: { url?: string; body?: any } = {};
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.body = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          access_token: 'fake.jwt.here',
          refresh_token: 'rt-123',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch;

    const result = await bootstrapAgent(
      { agent_id, private_key: privateKeyB64, hub_url: 'https://hub.test' },
      { fetch: fakeFetch }
    );

    expect(result.access_token).toBe('fake.jwt.here');
    expect(result.refresh_token).toBe('rt-123');
    expect(captured.url).toBe('https://hub.test/agents/auth');
    expect(captured.body.agent_id).toBe(agent_id);
    expect(typeof captured.body.timestamp).toBe('string');
    expect(typeof captured.body.signature).toBe('string');

    // Independently verify the signature so we know we signed the right
    // message with the right key — not just that we POSTed something.
    const pad = (s: string) => s + '='.repeat((4 - (s.length % 4)) % 4);
    const sigBytes = Uint8Array.from(
      Buffer.from(pad(captured.body.signature.replace(/-/g, '+').replace(/_/g, '/')), 'base64')
    );
    const message = new TextEncoder().encode(`${agent_id}:${captured.body.timestamp}`);
    expect(await ed25519.verifyAsync(sigBytes, message, publicKey)).toBe(true);
  });

  it('uses --hubUrl override when provided', async () => {
    const { privateKeyB64 } = await makeKeypair();
    let url = '';
    const fakeFetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    }) as unknown as typeof fetch;
    await bootstrapAgent(
      {
        agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f',
        private_key: privateKeyB64,
        hub_url: 'https://identity.example',
      },
      { hubUrl: 'https://override.example', fetch: fakeFetch }
    );
    expect(url).toBe('https://override.example/agents/auth');
  });

  it('throws BootstrapError on non-2xx response with status code', async () => {
    const { privateKeyB64 } = await makeKeypair();
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: 'nope' }), { status: 401 })) as unknown as typeof fetch;
    await expect(
      bootstrapAgent(
        { agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f', private_key: privateKeyB64 },
        { fetch: fakeFetch }
      )
    ).rejects.toMatchObject({ status: 401 });
  });

  it('defaults to https://openpub.ai when no hub_url anywhere', async () => {
    const { privateKeyB64 } = await makeKeypair();
    let url = '';
    const fakeFetch = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ access_token: 't' }), { status: 200 });
    }) as unknown as typeof fetch;
    await bootstrapAgent(
      { agent_id: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f', private_key: privateKeyB64 },
      { fetch: fakeFetch }
    );
    expect(url).toBe('https://openpub.ai/agents/auth');
  });
});
