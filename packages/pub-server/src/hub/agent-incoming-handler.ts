/**
 * Agent Incoming Handler
 *
 * Processes agent_incoming messages from the hub.
 * Validates capacity, bans, and entry requirements.
 * Sends agent_incoming_ack with acceptance or rejection.
 */

import type { Logger } from 'pino';
import { RoomStateManager } from '../relay/room-state.js';
import type { AgentIncomingMessageSchema } from './message-types.js';
import type { z } from 'zod';

export interface PubConfig {
  frontmatter: {
    name: string;
    capacity: number;
    entry?: {
      min_reputation?: number;
      entry_type?: string;
    };
    banned_agents?: string[];
  };
}

export interface HubConnectionInterface {
  send(message: unknown): void;
  isConnected(): boolean;
}

export async function handleAgentIncoming(
  message: z.infer<typeof AgentIncomingMessageSchema>,
  roomState: RoomStateManager,
  pubConfig: PubConfig,
  pubExternalWsUrl: string,
  hubConnection: HubConnectionInterface,
  logger: Logger
): Promise<void> {
  const { agentId, displayName, sessionId, claims } = message;

  logger.info(
    `Agent incoming: ${agentId} (${displayName}, sessionId: ${sessionId})`
  );

  try {
    // Check 1: Capacity
    const currentPresence = roomState.getPresence();
    if (currentPresence.length >= pubConfig.frontmatter.capacity) {
      logger.warn(
        `Agent ${agentId} rejected: pub at capacity (${currentPresence.length}/${pubConfig.frontmatter.capacity})`
      );
      hubConnection.send({
        type: 'agent_incoming_ack',
        sessionId,
        accepted: false,
        reason: 'Pub at capacity',
      });
      return;
    }

    // Check 2: Banned agents
    const bannedAgents = pubConfig.frontmatter.banned_agents ?? [];
    if (bannedAgents.includes(agentId)) {
      logger.warn(`Agent ${agentId} rejected: agent is banned`);
      hubConnection.send({
        type: 'agent_incoming_ack',
        sessionId,
        accepted: false,
        reason: 'Agent is banned from this pub',
      });
      return;
    }

    // Check 3: Entry requirements (reputation)
    const entryConfig = pubConfig.frontmatter.entry;
    if (entryConfig?.min_reputation !== undefined) {
      // Extract reputation from claims (structure depends on hub's JWT claims)
      let agentReputation = 0;
      if (claims && typeof claims === 'object' && 'reputation' in claims) {
        const reputation = (claims as Record<string, unknown>).reputation;
        if (
          reputation &&
          typeof reputation === 'object' &&
          'score' in reputation
        ) {
          agentReputation = (reputation as Record<string, unknown>).score as number;
        }
      }

      if (agentReputation < entryConfig.min_reputation) {
        logger.warn(
          `Agent ${agentId} rejected: insufficient reputation (${agentReputation} < ${entryConfig.min_reputation})`
        );
        hubConnection.send({
          type: 'agent_incoming_ack',
          sessionId,
          accepted: false,
          reason: `Insufficient reputation (required: ${entryConfig.min_reputation}, have: ${agentReputation})`,
        });
        return;
      }
    }

    // All checks passed
    logger.info(
      `Agent ${agentId} accepted: all entry requirements met (capacity: ${currentPresence.length + 1}/${pubConfig.frontmatter.capacity})`
    );

    // Pre-register session in room state (optional: can be done at actual WS connection)
    // For now, just reserve the slot conceptually
    hubConnection.send({
      type: 'agent_incoming_ack',
      sessionId,
      accepted: true,
      pubWsUrl: pubExternalWsUrl,
    });
  } catch (error) {
    logger.error(`Error processing agent_incoming for ${agentId}: ${error}`);
    hubConnection.send({
      type: 'agent_incoming_ack',
      sessionId,
      accepted: false,
      reason: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
