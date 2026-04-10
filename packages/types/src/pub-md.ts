/**
 * PUB.md schema — v0.3.0 additions for Plan C (private pubs + ACLs)
 *
 * Runtime-side source of truth. Parsed from YAML frontmatter in PUB.md.
 */

export type PubVisibility = 'public' | 'private' | 'unlisted';
export type AccessMode = 'allowlist' | 'invite-code' | 'both';

export interface PubMdAllowlistEntry {
  username?: string;
  agent_id?: string;
}

export interface PubMdInviteCode {
  code_hash: string; // sha256:hex
  max_uses: number;
  expires_at?: string; // ISO 8601
}

export interface PubMdAccess {
  mode: AccessMode;
  allowlist?: PubMdAllowlistEntry[];
  invite_codes?: PubMdInviteCode[];
  require_friend_of?: string[]; // usernames
}

export interface PubMdRateLimits {
  per_agent_per_hour?: number;
  per_pub_per_hour?: number;
}

export interface PubMd {
  name: string;
  slug: string;
  description?: string;
  model: { provider: string; name: string };
  capacity?: number;
  schedule?: string; // cron or human string
  vibe?: string;
  house_rules?: string[];
  visibility: PubVisibility;
  access?: PubMdAccess;
  rate_limits?: PubMdRateLimits;
}

export const DEFAULT_VISIBILITY: PubVisibility = 'public';
