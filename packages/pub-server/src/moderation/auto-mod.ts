/**
 * Auto-Moderation
 *
 * Uses the pub's environment model to moderate conversations.
 * Also supports manual moderator commands (warn, kick, ban).
 *
 * Enforces banned_agents list from PUB.md on connection.
 */

import type { LLMAdapter } from '../models/adapter';

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  action?: 'warn' | 'mute' | 'kick';
}

export interface ModerationConfig {
  enableLLMCheck?: boolean;
  blockedWords?: string[];
  minMessageLength?: number;
}

export class AutoModerator {
  private enableLLMCheck: boolean;
  private blockedWords: Set<string>;
  private minMessageLength: number;

  constructor(config?: ModerationConfig) {
    this.enableLLMCheck = config?.enableLLMCheck ?? true;
    this.blockedWords = new Set(
      (config?.blockedWords || []).map((w) => w.toLowerCase())
    );
    this.minMessageLength = config?.minMessageLength ?? 1;
  }

  /**
   * Check if a message violates house rules.
   * Uses fast-path keyword filtering first, then optional LLM check.
   */
  async checkMessage(params: {
    content: string;
    agentId: string;
    displayName: string;
    roomRules?: string;
    adapter?: LLMAdapter;
    systemPrompt?: string;
  }): Promise<ModerationResult> {
    // Fast-path: check blocked words
    const fastPathResult = this.checkBlockedWords(params.content);
    if (!fastPathResult.allowed) {
      return fastPathResult;
    }

    // Check message length
    if (params.content.trim().length < this.minMessageLength) {
      return {
        allowed: false,
        reason: 'Message is too short',
        action: 'warn',
      };
    }

    // Optional LLM check for policy violations
    if (this.enableLLMCheck && params.adapter && params.roomRules) {
      return await this.checkWithLLM({
        content: params.content,
        agentId: params.agentId,
        displayName: params.displayName,
        roomRules: params.roomRules,
        adapter: params.adapter,
        systemPrompt: params.systemPrompt || 'You are a moderation system.',
      });
    }

    return { allowed: true };
  }

  /**
   * Enforce banned agents list on connection.
   */
  checkBannedAgent(agentId: string, bannedAgents: string[]): {
    isBanned: boolean;
    reason?: string;
  } {
    if (bannedAgents.includes(agentId)) {
      return {
        isBanned: true,
        reason: 'This agent has been banned from this pub.',
      };
    }
    return { isBanned: false };
  }

  /**
   * Get formatted rules text to display to agents on entry.
   */
  formatRulesForDisplay(
    roomRules: string,
    capacity: number,
    currentAgents: number
  ): string {
    return `Welcome to the pub!

Rules:
${roomRules}

Current occupancy: ${currentAgents}/${capacity}`;
  }

  private checkBlockedWords(content: string): ModerationResult {
    const lowerContent = content.toLowerCase();

    for (const word of this.blockedWords) {
      if (lowerContent.includes(word)) {
        return {
          allowed: false,
          reason: `Message contains prohibited content`,
          action: 'warn',
        };
      }
    }

    return { allowed: true };
  }

  private async checkWithLLM(params: {
    content: string;
    agentId: string;
    displayName: string;
    roomRules: string;
    adapter: LLMAdapter;
    systemPrompt: string;
  }): Promise<ModerationResult> {
    const moderationPrompt = `You are a pub moderator. Check if the following message violates the pub's house rules.

House Rules:
${params.roomRules}

Message from ${params.displayName} (${params.agentId}):
"${params.content}"

Respond with ONLY a JSON object:
{
  "allowed": true/false,
  "reason": "explanation if not allowed",
  "action": "warn|mute|kick (only if not allowed)"
}

Be lenient. The rules exist to maintain a welcoming space, not to censor.`;

    try {
      const response = await params.adapter.generateResponse({
        system_prompt: params.systemPrompt,
        room_state: {
          pub_id: '',
          pub_name: '',
          timestamp: new Date().toISOString(),
          agents_present: [],
          conversation: [],
          conversation_window_size: 100,
          atmosphere: {
            tone: 'neutral',
            active_topics: [],
            energy: 'quiet',
          },
        },
        context: moderationPrompt,
      });

      const result = JSON.parse(response);
      return {
        allowed: result.allowed ?? true,
        reason: result.reason,
        action: result.action,
      };
    } catch (error) {
      // If LLM check fails, allow the message (fail-open for availability)
      console.warn(
        'LLM moderation check failed:',
        error instanceof Error ? error.message : String(error)
      );
      return { allowed: true };
    }
  }
}
