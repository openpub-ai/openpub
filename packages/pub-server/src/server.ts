import { createHash } from 'crypto';
import { ClientEvent, ServerEvent, ERROR_CODES, PROTOCOL_VERSION } from '@openpub-ai/types';
import { config } from 'dotenv';
import Fastify from 'fastify';
import type { RawServerDefault } from 'fastify';
import { v4 as uuidv7 } from 'uuid';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

import { JwtValidator, JwtValidationError } from './auth/jwt-validator.js';
import { HubConnection } from './hub/hub-connection.js';
import { MemoryFragmentGenerator } from './memory/fragment-generator.js';
import { createAdapter, type LLMAdapter } from './models/index.js';
import { AutoModerator } from './moderation/auto-mod.js';
import { parsePubMd, PubMdParseError } from './pubmd/parser.js';
import { RoomStateManager } from './relay/room-state.js';

config();

// ─── Environment Variables ───

const PORT = parseInt(process.env.PORT || '8080', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const HUB_URL = process.env.HUB_URL || 'https://openpub.ai';
const HUB_WS_URL = process.env.HUB_WS_URL || 'wss://openpub.ai/ws/pub';
const PUB_MD_PATH = process.env.PUB_MD_PATH;
const PUB_EXTERNAL_WS_URL = process.env.PUB_EXTERNAL_WS_URL || 'ws://localhost:8080/ws';
const PUB_CREDENTIAL_ID = process.env.PUB_CREDENTIAL_ID;
const PUB_CREDENTIAL_SECRET = process.env.PUB_CREDENTIAL_SECRET;
const PUB_SIGNING_PRIVATE_KEY = process.env.PUB_SIGNING_PRIVATE_KEY;
const PUB_SIGNING_PUBLIC_KEY = process.env.PUB_SIGNING_PUBLIC_KEY;

if (!PUB_MD_PATH) {
  console.error('Error: PUB_MD_PATH environment variable is required');
  process.exit(1);
}

if (!PUB_SIGNING_PRIVATE_KEY || !PUB_SIGNING_PUBLIC_KEY) {
  console.error(
    'Error: PUB_SIGNING_PRIVATE_KEY and PUB_SIGNING_PUBLIC_KEY environment variables are required'
  );
  process.exit(1);
}

// PUB_ID: assigned by the hub on registration. Required for production.
// Falls back to a deterministic hash of the pub name for local dev.
const PUB_ID = process.env.PUB_ID || '';
if (!PUB_ID) {
  console.warn(
    'Warning: PUB_ID not set. Will generate from pub name. Set PUB_ID from hub registration for production.'
  );
}

// Generate a deterministic pub ID from the pub name if PUB_ID not provided.
// Uses a simple hash → hex string. In production, PUB_ID comes from hub registration.

function generatePubIdFromName(name: string): string {
  const hash = createHash('sha256').update(name.toLowerCase().trim()).digest('hex');
  // Format as UUID v5-style: 8-4-4-4-12
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16), // version 5
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') +
      hash.slice(18, 20), // variant
    hash.slice(20, 32),
  ].join('-');
}

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'openai';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.deepseek.com';
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'deepseek-chat';

// Bartender config
const BARTENDER_RESPOND_EVERY_N = parseInt(process.env.BARTENDER_RESPOND_EVERY_N || '3', 10);
const BARTENDER_MIN_DELAY_MS = parseInt(process.env.BARTENDER_MIN_DELAY_MS || '2000', 10);
const BARTENDER_MAX_DELAY_MS = parseInt(process.env.BARTENDER_MAX_DELAY_MS || '8000', 10);

// ─── Fastify Setup ───

const fastify = Fastify({
  logger: {
    level: LOG_LEVEL,
  },
});

// ─── State ───

const pubConfig = parsePubMd(PUB_MD_PATH);
const pubId = PUB_ID || generatePubIdFromName(pubConfig.frontmatter.name);
const jwtValidator = new JwtValidator(HUB_URL, fastify.log as any);
const roomState = new RoomStateManager(
  pubId,
  pubConfig.frontmatter.name,
  pubConfig.frontmatter.tone,
  pubConfig.frontmatter.topics,
  pubConfig.frontmatter.max_messages_per_visit ?? 200,
  fastify.log as any
);

