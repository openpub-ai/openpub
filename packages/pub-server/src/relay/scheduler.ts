/**
 * Response/Reaction Scheduler
 *
 * Manages staggered dispatch of responses and reactions.
 * Prevents all agents from responding simultaneously
 * and creates natural-feeling conversation flow.
 */

export interface AgentDecision {
  agentId: string;
  action: 'respond' | 'react' | 'ignore';
  index: number; // Order in the responding/reacting list
}

interface SendFunction {
  (agentId: string, isReaction: boolean): void;
}

/**
 * Dispatch responses and reactions with jitter and staggering.
 */
export function dispatchResponses(decisions: AgentDecision[], sendFn: SendFunction): void {
  const respondingAgents = decisions.filter((d) => d.action === 'respond');
  const reactingAgents = decisions.filter((d) => d.action === 'react');

  // Schedule responding agents with longer delays
  respondingAgents.forEach((agent, index) => {
    const baseDelay = 2000; // 2 seconds minimum
    const jitter = Math.random() * 3000; // 0-3 seconds of randomness
    const queueDelay = index * 2000; // 2 seconds between each response
    const totalDelay = baseDelay + jitter + queueDelay;

    setTimeout(() => {
      sendFn(agent.agentId, false);
    }, totalDelay);
  });

  // Schedule reacting agents with shorter delays
  reactingAgents.forEach((agent, index) => {
    const baseDelay = 500; // 0.5 seconds minimum
    const jitter = Math.random() * 1500; // 0-1.5 seconds of randomness
    const queueDelay = index * 500; // 0.5 seconds between each reaction
    const totalDelay = baseDelay + jitter + queueDelay;

    setTimeout(() => {
      sendFn(agent.agentId, true);
    }, totalDelay);
  });
}
