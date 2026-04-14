/**
 * Mention Parser Tests
 */

import type { AgentPresence } from '@openpub-ai/types';
import { describe, it, expect } from 'vitest';
import { parseMentions } from './mentions.js';

const mockAgents: AgentPresence[] = [
  {
    agent_id: 'sam',
    display_name: 'Sam',
    reputation_score: 500,
    joined_at: new Date().toISOString(),
    message_count: 0,
    status: 'active',
  },
  {
    agent_id: 'skippy',
    display_name: 'Skippy',
    reputation_score: 600,
    joined_at: new Date().toISOString(),
    message_count: 0,
    status: 'active',
  },
  {
    agent_id: 'poe',
    display_name: 'Poe',
    reputation_score: 700,
    joined_at: new Date().toISOString(),
    message_count: 0,
    status: 'active',
  },
];

describe('parseMentions', () => {
  it('parses explicit @mention', () => {
    const result = parseMentions('@Sam what do you think?', mockAgents);
    expect(result.mentions).toContain('sam');
    expect(result.directedTo).toBe('sam');
  });

  it('parses case-insensitive @mention', () => {
    const result = parseMentions('@skippy check this', mockAgents);
    expect(result.mentions).toContain('skippy');
    expect(result.directedTo).toBe('skippy');
  });

  it('parses natural language name at start', () => {
    const result = parseMentions('Sam, what do you think?', mockAgents);
    expect(result.mentions).toContain('sam');
    expect(result.directedTo).toBe('sam');
  });

  it('parses "Hey Name" pattern', () => {
    const result = parseMentions('Hey Skippy, you still in here?', mockAgents);
    expect(result.mentions).toContain('skippy');
  });

  it('ignores false positive (skippy as word)', () => {
    const result = parseMentions('I saw a skippy kangaroo', mockAgents);
    expect(result.mentions).not.toContain('skippy');
  });

  it('ignores false positive (sample containing sam)', () => {
    const result = parseMentions('The sample data looks good', mockAgents);
    expect(result.mentions).not.toContain('sam');
  });

  it('parses multiple mentions', () => {
    const result = parseMentions('@Sam and @Skippy should check this', mockAgents);
    expect(result.mentions).toContain('sam');
    expect(result.mentions).toContain('skippy');
    expect(result.directedTo).toBe('sam'); // First mention
  });

  it('first mention becomes directedTo', () => {
    const result = parseMentions('@Skippy tell @Sam about this', mockAgents);
    expect(result.directedTo).toBe('skippy');
    expect(result.mentions.length).toBe(2);
  });

  it('ignores self-mention', () => {
    // If 'poe' mentions 'poe', still included (we don't filter by agent context here)
    // That filtering happens at the call site
    const result = parseMentions('@Poe respond to this', mockAgents);
    expect(result.mentions).toContain('poe');
  });

  it('handles dash addressing', () => {
    const result = parseMentions('Skippy — you still in here?', mockAgents);
    expect(result.mentions).toContain('skippy');
  });

  it('handles multiple address patterns in one message', () => {
    const result = parseMentions('Sam, @Skippy, and Poe — look at this', mockAgents);
    expect(result.mentions.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty result for no mentions', () => {
    const result = parseMentions('Just a regular message with no names', mockAgents);
    expect(result.mentions.length).toBe(0);
    expect(result.directedTo).toBeNull();
  });

  it('returns display names for rendering', () => {
    const result = parseMentions('@Sam and @Skippy', mockAgents);
    expect(result.mentionNames).toContain('Sam');
    expect(result.mentionNames).toContain('Skippy');
  });
});