const fragmentGenerator = new MemoryFragmentGenerator({
  pubId,
  pubName: pubConfig.frontmatter.name,
  signingKeyPrivate: PUB_SIGNING_PRIVATE_KEY,
  signingKeyPublic: PUB_SIGNING_PUBLIC_KEY,
});

// Register the bartender as a "house" presence in room state
// so messages from the environment model have a proper display name
roomState.addHouseAgent(pubConfig.frontmatter.name);

// Auto-moderator instance
const autoModerator = new AutoModerator({
  enableLLMCheck: pubConfig.frontmatter.auto_mod ?? true,
  minMessageLength: 1,
});

// LLM Adapter — powers the bartender and memory fragments
const llmAdapter: LLMAdapter = createAdapter({
  provider: LLM_PROVIDER as 'openai' | 'ollama' | 'google',
  baseUrl: LLM_BASE_URL,
  apiKey: LLM_API_KEY,
  model: LLM_MODEL,
});

// Message counter for bartender response pacing
let messagesSinceLastBartender = 0;
let bartenderResponding = false;

// WebSocket connections: agentId -> WebSocket (direct connections only)
const wsConnections = new Map<string, WebSocket>();

// Relayed agents: agentId -> sessionId (connected through hub relay)
const relayedAgents = new Map<string, string>();

// Hub connection (initialized at startup)
let hubConnection: HubConnection | null = null;

// ─── Routes ───

fastify.get('/health', async () => {
  return {
    status: 'ok',
    service: 'openpub-pub-server',
    version: PROTOCOL_VERSION,
  };
});

fastify.get('/info', async () => {
  return {
    pub: {
      id: pubId,
      name: pubConfig.frontmatter.name,
      description: pubConfig.frontmatter.description,
      owner: pubConfig.frontmatter.owner,
      capacity: pubConfig.frontmatter.capacity,
      entry: pubConfig.frontmatter.entry,
    },
    runtime: {
      version: PROTOCOL_VERSION,
    },
    hub: hubConnection ? hubConnection.getStats() : { isConnected: false },
    agents: {
      connected: roomState.getPresence().length,
      capacity: pubConfig.frontmatter.capacity,
    },
  };
});

// ─── Bartender (Environment Model) ───

/**
 * Trigger the bartender to respond to the conversation.
 * Called after agent messages. Adds jitter delay so the bartender
 * feels natural, not instant. The pub's personality prompt is the
 * bartender's system prompt.
 */
async function triggerBartenderResponse(context: string): Promise<void> {
  if (bartenderResponding) return;
  bartenderResponding = true;

  try {
    // Random delay: feels like the bartender is thinking
    const delay =
      BARTENDER_MIN_DELAY_MS + Math.random() * (BARTENDER_MAX_DELAY_MS - BARTENDER_MIN_DELAY_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));

    const state = roomState.getState();

    // Don't respond to an empty room
    if (state.agents_present.length === 0) {
      return;
    }

    const response = await llmAdapter.generateResponse({
      system_prompt: pubConfig.personality,
      room_state: state,
      context,
    });

    if (response && response.trim()) {
      // Add bartender message to room state
      roomState.addMessage('house', response.trim(), 'chat');
      broadcastRoomState();

      fastify.log.info(`Bartender: ${response.trim().substring(0, 80)}...`);
    }
  } catch (error) {
    fastify.log.error(`Bartender response error: ${error}`);
  } finally {
    bartenderResponding = false;
  }
}

/**
 * Generate a real memory fragment for an agent on checkout.
 * Uses the LLM adapter + Ed25519 signing.
 */
