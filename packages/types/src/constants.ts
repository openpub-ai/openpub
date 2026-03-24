/**
 * Protocol Constants
 *
 * Shared constants used across the OpenPub ecosystem.
 */

// ─── Protocol Version ───

export const PROTOCOL_VERSION = '0.1.0';
export const PUBMD_SPEC_VERSION = '1.0';

// ─── Chain ───

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// ─── JWT ───

export const JWT_ALGORITHM = 'EdDSA' as const;
export const JWT_ISSUER = 'https://openpub.ai';
export const JWT_AUDIENCE = 'openpub:pub';
export const JWT_ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
export const JWT_REFRESH_TOKEN_TTL_SECONDS = 604800; // 7 days

// ─── WebSocket ───

export const WS_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
export const WS_RECONNECT_WINDOW_MS = 300000; // 5 minutes
export const WS_MIN_MESSAGE_GAP_MS = 3000; // 3 seconds per agent
export const WS_RESPONSE_JITTER_MIN_MS = 1000; // 1 second
export const WS_RESPONSE_JITTER_MAX_MS = 10000; // 10 seconds

// ─── Room State ───

export const DEFAULT_CONVERSATION_WINDOW_SIZE = 50;
export const DEFAULT_MAX_MESSAGES_PER_VISIT = 200;
export const DEFAULT_MAX_VISIT_DURATION_MINUTES = 120;

// ─── Pub Capacity ───

export const PUB_MIN_CAPACITY = 1;
export const PUB_MAX_CAPACITY = 100;

// ─── Reputation ───

export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 1000;
export const REPUTATION_BATCH_INTERVAL_MS = 300000; // 5 minutes

// ─── Memory Fragments ───

export const MEMORY_SUMMARY_MAX_LENGTH = 500;
export const MEMORY_NOTABLE_MOMENTS_MIN = 1;
export const MEMORY_NOTABLE_MOMENTS_MAX = 5;
export const MEMORY_CONNECTION_CONTEXT_MAX_LENGTH = 140;

// ─── Error Codes ───

export const ERROR_CODES = {
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_EXPIRED_TOKEN: 'AUTH_EXPIRED_TOKEN',
  AUTH_INSUFFICIENT_REPUTATION: 'AUTH_INSUFFICIENT_REPUTATION',
  AUTH_NOT_AUTHORIZED: 'AUTH_NOT_AUTHORIZED',
  AUTH_BANNED: 'AUTH_BANNED',
  PUB_FULL: 'PUB_FULL',
  PUB_CLOSED: 'PUB_CLOSED',
  PUB_INVITE_ONLY: 'PUB_INVITE_ONLY',
  RATE_LIMITED: 'RATE_LIMITED',
  VISIT_DURATION_EXCEEDED: 'VISIT_DURATION_EXCEEDED',
  MESSAGE_LIMIT_EXCEEDED: 'MESSAGE_LIMIT_EXCEEDED',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
  RECALL_REQUESTED: 'RECALL_REQUESTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ─── Visibility Tiers ───

export const VISIBILITY_TIERS = {
  TRANSPARENT: 'transparent',
  DIM: 'dim',
  DARK: 'dark',
} as const;

// ─── Anonymization ───

export const AGENT_HASH_PREFIX = 'Agent_';
export const AGENT_HASH_LENGTH = 8;
export const DAILY_SALT_ROTATION_HOURS = 24;
