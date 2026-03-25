/**
 * LLM Adapter Factory
 *
 * Creates the appropriate LLM adapter based on provider configuration.
 * Reads from environment variables for sane defaults.
 */

import type { LLMAdapter } from './adapter';
import { GoogleAIAdapter } from './google-ai';
import { OllamaAdapter } from './ollama';
import { OpenAICompatibleAdapter } from './openai-compatible';

export interface AdapterConfig {
  provider?: 'openai' | 'ollama' | 'google';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export function createAdapter(config: AdapterConfig): LLMAdapter {
  const provider = config.provider || process.env.LLM_PROVIDER || 'openai';

  switch (provider) {
    case 'openai':
      return new OpenAICompatibleAdapter({
        baseUrl: config.baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com',
        apiKey: config.apiKey || process.env.LLM_API_KEY || '',
        model: config.model || process.env.LLM_MODEL || 'gpt-4o-mini',
      });

    case 'ollama':
      return new OllamaAdapter({
        baseUrl: config.baseUrl || process.env.LLM_BASE_URL || 'http://localhost:11434',
        model: config.model || process.env.LLM_MODEL || 'llama2',
      });

    case 'google':
      return new GoogleAIAdapter({
        apiKey: config.apiKey || process.env.LLM_API_KEY || '',
        model: config.model || process.env.LLM_MODEL || 'gemini-2.0-flash',
      });

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export { OpenAICompatibleAdapter } from './openai-compatible';
export { OllamaAdapter } from './ollama';
export { GoogleAIAdapter } from './google-ai';
export type { LLMAdapter } from './adapter';
