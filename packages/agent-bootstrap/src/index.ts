/**
 * @openpub-ai/agent-bootstrap
 *
 * Programmatic helper for the OpenPub agent auth bootstrap. Re-mints
 * a fresh access token from a long-lived Ed25519 keypair. The keypair
 * is the durable identity; tokens are ephemeral and re-minted on demand.
 */

import * as ed25519 from '@noble/ed25519';

export interface AgentIdentity {
  agent_id: string;
  /** Ed25519 private key, base64url-encoded. Common alt names auto-detected by loadIdentity(). */
  private_key: string;
  /** Optional. Defaults to https://openpub.ai. Use a local-trust pub-server URL for on-box deployments. */
  hub_url?: string;
}

export interface BootstrapResult {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

const DEFAULT_HUB = 'https://openpub.ai';

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

/**
 * Mint a fresh access token by signing a current timestamp with the agent's
 * Ed25519 private key and exchanging the signature at /agents/auth.
 *
 * Idempotent. Safe to call on every cold start, on any 401, or any time
 * a new token is desired. Each call returns a new (access, refresh) pair.
 */
export async function bootstrapAgent(
  identity: AgentIdentity,
  options: { hubUrl?: string; fetch?: typeof fetch } = {}
): Promise<BootstrapResult> {
  const hubUrl = options.hubUrl || identity.hub_url || DEFAULT_HUB;
  const httpFetch = options.fetch || fetch;

  const timestamp = new Date().toISOString();
  const message = new TextEncoder().encode(`${identity.agent_id}:${timestamp}`);
  const privateKey = base64UrlToBytes(identity.private_key);
  const sig = await ed25519.signAsync(message, privateKey);

  const url = new URL('/agents/auth', hubUrl).toString();
  const response = await httpFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: identity.agent_id,
      timestamp,
      signature: bytesToBase64Url(sig),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new BootstrapError(
      response.status,
      `agent auth failed: ${response.status} ${response.statusText} ${body}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.access_token !== 'string') {
    throw new BootstrapError(0, `auth response missing access_token: ${JSON.stringify(data)}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    token_type: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : 3600,
  };
}

/**
 * Read an identity file and normalize the keypair fields. Accepts the
 * canonical {agent_id, private_key, hub_url} shape and several common
 * variants (private_key_b64url, privateKey, etc.) so a stale identity
 * file from earlier tooling still works.
 */
export function loadIdentity(file: Record<string, unknown>): AgentIdentity {
  const agent_id = (file.agent_id || file.agentId) as string | undefined;
  const private_key = (file.private_key ||
    file.private_key_b64url ||
    file.privateKey ||
    file.privateKeyB64Url) as string | undefined;
  const hub_url = (file.hub_url || file.hubUrl) as string | undefined;

  if (!agent_id || typeof agent_id !== 'string') {
    throw new BootstrapError(0, 'identity file missing agent_id');
  }
  if (!private_key || typeof private_key !== 'string') {
    throw new BootstrapError(
      0,
      "identity file missing private_key (also tried: private_key_b64url, privateKey, privateKeyB64Url)"
    );
  }

  return { agent_id, private_key, hub_url };
}

export class BootstrapError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}
