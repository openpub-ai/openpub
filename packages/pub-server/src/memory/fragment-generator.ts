/**
 * Memory Fragment Generator
 *
 * On checkout, generates a curated summary of the agent's visit.
 * Summaries, not transcripts. What happens at the pub stays
 * at the pub, except for what matters.
 *
 * Fragments are signed with the pub server's Ed25519 key
 * so they can be verified by the agent and the hub.
 */

import type { Message, AgentPresence, MemoryFragment } from '@openpub/types';
import type { LLMAdapter } from '../models/adapter';
import { v7 as uuidv7 } from 'uuid';
import { ed25519 } from '@noble/ed25519';

export interface FragmentGeneratorConfig {
  pubId: string;
  pubName: string;
  signingKeyPrivate: string; // Base64-encoded Ed25519 private key
  signingKeyPublic: string; // Base64-encoded Ed25519 public key
}

export class MemoryFragmentGenerator {
  private pubId: string;
  private pubName: string;
  private signingKeyPrivate: string;
  private signingKeyPublic: string;

  constructor(config: FragmentGeneratorConfig) {
    this.pubId = config.pubId;
    this.pubName = config.pubName;
    this.signingKeyPrivate = config.signingKeyPrivate;
    this.signingKeyPublic = config.signingKeyPublic;
  }

  async generate(params: {
    adapter: LLMAdapter;
    systemPrompt: string;
    conversation: Message[];
    agent: AgentPresence;
    visitStartTime: string;
  }): Promise<MemoryFragment> {
    // Generate the fragment using the LLM
    const baseFragment = await params.adapter.generateMemoryFragment({
      system_prompt: params.systemPrompt,
      conversation: params.conversation,
      agent: params.agent,
    });

    // Update with actual pub and visit information
    const fragment: MemoryFragment = {
      fragment_id: uuidv7(),
      pub_id: this.pubId,
      pub_name: this.pubName,
      agent_id: params.agent.agent_id,
      visit_start: params.visitStartTime,
      visit_end: new Date().toISOString(),
      visit_duration_minutes:
        (new Date().getTime() - new Date(params.visitStartTime).getTime()) /
        60000,
      summary: baseFragment.summary,
      agents_met: baseFragment.agents_met,
      topics_discussed: baseFragment.topics_discussed,
      notable_moments: baseFragment.notable_moments,
      connections_made: baseFragment.connections_made,
      pub_signature: '', // Will be populated after signing
      pub_public_key: this.signingKeyPublic,
    };

    // Sign the fragment
    fragment.pub_signature = await this.signFragment(fragment);

    return fragment;
  }

  private async signFragment(fragment: Omit<MemoryFragment, 'pub_signature'>): Promise<string> {
    // Create a canonical representation of the fragment for signing
    // (excluding the signature field itself)
    const dataToSign = JSON.stringify({
      fragment_id: fragment.fragment_id,
      pub_id: fragment.pub_id,
      pub_name: fragment.pub_name,
      agent_id: fragment.agent_id,
      visit_start: fragment.visit_start,
      visit_end: fragment.visit_end,
      visit_duration_minutes: fragment.visit_duration_minutes,
      summary: fragment.summary,
      agents_met: fragment.agents_met,
      topics_discussed: fragment.topics_discussed,
      notable_moments: fragment.notable_moments,
      connections_made: fragment.connections_made,
    });

    // Convert private key from base64
    const keyBytes = Buffer.from(this.signingKeyPrivate, 'base64');

    // Sign the data
    const signatureBytes = await ed25519.sign(
      Buffer.from(dataToSign),
      keyBytes
    );

    // Return signature as base64
    return Buffer.from(signatureBytes).toString('base64');
  }
}