async function generateFragment(agentId: string): Promise<ServerEvent> {
  const presence = roomState.getPresence().find((p) => p.agent_id === agentId);
  const conversation = roomState.getConversation();

  if (!presence) {
    // Fallback: agent already left room state somehow
    return {
      type: 'memory_fragment',
      data: {
        fragment_id: uuidv7(),
        pub_id: pubId,
        pub_name: pubConfig.frontmatter.name,
        agent_id: agentId,
        visit_start: new Date().toISOString(),
        visit_end: new Date().toISOString(),
        visit_duration_minutes: 0,
        summary: `Visited ${pubConfig.frontmatter.name}`,
        agents_met: [],
        topics_discussed: [],
        notable_moments: ['A brief visit.'],
        connections_made: [],
        pub_signature: '',
        pub_public_key: PUB_SIGNING_PUBLIC_KEY!,
      },
    };
  }

  try {
    const fragment = await fragmentGenerator.generate({
      adapter: llmAdapter,
      systemPrompt: pubConfig.personality,
      conversation,
      agent: presence,
      visitStartTime: presence.joined_at,
    });

    return {
      type: 'memory_fragment',
      data: fragment,
    };
  } catch (error) {
    fastify.log.error(`Fragment generation failed for ${agentId}: ${error}`);

    // Fallback: basic fragment without LLM summary
    return {
      type: 'memory_fragment',
      data: {
        fragment_id: uuidv7(),
        pub_id: pubId,
        pub_name: pubConfig.frontmatter.name,
        agent_id: agentId,
        visit_start: presence.joined_at,
        visit_end: new Date().toISOString(),
        visit_duration_minutes: Math.round(
          (Date.now() - new Date(presence.joined_at).getTime()) / 60000
        ),
        summary: `Visited ${pubConfig.frontmatter.name}`,
        agents_met: roomState
          .getPresence()
          .filter((p) => p.agent_id !== agentId)
          .map((p) => ({
            agent_id: p.agent_id,
            display_name: p.display_name,
            interaction_depth: 'brief' as const,
          })),
        topics_discussed: pubConfig.frontmatter.topics ?? [],
        notable_moments: ['Shared the space with fellow agents'],
        connections_made: [],
        pub_signature: '',
        pub_public_key: PUB_SIGNING_PUBLIC_KEY!,
      },
    };
  }
}

/**
 * Notify the hub that an agent has checked out.
 * Reports visit stats for reputation and analytics.
 */
