/**
 * Hub Connection
 *
 * Persistent outbound WebSocket connection from pub to hub.
 * Handles reconnection with exponential backoff, heartbeats,
 * and message routing to handlers.
 */

import WebSocket from 'ws';
import type { Logger } from 'pino';
import { PROTOCOL_VERSION } from '@openpub-ai/types';
import type { RoomStateManager } from '../relay/room-state.js';
import type { MemoryFragmentGenerator } from '../memory/fragment-generator.js';
import type { WebSocket as WSType } from 'ws';
import type { WebSocket as FastifyWebSocket } from 'ws';

import {
  validateHubToPublishMessage,
  validateConnectionReady,
  type PubConnectionInit,
  type PublishToHubMessage,
  type HubToPublishMessage,
} from './message-types.js';
import { handleRecall } from './recall-handler.js';
import { handleAgentIncoming } from './agent-incoming-handler.js';
import type { PubConfig } from './agent-incoming-handler.js';
import type { LLMAdapter } from '../models/adapter.js';

export interface HubConnectionConfig {
  hubWsUrl: string;
  pubId: string;
  pubName: string;
  capacity: number;
  credentialId?: string;
  credentialSecret?: string;
  pubExternalWsUrl: string;
}

export class HubConnection {
  private ws: WSType | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = Infinity;
  private reconnectBaseDelayMs = 1000;
  private reconnectMaxDelayMs = 60000;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private heartbeatIntervalId: NodeJS.Timeout | null = null;
  private lastAckTime: number = Date.now();
  private startTime: number = Date.now();
  private isShuttingDown = false;
  private heartbeatIntervalMs = 30000; // Default, updated by server

  constructor(
    private config: HubConnectionConfig,
    private roomState: RoomStateManager,
    private fragmentGenerator: MemoryFragmentGenerator,
    private llmAdapter: LLMAdapter,
    private pubPersonality: string,
    private wsConnections: Map<string, WSType>,
    private pubConfig: PubConfig,
    private logger: Logger
  ) {}

  /**
   * Connect to the hub
   */
  async connect(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('Cannot connect: hub connection is shutting down');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.logger.debug('Hub connection already open');
      return;
    }

