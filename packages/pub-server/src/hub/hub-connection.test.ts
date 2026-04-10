import { describe, it, expect, vi } from 'vitest';
import { HubConnection } from './hub-connection.js';

describe('HubConnection: Version Warning Handler', () => {
  it('should log a clear warning when receiving a version_warning admin command', () => {
    // Mock the logger
    const mockLogger = {
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    // Instantiate HubConnection with minimal mocks for dependency injection
    const hubConnection = new HubConnection(
      {
        hubWsUrl: 'ws://localhost',
        pubId: 'test',
        pubName: 'test',
        capacity: 10,
        pubExternalWsUrl: 'ws://local',
      },
      {} as any, // roomState
      {} as any, // fragmentGen
      {} as any, // llmAdapter
      'test prompt',
      new Map(),
      { frontmatter: { name: 'test pub' } } as any, // pubConfig
      mockLogger as any
    );

    // Act: Simulate receiving the admin_command from hub
    const message = {
      type: 'admin_command',
      command: 'version_warning',
      payload: { message: 'Update required: version 0.1.7 is highly recommended.' },
    };
    (hubConnection as any).routeMessage(message);

    // Assert: It should output the specific warning log with the payload message
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('UPDATE AVAILABLE'));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Update required: version 0.1.7 is highly recommended.')
    );
  });

  it('should log standard admin commands differently', () => {
    const mockLogger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
    const hubConnection = new HubConnection(
      {
        hubWsUrl: 'ws://localhost',
        pubId: 'test',
        pubName: 'test',
        capacity: 10,
        pubExternalWsUrl: 'ws://local',
      },
      {} as any,
      {} as any,
      {} as any,
      '',
      new Map(),
      { frontmatter: {} } as any,
      mockLogger as any
    );

    const message = {
      type: 'admin_command',
      command: 'clear_cache',
    };
    (hubConnection as any).routeMessage(message);

    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Received admin command: clear_cache')
    );
  });
});
