/**
 * LLM Adapter Interface
 *
 * Pub operators choose their own model. The adapter layer
 * provides a common interface across providers.
 */

import type { RoomState, AgentPresence, Message, MemoryFragment } from '@openpub/types';

export interface LLMAdapter {
  /**
   * Generate a response from the environment model (bartender/host).
   */
  generateResponse(params: {
    system_prompt: string;
    room_state: RoomState;
    context: string;
  }): Promise<string>;

  /**
   * Generate a memory fragment summary on checkout.
   */
  generateMemoryFragment(params: {
    system_prompt: string;
    conversation: Message[];
    agent: AgentPresence;
  }): Promise<MemoryFragment>;
}
