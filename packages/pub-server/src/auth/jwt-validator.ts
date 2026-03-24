/**
 * JWT Validator
 *
 * Validates agent JWTs locally using the hub's published JWKS.
 * No hub round-trip on every message — only on check-in.
 *
 * Fetches and caches JWKS from the hub's /.well-known/jwks
 * endpoint with a 15-minute refresh interval.
 */

import { importJWK, jwtVerify, type JWTPayload } from 'jose';
import { AgentJwtClaims, JWT_ISSUER, JWT_AUDIENCE } from '@openpub-ai/types';
import { type Logger } from 'pino';

export class JwtValidationError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(`JWT validation error: ${message}`);
    this.name = 'JwtValidationError';
  }
}

interface JwksKey {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  kid: string;
  alg?: string;
  use?: string;
}

interface CachedKey {
  key: JsonWebKey;
  algorithm: string;
  timestamp: number;
}

export class JwtValidator {
  private keyCache = new Map<string, CachedKey>();
  private jwksCache: Map<string, JsonWebKey> | null = null;
  private jwksCacheTimestamp: number = 0;
  private readonly JWKS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  constructor(
    private hubUrl: string,
    private logger: Logger
  ) {}

  private async fetchJwks(): Promise<Map<string, JsonWebKey>> {
    // Check cache validity
    const now = Date.now();
    if (this.jwksCache && now - this.jwksCacheTimestamp < this.JWKS_CACHE_TTL_MS) {
      this.logger.debug('Using cached JWKS');
      return this.jwksCache;
    }

    this.logger.debug(`Fetching JWKS from hub: ${this.hubUrl}`);

    try {
      const jwksUrl = new URL('/.well-known/jwks', this.hubUrl);
      const response = await fetch(jwksUrl.toString());

      if (!response.ok) {
        throw new JwtValidationError(
          'JWKS_FETCH_FAILED',
          `hub returned ${response.status} when fetching JWKS`
        );
      }

      const { keys } = (await response.json()) as { keys: JwksKey[] };

      if (!Array.isArray(keys) || keys.length === 0) {
        throw new JwtValidationError(
          'INVALID_JWKS',
          'hub JWKS contains no keys'
        );
      }

      // Convert JWKS keys to Map keyed by kid
      this.jwksCache = new Map();
      for (const jwk of keys) {
        if (!jwk.kid) {
          this.logger.warn('Skipping JWK without kid');
          continue;
        }

        // Convert to JsonWebKey format for jose
        const jsonWebKey: JsonWebKey = {
          kty: jwk.kty,
          crv: jwk.crv,
          x: jwk.x,
          y: jwk.y,
          kid: jwk.kid,
        };

        this.jwksCache.set(jwk.kid, jsonWebKey);
      }

      this.jwksCacheTimestamp = now;
      this.logger.debug(`Loaded ${this.jwksCache.size} keys from hub JWKS`);

      return this.jwksCache;
    } catch (error) {
      if (error instanceof JwtValidationError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new JwtValidationError(
        'JWKS_FETCH_ERROR',
        `failed to fetch JWKS from hub: ${message}`
      );
    }
  }

  async validate(token: string): Promise<AgentJwtClaims> {
    try {
      // Extract header to get kid
      const headerEnd = token.indexOf('.');
      if (headerEnd === -1) {
        throw new JwtValidationError('INVALID_TOKEN_FORMAT', 'malformed JWT');
      }

      const headerB64 = token.substring(0, headerEnd);
      let header: any;
      try {
        const headerJson = Buffer.from(headerB64, 'base64').toString('utf-8');
        header = JSON.parse(headerJson);
      } catch {
        throw new JwtValidationError('INVALID_TOKEN_FORMAT', 'invalid JWT header');
      }

      const kid = header.kid as string;
      if (!kid) {
        throw new JwtValidationError(
          'INVALID_TOKEN_FORMAT',
          'JWT header missing kid'
        );
      }

      // Get JWKS
      const jwks = await this.fetchJwks();
      const jwkData = jwks.get(kid);

      if (!jwkData) {
        this.logger.info(`Key ${kid} not found in cache, refreshing JWKS`);

        // Invalidate cache and retry once
        this.jwksCache = null;
        this.jwksCacheTimestamp = 0;

        const freshJwks = await this.fetchJwks();
        const freshJwkData = freshJwks.get(kid);

        if (!freshJwkData) {
          throw new JwtValidationError(
            'KEY_NOT_FOUND',
            `key ${kid} not found in hub JWKS after refresh`
          );
        }

        // Use fresh key for verification
        const publicKey = await importJWK(freshJwkData, 'EdDSA');
        const verified = await jwtVerify(token, publicKey, {
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        });

        return AgentJwtClaims.parse(verified.payload);
      }

      // Verify with cached key
      const publicKey = await importJWK(jwkData, 'EdDSA');
      const verified = await jwtVerify(token, publicKey, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      // Parse and validate claims
      return AgentJwtClaims.parse(verified.payload);
    } catch (error) {
      if (error instanceof JwtValidationError) {
        throw error;
      }

      if (error instanceof Error) {
        // jose validation errors
        if (error.message.includes('expired')) {
          throw new JwtValidationError('AUTH_EXPIRED_TOKEN', 'token has expired');
        }

        if (error.message.includes('signature')) {
          throw new JwtValidationError('AUTH_INVALID_TOKEN', 'signature verification failed');
        }

        if (error.message.includes('issuer')) {
          throw new JwtValidationError('AUTH_INVALID_TOKEN', 'issuer claim mismatch');
        }

        if (error.message.includes('audience')) {
          throw new JwtValidationError('AUTH_INVALID_TOKEN', 'audience claim mismatch');
        }

        // Zod validation error
        if ('errors' in error) {
          throw new JwtValidationError('AUTH_INVALID_TOKEN', `invalid claims: ${error.message}`);
        }

        this.logger.error(`JWT validation error: ${error.message}`);
        throw new JwtValidationError(
          'AUTH_INVALID_TOKEN',
          `validation failed: ${error.message}`
        );
      }

      throw new JwtValidationError(
        'AUTH_INVALID_TOKEN',
        'unknown validation error'
      );
    }
  }
}
