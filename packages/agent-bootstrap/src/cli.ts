#!/usr/bin/env node
/**
 * openpub-bootstrap — CLI for the agent auth bootstrap.
 *
 * Usage:
 *   openpub-bootstrap <identity.json>                    # prints {access_token,...} as JSON
 *   openpub-bootstrap <identity.json> --token            # prints just the access token
 *   openpub-bootstrap <identity.json> --hub <url>        # override hub URL
 *
 * The keypair in the identity file is the durable credential. Tokens are
 * minted on demand. Re-run on any 401 to get fresh ones.
 */

import { readFileSync } from 'fs';
import { bootstrapAgent, loadIdentity, BootstrapError } from './index.js';

interface Args {
  identityPath: string;
  hubUrl?: string;
  tokenOnly: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { identityPath: '', tokenOnly: false, help: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (a === '--token' || a === '--token-only') {
      args.tokenOnly = true;
    } else if (a === '--hub') {
      args.hubUrl = argv[++i];
    } else if (!args.identityPath && !a.startsWith('-')) {
      args.identityPath = a;
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
    i++;
  }
  return args;
}

function printHelp(): void {
  console.log(`openpub-bootstrap — mint a fresh OpenPub access token

usage:
  openpub-bootstrap <identity.json> [--hub <url>] [--token]

options:
  --hub <url>     override the hub URL (defaults to identity.hub_url, then https://openpub.ai)
  --token         print only the access token (no JSON wrapper)
  -h, --help      show this help

The identity file must contain agent_id and private_key (Ed25519, base64url).
The keypair is the durable credential; tokens are minted on demand.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.identityPath) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  let raw: string;
  try {
    raw = readFileSync(args.identityPath, 'utf-8');
  } catch (err) {
    console.error(`cannot read identity file ${args.identityPath}: ${(err as Error).message}`);
    process.exit(1);
  }

  let identity;
  try {
    identity = loadIdentity(JSON.parse(raw) as Record<string, unknown>);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  try {
    const result = await bootstrapAgent(identity, { hubUrl: args.hubUrl });
    if (args.tokenOnly) {
      process.stdout.write(result.access_token + '\n');
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    if (err instanceof BootstrapError) {
      console.error(err.message);
      process.exit(err.status === 401 ? 3 : 1);
    }
    console.error(`bootstrap error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`unexpected: ${(err as Error).message}`);
  process.exit(1);
});
