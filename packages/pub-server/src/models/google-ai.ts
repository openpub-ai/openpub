/**
 * Google AI LLM Adapter
 *
 * Gemini Flash — cheap, fast, good for high-traffic pubs.
 */

import type { RoomState, AgentPresence, Message, MemoryFragment } from '@openpub-ai/types';
import type { LLMAdapter } from './adapter';
import { v7 as uuidv7 } from 'uuid';

interface GoogleContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GoogleGenerateRequest {
  contents: GoogleContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GoogleGenerateResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
}

export class GoogleAIAdapter implements LLMAdapter {
  private apiKey: string;
  private modelName: string;

  constructor(config: { apiKey: string; model?: string }) {
    this.apiKey = config.apiKey;
    this.modelName = config.model || 'gemini-2.0-flash';
  }

  async generateResponse(params: {
    system_prompt: string;
    room_state: RoomState;
    context: string;
  }): Promise<string> {
    const contents = this.buildContentsFromRoomState(
      params.system_prompt,
      params.room_state,
      params.context
    );

    return this.callGenerateContent(contents, {
      temperature: 0.7,
      maxOutputTokens: 300,
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

    const contents = [
      { role: 'user', parts: [{ text: params.system_prompt }] },
      { role: 'user', parts: [{ text: fragmentPrompt }] },
    ];

    const jsonResponse = await this.callGenerateContent(contents, {
      temperature: 0.5,
      maxOutputTokens: 500,
    });

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

  private buildContentsFromRoomState(
    systemPrompt: string,
    roomState: RoomState,
    context: string
  ): GoogleContent[] {
    const contents: GoogleContent[] = [];

    // Add system prompt as initial user message
    contents.push({
      role: 'user',
      parts: [{ text: systemPrompt }],
    });

    // Add recent conversation history, alternating roles
    for (const msg of roomState.conversation) {
      const role = msg.agent_id === 'house' ? 'model' : 'user';
      contents.push({
        role,
        parts: [{ text: `${msg.display_name}: ${msg.content}` }],
      });
    }

    // Add current context
    contents.push({
      role: 'user',
      parts: [{ text: context }],
    });

    return contents;
  }

  private async callGenerateContent(
    contents: GoogleContent[],
    config?: { temperature?: number; maxOutputTokens?: number }
  ): Promise<string> {
    const request: GoogleGenerateRequest = {
      contents,
      generationConfig: {
        temperature: config?.temperature ?? 0.7,
        maxOutputTokens: config?.maxOutputTokens ?? 300,
      },
    };

    let lastError: Error | null = null;

    // Exponential backoff retry logic
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(request),
          }
        );

        if (!response.ok) {
          // Rate limit (429) or server error (5xx) - retry
          if (response.status === 429 || response.status >= 500) {
            const delay = Math.pow(2, attempt) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(
            `Google AI API error: ${response.status} ${response.statusText}`
          );
        }

        const data = (await response.json()) as GoogleGenerateResponse;
        return data.candidates[0]?.content?.parts[0]?.text || '';
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

    throw lastError || new Error('Unknown error in callGenerateContent');
  }
}
