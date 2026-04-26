/**
 * LocalIssuer round-trip tests.
 */

import { existsSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JWT_AUDIENCE, JWT_ISSUER } from '@openpub-ai/types';
import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JwtValidator } from './jwt-validator.js';
import { LocalIssuer, type LocalAgentForToken } from './local-issuer.js';

const sampleAgent: LocalAgentForToken = {
  agentId: '01919c4e-9a12-7000-8000-1a2b3c4d5e6f',
  displayName: 'Carl',
  ownerId: 'local',
  keyVersion: 1,
  verificationSource: 'native',
  reputationScore: 100,
  totalVisits: 0,
  createdAt: new Date('2026-04-26T00:00:00.000Z'),
  permissions: {
    max_visit_duration_minutes: 1440,
    allowed_pub_ids: ['*'],
    max_spend_per_visit_opub: 0,
    schedule: '* * * * *',
  },
};

describe('LocalIssuer', () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'openpub-local-issuer-'));
    keyPath = join(dir, 'issuer.key');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('generates and persists an Ed25519 keypair on first call', async () => {
    const issuer = await LocalIssuer.loadOrCreate(keyPath);
    expect(existsSync(keyPath)).toBe(true);
    expect(issuer.kid).toMatch(/^local-[0-9a-f]{16}$/);
    // 0o600 = owner read/write only
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it('loads the same key on a second call (idempotent)', async () => {
    const a = await LocalIssuer.loadOrCreate(keyPath);
    const b = await LocalIssuer.loadOrCreate(keyPath);
    expect(b.kid).toBe(a.kid);
    expect(b.getPublicJwk().x).toBe(a.getPublicJwk().x);
  });

  it('issues a token that JwtValidator (local mode) accepts end-to-end', async () => {
    const issuer = await LocalIssuer.loadOrCreate(keyPath);
    const { accessToken, expiresIn } = await issuer.issueAccessToken(sampleAgent);
    expect(expiresIn).toBe(3600);

    const validator = new JwtValidator('http://unused.example', console as any, {
      jwk: issuer.getPublicJwk(),
      kid: issuer.kid,
    });
    const claims = await validator.validate(accessToken);
    expect(claims.sub).toBe(sampleAgent.agentId);
    expect(claims.iss).toBe(JWT_ISSUER);
    expect(claims.aud).toBe(JWT_AUDIENCE);
    expect(claims.agent.display_name).toBe(sampleAgent.displayName);
    expect(claims.reputation.score).toBe(100);
  });

  it('a token signed by issuer A does not validate against issuer B', async () => {
    const issuerA = await LocalIssuer.loadOrCreate(keyPath);
    const otherPath = join(dir, 'other.key');
    const issuerB = await LocalIssuer.loadOrCreate(otherPath);
    const { accessToken } = await issuerA.issueAccessToken(sampleAgent);

    const validatorB = new JwtValidator('http://unused.example', console as any, {
      jwk: issuerB.getPublicJwk(),
      kid: issuerB.kid,
    });
    await expect(validatorB.validate(accessToken)).rejects.toThrow();
  });

  it('exports a public JWK in the shape jose can re-import', async () => {
    const issuer = await LocalIssuer.loadOrCreate(keyPath);
    const jwk = issuer.getPublicJwk();
    expect(jwk.kty).toBe('OKP');
    expect(jwk.crv).toBe('Ed25519');
    expect(jwk.kid).toBe(issuer.kid);
    expect(jwk.alg).toBe('EdDSA');
    expect(jwk.use).toBe('sig');
    // Sanity: the JWK round-trips through jose's importer.
    await jose.importJWK(jwk, 'EdDSA');
  });
});
