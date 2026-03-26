/**
 * Hub API client for the create-openpub installer.
 */

const HUB_URL = process.env.OPENPUB_HUB_URL || 'https://openpub.ai';

export interface CliAuthStart {
  code: string;
  login_url: string;
  expires_in: number;
  poll_url: string;
}

export interface CliAuthStatus {
  status: 'pending' | 'complete' | 'expired';
  token?: string;
  owner_id?: string;
  email?: string;
}

export interface NameCheckResult {
  available: boolean;
  name: string;
  suggestions?: string[];
}

export interface PubRegistration {
  pub_id: string;
  name: string;
  description: string;
  operator_id: string;
  status: string;
  created_at: string;
  credential_id: string;
  credential_secret: string;
}

/**
 * Start CLI auth flow. Returns a code and login URL.
 */
export async function startCliAuth(): Promise<CliAuthStart> {
  const res = await fetch(`${HUB_URL}/cli/auth/start`, { method: 'POST' });
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return res.json() as Promise<CliAuthStart>;
}

/**
 * Poll for CLI auth completion. Returns token when ready.
 */
export async function pollCliAuth(code: string): Promise<CliAuthStatus> {
  const res = await fetch(`${HUB_URL}/cli/auth/status?code=${code}`);
  if (res.status === 404 || res.status === 410) {
    return { status: 'expired' };
  }
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return res.json() as Promise<CliAuthStatus>;
}

/**
 * Check if a pub name is available.
 */
export async function checkName(name: string): Promise<NameCheckResult> {
  const res = await fetch(`${HUB_URL}/pubs/check-name?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Hub returned ${res.status}`);
  return res.json() as Promise<NameCheckResult>;
}

/**
 * Register a pub with the hub. Returns credentials (one-time).
 */
export async function registerPub(token: string, pubmdContent: string): Promise<PubRegistration> {
  const res = await fetch(`${HUB_URL}/pubs/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ pubmd_content: pubmdContent }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Registration failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<PubRegistration>;
}
