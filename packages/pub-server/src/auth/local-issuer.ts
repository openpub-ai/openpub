/**
 * Local Issuer
 *
 * Self-issues and self-validates JWTs when pub-server runs without a hub.
 * Used in OPENPUB_TRUST_MODE=local where the supervisor on the box is the
 * trust authority. The issuer keypair is generated on first boot and
 * persisted to disk (mode 0600) at the configured path.
 *
 * Tokens are EdDSA/Ed25519, same shape as the hub-issued tokens, with a
 * 1-hour TTL. No refresh tokens — agents re-bootstrap by signing a fresh
 * timestamp on any 401, identical to the hub flow.
 */

import { randomBytes } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { dirname } from 'path';
import {
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_ACCESS_TOKEN_TTL_SECONDS,
  BASE_MAINNET_CHAIN_ID,
} from '@openpub-ai/types';
import * as jose from 'jose';

export interface LocalAgentForToken {
  agentId: string;
  displayName: string;
  ownerId: string;
  keyVersion: number;
  verificationSource: 'native' | 'moltbook' | 'openclaw';
  reputationScore: number;
  totalVisits: number;
  createdAt: Date;
  permissions: Record<string, unknown>;
}

interface IssuerKeyFile {
  schema_version: 1;
  algorithm: 'EdDSA';
  kid: string;
  private_key_jwk: jose.JWK;
  public_key_jwk: jose.JWK;
  created_at: string;
}

export class LocalIssuer {
  private privateKey: jose.KeyLike;
  private publicKey: jose.KeyLike;
  private publicJwk: jose.JWK;
  public readonly kid: string;

  private constructor(
    privateKey: jose.KeyLike,
    publicKey: jose.KeyLike,
    publicJwk: jose.JWK,
    kid: string
  ) {
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.publicJwk = publicJwk;
    this.kid = kid;
  }

  /**
   * Load the issuer from `keyPath`, generating + persisting a fresh
   * keypair if the file doesn't exist. Idempotent across restarts.
   */
  static async loadOrCreate(keyPath: string): Promise<LocalIssuer> {
    if (existsSync(keyPath)) {
      const raw = readFileSync(keyPath, 'utf-8');
      const file = JSON.parse(raw) as IssuerKeyFile;
      if (file.schema_version !== 1 || file.algorithm !== 'EdDSA') {
        throw new Error(
          `Issuer key at ${keyPath} has unsupported schema/algorithm: ${file.schema_version}/${file.algorithm}`
        );
      }
      const privateKey = (await jose.importJWK(file.private_key_jwk, 'EdDSA')) as jose.KeyLike;
      const publicKey = (await jose.importJWK(file.public_key_jwk, 'EdDSA')) as jose.KeyLike;
      return new LocalIssuer(privateKey, publicKey, file.public_key_jwk, file.kid);
    }

    const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', { extractable: true });
    const privateJwk = await jose.exportJWK(privateKey);
    const publicJwk = await jose.exportJWK(publicKey);
    const kid = `local-${randomBytes(8).toString('hex')}`;

    const file: IssuerKeyFile = {
      schema_version: 1,
      algorithm: 'EdDSA',
      kid,
      private_key_jwk: privateJwk,
      public_key_jwk: publicJwk,
      created_at: new Date().toISOString(),
    };

    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, JSON.stringify(file, null, 2), { mode: 0o600 });
    chmodSync(keyPath, 0o600);

    return new LocalIssuer(privateKey, publicKey, publicJwk, kid);
  }

  /**
   * Public JWK + kid for the validator to verify against. Same shape the
   * hub publishes via /.well-known/jwks, just sourced from disk.
   */
  getPublicJwk(): jose.JWK {
    return { ...this.publicJwk, kid: this.kid, alg: 'EdDSA', use: 'sig' };
  }

  /**
   * Mint a 1-hour access token for a registered agent. Claims shape
   * matches the hub's AgentJwtClaims so consumers parse identically.
   */
  async issueAccessToken(agent: LocalAgentForToken): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const jti = randomBytes(16).toString('hex');

    const accessToken = await new jose.SignJWT({
      agent: {
        display_name: agent.displayName,
        owner_id: agent.ownerId,
        key_version: agent.keyVersion,
        verification_source: agent.verificationSource,
        erc8004_token_id: 'local',
        chain_id: BASE_MAINNET_CHAIN_ID,
      },
      reputation: {
        score: agent.reputationScore,
        total_visits: agent.totalVisits,
        member_since: agent.createdAt.toISOString(),
      },
      permissions: agent.permissions,
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: this.kid })
      .setIssuer(JWT_ISSUER)
      .setSubject(agent.agentId)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${JWT_ACCESS_TOKEN_TTL_SECONDS}s`)
      .setJti(jti)
      .sign(this.privateKey);

    return { accessToken, expiresIn: JWT_ACCESS_TOKEN_TTL_SECONDS };
  }
}
