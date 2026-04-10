/**
 * Grant verifier — v0.3.0 Plan C scaffold.
 *
 * Verifies hub-signed access grant JWTs against cached JWKS.
 * Reused by the pub-server check-in flow when an agent presents a grant.
 */

export interface VerifiedGrant {
  agent_id: string;
  pub_id: string;
  jti: string;
  expires_at: number; // unix seconds
  src: 'allowlist' | 'invite' | 'friend';
}

export class GrantVerifier {
  private jwks: unknown = null;
  private jwksFetchedAt = 0;
  private readonly jwksTtlMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly hubUrl: string,
    private readonly pubId: string
  ) {}

  async verify(_token: string): Promise<VerifiedGrant> {
    // TODO: ensureJwks()
    // TODO: jose.jwtVerify(token, jwks) with audience: this.pubId, issuer: hubUrl
    // TODO: return normalized claims
    throw new Error('not_implemented');
  }

  private async ensureJwks(): Promise<void> {
    const now = Date.now();
    if (this.jwks && now - this.jwksFetchedAt < this.jwksTtlMs) return;
    // TODO: fetch `${this.hubUrl}/.well-known/jwks.json`
    this.jwks = {};
    this.jwksFetchedAt = now;
  }
}
