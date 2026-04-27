/**
 * Keepalive helper tests — guard against the v0.3.3 regression where
 * the agent handler skipped this setup and the heartbeat loop terminated
 * healthy connections after one cycle.
 */

import { describe, expect, it } from 'vitest';
import { armWsKeepalive } from './ws-keepalive.js';

function fakeWs() {
  const listeners: Record<string, Array<() => void>> = {};
  const ws = {
    isAlive: undefined as boolean | undefined,
    on(event: string, fn: () => void) {
      (listeners[event] ||= []).push(fn);
      return ws;
    },
    emit(event: string) {
      for (const fn of listeners[event] || []) fn();
    },
  };
  return ws;
}

describe('armWsKeepalive', () => {
  it('initializes isAlive to true', () => {
    const ws = fakeWs();
    armWsKeepalive(ws);
    expect(ws.isAlive).toBe(true);
  });

  it('re-arms isAlive when a pong is received', () => {
    const ws = fakeWs();
    armWsKeepalive(ws);
    // Simulate the heartbeat loop marking it as not-yet-confirmed
    ws.isAlive = false;
    ws.emit('pong');
    expect(ws.isAlive).toBe(true);
  });

  it('multiple pongs keep it true', () => {
    const ws = fakeWs();
    armWsKeepalive(ws);
    ws.isAlive = false;
    ws.emit('pong');
    ws.emit('pong');
    ws.emit('pong');
    expect(ws.isAlive).toBe(true);
  });
});
