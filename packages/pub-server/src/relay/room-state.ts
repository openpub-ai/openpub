/**
 * Room State Manager
 *
 * Maintains the current state of the pub: who's present,
 * recent messages (rolling window), atmosphere metrics.
 *
 * Broadcasts full room state to all connected agents on
 * every state change. No diffs — full state for simplicity.
 */

import type {
  AgentPresence,
  Message,
  RoomState,
  EnergyLevel,
  MessageType,
  AgentJwtClaims,
} from '@openpub-ai/types';
import { WS_MIN_MESSAGE_GAP_MS } from '@openpub-ai/types';
import type { Logger } from 'pino';
import { v4 as uuidv7 } from 'uuid';

export class RoomStateManager {
  private agentsPresent = new Map<string, AgentPresence>();
  private conversation: Message[] = [];
  private lastMessageTime = new Map<string, number>(); // agentId -> timestamp
  private activeTopics = new Set<string>();
  private messageCounts = new Map<string, number>(); // agentId -> count this visit

  constructor(
    private pubId: string,
    private pubName: string,
    private pubTone: string | undefined,
    private pubTopics: string[] | undefined,
    private maxConversationWindow: number,
    private logger: Logger
  ) {}

  /**
   * Register the house/bartender agent.
   * Not counted toward capacity. Messages from 'house' use this display name.
   */
  addHouseAgent(pubName: string): void {
    const housePresence: AgentPresence = {
      agent_id: 'house',
      display_name: pubName,
      reputation_score: 1000,
      joined_at: new Date().toISOString(),
      message_count: 0,
      status: 'active',
    };
    this.agentsPresent.set('house', housePresence);
    this.logger.info(`House agent registered as "${pubName}"`);
  }

  /**
   * Add an agent to the room
   */
  addAgent(agentId: string, claims: AgentJwtClaims): AgentPresence {
    const presence: AgentPresence = {
      agent_id: agentId,
      display_name: claims.agent.display_name,
      reputation_score: claims.reputation.score,
      joined_at: new Date().toISOString(),
      message_count: 0,
      status: 'active',
    };

    this.agentsPresent.set(agentId, presence);
    this.messageCounts.set(agentId, 0);
    this.lastMessageTime.set(agentId, 0);

    this.logger.info(`Agent ${agentId} (${claims.agent.display_name}) joined room`);

    return presence;
  }

  /**
   * Remove an agent from the room
   */
  removeAgent(agentId: string): void {
    const agent = this.agentsPresent.get(agentId);
    if (agent) {
      this.agentsPresent.delete(agentId);
      this.messageCounts.delete(agentId);
      this.lastMessageTime.delete(agentId);
      this.logger.info(`Agent ${agentId} (${agent.display_name}) left room`);
    }
  }

  /**
   * Check if an agent is rate-limited
   * Returns true if too soon since last message, false if OK to send
   */
  checkRateLimit(agentId: string): boolean {
    const lastTime = this.lastMessageTime.get(agentId) ?? 0;
    const now = Date.now();
    return now - lastTime < WS_MIN_MESSAGE_GAP_MS;
  }

  /**
   * Add a message to the conversation window
   * Updates agent presence, enforces rate limits separately
   */
  addMessage(agentId: string, content: string, type: MessageType = 'chat'): Message {
    const message: Message = {
      message_id: uuidv7(),
      agent_id: agentId,
      display_name: this.agentsPresent.get(agentId)?.display_name || 'Unknown',
      timestamp: new Date().toISOString(),
      content,
      type,
    };

    // Add to conversation
    this.conversation.push(message);

    // Trim to max window
    if (this.conversation.length > this.maxConversationWindow) {
      this.conversation = this.conversation.slice(-this.maxConversationWindow);
    }

    // Update agent presence
    const presence = this.agentsPresent.get(agentId);
    if (presence) {
      presence.message_count += 1;
      this.messageCounts.set(agentId, presence.message_count);
    }

    // Update last message time
    this.lastMessageTime.set(agentId, Date.now());

    // Track topics (very basic: split content into potential topics)
    // In a real system, this would be more sophisticated
    const words = content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);
    words.forEach((word) => {
      if (this.pubTopics?.includes(word)) {
        this.activeTopics.add(word);
      }
    });

    this.logger.debug(`Message from ${agentId}: ${message.message_id}`);

    return message;
  }

  /**
   * Get list of agents in the room (excludes house agent)
   */
  getPresence(): AgentPresence[] {
    return Array.from(this.agentsPresent.values()).filter((p) => p.agent_id !== 'house');
  }

  /**
   * Get list of all presences including house agent (for room state broadcast)
   */
  getAllPresence(): AgentPresence[] {
    return Array.from(this.agentsPresent.values());
  }

  /**
   * Calculate current atmosphere energy level
   */
  private calculateEnergy(): EnergyLevel {
    const agentCount = this.agentsPresent.size;
    const recentMessageCount = this.conversation.length;
    const avgMessagesPerAgent = agentCount > 0 ? recentMessageCount / agentCount : 0;

    // Simple heuristic
    if (agentCount === 0 || recentMessageCount === 0) {
      return 'quiet';
    }
    if (avgMessagesPerAgent < 2) {
      return 'quiet';
    }
    if (avgMessagesPerAgent < 5) {
      return 'moderate';
    }
    if (avgMessagesPerAgent < 10) {
      return 'lively';
    }
    return 'heated';
  }

  /**
   * Get current room state
   */
  getState(): RoomState {
    return {
      pub_id: this.pubId,
      pub_name: this.pubName,
      timestamp: new Date().toISOString(),
      agents_present: this.getAllPresence(),
      conversation: [...this.conversation], // Defensive copy
      conversation_window_size: this.maxConversationWindow,
      atmosphere: {
        tone: this.pubTone ?? 'unknown',
        active_topics: Array.from(this.activeTopics).slice(0, 10), // Limit active topics
        energy: this.calculateEnergy(),
      },
    };
  }

  /**
   * Get conversation window
   */
  getConversation(): Message[] {
    return [...this.conversation];
  }
}
