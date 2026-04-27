/**
 * WebSocket Keepalive
 *
 * Arms a WebSocket to participate in the heartbeat loop. The shared
 * heartbeat sets `isAlive = false` and sends a ping every 30s; the
 * remote's pong response re-arms the flag. Connections found with
 * `isAlive === false` on the next tick are terminated as dead.
 *
 * Both the agent and spectator handlers must call this immediately
 * after registering the connection. Forgetting it causes the server
 * to terminate the connection ~30-60s after a successful join even
 * though the remote is healthy and auto-ponging.
 */

interface KeepaliveTarget {
  isAlive?: boolean;
  on: (event: 'pong', listener: () => void) => unknown;
}

export function armWsKeepalive(ws: KeepaliveTarget): void {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });
}