    try {
      this.logger.info(
        `Connecting to hub: ${this.config.hubWsUrl} (attempt ${this.reconnectAttempts + 1})`
      );

      this.ws = new WebSocket(this.config.hubWsUrl, {
        headers: {
          'User-Agent': `OpenPub/${PROTOCOL_VERSION}`,
        },
        // TODO: Add client certificate authentication if credentialId/Secret provided
      });

      this.ws.on('open', () => this.handleOpen());
      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('close', () => this.handleClose());
      this.ws.on('error', (error) => this.handleError(error));
    } catch (error) {
      this.logger.error(`Failed to create WebSocket connection: ${error}`);
      this.scheduleReconnect();
    }
  }

  /**
   * WebSocket open handler
   */
  private handleOpen = (): void => {
    this.logger.info('Connected to hub');
    this.reconnectAttempts = 0;

    // Send init handshake
    const init: PubConnectionInit = {
      type: 'init',
      pubId: this.config.pubId,
      pubName: this.config.pubName,
      version: PROTOCOL_VERSION,
      capacity: this.config.capacity,
    };

    this.send(init);
    this.startHeartbeat();
  };

  /**
   * WebSocket message handler
   */
  private handleMessage = (data: WebSocket.Data): void => {
    try {
      const messageStr = data.toString('utf-8');
      const parsed = JSON.parse(messageStr);

      // First, validate as hub→pub message
      const hubMessage = validateHubToPublishMessage(parsed);

      // If not a hub→pub message, check for connection_ready
      if (!hubMessage) {
        const readyMessage = validateConnectionReady(parsed);
        if (readyMessage) {
          this.logger.info(
            `Hub ready (heartbeat interval: ${readyMessage.heartbeatIntervalMs}ms)`
          );
          this.heartbeatIntervalMs = readyMessage.heartbeatIntervalMs;
          // Restart heartbeat with new interval
          this.stopHeartbeat();
          this.startHeartbeat();
          return;
        }

        this.logger.warn(`Received invalid message from hub: ${messageStr}`);
        return;
      }

      // Route the message
      this.routeMessage(hubMessage);
    } catch (error) {
      this.logger.error(`Error processing hub message: ${error}`);
    }
  };

  /**
   * Route incoming message to appropriate handler
   */
  private routeMessage(message: HubToPublishMessage): void {
    switch (message.type) {
      case 'heartbeat_ack':
        this.lastAckTime = Date.now();
        this.logger.debug('Received heartbeat ack from hub');
        break;

      case 'recall':
        handleRecall(
          message,
          this.roomState,
          this.fragmentGenerator,
          this.llmAdapter,
          this.pubPersonality,
          this.wsConnections,
          this,
          this.logger
        ).catch((error) => {
          this.logger.error(`Error in recall handler: ${error}`);
        });
        break;

      case 'agent_incoming':
        handleAgentIncoming(
          message,
          this.roomState,
          this.pubConfig,
          this.config.pubExternalWsUrl,
          this,
          this.logger
        ).catch((error) => {
          this.logger.error(`Error in agent_incoming handler: ${error}`);
        });
        break;

      case 'admin_command':
        this.logger.info(
          `Received admin command: ${message.command} (unimplemented)`
        );
        break;

      default: {
        const _exhaustive: never = message;
        this.logger.warn(`Unknown message type: ${_exhaustive}`);
      }
    }
  }

  /**
   * WebSocket close handler
   */
  private handleClose = (): void => {
    this.logger.info('Disconnected from hub');
    this.stopHeartbeat();

    if (!this.isShuttingDown) {
      this.scheduleReconnect();
    }
  };

  /**
   * WebSocket error handler
   */
  private handleError = (error: Error): void => {
    this.logger.error(`Hub WebSocket error: ${error.message}`);
  };

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimeoutId) {
      return;
    }

    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts),
      this.reconnectMaxDelayMs
    );

    // Add jitter (0-1 second)
    const jitter = Math.random() * 1000;
    const totalDelay = delay + jitter;

    this.logger.info(
      `Scheduling hub reconnection in ${Math.round(totalDelay)}ms (attempt ${this.reconnectAttempts + 1})`
    );

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.reconnectAttempts += 1;
      this.connect().catch((error) => {
        this.logger.error(`Reconnection attempt failed: ${error}`);
      });
    }, totalDelay);
  }

  /**
   * Compute enriched stats from room state and config
   */
  private computeEnrichedStats() {
    const presence = this.roomState.getPresence();
    const state = this.roomState.getState();

    // Reputation range from connected agents
    let minReputation = 1000;
    let maxReputation = 0;
    for (const agent of presence) {
      minReputation = Math.min(minReputation, agent.reputation_score);
      maxReputation = Math.max(maxReputation, agent.reputation_score);
    }

    // If no agents, set neutral range
    if (presence.length === 0) {
      minReputation = 0;
      maxReputation = 0;
    }

    // Parse model name and provider from config
    const modelString = this.pubConfig.frontmatter.model || 'unknown';
    const [modelProvider, modelName] = modelString.includes('-')
      ? modelString.split('-', 2)
      : ['unknown', modelString];

    return {
      connectedAgents: presence.length,
      capacity: this.config.capacity,
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage().heapUsed,
      activeTopics: state.atmosphere.active_topics.slice(0, 3),
      energyLevel: state.atmosphere.energy as 'quiet' | 'moderate' | 'lively' | 'intense',
      avgVisitDurationMinutes: 0, // TODO: compute from visit tracking
      reputationRange: {
        min: Math.max(0, minReputation),
        max: Math.min(1000, maxReputation),
      },
      modelProvider,
      modelName,
      visibility: this.pubConfig.frontmatter.visibility as 'transparent' | 'dim' | 'dark',
      hasWaitlist: false, // TODO: check if there's a queue of waiting agents
    };
  }

  /**
   * Start sending heartbeats
   */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      this.stopHeartbeat();
    }

    this.heartbeatIntervalId = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const stats = this.computeEnrichedStats();
        const message: PublishToHubMessage = {
          type: 'heartbeat',
          timestamp: new Date().toISOString(),
          stats,
        };

        this.send(message);
      }
    }, this.heartbeatIntervalMs);

    this.logger.debug(
      `Heartbeat started (interval: ${this.heartbeatIntervalMs}ms)`
    );
  }

  /**
   * Stop sending heartbeats
   */
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
      this.logger.debug('Heartbeat stopped');
    }
  }

  /**
   * Send a message to the hub
   */
  send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(
        `Cannot send message to hub: connection not open (state: ${this.ws?.readyState ?? 'null'})`
      );
      return;
    }

    try {
      const jsonStr = JSON.stringify(message);
      this.ws.send(jsonStr, (error) => {
        if (error) {
          this.logger.error(`Failed to send message to hub: ${error.message}`);
        }
      });
    } catch (error) {
      this.logger.error(`Error serializing message for hub: ${error}`);
    }
  }

  /**
   * Check if hub connection is open
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Gracefully disconnect from the hub
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting from hub...');
    this.isShuttingDown = true;

    // Cancel pending reconnection
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        // Send graceful disconnect message
        const disconnectMsg = {
          type: 'disconnect',
          reason: 'Pub server shutting down',
          timestamp: new Date().toISOString(),
        };
        this.send(disconnectMsg);

        // Give hub time to process
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 500);
          this.ws!.on('close', resolve);
        });
      } catch (error) {
        this.logger.debug(`Error sending disconnect message: ${error}`);
      }
    }

    if (this.ws) {
      this.ws.close(1000, 'Server shutting down');
      this.ws = null;
    }

    this.logger.info('Disconnected from hub');
  }

  /**
   * Get current connection stats
   */
  getStats() {
    return {
      isConnected: this.isConnected(),
      reconnectAttempts: this.reconnectAttempts,
      lastAckTime: new Date(this.lastAckTime).toISOString(),
      uptime: Date.now() - this.startTime,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
    };
  }
}
