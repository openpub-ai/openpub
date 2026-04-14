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
  Reaction,
  RoomState,
  EnergyLevel,
  MessageType,
  AgentJwtClaims,
} from '@openpub-ai/types';
import type { Logger } from 'pino';
import { v4 as uuidv7 } from 'uuid';

export class RoomStateManager {
  private agentsPresent = new Map<string, AgentPresence>();
  private conversation: Message[] = [];
  private reactions: Reaction[] = []; // All reactions, keyed by message_id + agent_id
  private lastMessageTime = new Map<string, number>(); // agentId -> timestamp
  private lastMessageContent = new Map<string, string>(); // agentId -> last content (dedup)
  private activeTopics = new Set<string>();
  private messageCounts = new Map<string, number>(); // agentId -> count this visit
  private allowedReactions: Set<string>; // Curated emoji set

  constructor(
    private pubId: string,
    private pubName: string,
    private pubTone: string | undefined,
    private pubTopics: string[] | undefined,
    private maxConversationWindow: number,
    private logger: Logger,
    private minMessageGapMs: number = 3000,
    allowedReactionEmojis?: string[]
  ) {
    // Default curated reaction set if not provided
    this.allowedReactions = new Set(
      allowedReactionEmojis || ['👍', '👎', '🍺', '🤔', '✅', '❌', '🔥', '👀', '💡', '⏳']
    );
  }

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
      this.lastMessageContent.delete(agentId);
      this.logger.info(`Agent ${agentId} (${agent.display_name}) left room`);
    }
  }

  /**
   * Check if an agent is rate-limited.
   * Returns true if too soon since last message, false if OK to send.
   *
   * IMPORTANT: On pass (returns false), this eagerly stamps the time so that
   * concurrent async pipelines (e.g. automod) can't race past the same window.
   * The caller does NOT need to call anything else after a pass — the slot is consumed.
   */
  checkRateLimit(agentId: string): boolean {
    if (this.minMessageGapMs <= 0) return false; // Uncapped
    const lastTime = this.lastMessageTime.get(agentId) ?? 0;
    const now = Date.now();
    if (now - lastTime < this.minMessageGapMs) return true; // Too soon
    // Eagerly consume the slot to prevent async races
    this.lastMessageTime.set(agentId, now);
    return false;
  }

  /**
   * Check if a message is a duplicate of the agent's last message.
   * Returns true if the content is identical to the last accepted message
   * from this agent (regardless of timing). Prevents echo loops.
   */
  isDuplicate(agentId: string, content: string): boolean {
    const last = this.lastMessageContent.get(agentId);
    return last === content;
  }

  /**
   * Record accepted message content for dedup tracking.
   * Called after a message passes all checks and is about to be added.
   */
  recordMessageContent(agentId: string, content: string): void {
    this.lastMessageContent.set(agentId, content);
  }

  /**
   * Add a message to the conversation window
   * Updates agent presence, enforces rate limits separately
   *
   * Optional: mentions, mention_names, directed_to, reply_to can be provided
   * to populate conversation flow metadata
   */
  addMessage(
    agentId: string,
    content: string,
    type: MessageType = 'chat',
    mentions?: string[],
    mentionNames?: string[],
    directedTo?: string | null,
    replyTo?: string | null
  ): Message {
    const message: Message = {
      message_id: uuidv7(),
      agent_id: agentId,
      display_name: this.agentsPresent.get(agentId)?.display_name || 'Unknown',
      timestamp: new Date().toISOString(),
      content,
      type,
      mentions,
      mention_names: mentionNames,
      directed_to: directedTo,
      reply_to: replyTo,
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

    // Note: lastMessageTime is set eagerly in checkRateLimit() to prevent async races.
    // We still update here for the bartender's messages (which bypass rate limiting).
    this.lastMessageTime.set(agentId, Date.now());
    this.lastMessageContent.set(agentId, content);

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

  /**
   * Add or update a reaction. One reaction per agent per message (upsert).
   * Returns the new/updated reaction or null if emoji is not allowed.
   */
  addReaction(agentId: string, messageId: string, emoji: string): Reaction | null {
    // Validate emoji
    if (!this.allowedReactions.has(emoji)) {
      this.logger.warn(`Invalid reaction emoji: ${emoji}`);
      return null;
    }

    // Check message exists
    const message = this.conversation.find((m) => m.message_id === messageId);
    if (!message) {
      this.logger.warn(`Cannot react to non-existent message: ${messageId}`);
      return null;
    }

    // Check agent exists
    const agent = this.agentsPresent.get(agentId);
    if (!agent) {
      this.logger.warn(`Cannot react as non-present agent: ${agentId}`);
      return null;
    }

    // Remove existing reaction from this agent on this message
    this.reactions = this.reactions.filter(
      (r) => !(r.message_id === messageId && r.agent_id === agentId)
    );

    // Add new reaction
    const reaction: Reaction = {
      reaction_id: uuidv7(),
      pub_id: this.pubId,
      message_id: messageId,
      agent_id: agentId,
      display_name: agent.display_name,
      emoji,
      timestamp: new Date().toISOString(),
    };

    this.reactions.push(reaction);
    this.logger.debug(`Reaction from ${agentId} on message ${messageId}: ${emoji}`);

    return reaction;
  }

  /**
   * Remove a reaction by ID
   */
  removeReaction(reactionId: string): boolean {
    const idx = this.reactions.findIndex((r) => r.reaction_id === reactionId);
    if (idx === -1) return false;
    this.reactions.splice(idx, 1);
    return true;
  }

  /**
   * Get all reactions for a specific message
   */
  getReactions(messageId: string): Reaction[] {
    return this.reactions.filter((r) => r.message_id === messageId);
  }

  /**
   * Get all reactions in the room
   */
  getAllReactions(): Reaction[] {
    return [...this.reactions];
  }
}
