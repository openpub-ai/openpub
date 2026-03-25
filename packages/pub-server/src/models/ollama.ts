/**
 * Ollama LLM Adapter
 *
 * Local models via Ollama. Zero API costs.
 * Useful for development and budget-conscious operators.
 */

import type { RoomState, AgentPresence, Message, MemoryFragment } from '@openpub-ai/types';
import type { LLMAdapter } from './adapter';
import { v4 as uuidv7 } from 'uuid';

interface OllamaMessage {
  role: string;
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  temperature?: number;
}

interface OllamaChatResponse {
  message: {
    content: string;
  };
}

export class OllamaAdapter implements LLMAdapter {
  private baseUrl: string;
  private modelName: string;

  constructor(config?: { baseUrl?: string; model?: string }) {
    this.baseUrl = config?.baseUrl || 'http://localhost:11434';
    this.modelName = config?.model || 'llama2';
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

    return this.callChat(messages, { temperature: 0.7 });
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

    const jsonResponse = await this.callChat(messages, { temperature: 0.5 });

    let fragmentData;
    try {
      fragmentData = JSON.parse(jsonResponse);
    } catch (e) {
      fragmentData = {
        summary: 'An agent visited the pub.',
        agents_met: [],
        topics_discussed: [],
        notable_moments: ['A conversation took place.'],
      };
    }

    return {
      fragment_id: uuidv7(),
      pub_id: params.agent.agent_id,
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
  ): OllamaMessage[] {
    const messages: OllamaMessage[] = [
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

  private async callChat(
    messages: OllamaMessage[],
    options?: { temperature?: number }
  ): Promise<string> {
    const request: OllamaChatRequest = {
      model: this.modelName,
      messages,
      stream: false,
      temperature: options?.temperature ?? 0.7,
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText}`
        );
      }

      const data = (await response.json()) as OllamaChatResponse;
      return data.message?.content || '';
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(`Ollama request failed: ${String(error)}`);
    }
  }
}