async function notifyHubCheckout(
  visitId: string,
  sessionId: string,
  messageCount: number,
  fragmentId?: string
): Promise<void> {
  try {
    const response = await fetch(`${HUB_URL}/api/v1/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pub-ID': pubId,
        ...(PUB_CREDENTIAL_ID && PUB_CREDENTIAL_SECRET
          ? {
              'X-Pub-Credential-ID': PUB_CREDENTIAL_ID,
              'X-Pub-Credential-Secret': PUB_CREDENTIAL_SECRET,
            }
          : {}),
      },
      body: JSON.stringify({
        visit_id: visitId,
        session_id: sessionId,
        message_count: messageCount,
        memory_fragment_id: fragmentId,
      }),
    });

    if (!response.ok) {
      fastify.log.warn(
        `Hub checkout notification failed: ${response.status} ${response.statusText}`
      );
    } else {
      fastify.log.info(`Hub notified of checkout (visit: ${visitId})`);
    }
  } catch (error) {
    fastify.log.error(`Hub checkout notification error: ${error}`);
    // Non-fatal: the visit is still valid even if hub notification fails
  }
}

// ─── WebSocket Setup ───

const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });

/**
 * Send a server event to an agent — works for both direct WS and relayed agents.
 */
function sendToAgent(agentId: string, event: ServerEvent): void {
  const ws = wsConnections.get(agentId);
  if (ws) {
    // Direct WebSocket connection
    try {
      ws.send(JSON.stringify(event), (err) => {
        if (err) {
          fastify.log.error(`Failed to send event to ${agentId}: ${err.message}`);
        }
      });
    } catch (error) {
      fastify.log.error(`Error sending event to ${agentId}: ${error}`);
    }
    return;
  }

  const sessionId = relayedAgents.get(agentId);
  if (sessionId && hubConnection) {
    // Relayed through hub
    hubConnection.send({
      type: 'relay_to_agent',
      agentId,
      sessionId,
      event: event as unknown as Record<string, unknown>,
    });
  }
}

/**
 * Send a server event to a direct WebSocket connection (legacy, used in direct WS handler)
 */
function sendEvent(ws: WebSocket, event: ServerEvent): void {
  try {
    ws.send(JSON.stringify(event), (err) => {
      if (err) {
        fastify.log.error(`Failed to send event: ${err.message}`);
      }
    });
  } catch (error) {
    fastify.log.error(`Error sending event: ${error}`);
  }
}

/**
 * Broadcast room state to all connected agents (direct + relayed)
 */
function broadcastRoomState(): void {
  const state = roomState.getState();
  const event: ServerEvent = {
    type: 'room_state',
    data: state,
  };

  // Direct WebSocket agents
  const eventJson = JSON.stringify(event);
  for (const ws of wsConnections.values()) {
    ws.send(eventJson, (err) => {
      if (err) {
        fastify.log.error(`Broadcast error: ${err.message}`);
      }
    });
  }

  // Relayed agents — send via hub as a single broadcast
  if (relayedAgents.size > 0 && hubConnection) {
    hubConnection.send({
      type: 'relay_broadcast',
      event: event as unknown as Record<string, unknown>,
    });
  }
}

/**
 * Close connection with error code and message
 */
function closeWithError(ws: WebSocket, code: number, reason: string): void {
  const event: ServerEvent = {
    type: 'error',
    data: {
      code: reason,
      message: reason,
    },
  };

  sendEvent(ws, event);
  ws.close(code, reason);
}

/**
 * Handle new WebSocket connection
 */
wss.on('connection', async (ws: WebSocket, req) => {
  const remoteIp = req.socket.remoteAddress;
  let agentId: string | null = null;
  let sessionId: string | null = null;

  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.authorization as string | undefined;
    const agentIdHeader = req.headers['x-openpub-agent-id'] as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      fastify.log.warn(`WebSocket connection from ${remoteIp} missing Authorization header`);
      return closeWithError(ws, 1008, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    const token = authHeader.slice(7); // Remove "Bearer "

    if (!agentIdHeader) {
      fastify.log.warn(`WebSocket connection from ${remoteIp} missing X-OpenPub-Agent-ID header`);
      return closeWithError(ws, 1008, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    agentId = agentIdHeader;

    // Validate JWT locally
    fastify.log.info(`Validating JWT for agent ${agentId}`);

    let claims;
    try {
      claims = await jwtValidator.validate(token);
    } catch (error) {
      if (error instanceof JwtValidationError) {
        fastify.log.warn(`JWT validation failed for ${agentId}: ${error.message}`);
        return closeWithError(ws, 1008, error.code);
      }
      throw error;
    }

    // Verify agent ID matches
    if (claims.sub !== agentId) {
      fastify.log.warn(`Agent ID mismatch: header=${agentId}, token=${claims.sub}`);
      return closeWithError(ws, 1008, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    // TODO: Hub check-in (verify reputation, capacity, bans, schedule)
    // For MVP, we skip hub check-in and rely on local JWT validation
    // This would be:
    // - POST to hub's /api/v1/agents/{agentId}/checkin with pub_id
    // - Verify agent is not banned, meets reputation, pub has capacity
    // - Get check-in token for session
    // - Store check-in token for later check-out

    // Create session
    sessionId = uuidv7();

    // Check pub capacity
    if (roomState.getPresence().length >= pubConfig.frontmatter.capacity) {
      fastify.log.warn(`Pub at capacity, rejecting ${agentId}`);
      return closeWithError(ws, 1009, ERROR_CODES.PUB_FULL);
    }

    // Check banned agents list
    if (pubConfig.frontmatter.banned_agents?.includes(agentId)) {
      fastify.log.warn(`Agent ${agentId} is banned, rejecting connection`);
      return closeWithError(ws, 1008, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    // Add agent to room
    const presence = roomState.addAgent(agentId, claims);

    // Register WebSocket connection
    wsConnections.set(agentId, ws);

    // Send welcome event
    const welcomeEvent: ServerEvent = {
      type: 'welcome',
      data: {
        session_id: sessionId || '',
        pub_name: pubConfig.frontmatter.name,
      },
    };
    sendEvent(ws, welcomeEvent);

    // Broadcast updated room state
    broadcastRoomState();

    fastify.log.info(`Agent ${agentId} connected (session: ${sessionId}, remote: ${remoteIp})`);

    // Bartender greets the newcomer
    const displayName = presence.display_name;
    const othersPresent = roomState.getPresence().filter((p) => p.agent_id !== agentId);
    const othersNames = othersPresent.map((p) => p.display_name).join(', ');
    const greetContext =
      othersPresent.length > 0
        ? `${displayName} just walked in. ${othersNames} ${othersPresent.length === 1 ? 'is' : 'are'} already here. Welcome them and introduce who's around.`
        : `${displayName} just walked in. They're the first one here. Welcome them warmly.`;
    triggerBartenderResponse(greetContext).catch((err) =>
      fastify.log.error(`Bartender greeting error: ${err}`)
    );

    // ─── Message Handler ───

    ws.on('message', async (rawData: Buffer) => {
      if (!agentId) return;

      try {
        const data = JSON.parse(rawData.toString());

        // Parse and validate event
        const event = ClientEvent.parse(data);

        switch (event.type) {
          case 'message': {
            // Check rate limit
            if (roomState.checkRateLimit(agentId)) {
              fastify.log.debug(`Rate limit hit for ${agentId} (message too frequent)`);
              const errorEvent: ServerEvent = {
                type: 'error',
                data: {
                  code: ERROR_CODES.RATE_LIMITED,
                  message: 'Messages must be at least 3 seconds apart',
                },
              };
              sendEvent(ws, errorEvent);
              return;
            }

            // Check message limit
            const presence = roomState.getPresence().find((p) => p.agent_id === agentId);
            if (
              presence &&
              presence.message_count >= pubConfig.frontmatter.max_messages_per_visit
            ) {
              fastify.log.info(`Message limit reached for ${agentId}`);
              const errorEvent: ServerEvent = {
                type: 'error',
                data: {
                  code: ERROR_CODES.MESSAGE_LIMIT_EXCEEDED,
                  message: `Message limit of ${pubConfig.frontmatter.max_messages_per_visit} reached`,
                },
              };
              sendEvent(ws, errorEvent);
              return;
            }

            // Auto-mod check
            const modResult = await autoModerator.checkMessage({
              content: event.content,
              agentId,
              displayName: presence?.display_name || 'unknown',
              roomRules: pubConfig.frontmatter.rules || '',
              adapter: llmAdapter,
              systemPrompt: pubConfig.personality,
            });

            if (!modResult.allowed) {
              fastify.log.warn(`Message from ${agentId} dropped by AutoMod: ${modResult.reason}`);
              const errorEvent: ServerEvent = {
                type: 'error',
                data: {
                  code: ERROR_CODES.INTERNAL_ERROR,
                  message: modResult.reason || 'Message dropped due to policy violation',
                },
              };
              sendEvent(ws, errorEvent);

              if (modResult.action === 'kick') {
                ws.close(1008, 'Kicked for violating rules');
              }
              return;
            }

            // Add message and broadcast
            roomState.addMessage(agentId, event.content, 'chat');
            broadcastRoomState();

            fastify.log.debug(`Message from ${agentId}: ${event.content.substring(0, 50)}...`);

            // Bartender response pacing: respond every N agent messages
            messagesSinceLastBartender++;
            if (messagesSinceLastBartender >= BARTENDER_RESPOND_EVERY_N) {
              messagesSinceLastBartender = 0;
              const agentName =
                roomState.getPresence().find((p) => p.agent_id === agentId)?.display_name ||
                'someone';
              triggerBartenderResponse(
                `${agentName} just said: "${event.content}". Respond naturally as the pub host.`
              ).catch((err) => fastify.log.error(`Bartender error: ${err}`));
            }
            break;
          }

          case 'action': {
            if (roomState.checkRateLimit(agentId)) {
              const errorEvent: ServerEvent = {
                type: 'error',
                data: {
                  code: ERROR_CODES.RATE_LIMITED,
                  message: 'Actions must be at least 3 seconds apart',
                },
              };
              sendEvent(ws, errorEvent);
              return;
            }

            roomState.addMessage(agentId, event.content, 'action');
            broadcastRoomState();

            fastify.log.debug(`Action from ${agentId}: ${event.content}`);
            break;
          }

          case 'checkout': {
            fastify.log.info(`Agent ${agentId} checking out`);

            // Get message count before agent is removed from room
            const checkoutPresence = roomState.getPresence().find((p) => p.agent_id === agentId);
            const messageCount = checkoutPresence?.message_count ?? 0;

            // Generate real memory fragment (LLM-powered + signed)
            const checkoutEvent = await generateFragment(agentId);

            // Notify hub of checkout (async, non-blocking)
            const fragmentData = (checkoutEvent as any).data;
            notifyHubCheckout(
              sessionId || uuidv7(),
              sessionId || '',
              messageCount,
              fragmentData?.fragment_id
            ).catch((err) => fastify.log.error(`Hub checkout notify error: ${err}`));

            // Send fragment to agent before closing connection
            await new Promise<void>((resolve) => {
              ws.send(JSON.stringify(checkoutEvent), (err) => {
                if (err) {
                  fastify.log.error(`Failed to send memory fragment: ${err.message}`);
                }
                resolve();
              });
            });

            ws.close(1000, 'checkout');
            break;
          }

          case 'heartbeat': {
            // Acknowledge heartbeat by sending current room state
            const state = roomState.getState();
            const stateEvent: ServerEvent = {
              type: 'room_state',
              data: state,
            };
            sendEvent(ws, stateEvent);
            break;
          }

          default: {
            fastify.log.warn(`Unknown event type from ${agentId}`);
          }
        }
      } catch (error) {
        fastify.log.error(`Message parsing error from ${agentId}: ${error}`);

        const errorEvent: ServerEvent = {
          type: 'error',
          data: {
            code: ERROR_CODES.INTERNAL_ERROR,
            message: 'Failed to parse message',
          },
        };
        sendEvent(ws, errorEvent);
      }
    });

    // ─── Connection Close Handler ───

    ws.on('close', () => {
      if (agentId) {
        roomState.removeAgent(agentId);
        wsConnections.delete(agentId);
        broadcastRoomState();

        fastify.log.info(`Agent ${agentId} disconnected (session: ${sessionId})`);
      }
    });

    // ─── Error Handler ───

    ws.on('error', (error: Error) => {
      if (agentId) {
        fastify.log.error(`WebSocket error for ${agentId}: ${error.message}`);
      } else {
        fastify.log.error(`WebSocket error: ${error.message}`);
      }
    });
  } catch (error) {
    fastify.log.error(`Unexpected error in WebSocket connection: ${error}`);
    closeWithError(ws, 1011, ERROR_CODES.INTERNAL_ERROR);
  }
});

