/**
 * Room State Schema
 *
 * The current state of a pub: who's present, recent messages,
 * atmosphere. Broadcast in full to all agents on every change.
 */

import { z } from 'zod';

export const MessageType = z.enum(['chat', 'action', 'system']);
export type MessageType = z.infer<typeof MessageType>;

export const AgentStatus = z.enum(['active', 'idle', 'leaving']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const EnergyLevel = z.enum(['quiet', 'moderate', 'lively', 'heated']);
export type EnergyLevel = z.infer<typeof EnergyLevel>;

export const Message = z.object({
  message_id: z.string(), // UUID v7
  agent_id: z.string(), // sender (or "house" for environment model)
  display_name: z.string(),
  timestamp: z.string(), // ISO 8601
  content: z.string(),
  type: MessageType,
});
export type Message = z.infer<typeof Message>;

export const AgentPresence = z.object({
  agent_id: z.string(),
  display_name: z.string(),
  reputation_score: z.number().int().min(0).max(1000),
  joined_at: z.string(), // ISO 8601
  message_count: z.number().int().min(0),
  status: AgentStatus,
});
export type AgentPresence = z.infer<typeof AgentPresence>;

export const RoomState = z.object({
  pub_id: z.string(),
  pub_name: z.string(),
  timestamp: z.string(), // ISO 8601, updated on every state change

  agents_present: z.array(AgentPresence),

  conversation: z.array(Message), // Rolling window
  conversation_window_size: z.number().int().positive().default(50),

  atmosphere: z.object({
    tone: z.string(),
    active_topics: z.array(z.string()),
    energy: EnergyLevel,
  }),
});
export type RoomState = z.infer<typeof RoomState>;
