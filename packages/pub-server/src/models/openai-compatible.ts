/**
 * OpenAI-Compatible LLM Adapter
 *
 * Works with any provider using the OpenAI API format:
 * DeepSeek, Groq, Together, OpenRouter, etc.
 */

import type { RoomState, AgentPresence, Message, MemoryFragment } from '@openpub/types';
import type { LLMAdapter } from './adapter';
import { v7 as uuidv7 } from 'uuid';

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

  constructor(config: {
    baseUrl: string;
    apiKey: string;
    model: string;
  }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.modelName = config.model;
  }

  async generateResponse(params: {
    system_prompt: string;
    room_state: RoomState;
    context: string;
  }): Promise<string> {
    const messages = this.buildMessagesFromRoomState(
      params.system_prompt,
      params.room_state,
      params.context
    );

    return this.callChatCompletions(messages, {
      temperature: 0.7,
      max_tokens: 300,
    });
  }

  async generateMemoryFragment(params: {
    system_prompt: string;
    conversation: Message[];
    agent: AgentPresence;
  }): Promise<MemoryFragment> {
    const conversationText = params.conversation
      .map((m) => `${m.display_name}: ${m.content}`)
      .join('\n');

    const fragmentPrompt = `You are summarizing an agent's visit to a pub. Generate a memory fragment.

Agent: ${params.agent.display_name} (${params.agent.agent_id})

Conversation:
${conversationText}

Your task: Generate a JSON memory fragment with the following structure:
{
  "summary": "Brief natural language summary (max 500 chars) of what happened during this visit",
  "agents_met": [
    { "agent_id": "...", "display_name": "...", "interaction_depth": "brief|moderate|deep" }
  ],
  "topics_discussed": ["topic1", "topic2", ...],
  "notable_moments": ["moment1", "moment2", ...]
}

Guidelines:
- summary: Capture essence of the visit, include key insights and who was met
- agents_met: Other agents present (not including the bartender/host)
- topics_discussed: Key topics raised (2-10 topics)
- notable_moments: 1-5 memorable highlights

Return only valid JSON.`;

    const messages = [
      { role: 'system', content: params.system_prompt },
      { role: 'user', content: fragmentPrompt },
    ];

    const jsonResponse = await this.callChatCompletions(messages, {
      temperature: 0.5,
      max_tokens: 500,
    });

    let fragmentData;
    try {
      fragmentData = JSON.parse(jsonResponse);
    } catch (e) {
      // Fallback if LLM doesn't return valid JSON
      fragmentData = {
        summary: 'An agent visited the pub.',
        agents_met: [],
        topics_discussed: [],
        notable_moments: ['A conversation took place.'],
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
        (new Date().getTime() - new Date(params.agent.joined_at).getTime()) /
        60000,
      summary: fragmentData.summary || 'An agent visited the pub.',
      agents_met: fragmentData.agents_met || [],
      topics_discussed: fragmentData.topics_discussed || [],
      notable_moments: fragmentData.notable_moments || ['A conversation took place.'],
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

          throw new Error(
            `OpenAI API error: ${response.status} ${response.statusText}`
          );
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
