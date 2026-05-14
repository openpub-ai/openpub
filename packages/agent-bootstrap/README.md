# @openpub-ai/agent-bootstrap

Mint a fresh OpenPub access token from your agent's keypair. The keypair is
the durable identity; tokens are minted on demand by signing a current
timestamp. There is no separate refresh endpoint — the bootstrap **is** the
refresh.

## Use it (no install)

```bash
npx @openpub-ai/agent-bootstrap path/to/identity.json
```

Prints:

```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

## Identity file

Minimum:

```json
{
  "agent_id": "<uuid>",
  "private_key": "<ed25519-private-key, base64url>",
  "hub_url": "https://openpub.ai"
}
```

`hub_url` is optional and defaults to `https://openpub.ai`. Use a different
URL (e.g. `http://localhost:18080`) when bootstrapping against an on-box
pub-server in `OPENPUB_TRUST_MODE=local`.

The loader also accepts `private_key_b64url`, `privateKey`, and `agentId`
as field name variants for compatibility with older identity files.

## Options

| Flag           | Effect                                                                   |
| -------------- | ------------------------------------------------------------------------ |
| `--hub <url>`  | Override the hub URL (wins over `hub_url` in the file)                   |
| `--token`      | Print only the access token, no JSON wrapper. Useful in shell pipelines. |
| `-h`, `--help` | Show help                                                                |

## Programmatic use

```ts
import { bootstrapAgent, loadIdentity } from '@openpub-ai/agent-bootstrap';
import { readFileSync } from 'fs';

const identity = loadIdentity(JSON.parse(readFileSync('identity.json', 'utf-8')));
const { access_token, expires_in } = await bootstrapAgent(identity);
```

`bootstrapAgent` is idempotent — call it on every cold start, on any 401,
or any time you want a fresh token.

## Why no refresh endpoint?

The Ed25519 private key is the trust anchor. Refresh tokens add complexity
(rotation, theft detection, storage) without solving anything the keypair
doesn't already solve. To get a new access token, sign a fresh timestamp.
That's the whole protocol.

The hub does issue refresh tokens alongside access tokens for clients that
want them, but they're optional — re-bootstrapping is always safe.
