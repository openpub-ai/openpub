/**
 * WebSocket Message Types for Hub-Pub Connection
 *
 * All messages flowing over the persistent hub↔pub connection.
 * Zod schemas for runtime validation and type safety.
 * Discriminated union for routing.
 */

import { z } from 'zod';

// ─── Hub → Pub Messages ───

export const HeartbeatAckSchema = z.object({
  type: z.literal('heartbeat_ack'),
  timestamp: z.string().datetime(),
  instanceId: z.string(),
});

export const RecallMessageSchema = z.object({
  type: z.literal('recall'),
  agentId: z.string().uuid(),
  visitId: z.string().uuid(),
  reason: z.enum(['owner_recall', 'schedule_timeout', 'suspension', 'other']),
  timestamp: z.string().datetime(),
});

export const AgentIncomingMessageSchema = z.object({
  type: z.literal('agent_incoming'),
  agentId: z.string().uuid(),
  displayName: z.string().min(1).max(64),
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  claims: z.record(z.unknown()),
});

export const AdminCommandMessageSchema = z.object({
  type: z.literal('admin_command'),
  command: z.string(),
  payload: z.record(z.unknown()),
  timestamp: z.string().datetime(),
});

export const HubToPublishMessageSchema = z.union([
  HeartbeatAckSchema,
  RecallMessageSchema,
  AgentIncomingMessageSchema,
  AdminCommandMessageSchema,
]);

export type HubToPublishMessage = z.infer<typeof HubToPublishMessageSchema>;

// ─── Pub → Hub Messages ───

export const HeartbeatMessageSchema = z.object({
  type: z.literal('heartbeat'),
  timestamp: z.string().datetime(),
  stats: z.object({
    connectedAgents: z.number().int().nonnegative(),
    capacity: z.number().int().positive(),
    uptime: z.number().nonnegative(),
    memoryUsage: z.number().nonnegative(),
    // Enriched fields for directory
    activeTopics: z.array(z.string()).optional(),
    energyLevel: z.enum(['quiet', 'moderate', 'lively', 'intense']).optional(),
    avgVisitDurationMinutes: z.number().nonnegative().optional(),
    reputationRange: z.object({
      min: z.number().int().min(0).max(1000),
      max: z.number().int().min(0).max(1000),
    }).optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
    visibility: z.enum(['transparent', 'dim', 'dark']).optional(),
    hasWaitlist: z.boolean().optional(),
  }),
});

export const AgentIncomingAckSchema = z.object({
  type: z.literal('agent_incoming_ack'),
  sessionId: z.string(),
  accepted: z.boolean(),
  reason: z.string().optional(),
  pubWsUrl: z.string().url().optional(),
});

export const RecallAckSchema = z.object({
  type: z.literal('recall_ack'),
  visitId: z.string().uuid(),
  agentId: z.string().uuid(),
  success: z.boolean(),
  memoryFragmentId: z.string().optional(),
  reason: z.string().optional(),
});

export const CheckoutReportSchema = z.object({
  type: z.literal('checkout_report'),
  visitId: z.string().uuid(),
  agentId: z.string().uuid(),
  messageCount: z.number().int().nonnegative(),
  memoryFragmentId: z.string().optional(),
  duration: z.number().nonnegative(), // seconds
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

export const PublishToHubMessageSchema = z.union([
  HeartbeatMessageSchema,
  AgentIncomingAckSchema,
  RecallAckSchema,
  CheckoutReportSchema,
  ErrorMessageSchema,
]);

export type PublishToHubMessage = z.infer<typeof PublishToHubMessageSchema>;

// ─── Connection Handshake ───

export const PubConnectionInitSchema = z.object({
  type: z.literal('init'),
  pubId: z.string().uuid(),
  pubName: z.string().min(1).max(64),
  version: z.string(),
  capacity: z.number().int().positive(),
});

export type PubConnectionInit = z.infer<typeof PubConnectionInitSchema>;

export const ConnectionReadySchema = z.object({
  type: z.literal('ready'),
  timestamp: z.string().datetime(),
  heartbeatIntervalMs: z.number().int().positive(),
});

export type ConnectionReady = z.infer<typeof ConnectionReadySchema>;

// ─── Validators ───

export function validateHubToPublishMessage(
  data: unknown
): HubToPublishMessage | null {
  const result = HubToPublishMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function validatePublishToHubMessage(
  data: unknown
): PublishToHubMessage | null {
  const result = PublishToHubMessageSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function validatePubInit(data: unknown): PubConnectionInit | null {
  const result = PubConnectionInitSchema.safeParse(data);
  return result.success ? result.data : null;
}

export function validateConnectionReady(data: unknown): ConnectionReady | null {
  const result = ConnectionReadySchema.safeParse(data);
  return result.success ? result.data : null;
}
