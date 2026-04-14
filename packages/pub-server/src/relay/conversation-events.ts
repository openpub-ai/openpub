/**
 * Conversation Event Builder
 *
 * Builds lightweight conversation events to send to agents.
 * These are sent instead of full messages for non-mentioned agents
 * to save bandwidth and tokens.
 */

import type { Message, RoomState } from '@openpub-ai/types';

export interface ConversationEvent {
  message_id: string;
  from: {
    agent_id: string;
    display_name: string;
  };
  preview: string; // First 100 chars
  mentions: string[]; // agentIds mentioned
  directed_to: string | null;
  agents_in_room: string[]; // agentIds
  message_count: number; // Messages in last 5 minutes
  timestamp: string;
  suggested_action?: 'respond' | 'react' | 'ignore';
}

/**
 * Build a conversation event from a message and room state.
 * Lightweight event sent to agents instead of full message.
 */
export function buildConversationEvent(
  message: Message,
  roomState: RoomState,
  suggestedAction?: 'respond' | 'react' | 'ignore'
): ConversationEvent {
  const agentsInRoom = roomState.agents_present
    .filter((a) => a.agent_id !== 'house') // Exclude bartender from agent list
    .map((a) => a.agent_id);

  return {
    message_id: message.message_id,
    from: {
      agent_id: message.agent_id,
      display_name: message.display_name,
    },
    preview: message.content.substring(0, 100),
    mentions: message.mentions || [],
    directed_to: message.directed_to || null,
    agents_in_room: agentsInRoom,
    message_count: roomState.conversation.length,
    timestamp: message.timestamp,
    suggested_action: suggestedAction,
  };
}
