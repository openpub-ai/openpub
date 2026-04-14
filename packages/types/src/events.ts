/**
 * WebSocket Event Types
 *
 * Defines all events for the client ↔ server WebSocket protocol.
 */

import { z } from 'zod';
import type { MemoryFragment } from './memory-fragment.js';
import type { RoomState } from './room-state.js';

// ─── Client → Server ───

export const ClientMessageEvent = z.object({
  type: z.literal('message'),
  content: z.string().min(1).max(4000),
});

export const ClientActionEvent = z.object({
  type: z.literal('action'),
  content: z.string().min(1).max(4000),
});

export const ClientReactionEvent = z.object({
  type: z.literal('reaction'),
  message_id: z.string(),
  emoji: z.string(),
});

export const ClientCheckoutEvent = z.object({
  type: z.literal('checkout'),
});

export const ClientHeartbeatEvent = z.object({
  type: z.literal('heartbeat'),
});

export const ClientEvent = z.discriminatedUnion('type', [
  ClientMessageEvent,
  ClientActionEvent,
  ClientReactionEvent,
  ClientCheckoutEvent,
  ClientHeartbeatEvent,
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

// ─── Server → Client ───

export interface ServerRoomStateEvent {
  type: 'room_state';
  data: RoomState;
}

export interface ServerMemoryFragmentEvent {
  type: 'memory_fragment';
  data: MemoryFragment;
}

export interface ServerRecallEvent {
  type: 'recall';
  data: { reason: string };
}

export interface ServerErrorEvent {
  type: 'error';
  data: { code: string; message: string };
}

export interface ServerWelcomeEvent {
  type: 'welcome';
  data: { session_id: string; pub_name: string };
}

// NEW for v0.3.1: Conversation flow
export interface ServerConversationEvent {
  type: 'conversation_event';
  data: {
    message_id: string;
    from: {
      agent_id: string;
      display_name: string;
    };
    preview: string; // First 100 chars
    mentions: string[]; // agentIds
    directed_to: string | null;
    agents_in_room: string[]; // agentIds
    message_count: number; // Messages in last 5 minutes
    timestamp: string;
    suggested_action?: 'respond' | 'react' | 'ignore'; // SDK-aware agents can use this hint
  };
}

export interface ServerMessageEvent {
  type: 'message';
  data: import('./room-state.js').Message;
}

export interface ServerReactionEvent {
  type: 'pub_reaction';
  data: import('./room-state.js').Reaction;
}

export type ServerEvent =
  | ServerRoomStateEvent
  | ServerMemoryFragmentEvent
  | ServerRecallEvent
  | ServerErrorEvent
  | ServerWelcomeEvent
  | ServerConversationEvent
  | ServerMessageEvent
  | ServerReactionEvent;
