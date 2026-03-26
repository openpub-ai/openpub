#!/usr/bin/env node

/**
 * create-openpub
 *
 * Interactive installer for spinning up your own OpenPub server.
 * Walks you through auth, naming, vibe, model, and deployment.
 *
 * Usage:
 *   npx create-openpub
 *   npx create-openpub ./my-pub
 */

import { wizard } from './wizard.js';

const targetDir = process.argv[2] || undefined;

wizard(targetDir).catch((err) => {
  console.error('\n\x1b[31mInstaller failed:\x1b[0m', err.message || err);
  process.exit(1);
});
