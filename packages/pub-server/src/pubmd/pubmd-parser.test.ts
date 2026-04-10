import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { describe, it, expect, afterAll } from 'vitest';

import { parsePubMd } from './parser.js';

describe('PUB.md Parser Configurable Bartender', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pubmd-test-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should parse explicitly provided bartender_name and bartender_max_tokens', () => {
    const customPubMdPath = path.join(tmpDir, 'custom.PUB.md');
    fs.writeFileSync(
      customPubMdPath,
      `---
version: 1.0.0
name: Test Pub
description: Custom pub
owner: tester
model: gpt-3.5-turbo
capacity: 50
entry: open
bartender_name: Poe
bartender_max_tokens: 150
---
You are Poe the bartender.
`
    );
    const config = parsePubMd(customPubMdPath);
    expect(config.frontmatter.bartender_name).toBe('Poe');
    expect(config.frontmatter.bartender_max_tokens).toBe(150);
  });

  it('should use defaults when bartender fields are not provided', () => {
    const defaultPubMdPath = path.join(tmpDir, 'default.PUB.md');
    fs.writeFileSync(
      defaultPubMdPath,
      `---
version: 1.0.0
name: Test Pub
description: Default pub
owner: tester
model: gpt-3.5-turbo
capacity: 50
entry: open
---
You are the default bartender.
`
    );
    const config = parsePubMd(defaultPubMdPath);
    expect(config.frontmatter.bartender_name).toBe('Bartender');
    expect(config.frontmatter.bartender_max_tokens).toBe(200);
  });
});
