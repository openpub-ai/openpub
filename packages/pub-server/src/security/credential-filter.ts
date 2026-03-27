/**
 * Credential Filter
 *
 * Scans messages for API keys and credentials before they're relayed.
 * If a match is found, the message is blocked entirely.
 * Never logs the message content — only the pattern that matched.
 */

const CREDENTIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  // OpenAI, Anthropic, DeepSeek
  { name: 'api_key_sk', pattern: /sk-[a-zA-Z0-9]{20,}/ },
  // AWS Access Key IDs
  { name: 'aws_access_key', pattern: /AKIA[A-Z0-9]{16}/ },
  // GitHub tokens
  { name: 'github_pat', pattern: /ghp_[a-zA-Z0-9]{36}/ },
  { name: 'github_oauth', pattern: /gho_[a-zA-Z0-9]{36}/ },
  { name: 'github_fine_grained', pattern: /github_pat_[a-zA-Z0-9_]{22,}/ },
  // Slack tokens
  { name: 'slack_bot', pattern: /xoxb-[a-zA-Z0-9-]+/ },
  { name: 'slack_user', pattern: /xoxp-[a-zA-Z0-9-]+/ },
  // Stripe keys
  { name: 'stripe_live', pattern: /sk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'stripe_test', pattern: /sk_test_[a-zA-Z0-9]{24,}/ },
  { name: 'stripe_restricted', pattern: /rk_live_[a-zA-Z0-9]{24,}/ },
  { name: 'stripe_publishable', pattern: /pk_live_[a-zA-Z0-9]{24,}/ },
  // SendGrid
  { name: 'sendgrid', pattern: /SG\.[a-zA-Z0-9\-_]{22,}/ },
  // npm tokens
  { name: 'npm_token', pattern: /npm_[a-zA-Z0-9]{36}/ },
  // Bearer tokens (long form)
  { name: 'bearer_token', pattern: /Bearer [a-zA-Z0-9\-._~+/]{40,}/ },
  // JWTs (three base64 segments)
  {
    name: 'jwt',
    pattern: /eyJ[a-zA-Z0-9\-_]{10,}\.eyJ[a-zA-Z0-9\-_]{10,}\.[a-zA-Z0-9\-_]{10,}/,
  },
];

export interface FilterResult {
  blocked: boolean;
  pattern?: string;
}

/**
 * Check if a message contains credentials.
 * Returns the name of the matching pattern if blocked.
 */
export function checkForCredentials(content: string): FilterResult {
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(content)) {
      return { blocked: true, pattern: name };
    }
  }
  return { blocked: false };
}
