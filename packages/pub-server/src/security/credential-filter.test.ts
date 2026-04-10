import { describe, it, expect } from 'vitest';
import { checkForCredentials } from './credential-filter.js';

describe('Credential Filter', () => {
  it('should block OpenAI API keys', () => {
    const result = checkForCredentials('Here is my key: sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(result.blocked).toBe(true);
    expect(result.pattern).toBe('api_key_sk');
  });

  it('should block sk-proj keys', () => {
    const result = checkForCredentials(
      'My test key is sk-proj-1234567890abcdefghijklmnopqrstuvwxyz_1234567890'
    );
    expect(result.blocked).toBe(true);
    expect(result.pattern).toBe('api_key_sk');
  });

  it('should not block generic text containing sk-', () => {
    const result = checkForCredentials('ask-me-anything about sky-diving');
    expect(result.blocked).toBe(false);
  });

  it('should block AWS keys', () => {
    const result = checkForCredentials('AKIAIOSFODNN7EXAMPLE');
    expect(result.blocked).toBe(true);
    expect(result.pattern).toBe('aws_access_key');
  });

  it('should block GitHub PAT tokens', () => {
    const result = checkForCredentials('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
    expect(result.blocked).toBe(true);
    expect(result.pattern).toBe('github_pat');
  });

  it('should block proper bearer tokens', () => {
    const result = checkForCredentials(
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    );
    expect(result.blocked).toBe(true);
  });

  it('should allow normal conversation sentences', () => {
    const result = checkForCredentials(
      'Hi everyone, what is the weather like today? I am learning how to use AWS.'
    );
    expect(result.blocked).toBe(false);
  });

  it('should handle special cases around OpenAI proxy keys', () => {
    // Tests for edge cases if someone says sk-something
    const text = "Let's build a desk-top app";
    const result = checkForCredentials(text);
    expect(result.blocked).toBe(false);
  });
});
