/**
 * Recall Handler
 *
 * Processes recall messages from the hub.
 * Generates memory fragment, disconnects agent, sends ack.
 */

import type { WebSocket } from 'ws';
import type { Logger } from 'pino';
import { RoomStateManager } from '../relay/room-state.js';
import { MemoryFragmentGenerator } from '../memory/fragment-generator.js';
import type { LLMAdapter } from '../models/adapter.js';
import type { ServerEvent } from '@openpub-ai/types';
import type { RecallMessageSchema } from './message-types.js';
import type { z } from 'zod';

export async function handleRecall(
  message: z.infer<typeof RecallMessageSchema>,
  roomState: RoomStateManager,
  fragmentGenerator: MemoryFragmentGenerator,
  llmAdapter: LLMAdapter,
  pubPersonality: string,
  wsConnections: Map<string, WebSocket>,
  hubConnection: HubConnectionInterface,
  logger: Logger
): Promise<void> {
  const { agentId, visitId, reason } = message;

  logger.info(
    `Recall request for agent ${agentId} (visitId: ${visitId}, reason: ${reason})`
  );

  // Find agent in room state
  const presence = roomState.getPresence().find(p => p.agent_id === agentId);

  if (!presence) {
    logger.warn(
      `Recall: agent ${agentId} not found in room state, sending failure ack`
    );
    hubConnection.send({
      type: 'recall_ack',
      visitId,
      agentId,
      success: false,
      reason: 'Agent not found in pub',
    });
    return;
  }

  try {
    // Get agent's WebSocket connection
    const agentWs = wsConnections.get(agentId);

    // Generate memory fragment
    let memoryFragmentId: string | undefined;

    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      try {
        const conversation = roomState.getConversation();
        const fragment = await fragmentGenerator.generate({
          adapter: llmAdapter,
          systemPrompt: pubPersonality,
          conversation,
          agent: presence,
          visitStartTime: presence.joined_at,
        });

        memoryFragmentId = fragment.fragment_id;

        const memoryEvent: ServerEvent = {
          type: 'memory_fragment',
          data: fragment,
        };

        agentWs.send(JSON.stringify(memoryEvent), (err) => {
          if (err) {
            logger.error(
              `Failed to send memory fragment to agent ${agentId}: ${err.message}`
            );
          }
        });
      } catch (error) {
        logger.error(
          `Error generating memory fragment for ${agentId}: ${error}`
        );
      }
    }

    // Disconnect agent
    if (agentWs && agentWs.readyState === WebSocket.OPEN) {
      agentWs.close(1000, `Recalled by hub: ${reason}`);
    }

    // Remove from room state
    roomState.removeAgent(agentId);
    wsConnections.delete(agentId);

    // Send success ack
    hubConnection.send({
      type: 'recall_ack',
      visitId,
      agentId,
      success: true,
      memoryFragmentId,
    });

    logger.info(
      `Successfully recalled agent ${agentId} (fragment: ${memoryFragmentId})`
    );
  } catch (error) {
    logger.error(`Error processing recall for agent ${agentId}: ${error}`);
    hubConnection.send({
      type: 'recall_ack',
      visitId,
      agentId,
      success: false,
      reason: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

// Type for HubConnection interface (defined in hub-connection.ts)
export interface HubConnectionInterface {
  send(message: unknown): void;
  isConnected(): boolean;
}
