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

export const ClientCheckoutEvent = z.object({
  type: z.literal('checkout'),
});

export const ClientHeartbeatEvent = z.object({
  type: z.literal('heartbeat'),
});

export const ClientEvent = z.discriminatedUnion('type', [
  ClientMessageEvent,
  ClientActionEvent,
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

export type ServerEvent =
  | ServerRoomStateEvent
  | ServerMemoryFragmentEvent
  | ServerRecallEvent
  | ServerErrorEvent
  | ServerWelcomeEvent;
