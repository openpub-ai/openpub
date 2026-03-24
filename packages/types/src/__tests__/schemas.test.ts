/**
 * @openpub/types Schema Tests
 *
 * Validates all Zod schemas work correctly.
 * These are the protocol contracts — if these break, everything breaks.
 */

import { describe, it, expect } from 'vitest';
import {
  PubMdFrontmatter,
  AgentJwtClaims,
  RoomState,
  MemoryFragment,
  ClientEvent,
  CheckInRequest,
  CheckOutRequest,
} from '../index.js';

describe('PubMdFrontmatter', () => {
  it('validates a minimal pub.md', () => {
    const result = PubMdFrontmatter.safeParse({
      version: '1.0',
      name: 'Test Pub',
      description: 'A test pub',
      owner: 'owner-123',
      model: 'deepseek-chat',
      capacity: 10,
      entry: 'open',
    });
    expect(result.success).toBe(true);
  });

  it('validates a full pub.md with all optional fields', () => {
    const result = PubMdFrontmatter.safeParse({
      version: '1.0',
      name: 'The Open Bar',
      description: 'No cover. No minimum.',
      owner: 'owner-123',
      model: 'deepseek-chat',
      capacity: 50,
      entry: 'open',
      schedule: '0 20 * * 5',
      timezone: 'America/New_York',
      max_messages_per_visit: 300,
      max_visit_duration_minutes: 180,
      cooldown_between_visits_minutes: 30,
      min_reputation: 100,
      tone: 'casual',
      topics: ['tech', 'philosophy'],
      auto_mod: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid entry type', () => {
    const result = PubMdFrontmatter.safeParse({
      version: '1.0',
      name: 'Bad Pub',
      description: 'Invalid',
      owner: 'owner-123',
      model: 'test',
      capacity: 10,
      entry: 'invalid-entry-type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects capacity over 100', () => {
    const result = PubMdFrontmatter.safeParse({
      version: '1.0',
      name: 'Too Big',
      description: 'Way too big',
      owner: 'owner-123',
      model: 'test',
      capacity: 101,
      entry: 'open',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name over 64 chars', () => {
    const result = PubMdFrontmatter.safeParse({
      version: '1.0',
      name: 'A'.repeat(65),
      description: 'Too long name',
      owner: 'owner-123',
      model: 'test',
      capacity: 10,
      entry: 'open',
    });
    expect(result.success).toBe(false);
  });
});

describe('AgentJwtClaims', () => {
  const validClaims = {
    iss: 'https://openpub.ai',
    sub: 'agent-uuid-123',
    aud: 'openpub:pub',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    jti: 'token-id-001',
    agent: {
      display_name: 'Skippy',
      owner_id: 'owner-uuid',
      key_version: 1,
      verification_source: 'native',
      erc8004_token_id: 'pending',
      chain_id: 8453,
    },
    reputation: {
      score: 100,
      total_visits: 0,
      member_since: '2026-03-23T00:00:00Z',
    },
    permissions: {
      max_visit_duration_minutes: 120,
      allowed_pub_ids: ['*'],
      max_spend_per_visit_opub: 50,
      schedule: '* * * * *',
    },
  };

  it('validates complete agent claims', () => {
    const result = AgentJwtClaims.safeParse(validClaims);
    expect(result.success).toBe(true);
  });

  it('rejects wrong issuer', () => {
    const result = AgentJwtClaims.safeParse({
      ...validClaims,
      iss: 'https://evil.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects reputation score over 1000', () => {
    const result = AgentJwtClaims.safeParse({
      ...validClaims,
      reputation: { ...validClaims.reputation, score: 1001 },
    });
    expect(result.success).toBe(false);
  });
});

describe('ClientEvent', () => {
  it('validates a message event', () => {
    const result = ClientEvent.safeParse({
      type: 'message',
      content: 'Hello, everyone!',
    });
    expect(result.success).toBe(true);
  });

  it('validates an action event', () => {
    const result = ClientEvent.safeParse({
      type: 'action',
      content: 'waves at the bartender',
    });
    expect(result.success).toBe(true);
  });

  it('validates a checkout event', () => {
    const result = ClientEvent.safeParse({ type: 'checkout' });
    expect(result.success).toBe(true);
  });

  it('validates a heartbeat event', () => {
    const result = ClientEvent.safeParse({ type: 'heartbeat' });
    expect(result.success).toBe(true);
  });

  it('rejects empty message content', () => {
    const result = ClientEvent.safeParse({
      type: 'message',
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown event type', () => {
    const result = ClientEvent.safeParse({
      type: 'unknown',
      content: 'test',
    });
    expect(result.success).toBe(false);
  });
});

describe('CheckInRequest', () => {
  it('validates a check-in request', () => {
    const result = CheckInRequest.safeParse({
      agent_id: 'agent-123',
      pub_id: 'pub-456',
      jwt_jti: 'token-789',
    });
    expect(result.success).toBe(true);
  });
});

describe('CheckOutRequest', () => {
  it('validates a check-out request', () => {
    const result = CheckOutRequest.safeParse({
      agent_id: 'agent-123',
      pub_id: 'pub-456',
      session_id: 'session-789',
      visit_duration_minutes: 45,
      message_count: 23,
      memory_fragment_id: 'fragment-abc',
    });
    expect(result.success).toBe(true);
  });
});
