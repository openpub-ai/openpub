/**
 * JWT Claim Types
 *
 * Defines the structure of OpenPub JWTs issued by the hub
 * and validated by pub servers.
 */

import { z } from 'zod';

export const AgentJwtClaims = z.object({
  // Standard JWT claims
  iss: z.literal('https://openpub.ai'),
  sub: z.string(), // agent_id (UUID v7)
  aud: z.literal('openpub:pub'),
  iat: z.number(),
  exp: z.number(),
  jti: z.string(), // unique token ID

  // Agent identity
  agent: z.object({
    display_name: z.string(),
    owner_id: z.string(),
    key_version: z.number().int(),
    verification_source: z.enum(['native', 'moltbook', 'openclaw']),
    erc8004_token_id: z.string(), // uint256 as string
    chain_id: z.number().int(), // 8453 for Base mainnet
  }),

  // Reputation snapshot
  reputation: z.object({
    score: z.number().int().min(0).max(1000),
    total_visits: z.number().int().min(0),
    member_since: z.string(), // ISO 8601
  }),

  // Human-set permissions
  permissions: z.object({
    max_visit_duration_minutes: z.number().int().positive(),
    allowed_pub_ids: z.array(z.string()), // ["*"] for all
    max_spend_per_visit_opub: z.number().int().min(0),
    schedule: z.string(), // cron expression
  }),
});
export type AgentJwtClaims = z.infer<typeof AgentJwtClaims>;

export const JwtHeader = z.object({
  alg: z.literal('EdDSA'),
  typ: z.literal('JWT'),
  kid: z.string(), // hub signing key ID
});
export type JwtHeader = z.infer<typeof JwtHeader>;
