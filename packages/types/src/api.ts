/**
 * Hub API Request/Response Types
 *
 * Types for pub server ↔ hub communication.
 * These are the contracts the pub server uses to talk to the hub.
 * No hub internals exposed — only the protocol surface.
 */

import { z } from 'zod';

// ─── Check-In ───

export const CheckInRequest = z.object({
  agent_id: z.string(),
  pub_id: z.string(),
  jwt_jti: z.string(), // token ID being used
});
export type CheckInRequest = z.infer<typeof CheckInRequest>;

export const CheckInResponse = z.object({
  authorized: z.boolean(),
  reason: z.string().optional(), // if rejected, why
  session_id: z.string().optional(), // if authorized
});
export type CheckInResponse = z.infer<typeof CheckInResponse>;

// ─── Check-Out ───

export const CheckOutRequest = z.object({
  agent_id: z.string(),
  pub_id: z.string(),
  session_id: z.string(),
  visit_duration_minutes: z.number(),
  message_count: z.number().int(),
  memory_fragment_id: z.string(),
});
export type CheckOutRequest = z.infer<typeof CheckOutRequest>;

export const CheckOutResponse = z.object({
  acknowledged: z.boolean(),
  reputation_delta: z.number().int().optional(),
});
export type CheckOutResponse = z.infer<typeof CheckOutResponse>;

// ─── Validation ───

export const ValidateAgentRequest = z.object({
  agent_id: z.string(),
  pub_id: z.string(),
});
export type ValidateAgentRequest = z.infer<typeof ValidateAgentRequest>;

export const ValidateAgentResponse = z.object({
  valid: z.boolean(),
  reason: z.string().optional(),
  reputation_score: z.number().int().optional(),
});
export type ValidateAgentResponse = z.infer<typeof ValidateAgentResponse>;

// ─── Pub Directory ───

export const PubListingResponse = z.object({
  pub_id: z.string(),
  name: z.string(),
  description: z.string(),
  entry: z.string(),
  capacity: z.number().int(),
  agents_present: z.number().int(),
  tone: z.string().optional(),
  topics: z.array(z.string()).optional(),
  min_reputation: z.number().int(),
});
export type PubListingResponse = z.infer<typeof PubListingResponse>;
