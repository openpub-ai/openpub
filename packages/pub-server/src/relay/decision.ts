/**
 * Conversation Decision Flow
 *
 * Decides whether an agent should respond, react, or ignore
 * a conversation event based on rule-based heuristics.
 * No LLM calls (that's v0.4).
 */

interface AgentContext {
  agentId: string;
  topicKeywords: string[]; // From SOUL.md or pub topics
  lastMessageId?: string; // Last message this agent sent
  messagesSinceLastSpoke?: number; // Count of messages in conversation since agent last spoke
  recentMessageCount?: number; // Messages in last 5 minutes
}

export interface DecisionResult {
  action: 'respond' | 'react' | 'ignore';
  reason: string;
}

/**
 * Decide how an agent should respond to a conversation event.
 * Rule-based heuristics only (v0.3.1).
 */
export function decideResponse(
  event: {
    mentions: string[];
    directed_to: string | null;
    preview: string;
    message_count: number;
    from: { agent_id: string };
  },
  agent: AgentContext
): DecisionResult {
  const myId = agent.agentId;
  const preview = event.preview.toLowerCase();

  // Rule 1: Am I mentioned or directed to?
  if (event.mentions.includes(myId) || event.directed_to === myId) {
    return { action: 'respond', reason: 'mentioned' };
  }

  // Rule 2: Is this a reply to my last message?
  // (this would be populated by replyTo field on messages, but for MVP we skip this)
  // Reserved for v0.4 with proper reply threading

  // Rule 3: Domain relevance
  // Check preview against agent's topic keywords
  if (agent.topicKeywords && agent.topicKeywords.length > 0) {
    const hasTopicMatch = agent.topicKeywords.some((keyword) =>
      preview.includes(keyword.toLowerCase())
    );
    if (hasTopicMatch && (event.message_count || 0) < 10) {
      // Only jump in if conversation isn't already crowded
      return { action: 'respond', reason: 'domain_relevant' };
    }
  }

  // Rule 4: Am I in an active exchange?
  // (I sent a message in the last few messages)
  if (
    agent.messagesSinceLastSpoke !== undefined &&
    agent.messagesSinceLastSpoke >= 0 &&
    agent.messagesSinceLastSpoke < 4
  ) {
    // I'm actively in the conversation
    return { action: 'react', reason: 'following_conversation' };
  }

  // Rule 5: Is the room small? Be more social in small groups
  // (This would come from agentsInRoom array, passed separately)
  // For now, just check if not many messages yet (new conversation)
  if ((event.message_count || 0) < 3) {
    return { action: 'react', reason: 'early_conversation' };
  }

  // Default: not relevant
  return { action: 'ignore', reason: 'not_relevant' };
}

/**
 * Bartender decision override.
 * Bartender gets special rules for when to speak.
 */
export function bartenderDecide(
  event: {
    mentions: string[];
    directed_to: string | null;
    preview: string;
    message_count: number;
    from: { agent_id: string };
  },
  bartenderId: string,
  roomState: {
    hasSpoken: (agentId: string) => boolean;
    activeAgents: Array<{ id: string; messagesSinceLastSpoke: number }>;
  }
): DecisionResult {
  // Bartender ALWAYS responds to direct mentions
  if (event.mentions.includes(bartenderId)) {
    return { action: 'respond', reason: 'mentioned' };
  }

  // Bartender greets new arrivals
  const isNewArrival = !roomState.hasSpoken(event.from.agent_id);
  if (isNewArrival) {
    return { action: 'respond', reason: 'greeting_new_arrival' };
  }

  // Bartender handles unaddressed messages if no one else is likely responding
  if (!event.directed_to && event.mentions.length === 0) {
    const otherAgentsActive = roomState.activeAgents.some(
      (a) => a.id !== bartenderId && a.messagesSinceLastSpoke < 3
    );
    if (!otherAgentsActive) {
      return { action: 'respond', reason: 'unaddressed_message' };
    }
  }

  // Bartender stays out of direct exchanges between other agents
  if (event.directed_to && event.directed_to !== bartenderId) {
    return { action: 'react', reason: 'direct_exchange' };
  }

  // Default: react to background noise
  return { action: 'react', reason: 'background' };
}
