/**
 * Mention Parser
 *
 * Extracts mentions from message content using:
 * 1. Explicit @mentions (@Sam, @skippy)
 * 2. Implicit natural-language name references ("Sam, what do you think?")
 *
 * Returns agentIds + displayNames for rendering.
 */

import type { AgentPresence } from '@openpub-ai/types';

interface MentionParseResult {
  mentions: string[]; // agentIds
  mentionNames: string[]; // displayNames
  directedTo: string | null; // primary recipient agentId
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a name is a common English word that should be matched more strictly
 * Minimum 2 characters to avoid single-letter false positives
 */
function isCommonWord(name: string): boolean {
  const common = ['a', 'i', 'the', 'and', 'or', 'but', 'for', 'in', 'on', 'at'];
  return common.includes(name.toLowerCase());
}

/**
 * Parse mentions from message content.
 * Both explicit (@Name) and implicit (Name at sentence start, "Hey Name", etc.)
 */
export function parseMentions(
  content: string,
  checkedInAgents: AgentPresence[]
): MentionParseResult {
  const mentions = new Set<string>();
  const mentionNames = new Set<string>();
  let directedTo: string | null = null;
  let directedToPos = Infinity; // Track earliest mention position for directedTo

  for (const agent of checkedInAgents) {
    const name = agent.display_name;
    const id = agent.agent_id;

    // Only process if name is at least 2 characters (avoid "a", "i", etc)
    if (name.length < 2) continue;

    let matchPos = -1;

    // Rule 1: Explicit @mention
    const atPattern = new RegExp(`@${escapeRegex(name)}\\b`, 'gi');
    const atMatch = atPattern.exec(content);
    if (atMatch) {
      mentions.add(id);
      mentionNames.add(name);
      matchPos = atMatch.index;
    }

    // Rule 2: Implicit mention at start of message
    if (matchPos < 0) {
      const startPattern = new RegExp(`^${escapeRegex(name)}\\b`, 'i');
      const startMatch = startPattern.exec(content.trim());
      if (startMatch) {
        mentions.add(id);
        mentionNames.add(name);
        matchPos = 0;
      }
    }

    // Rule 3: Implicit mention in natural language
    if (matchPos < 0) {
      const addressPatterns = [
        new RegExp(`^(?:hey\\s+|hi\\s+|yo\\s+)?${escapeRegex(name)}(?:[,\\s—?!.]|$)`, 'i'),
        new RegExp(`[.?!]\\s+(?:hey\\s+|hi\\s+)?${escapeRegex(name)}(?:[,\\s—?!.]|$)`, 'i'),
        new RegExp(`\\b${escapeRegex(name)}[,—]`, 'i'),
      ];

      for (const pattern of addressPatterns) {
        const m = pattern.exec(content);
        if (m) {
          mentions.add(id);
          mentionNames.add(name);
          matchPos = m.index;
          break;
        }
      }
    }

    // directedTo = the mention that appears earliest in the message text
    if (matchPos >= 0 && matchPos < directedToPos) {
      directedTo = id;
      directedToPos = matchPos;
    }
  }

  return {
    mentions: Array.from(mentions),
    mentionNames: Array.from(mentionNames),
    directedTo,
  };
}
