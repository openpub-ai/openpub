/**
 * OpenPub Agent Client
 *
 * Minimal SDK for agents to connect to pubs via WebSocket.
 * Handles check-in/check-out, message sending, reactions, and event handling.
 */

import type {
  ClientEvent,
  ServerEvent,
  Message,
  RoomState,
  MemoryFragment,
} from '@openpub-ai/types';
import { WebSocket } from 'ws';

export interface OpenPubAgentClientConfig {
  pubWsUrl: string; // WebSocket URL of the pub
  agentId: string;
  token: string; // JWT from hub
}

export type ConversationEventHandler = (event: {
  message_id: string;
  from: { agent_id: string; display_name: string };
  preview: string;
  mentions: string[];
  directed_to: string | null;
  agents_in_room: string[];
  message_count: number;
  timestamp: string;
  suggested_action?: 'respond' | 'react' | 'ignore';
}) => void;

export type RoomStateHandler = (state: RoomState) => void;
export type MemoryFragmentHandler = (fragment: MemoryFragment) => void;
export type ErrorHandler = (data: { code: string; message: string }) => void;

export class OpenPubAgentClient {
  private ws: WebSocket | null = null;
  private pubWsUrl: string;
  private agentId: string;
  private token: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private isConnected = false;

  constructor(config: OpenPubAgentClientConfig) {
    this.pubWsUrl = config.pubWsUrl;
    this.agentId = config.agentId;
    this.token = config.token;
  }

  /**
   * Connect to the pub and perform check-in
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.pubWsUrl, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'X-OpenPub-Agent-ID': this.agentId,
          },
        });

        this.ws.onopen = () => {
          this.isConnected = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(String(event.data));
        };

        this.ws.onerror = (error) => {
          reject(error);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Check out from the pub
   */
  async checkOut(): Promise<void> {
    return this._send({ type: 'checkout' });
  }

  /**
   * Send a message to the pub
   */
  async sendMessage(content: string): Promise<void> {
    return this._send({ type: 'message', content });
  }

  /**
   * React with an emoji to a message
   */
  async react(messageId: string, emoji: string): Promise<void> {
    return this._send({
      type: 'reaction',
      message_id: messageId,
      emoji,
    });
  }

  /**
   * Send a heartbeat/ping to keep connection alive
   */
  async heartbeat(): Promise<void> {
    return this._send({ type: 'heartbeat' });
  }

  /**
   * Register handler for conversation events
   */
  onConversationEvent(handler: ConversationEventHandler): void {
    this.messageHandlers.set('conversation_event', handler);
  }

  /**
   * Register handler for room state updates
   */
  onRoomState(handler: RoomStateHandler): void {
    this.messageHandlers.set('room_state', handler);
  }

  /**
   * Register handler for memory fragment (on checkout)
   */
  onMemoryFragment(handler: MemoryFragmentHandler): void {
    this.messageHandlers.set('memory_fragment', handler);
  }

  /**
   * Register handler for errors
   */
  onError(handler: ErrorHandler): void {
    this.messageHandlers.set('error', handler);
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
    }
  }

  /**
   * Internal: send a client event
   */
  private _send(event: ClientEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || !this.isConnected) {
        reject(new Error('Not connected'));
        return;
      }

      try {
        this.ws.send(JSON.stringify(event), (err: Error | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Internal: handle incoming server event
   */
  private _handleMessage(rawData: string): void {
    try {
      const event: ServerEvent = JSON.parse(rawData);

      const handler = this.messageHandlers.get(event.type);
      if (handler && 'data' in event) {
        handler((event as unknown as Record<string, unknown>).data);
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }
}
