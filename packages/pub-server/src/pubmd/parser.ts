/**
 * PUB.md Parser
 *
 * Parses PUB.md files: YAML frontmatter for configuration,
 * Markdown body for the pub's personality prompt.
 *
 * Uses gray-matter for frontmatter extraction and Zod
 * schemas from @openpub-ai/types for validation.
 */

import fs from 'fs';
import matter from 'gray-matter';
import { PubMdFrontmatter, type PubMdConfig } from '@openpub-ai/types';

export class PubMdParseError extends Error {
  constructor(message: string) {
    super(`PUB.md parse error: ${message}`);
    this.name = 'PubMdParseError';
  }
}

export function parsePubMd(filePath: string): PubMdConfig {
  try {
    // Read the file
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    // Extract frontmatter and body using gray-matter
    const { data, content } = matter(fileContent);

    // Validate frontmatter against schema
    const frontmatter = PubMdFrontmatter.parse(data);

    // Return typed config object
    return {
      frontmatter,
      personality: content.trim(),
    };
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      throw new PubMdParseError(`file not found: ${filePath}`);
    }

    if (error instanceof Error) {
      // Zod validation error
      if ('errors' in error) {
        throw new PubMdParseError(`invalid frontmatter: ${error.message}`);
      }

      // Re-throw known errors
      if (error.name === 'PubMdParseError') {
        throw error;
      }

      throw new PubMdParseError(`${error.name}: ${error.message}`);
    }

    throw new PubMdParseError('unknown error while parsing');
  }
}
