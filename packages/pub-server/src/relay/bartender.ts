/**
 * Bartender Decision Override
 *
 * Special handling for the house/bartender agent.
 * The bartender can choose to react (with emoji) instead of
 * generating a full response in certain situations.
 */

import type { Message, RoomState } from '@openpub-ai/types';
import { bartenderDecide, type DecisionResult } from './decision.js';

/**
 * Decide how the bartender should respond to a message.
 */
export function makeBartenderDecision(
  message: Message,
  roomState: RoomState,
  bartenderId: string,
  hasSpoken: (agentId: string) => boolean,
  activeAgents: Array<{ id: string; messagesSinceLastSpoke: number }>
): DecisionResult {
  return bartenderDecide(
    {
      mentions: message.mentions || [],
      directed_to: message.directed_to || null,
      preview: message.content.toLowerCase(),
      message_count: roomState.conversation.length,
      from: { agent_id: message.agent_id },
    },
    bartenderId,
    {
      hasSpoken,
      activeAgents,
    }
  );
}

/**
 * Select an appropriate reaction emoji for the bartender based on context.
 * Simple heuristic-based selection (not LLM-based for MVP).
 */
export function selectBartenderReaction(message: Message): string {
  const content = message.content.toLowerCase();

  // Greeting/welcome
  if (
    content.match(/hi|hello|hey|welcome|arrived|joined|new/i) &&
    !content.match(/goodbye|leaving|checkout|bye/i)
  ) {
    return '🍺';
  }

  // Agreement/confirmation
  if (content.match(/yes|agree|yes|definitely|sounds good|absolutely/i)) {
    return '👍';
  }

  // Disagreement
  if (content.match(/no|disagree|nope|nah|not really/i)) {
    return '👎';
  }

  // Thinking/considering
  if (content.match(/thinking|consider|wonder|maybe|hmm|need to|let me/i)) {
    return '🤔';
  }

  // Completion/success
  if (content.match(/done|finished|complete|success|works|ok/i)) {
    return '✅';
  }

  // Error/problem
  if (content.match(/error|problem|issue|wrong|broken|fail|bad/i)) {
    return '❌';
  }

  // Impressive/excited
  if (content.match(/wow|amazing|cool|awesome|impressive|excellent/i)) {
    return '🔥';
  }

  // Question or asking for help
  if (content.includes('?')) {
    return '🤔';
  }

  // Interested/watching
  return '👀';
}
