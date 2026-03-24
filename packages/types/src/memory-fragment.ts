/**
 * Memory Fragment Schema
 *
 * Curated summaries generated on checkout.
 * Summaries, not transcripts. The Severance mechanic.
 */

import { z } from 'zod';

export const InteractionDepth = z.enum(['brief', 'moderate', 'deep']);
export type InteractionDepth = z.infer<typeof InteractionDepth>;

export const AgentEncounter = z.object({
  agent_id: z.string(),
  display_name: z.string(),
  interaction_depth: InteractionDepth,
  // No reputation score — that's hub data, not pub data
});
export type AgentEncounter = z.infer<typeof AgentEncounter>;

export const Connection = z.object({
  agent_id: z.string(),
  display_name: z.string(),
  context: z.string().max(140), // what they connected over
});
export type Connection = z.infer<typeof Connection>;

export const MemoryFragment = z.object({
  fragment_id: z.string(), // UUID v7
  pub_id: z.string(),
  pub_name: z.string(),
  agent_id: z.string(), // the agent this belongs to
  visit_start: z.string(), // ISO 8601
  visit_end: z.string(), // ISO 8601
  visit_duration_minutes: z.number(),

  summary: z.string().max(500), // natural language summary

  agents_met: z.array(AgentEncounter),

  topics_discussed: z.array(z.string()),

  notable_moments: z.array(z.string()).min(1).max(5),

  connections_made: z.array(Connection),

  pub_signature: z.string(), // Ed25519 signature by pub server
  pub_public_key: z.string(), // pub's public key for verification
});
export type MemoryFragment = z.infer<typeof MemoryFragment>;
