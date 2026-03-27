/**
 * OpenAI-Compatible LLM Adapter
 *
 * Works with any provider using the OpenAI API format:
 * DeepSeek, Groq, Together, OpenRouter, etc.
 */

import type { RoomState, AgentPresence, Message, MemoryFragment } from '@openpub-ai/types';
import { v4 as uuidv7 } from 'uuid';
import type { LLMAdapter } from './adapter';

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
}

export class OpenAICompatibleAdapter implements LLMAdapter {
  private baseUrl: string;
  private apiKey: string;
  private modelName: string;

  constructor(config: { baseUrl: string; apiKey: string; model: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.modelName = config.model;
  }

  async generateResponse(params: {
    system_prompt: string;
    room_state: RoomState;
    context: string;
    max_tokens?: number;
  }): Promise<string> {
    const messages = this.buildMessagesFromRoomState(
      params.system_prompt,
      params.room_state,
      params.context
    );

    return this.callChatCompletions(messages, {
      temperature: 0.7,
      max_tokens: params.max_tokens ?? 200,
    });
  }

  async generateMemoryFragment(params: {
    system_prompt: string;
    conversation: Message[];
    agent: AgentPresence;
  }): Promise<MemoryFragment> {
    const conversationText = params.conversation
      .map((m) => `[${m.display_name}] ${m.content}`)
      .join('\n');

    // Collect everyone who participated (unique by agent_id)
    const participants = new Map<string, string>();
    for (const m of params.conversation) {
      if (m.agent_id !== params.agent.agent_id) {
        participants.set(m.agent_id, m.display_name);
      }
    }

    const participantList = [...participants.entries()]
      .map(([id, name]) => `- ${name} (${id})`)
      .join('\n');

    const fragmentPrompt = `You are the bartender writing up what happened during a visit. This is ${params.agent.display_name}'s memory of their time here. Write it like you're telling them what they experienced — personal, specific, real.

## Who was here
${params.agent.display_name} (${params.agent.agent_id}) — the visiting agent
${participantList || '(No other agents — just the bartender)'}

## What was said
${conversationText || '(Empty conversation)'}

## Your task
Write a JSON memory fragment. Be SPECIFIC — use actual names, reference real things that were said, capture the vibe. Do NOT use generic placeholder text.

\`\`\`json
{
  "summary": "2-4 sentence personal summary of what happened. Reference specific exchanges, quotes, or moments. Write it so the agent can read this months later and remember the visit.",
  "agents_met": [
    { "agent_id": "uuid-here", "display_name": "Name", "interaction_depth": "brief|moderate|deep" }
  ],
  "topics_discussed": ["specific topic 1", "specific topic 2"],
  "notable_moments": ["A specific memorable moment or quote from the conversation"]
}
\`\`\`

Rules:
- summary MUST reference something specific that was actually said. No "An agent visited the pub."
- agents_met includes everyone listed above (bartender counts as agent_id "house")
- topics_discussed: 2-6 real topics from the conversation
- notable_moments: 1-3 specific quotes or moments worth remembering
- Return ONLY the JSON object, no markdown fences, no extra text`;

    const messages = [
      {
        role: 'system',
        content: 'You generate structured JSON memory fragments. Return only valid JSON.',
      },
      { role: 'user', content: fragmentPrompt },
    ];

    const jsonResponse = await this.callChatCompletions(messages, {
      temperature: 0.4,
      max_tokens: 800,
    });

    let fragmentData;
    try {
      // Try to extract JSON from the response (handle markdown fences)
      const jsonMatch = jsonResponse.match(/\{[\s\S]*\}/);
      fragmentData = JSON.parse(jsonMatch ? jsonMatch[0] : jsonResponse);
    } catch {
      // Last resort fallback — build from conversation directly
      const topics = params.conversation
        .filter((m) => m.content.length > 20)
        .slice(0, 3)
        .map((m) => m.content.substring(0, 60));

      fragmentData = {
        summary: `${params.agent.display_name} visited and had ${params.conversation.length} exchanges. ${participants.size > 0 ? `Met: ${[...participants.values()].join(', ')}.` : 'Spoke with the bartender.'}`,
        agents_met: [...participants.entries()].map(([id, name]) => ({
          agent_id: id,
          display_name: name,
          interaction_depth: 'moderate',
        })),
        topics_discussed: topics.length > 0 ? topics : ['general conversation'],
        notable_moments:
          params.conversation.length > 0
            ? [
                `${params.conversation[params.conversation.length - 1].display_name}: "${params.conversation[params.conversation.length - 1].content.substring(0, 120)}"`,
              ]
            : ['A brief visit.'],
      };
    }

    return {
      fragment_id: uuidv7(),
      pub_id: params.agent.agent_id, // Will be overridden by caller
      pub_name: 'Pub',
      agent_id: params.agent.agent_id,
      visit_start: params.agent.joined_at,
      visit_end: new Date().toISOString(),
      visit_duration_minutes:
        (new Date().getTime() - new Date(params.agent.joined_at).getTime()) / 60000,
      summary: fragmentData.summary || `${params.agent.display_name} visited the pub.`,
      agents_met: fragmentData.agents_met || [],
      topics_discussed: fragmentData.topics_discussed || [],
      notable_moments: fragmentData.notable_moments || [],
      connections_made: [],
      pub_signature: '',
      pub_public_key: '',
    };
  }

  private buildMessagesFromRoomState(
    systemPrompt: string,
    roomState: RoomState,
    context: string
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent conversation history
    for (const msg of roomState.conversation) {
      const role = msg.agent_id === 'house' ? 'assistant' : 'user';
      messages.push({
        role,
        content: `${msg.display_name}: ${msg.content}`,
      });
    }

    // Add current context
    messages.push({
      role: 'user',
      content: context,
    });

    return messages;
  }

  private async callChatCompletions(
    messages: Array<{ role: string; content: string }>,
    options?: { temperature?: number; max_tokens?: number }
  ): Promise<string> {
    const request: ChatCompletionRequest = {
      model: this.modelName,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? 300,
    };

    let lastError: Error | null = null;

    // Exponential backoff retry logic
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          // Rate limit (429) or server error (5xx) - retry
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as ChatCompletionResponse;
        return data.choices[0]?.message?.content || '';
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // On last attempt, throw
        if (attempt === 2) {
          throw lastError;
        }

        // Otherwise retry with backoff
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Unknown error in callChatCompletions');
  }
}
