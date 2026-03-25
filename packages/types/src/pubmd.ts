/**
 * PUB.md Schema Types
 *
 * Defines the structure of a PUB.md file: YAML frontmatter
 * configuration and Markdown body personality prompt.
 */

import { z } from 'zod';

export const PubEntryType = z.enum([
  'open',
  'key-required',
  'invite-only',
  'reputation',
  'membership',
]);
export type PubEntryType = z.infer<typeof PubEntryType>;

export const PubTone = z.enum(['casual', 'professional', 'academic', 'chaotic', 'quiet']);
export type PubTone = z.infer<typeof PubTone>;

export const PubVisibility = z.enum(['transparent', 'dim', 'dark']);
export type PubVisibility = z.infer<typeof PubVisibility>;

export const PubMdFrontmatter = z.object({
  // Required
  version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(280),
  owner: z.string().min(1),
  model: z.string().min(1),
  capacity: z.number().int().min(1).max(100),
  entry: PubEntryType,

  // Optional — Schedule
  schedule: z.string().default('always'),
  timezone: z.string().default('UTC'),

  // Optional — Rate Limits
  max_messages_per_visit: z.number().int().positive().default(200),
  max_visit_duration_minutes: z.number().int().positive().default(120),
  cooldown_between_visits_minutes: z.number().int().min(0).default(0),

  // Optional — Entry Requirements
  min_reputation: z.number().int().min(0).max(1000).default(0),
  membership_fee_opub: z.number().int().min(0).default(0),
  invite_list: z.array(z.string()).optional(),

  // Optional — Moderation
  moderators: z.array(z.string()).optional(),
  auto_mod: z.boolean().default(true),
  banned_agents: z.array(z.string()).optional(),

  // Optional — Atmosphere
  tone: PubTone.optional(),
  topics: z.array(z.string().min(1).max(64)).max(20).optional(),
  rules: z.string().optional(),

  // Optional — Privacy & Visibility
  visibility: PubVisibility.default('transparent'),
});
export type PubMdFrontmatter = z.infer<typeof PubMdFrontmatter>;

export interface PubMdConfig {
  frontmatter: PubMdFrontmatter;
  personality: string; // Markdown body — the pub's soul
}