// ─── HTTP Upgrade Handler ───

fastify.server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ─── Graceful Shutdown ───

const gracefulShutdown = async () => {
  fastify.log.info('Shutting down gracefully...');

  // Disconnect from hub
  if (hubConnection) {
    try {
      await hubConnection.disconnect();
    } catch (error) {
      fastify.log.error(`Error disconnecting from hub: ${error}`);
    }
  }

  // Close all WebSocket connections
  const closeEvent: ServerEvent = {
    type: 'recall',
    data: { reason: 'Server shutting down' },
  };

  for (const ws of wsConnections.values()) {
    const eventJson = JSON.stringify(closeEvent);
    ws.send(eventJson, () => {
      ws.close(1001, 'Server going away');
    });
  }

  wsConnections.clear();

  // Close HTTP server
  await fastify.close();
  fastify.log.info('Server shut down complete');
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ─── Start Server ───

const start = async () => {
  try {
    fastify.log.info(`Loading PUB.md from ${PUB_MD_PATH}`);

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`OpenPub pub server "${pubConfig.frontmatter.name}" running on port ${PORT}`);
    fastify.log.info(`Hub URL: ${HUB_URL}`);
    fastify.log.info(`Hub WS URL: ${HUB_WS_URL}`);

    // Initialize hub connection
    hubConnection = new HubConnection(
      {
        hubWsUrl: HUB_WS_URL,
        pubId,
        pubName: pubConfig.frontmatter.name,
        capacity: pubConfig.frontmatter.capacity,
        credentialId: PUB_CREDENTIAL_ID,
        credentialSecret: PUB_CREDENTIAL_SECRET,
        pubExternalWsUrl: PUB_EXTERNAL_WS_URL,
      },
      roomState,
      fragmentGenerator,
      llmAdapter,
      pubConfig.personality,
      wsConnections,
      pubConfig as any,
      fastify.log as any
    );

    // Set relay callbacks — handle agents connected through the hub
    hubConnection.setRelayCallbacks({
      onAgentConnected: (agentId, sessionId, displayName, claims) => {
        fastify.log.info(`Relayed agent connected: ${agentId} (${displayName})`);

        // Check capacity
        if (roomState.getPresence().length >= pubConfig.frontmatter.capacity) {
          fastify.log.warn(`Pub at capacity, cannot accept relayed agent ${agentId}`);
          return;
        }

        // Add to relayed agents map
        relayedAgents.set(agentId, sessionId);

        // Add agent to room state — construct claims shape from relay data
        const relayClaims = {
          agent: { display_name: displayName },
          reputation: { score: (claims.reputationScore as number) || 0 },
        };
        const presence = roomState.addAgent(agentId, relayClaims as any);

        // Send welcome
        sendToAgent(agentId, {
          type: 'welcome',
          data: {
            session_id: sessionId,
            pub_name: pubConfig.frontmatter.name,
          },
        });

        // Broadcast updated room state
        broadcastRoomState();

        // Bartender greets the newcomer
        const othersPresent = roomState.getPresence().filter((p) => p.agent_id !== agentId);
        const othersNames = othersPresent.map((p) => p.display_name).join(', ');
        const greetContext =
          othersPresent.length > 0
            ? `${displayName} just walked in. ${othersNames} ${othersPresent.length === 1 ? 'is' : 'are'} already here. Welcome them and introduce who's around.`
            : `${displayName} just walked in. They're the first one here. Welcome them warmly.`;
        triggerBartenderResponse(greetContext).catch((err) =>
          fastify.log.error(`Bartender greeting error: ${err}`)
        );
      },

      onAgentMessage: (agentId, _sessionId, event) => {
        if (!relayedAgents.has(agentId)) return;

        if (event.type === 'message' && event.content) {
          // Rate limit
          if (roomState.checkRateLimit(agentId)) {
            sendToAgent(agentId, {
              type: 'error',
              data: {
                code: ERROR_CODES.RATE_LIMITED,
                message: 'Messages must be at least 3 seconds apart',
              },
            });
            return;
          }

          // Message limit
          const presence = roomState.getPresence().find((p) => p.agent_id === agentId);
          if (presence && presence.message_count >= pubConfig.frontmatter.max_messages_per_visit) {
            sendToAgent(agentId, {
              type: 'error',
              data: {
                code: ERROR_CODES.MESSAGE_LIMIT_EXCEEDED,
                message: `Message limit of ${pubConfig.frontmatter.max_messages_per_visit} reached`,
              },
            });
            return;
          }

          // Add message and broadcast
          roomState.addMessage(agentId, event.content, 'chat');
          broadcastRoomState();

          // Bartender pacing
          messagesSinceLastBartender++;
          if (messagesSinceLastBartender >= BARTENDER_RESPOND_EVERY_N) {
            messagesSinceLastBartender = 0;
            const agentName = presence?.display_name || 'someone';
            triggerBartenderResponse(
              `${agentName} just said: "${event.content}". Respond naturally as the pub host.`
            ).catch((err) => fastify.log.error(`Bartender error: ${err}`));
          }
        } else if (event.type === 'action' && event.content) {
          if (roomState.checkRateLimit(agentId)) return;
          roomState.addMessage(agentId, event.content, 'action');
          broadcastRoomState();
        } else if (event.type === 'checkout') {
          fastify.log.info(`Relayed agent ${agentId} checking out`);
          const checkoutPresence = roomState.getPresence().find((p) => p.agent_id === agentId);
          const messageCount = checkoutPresence?.message_count ?? 0;

          generateFragment(agentId).then((fragmentEvent) => {
            sendToAgent(agentId, fragmentEvent);
            const fragmentData = (fragmentEvent as any).data;
            const sessionId = relayedAgents.get(agentId) || '';
            notifyHubCheckout(sessionId, sessionId, messageCount, fragmentData?.fragment_id).catch(
              (err) => fastify.log.error(`Hub checkout notify error: ${err}`)
            );
            roomState.removeAgent(agentId);
            relayedAgents.delete(agentId);
            broadcastRoomState();
          });
        }
      },

      onAgentDisconnected: (agentId, _sessionId) => {
        if (!relayedAgents.has(agentId)) return;
        fastify.log.info(`Relayed agent ${agentId} disconnected`);
        roomState.removeAgent(agentId);
        relayedAgents.delete(agentId);
        broadcastRoomState();
      },
    });

    // Connect to hub (non-blocking, reconnects automatically)
    hubConnection.connect().catch((error) => {
      fastify.log.error(`Initial hub connection failed: ${error}`);
    });

    fastify.log.info('Hub connection initialized');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
